"""1:1 WebRTC call signaling — relay, ring, and offline buffering.

The server never sees call media (WebRTC is peer-to-peer, DTLS-SRTP encrypted);
it only forwards the setup messages (SDP offer/answer + ICE candidates) between
two users who share a conversation.

Every `call.*` is routed ONLY to the `to` user's devices — never echoed back to
the sender (a caller that sees its own offer would conclude "busy"). On an offer
we also "ring" an offline callee: buffer the whole signaling stream and send a
wake-up push (VoIP → CallKit, else web/APNs alert), so a call reaches them even
when their app is closed.
"""
import asyncio
import json
import uuid

from app.database import SessionLocal
from app.models import ConversationMember, User
from app.redis_client import redis
from app.services.fanout import fanout_user
from app.services.push import ring_call
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

# While a callee is offline (waking from a push), queue EVERY call.* addressed to
# them — offer, then ICE, maybe hangup — and flush in order when their WS connects.
# Without this the callee answers but ICE never arrives and the call hangs at
# "Connecting…".
_QUEUE_KEY = "call_queue_user:{}"
_QUEUE_TTL = 60  # seconds — drop a stale, never-answered call
_QUEUE_MAX = 64  # cap the backlog (offer + a burst of ICE candidates)
_CLEAR_EVENTS = {"call.answer", "call.hangup", "call.decline"}

# Keep strong refs to fire-and-forget push tasks so they aren't GC'd mid-flight.
_bg_tasks: set[asyncio.Task] = set()


def _fire(coro) -> None:
    t = asyncio.create_task(coro)
    _bg_tasks.add(t)
    t.add_done_callback(_bg_tasks.discard)


async def _queue_event(user_id: uuid.UUID, env: dict) -> None:
    try:
        key = _QUEUE_KEY.format(user_id)
        await redis.rpush(key, json.dumps(env))
        await redis.ltrim(key, -_QUEUE_MAX, -1)
        await redis.expire(key, _QUEUE_TTL)
    except Exception:  # noqa: BLE001
        pass


async def _clear_queue(*user_ids: uuid.UUID) -> None:
    try:
        await redis.delete(*[_QUEUE_KEY.format(u) for u in user_ids])
    except Exception:  # noqa: BLE001
        pass


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
    # Deliver ONLY to the callee's live socket(s); never back to the caller.
    await fanout_user(to_uuid, env)

    # Buffer every signaling frame so a callee waking from a push gets the offer +
    # any ICE that arrived during the wake-up, flushed in order on WS connect.
    # Buffering unconditionally (not gated on presence) is deliberate: presence is
    # per-device, so a second online session must not stop a closed device's flush.
    # It's harmless when the callee is already connected — they don't reconnect
    # mid-call, and the client dedupes a replayed offer. Cleared when the call ends.
    if event_type not in _CLEAR_EVENTS:
        await _queue_event(to_uuid, env)

    if event_type == "call.offer":
        caller_name = (caller.display_name or caller.username) if caller else "Someone"
        _fire(ring_call(to_uuid, caller_name, conv_uuid, out))
    elif event_type in _CLEAR_EVENTS:
        # Call resolved — drop any buffered signaling for both directions.
        await _clear_queue(to_uuid, from_user_id)


async def deliver_buffered_calls(websocket, user_id: uuid.UUID) -> None:
    """On WS connect: flush, in order, any call.* buffered while this user was
    offline — so opening the app (e.g. from a call push) rings them and ICE that
    arrived during the wake-up still lands."""
    try:
        key = _QUEUE_KEY.format(user_id)
        items = await redis.lrange(key, 0, -1)
        await redis.delete(key)
    except Exception:  # noqa: BLE001
        return
    for raw in items:
        try:
            await websocket.send_json(json.loads(raw))
        except Exception:  # noqa: BLE001
            break
