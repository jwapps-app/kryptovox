"""Orphaned-blob garbage collector.

Encrypted media blobs live as flat files in the media store; the DB only holds
their ids inside JSONB columns. Nothing at the DB level ties a file to a row, so
any path that removes a row without removing its blob — admin user-delete and the
guest/note cascades, plus a crash between blob upload and message insert — leaks
the file forever. This sweeper is the backstop: it deletes any blob no live row
references (and that is old enough not to be an in-flight upload).

Runs as a single daily background loop guarded by a Postgres advisory lock so
only one gunicorn worker sweeps each tick (mirrors the retention sweeper).
"""
import asyncio
import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import SessionLocal
from app.models import GuestMessage, Message, Note
from app.services import media_store

log = logging.getLogger("kryptovox.blobgc")

GC_INTERVAL_SECONDS = 86400  # daily — orphans aren't urgent
_GRACE_SECONDS = 86400  # never reap a blob younger than a day (in-flight uploads)
_LOCK_KEY = 0x4B56_4743  # "KVGC" — arbitrary, stable advisory-lock id


async def referenced_ids(db: AsyncSession) -> set[str]:
    """Every blob id reachable from a live row. Message.media holds both image and
    file blobs; Note.attachments is a list of {media_id,...}; GuestMessage.media is
    a guest image. (Avatars are stored inline in the DB, not as blobs.)"""
    ids: set[str] = set()
    for mid in (
        await db.execute(
            select(Message.media["id"].astext).where(Message.media.isnot(None))
        )
    ).scalars():
        if mid:
            ids.add(mid)
    for mid in (
        await db.execute(
            select(GuestMessage.media["id"].astext).where(
                GuestMessage.media.isnot(None)
            )
        )
    ).scalars():
        if mid:
            ids.add(mid)
    for atts in (await db.execute(select(Note.attachments))).scalars():
        for a in atts or []:
            mid = a.get("media_id")
            if mid:
                ids.add(mid)
    return ids


async def gc_once(db: AsyncSession, grace_seconds: float = _GRACE_SECONDS) -> int:
    """Delete blobs older than the grace window that no row references. Returns
    the count removed."""
    candidates = media_store.list_ids(min_age_seconds=grace_seconds)
    if not candidates:
        return 0
    referenced = await referenced_ids(db)
    removed = 0
    for media_id in candidates:
        if media_id not in referenced:
            media_store.delete(media_id)
            removed += 1
    return removed


async def blob_gc_loop() -> None:
    """Background task: GC orphaned blobs daily. A Postgres advisory lock ensures
    only one worker actually sweeps each tick."""
    from sqlalchemy import func

    while True:
        try:
            async with SessionLocal() as db:
                got = await db.scalar(select(func.pg_try_advisory_lock(_LOCK_KEY)))
                if got:
                    try:
                        n = await gc_once(db)
                        if n:
                            log.info("blob GC reclaimed %d orphaned blob(s)", n)
                    finally:
                        await db.scalar(select(func.pg_advisory_unlock(_LOCK_KEY)))
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001
            log.warning("blob GC tick failed: %s", exc)
        await asyncio.sleep(GC_INTERVAL_SECONDS)
