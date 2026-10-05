"""Session revocation helper.

Refresh tokens outlive a single request (up to REFRESH_TOKEN_EXPIRE_DAYS), so a
password change or account recovery must invalidate them explicitly — otherwise
a stolen session survives the very action taken to end it. Access tokens are
short-lived (stateless JWT) and expire on their own within minutes.
"""
import uuid

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AuthToken, Device
from app.ws.hub import hub


async def revoke_sessions(
    db: AsyncSession,
    user_id: uuid.UUID,
    *,
    except_device_id: uuid.UUID | None = None,
) -> None:
    """Revoke the user's refresh tokens. Pass except_device_id to keep the
    caller's own session alive (password change); omit it to revoke all
    (recovery, where there is no current session)."""
    devices = select(Device.id).where(Device.user_id == user_id)
    stmt = (
        update(AuthToken)
        .where(AuthToken.device_id.in_(devices), AuthToken.revoked.is_(False))
        .values(revoked=True)
    )
    if except_device_id is not None:
        stmt = stmt.where(AuthToken.device_id != except_device_id)
    await db.execute(stmt)
    # Also terminate those devices' LIVE sockets: a refresh-token revoke alone
    # leaves an already-open WebSocket streaming until its access token expires.
    rows = await db.execute(select(Device.id).where(Device.user_id == user_id))
    affected = [str(d) for d in rows.scalars().all() if d != except_device_id]
    await close_device_sockets(user_id, affected)


async def close_device_sockets(user_id: uuid.UUID, device_ids: list[str]) -> None:
    """Tell every worker to close the live WebSockets of these devices."""
    if device_ids:
        await hub.publish_user(
            str(user_id), {"type": "session.revoked", "device_ids": device_ids}
        )
