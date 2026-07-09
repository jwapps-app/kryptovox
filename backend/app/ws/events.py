"""WebSocket event envelopes and Redis channel naming.

Every realtime message is a JSON envelope: {"type": ..., "payload": {...}}.
Fanout happens over Redis pub/sub so that any uvicorn/gunicorn worker can
deliver to a client connected to any other worker.
"""
from typing import Any

# Event type constants (mirror the frontend store)
MESSAGE_NEW = "message.new"
MESSAGE_EDIT = "message.edit"
MESSAGE_DELETE = "message.delete"
MESSAGE_DISAPPEAR_START = "message.disappear_start"
RECEIPT_DELIVERED = "receipt.delivered"
RECEIPT_READ = "receipt.read"
TYPING_START = "typing.start"
TYPING_STOP = "typing.stop"
CONVERSATION_UPDATED = "conversation.updated"
REACTION_ADD = "reaction.add"
REACTION_REMOVE = "reaction.remove"
GUEST_REPLY = "guest.reply"


def user_channel(user_id: str) -> str:
    return f"user:{user_id}"


def thread_channel(thread_id: str) -> str:
    # Secret-link threads: a public, link-scoped channel both the host and the
    # anonymous guest subscribe to (used for call signaling).
    return f"thread:{thread_id}"


def envelope(event_type: str, payload: dict[str, Any]) -> dict[str, Any]:
    return {"type": event_type, "payload": payload}
