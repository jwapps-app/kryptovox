"""Message retention sweeper.

Periodically deletes messages older than each conversation's retention_days
(0 = keep forever). Dependent rows (reactions, receipts) cascade on the message
delete. Runs as a single background loop; a Postgres advisory lock ensures only
one gunicorn worker actually sweeps each tick.
"""
import asyncio
import logging
from datetime import UTC, datetime, timedelta

from sqlalchemy import and_, delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import SessionLocal
from app.models import Conversation, GuestThread, Message
from app.services import media_store
from app.services.app_settings import get_default_retention_days

log = logging.getLogger("kryptovox.retention")

SWEEP_INTERVAL_SECONDS = 120  # disappearing messages need a prompt cadence
_LOCK_KEY = 0x4B56_5254  # "KVRT" — arbitrary, stable advisory-lock id


async def sweep_once(db: AsyncSession) -> int:
    """Delete expired messages across all conversations. Returns rows removed.

    Effective retention = the conversation's override, or the live global default
    when the override is NULL (inherit). 0 means keep forever."""
    default_days = await get_default_retention_days(db)
    rows = await db.execute(
        select(Conversation.id, Conversation.retention_days)
    )
    now = datetime.now(UTC)
    removed = 0
    # Disappearing messages: each carries its own window (disappear_seconds) and
    # starts on read (disappear_started_at); unread/permanent messages persist.
    expired = and_(
        Message.disappear_seconds > 0,
        Message.disappear_started_at.isnot(None),
        Message.disappear_started_at
        + func.make_interval(0, 0, 0, 0, 0, 0, Message.disappear_seconds)
        < now,
    )
    media_ids = await db.execute(
        select(Message.media["id"].astext).where(expired, Message.media.isnot(None))
    )
    for mid in media_ids.scalars().all():
        if mid:
            media_store.delete(mid)
    result = await db.execute(delete(Message).where(expired))
    removed += result.rowcount or 0
    for conv_id, override in rows.all():
        days = override if override is not None else default_days
        if days <= 0:
            continue
        cutoff = now - timedelta(days=days)
        # Delete the encrypted image blobs for expiring messages first.
        media_ids = await db.execute(
            select(Message.media["id"].astext).where(
                Message.conversation_id == conv_id,
                Message.created_at < cutoff,
                Message.media.isnot(None),
            )
        )
        for mid in media_ids.scalars().all():
            if mid:
                media_store.delete(mid)
        result = await db.execute(
            delete(Message).where(
                Message.conversation_id == conv_id,
                Message.created_at < cutoff,
            )
        )
        removed += result.rowcount or 0
    # Secret-link thread cleanup (messages cascade):
    #  - time-based: delete at expiry.
    #  - burn, opened: the creator's post-window read deletes it; this is just a
    #    safety net 7 days later if they never come back to read it.
    #  - burn, never opened: clean up after 30 days.
    expired = await db.execute(
        delete(GuestThread).where(
            or_(
                and_(
                    GuestThread.burn_minutes.is_(None),
                    GuestThread.expires_at.isnot(None),
                    GuestThread.expires_at < now,
                ),
                and_(
                    GuestThread.burn_minutes.isnot(None),
                    GuestThread.expires_at.isnot(None),
                    GuestThread.expires_at < now - timedelta(days=7),
                ),
                and_(
                    GuestThread.burn_minutes.isnot(None),
                    GuestThread.expires_at.is_(None),
                    GuestThread.created_at < now - timedelta(days=30),
                ),
            )
        )
    )
    removed += expired.rowcount or 0
    if removed:
        await db.commit()
    return removed


async def retention_loop() -> None:
    """Background task: sweep on an interval until cancelled. A Postgres advisory
    lock (held on the same connection as the sweep) keeps multiple workers from
    sweeping concurrently."""
    while True:
        try:
            async with SessionLocal() as db:
                got = await db.scalar(select(func.pg_try_advisory_lock(_LOCK_KEY)))
                if got:
                    try:
                        removed = await sweep_once(db)
                        if removed:
                            log.info("retention sweep removed %d message(s)", removed)
                    finally:
                        await db.scalar(select(func.pg_advisory_unlock(_LOCK_KEY)))
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 — never let the loop die
            log.warning("retention sweep failed: %s", exc)
        await asyncio.sleep(SWEEP_INTERVAL_SECONDS)
