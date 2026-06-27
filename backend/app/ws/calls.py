"""1:1 WebRTC call signaling — pure relay, no state, no DB writes.

The server never sees call media (WebRTC is peer-to-peer, DTLS-SRTP encrypted);
it only forwards the setup messages (SDP offer/answer + ICE candidates) between
two users who share a conversation. Entirely self-contained: deleting this file
and its one call site in ws/endpoint.py removes calling with no other impact.
"""
import uuid

from app.database import SessionLocal
from app.models import ConversationMember
from app.services.fanout import fanout_user
from app.ws.events import envelope

# call.offer/answer/ice set up the connection; hangup/decline/busy tear it down;
# ringing tells the caller the callee's device received the invite.
CALL_EVENTS = {
    "call.offer",
    "call.answer",
    "call.ice",
    "call.hangup",
    "call.decline",
    "call.busy",
    "call.ringing",
}


async def relay_call_event(from_user_id: uuid.UUID, data: dict) -> None:
    """Forward a call.* event to the `to` user, stamped with `from`. Both parties
    must belong to the named conversation — no cold-calling arbitrary users."""
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

    async with SessionLocal() as db:
        if await db.get(ConversationMember, (conv_uuid, from_user_id)) is None:
            return
        if await db.get(ConversationMember, (conv_uuid, to_uuid)) is None:
            return

    out = dict(payload)
    out["from"] = str(from_user_id)
    await fanout_user(to_uuid, envelope(data["type"], out))
