"""Public, link-scoped WebSocket for secret-link threads — carries 1:1 call
signaling between a registered host and an anonymous guest.

Authorization is possession of the thread id (same model as the rest of secret
links). It only relays call.* signaling; media is peer-to-peer (DTLS-SRTP), never
touching the server. Entirely self-contained: deleting this file + its include in
main.py removes secret-link calling with no other impact.

Abuse controls (the guest is anonymous and only semi-trusted):
  - Origin check on the handshake (no cross-site socket opening / CSWSH).
  - Per-thread ring rate limit so a link holder can't spam the host's push.
  - `name` is length-capped and stripped (it lands in a push body / banner).
  - Relayed payloads are key-whitelisted and size-capped (no 16 MiB amplifier).
  - A call is paired to one guest + one host: the second party's frames are
    targeted (`_to`) so ICE/answers don't leak to other link holders, and a
    second concurrent offerer is rejected.
"""
import json
import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from jwt import PyJWTError as JWTError

from app.config import settings
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
_CALL_KEY = "call_state:{}"  # {"guest": src, "host": src|null} while a call is live
_RING_KEY = "call_ring:{}"  # ring counter per thread (rate limit window)
_OFFER_TTL = 90  # seconds — long enough to open the app from a push and answer
_RING_WINDOW = 60  # seconds
_RING_MAX = 4  # host rings allowed per window per thread
_MAX_FRAME = 16 * 1024  # 16 KiB — an SDP offer is a few KB; reject anything larger
_ALLOWED_KEYS = {"sdp", "candidate", "video", "name"}
_RELAY = {"call.offer", "call.answer", "call.ice", "call.hangup", "call.decline", "call.busy"}


def _origin_ok(websocket: WebSocket) -> bool:
    origin = websocket.headers.get("origin")
    # No Origin header at all = a non-browser client (native app / curl); allow,
    # since CSWSH is specifically a *browser* ambient-credential attack. A present
    # Origin must be in the allowlist.
    return origin is None or origin in settings.cors_origins


def _clean_name(v: object) -> str:
    s = "".join(ch for ch in str(v or "")[:64] if ch.isprintable()).strip()
    return s[:40] or "Someone"


def _clean_payload(payload: dict) -> dict:
    p = {k: payload[k] for k in _ALLOWED_KEYS if k in payload}
    if "name" in p:
        p["name"] = _clean_name(p["name"])
    return p


async def _thread(thread_id: uuid.UUID) -> GuestThread | None:
    """Return the thread iff it exists and hasn't expired (revocation deletes it)."""
    async with SessionLocal() as db:
        thread = await db.get(GuestThread, thread_id)
        if thread is None:
            return None
        if thread.expires_at and thread.expires_at <= datetime.now(UTC):
            return None
        return thread


async def _still_active(thread_id: uuid.UUID) -> bool:
    return await _thread(thread_id) is not None


async def _is_host(token: str, creator_id: uuid.UUID) -> bool:
    if not token:
        return False
    try:
        claims = decode_access_token(token)
        return uuid.UUID(claims["sub"]) == creator_id
    except (JWTError, KeyError, ValueError):
        return False


async def _ring_allowed(thread_id: uuid.UUID) -> bool:
    """Token-bucket-ish limit so a link holder can't spam host notifications."""
    try:
        key = _RING_KEY.format(thread_id)
        n = await redis.incr(key)
        if n == 1:
            await redis.expire(key, _RING_WINDOW)
        return n <= _RING_MAX
    except Exception:  # noqa: BLE001 — if Redis is down, don't block the ring
        return True


async def _ring_host(creator_id: uuid.UUID, thread_id: uuid.UUID, name: str) -> None:
    await fanout_user(
        creator_id,
        envelope("call.incoming", {"thread_id": str(thread_id), "name": name}),
    )
    try:
        await notify_user(
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


async def _rset(key: str, value: str, ttl: int) -> None:
    try:
        await redis.set(key, value, ex=ttl)
    except Exception:  # noqa: BLE001
        pass


async def _rget(key: str) -> str | None:
    try:
        return await redis.get(key)
    except Exception:  # noqa: BLE001
        return None


async def _rdel(*keys: str) -> None:
    try:
        await redis.delete(*keys)
    except Exception:  # noqa: BLE001
        pass


@router.websocket("/guest-ws/{thread_id}")
async def guest_ws(websocket: WebSocket, thread_id: uuid.UUID, token: str = "") -> None:
    if not _origin_ok(websocket):
        await websocket.close(code=4403)
        return
    thread = await _thread(thread_id)
    if thread is None:
        await websocket.close(code=4404)
        return
    is_host = await _is_host(token, thread.creator_id)

    await websocket.accept()
    src = uuid.uuid4().hex
    websocket._kv_src = src  # type: ignore[attr-defined]
    tid = str(thread_id)
    offer_key, call_key = _OFFER_KEY.format(tid), _CALL_KEY.format(tid)
    hub.register_thread(websocket, tid)

    # Host just arrived → record presence (so a guest's offer targets us directly
    # rather than broadcasting to other link holders) and hand over any call
    # invite buffered while we were away.
    if is_host:
        st = json.loads(await _rget(call_key) or "{}")
        st["host"] = src
        await _rset(call_key, json.dumps(st), _OFFER_TTL)
        buffered = await _rget(offer_key)
        if buffered:
            try:
                await websocket.send_json(json.loads(buffered))
            except Exception:  # noqa: BLE001
                pass

    try:
        while True:
            raw = await websocket.receive_text()
            if len(raw) > _MAX_FRAME:
                continue  # oversized — drop before parsing/relaying
            try:
                data = json.loads(raw)
            except (ValueError, TypeError):
                continue
            event_type = data.get("type")
            if event_type not in _RELAY:
                continue
            # Re-check per frame: if the host revoked the link or it expired mid-
            # call, stop relaying (previously only checked on a new offer).
            if not await _still_active(thread_id):
                await websocket.close(code=4410)
                return
            payload = _clean_payload(dict(data.get("payload") or {}))

            state = json.loads(await _rget(call_key) or "{}")
            guest_src, host_src = state.get("guest"), state.get("host")

            # Only the host may answer; a non-host answer is dropped.
            if event_type == "call.answer" and not is_host:
                continue

            # Target the paired peer where known, so a third link holder never
            # receives the media negotiation (ICE/answer) and can't inject.
            env = envelope(event_type, payload)
            env["_src"] = src
            to = None
            if is_host and guest_src:
                to = guest_src
            elif not is_host and host_src:
                to = host_src
            if to:
                env["_to"] = to

            if event_type == "call.offer" and not is_host:
                # One live guest call per thread: reject a competing second offerer.
                if guest_src and guest_src != src:
                    continue
                if not await _still_active(thread_id):
                    await websocket.close(code=4410)
                    return
                await _rset(call_key, json.dumps({"guest": src, "host": host_src}), _OFFER_TTL)
                await _rset(offer_key, json.dumps(env), _OFFER_TTL)
                await hub.publish_thread(tid, env)  # broadcast so the host picks it up
                if await _ring_allowed(thread_id):
                    await _ring_host(thread.creator_id, thread_id, str(payload.get("name") or "Someone"))
                continue

            if event_type == "call.answer" and is_host:
                await _rset(call_key, json.dumps({"guest": guest_src, "host": src}), _OFFER_TTL)
                await _rdel(offer_key)

            await hub.publish_thread(tid, env)

            if event_type in ("call.hangup", "call.decline"):
                await _rdel(offer_key, call_key)
    except WebSocketDisconnect:
        pass
    except Exception:  # noqa: BLE001
        pass
    finally:
        hub.unregister_thread(websocket, tid)
        # If the guest drops mid-call, tell the host so their UI resets.
        if not is_host:
            await _rdel(offer_key, call_key)
            try:
                await hub.publish_thread(tid, envelope("call.hangup", {}))
            except Exception:  # noqa: BLE001
                pass
