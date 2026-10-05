"""Who may reference a media blob.

Blob ids are unguessable, but a client can still *supply* one it learned (e.g.
an image in a shared conversation). Without an ownership check, that id could
be attached to the client's own note or message — and deleting that note would
destroy the other conversation's attachment. Every upload records its owner
(user) or thread (guest); every reference is checked against it.
"""
import uuid

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import MediaBlob

_NOT_YOURS = HTTPException(status.HTTP_400_BAD_REQUEST, "Unknown or foreign media id")


async def record(
    db: AsyncSession,
    media_id: str,
    *,
    owner_id: uuid.UUID | None = None,
    thread_id: uuid.UUID | None = None,
    size_bytes: int = 0,
) -> None:
    db.add(
        MediaBlob(id=media_id, owner_id=owner_id, thread_id=thread_id, size_bytes=size_bytes)
    )
    await db.flush()


async def assert_owned(db: AsyncSession, media_id: str, owner_id: uuid.UUID) -> None:
    """The blob must exist and have been uploaded by `owner_id`."""
    blob = await db.get(MediaBlob, media_id)
    if blob is None or blob.owner_id != owner_id:
        raise _NOT_YOURS


async def assert_in_thread(db: AsyncSession, media_id: str, thread_id: uuid.UUID) -> None:
    """The blob must have been uploaded into this guest thread (by the guest) or
    by the thread's host."""
    blob = await db.get(MediaBlob, media_id)
    if blob is None or (blob.thread_id != thread_id and blob.owner_id is None):
        raise _NOT_YOURS


async def owned_ids(db: AsyncSession, owner_id: uuid.UUID, media_ids: set[str]) -> set[str]:
    if not media_ids:
        return set()
    rows = await db.execute(
        select(MediaBlob.id).where(MediaBlob.owner_id == owner_id, MediaBlob.id.in_(media_ids))
    )
    return set(rows.scalars().all())
