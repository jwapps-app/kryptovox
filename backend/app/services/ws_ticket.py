"""Short-lived, single-use WebSocket tickets.

A WebSocket handshake can't carry an Authorization header from a browser, so
the credential has to ride in the URL. Putting the bearer access token there
means it lands in every access log and proxy trace on the path. Instead the
client trades its bearer for a 30-second, one-shot ticket (this module) and
opens the socket with that: a logged ticket is already spent.

Tickets live in Redis; if Redis is down no socket can be opened (the hub
needs Redis anyway, so that isn't a new failure mode).
"""
import secrets
import uuid

from app.redis_client import redis

TTL_SECONDS = 30
_KEY = "ws_ticket:{}"


async def issue(user_id: uuid.UUID, device_id: uuid.UUID) -> str:
    ticket = secrets.token_urlsafe(32)
    await redis.set(_KEY.format(ticket), f"{user_id}:{device_id}", ex=TTL_SECONDS, nx=True)
    return ticket


async def redeem(ticket: str) -> tuple[uuid.UUID, uuid.UUID] | None:
    """Consume a ticket. Returns (user_id, device_id) once; None if the ticket
    is unknown, expired, already used, or Redis is unavailable."""
    if not ticket or len(ticket) > 128:
        return None
    try:
        raw = await redis.getdel(_KEY.format(ticket))
    except Exception:  # noqa: BLE001 — treat an unreachable Redis as "no ticket"
        return None
    if not raw:
        return None
    try:
        user_s, device_s = raw.split(":", 1)
        return uuid.UUID(user_s), uuid.UUID(device_s)
    except ValueError:
        return None
