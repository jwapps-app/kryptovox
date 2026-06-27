"""Public, link-scoped WebSocket for secret-link threads — carries 1:1 call
signaling between a registered host and an anonymous guest.

Authorization is possession of the thread id (same model as the rest of secret
links). It only relays call.* signaling; media is peer-to-peer (DTLS-SRTP), never
touching the server. Entirely self-contained: deleting this file + its include in
main.py removes secret-link calling with no other impact.

When the guest places a call we also "ring" the host out-of-band so they don't
have to be sitting on the thread page: an in-app event on their main socket, a
web push if they're backgrounded, and the offer is buffered briefly so it's still
deliverable once they open the thread.
"""
import json
import uuid

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from jwt import PyJWTError as JWTError

from app.database import SessionLocal
from app.models import GuestThread
from app.redis_client import redis
from app.security import decode_access_token
from app.services.fanout import fanout_user
from app.services.push import notify_user
from app.ws.events import envelope
from app.ws.hub import hub

router = APIRouter()

_OFFER_KEY = "call_offer:{}"  # buffered guest offer per thread (TTL'd)
_OFFER_TTL = 90  # seconds — long enough to open the app from a push and answer
_RELAY = {"call.offer", "call.answer", "call.ice", "call.hangup", "call.decline", "call.busy"}


async def _thread(thread_id: uuid.UUID) -> GuestThread | None:
    async with SessionLocal() as db:
        thread = await db.get(GuestThread, thread_id)
        if thread is None:
            return None
        from datetime import UTC, datetime

        if thread.expires_at and thread.expires_at <= datetime.now(UTC):
            return None
        return thread


async def _is_host(token: str, creator_id: uuid.UUID) -> bool:
    if not token:
        return False
    try:
        claims = decode_access_token(token)
        return uuid.UUID(claims["sub"]) == creator_id
    except (JWTError, KeyError, ValueError):
        return False


async def _ring_host(creator_id: uuid.UUID, thread_id: uuid.UUID, name: str) -> None:
    # In-app: surfaces an "incoming call" banner if the host has the app open
    # anywhere. Push: reaches them if backgrounded/closed (notify_user skips
    # devices that are currently online, so the two don't double-ring).
    await fanout_user(
        creator_id,
        envelope("call.incoming", {"thread_id": str(thread_id), "name": name}),
    )
    try:
        async with SessionLocal() as db:
            await notify_user(
                db,
                creator_id,
                {
                    "title": "Incoming call",
                    "body": f"{name} is calling you on your secret link.",
                    "url": f"/links/{thread_id}",
                    "type": "call",
                },
            )
    except Exception:  # noqa: BLE001 — push is best-effort
        pass


async def _buffer_offer(thread_id: uuid.UUID, env: dict) -> None:
    try:
        await redis.set(_OFFER_KEY.format(thread_id), json.dumps(env), ex=_OFFER_TTL)
    except Exception:  # noqa: BLE001
        pass


async def _clear_offer(thread_id: uuid.UUID) -> None:
    try:
        await redis.delete(_OFFER_KEY.format(thread_id))
    except Exception:  # noqa: BLE001
        pass


@router.websocket("/guest-ws/{thread_id}")
async def guest_ws(websocket: WebSocket, thread_id: uuid.UUID, token: str = "") -> None:
    thread = await _thread(thread_id)
    if thread is None:
        await websocket.close(code=4404)
        return
    is_host = await _is_host(token, thread.creator_id)

    await websocket.accept()
    websocket._kv_src = uuid.uuid4().hex  # type: ignore[attr-defined]
    tid = str(thread_id)
    hub.register_thread(websocket, tid)

    # Host just arrived → hand them any call invite that came in while they were away.
    if is_host:
        try:
            buffered = await redis.get(_OFFER_KEY.format(thread_id))
            if buffered:
                await websocket.send_json(json.loads(buffered))
        except Exception:  # noqa: BLE001
            pass

    try:
        while True:
            data = await websocket.receive_json()
            event_type = data.get("type")
            if event_type not in _RELAY:
                continue
            payload = dict(data.get("payload") or {})
            env = envelope(event_type, payload)
            env["_src"] = websocket._kv_src  # type: ignore[attr-defined]
            await hub.publish_thread(tid, env)

            if event_type == "call.offer" and not is_host:
                await _buffer_offer(thread_id, env)
                await _ring_host(
                    thread.creator_id, thread_id, str(payload.get("name") or "Someone")
                )
            elif event_type in ("call.answer", "call.hangup", "call.decline"):
                await _clear_offer(thread_id)
    except WebSocketDisconnect:
        pass
    except Exception:  # noqa: BLE001
        pass
    finally:
        hub.unregister_thread(websocket, tid)
        # If the guest drops mid-call, tell the host so their UI resets.
        if not is_host:
            await _clear_offer(thread_id)
            try:
                await hub.publish_thread(tid, envelope("call.hangup", {}))
            except Exception:  # noqa: BLE001
                pass
