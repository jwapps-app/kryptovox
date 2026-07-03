"""1:1 WebRTC call signaling — relay + ring.

The server never sees call media (WebRTC is peer-to-peer, DTLS-SRTP encrypted);
it only forwards the setup messages (SDP offer/answer + ICE candidates) between
two users who share a conversation. On an offer it also "rings" the callee —
buffers the offer briefly and pushes their offline/background devices — so a call
reaches them even when their app isn't focused (mirrors the secret-link flow).
"""
import asyncio
import json
import uuid

from app.database import SessionLocal
from app.models import ConversationMember, User
from app.redis_client import redis
from app.services.fanout import fanout_user
from app.services.push import notify_call
from app.ws.events import envelope

CALL_EVENTS = {
    "call.offer",
    "call.answer",
    "call.ice",
    "call.hangup",
    "call.decline",
    "call.busy",
    "call.ringing",
}

_OFFER_KEY = "call_offer_user:{}"  # buffered incoming offer per callee (TTL'd)
_OFFER_TTL = 60  # long enough to open the app from a push and answer

# Keep strong refs to fire-and-forget push tasks so they aren't GC'd mid-flight.
_bg_tasks: set[asyncio.Task] = set()


def _fire(coro) -> None:
    t = asyncio.create_task(coro)
    _bg_tasks.add(t)
    t.add_done_callback(_bg_tasks.discard)


async def relay_call_event(from_user_id: uuid.UUID, data: dict) -> None:
    """Forward a call.* event to the `to` user. Both parties must belong to the
    named conversation — no cold-calling arbitrary users."""
    payload = data.get("payload") or {}
    to = payload.get("to")
    conversation_id = payload.get("conversation_id")
    if not to or not conversation_id:
        return
    try:
        to_uuid = uuid.UUID(str(to))
        conv_uuid = uuid.UUID(str(conversation_id))
    except ValueError:
        return
    event_type = data["type"]

    async with SessionLocal() as db:
        if await db.get(ConversationMember, (conv_uuid, from_user_id)) is None:
            return
        if await db.get(ConversationMember, (conv_uuid, to_uuid)) is None:
            return
        caller = await db.get(User, from_user_id) if event_type == "call.offer" else None

    out = dict(payload)
    out["from"] = str(from_user_id)
    env = envelope(event_type, out)
    await fanout_user(to_uuid, env)  # deliver to the callee's live socket(s)

    if event_type == "call.offer":
        # Buffer so the callee can still answer after opening from a push, and
        # ring their offline/background devices.
        try:
            await redis.set(_OFFER_KEY.format(to_uuid), json.dumps(env), ex=_OFFER_TTL)
        except Exception:  # noqa: BLE001
            pass
        caller_name = (caller.display_name or caller.username) if caller else "Someone"
        _fire(notify_call(to_uuid, caller_name, conv_uuid))
    elif event_type in ("call.answer", "call.hangup", "call.decline"):
        try:
            await redis.delete(
                _OFFER_KEY.format(to_uuid), _OFFER_KEY.format(from_user_id)
            )
        except Exception:  # noqa: BLE001
            pass


async def deliver_buffered_offer(websocket, user_id: uuid.UUID) -> None:
    """On WS connect: hand over any incoming call offer buffered while offline."""
    try:
        buffered = await redis.get(_OFFER_KEY.format(user_id))
        if buffered:
            await websocket.send_json(json.loads(buffered))
    except Exception:  # noqa: BLE001
        pass
