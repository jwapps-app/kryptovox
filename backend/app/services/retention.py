"""Message retention sweeper.

Periodically deletes messages older than each conversation's retention_days
(0 = keep forever). Dependent rows (reactions, receipts) cascade on the message
delete. Runs as a single background loop; a Postgres advisory lock ensures only
one gunicorn worker actually sweeps each tick.
"""
import asyncio
import logging
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import SessionLocal
from app.models import Conversation, Message

log = logging.getLogger("kryptovox.retention")

SWEEP_INTERVAL_SECONDS = 3600  # hourly
_LOCK_KEY = 0x4B56_5254  # "KVRT" — arbitrary, stable advisory-lock id


async def sweep_once(db: AsyncSession) -> int:
    """Delete expired messages across all conversations. Returns rows removed."""
    rows = await db.execute(
        select(Conversation.id, Conversation.retention_days).where(
            Conversation.retention_days > 0
        )
    )
    now = datetime.now(UTC)
    removed = 0
    for conv_id, days in rows.all():
        cutoff = now - timedelta(days=days)
        result = await db.execute(
            delete(Message).where(
                Message.conversation_id == conv_id,
                Message.created_at < cutoff,
            )
        )
        removed += result.rowcount or 0
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
