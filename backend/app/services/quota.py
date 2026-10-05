"""Per-account storage quota and upload concurrency budget.

Every blob has a 25 MB cap, but without an aggregate limit one account (or one
secret-link holder) can fill the disk a blob at a time. `media_blobs` records
each upload's size, so the quota is one SUM per upload. Guest uploads into a
secret link count against the link's creator.

The concurrency budget is a Redis counter per principal with a safety TTL, so
a client can't open dozens of parallel 25 MB uploads and pin the worker.
"""
import uuid
from contextlib import asynccontextmanager

from fastapi import HTTPException, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import GuestThread, MediaBlob
from app.redis_client import redis

_QUOTA = HTTPException(
    status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Storage quota exceeded"
)
_BUSY = HTTPException(
    status.HTTP_429_TOO_MANY_REQUESTS, "Too many uploads in progress — try again"
)
_INFLIGHT_KEY = "upload_inflight:{}"
_INFLIGHT_TTL = 120  # a stuck counter self-heals after this


async def used_bytes(db: AsyncSession, owner_id: uuid.UUID) -> int:
    threads = select(GuestThread.id).where(GuestThread.creator_id == owner_id)
    total = await db.scalar(
        select(func.coalesce(func.sum(MediaBlob.size_bytes), 0)).where(
            or_(MediaBlob.owner_id == owner_id, MediaBlob.thread_id.in_(threads))
        )
    )
    return int(total or 0)


async def assert_within_quota(db: AsyncSession, owner_id: uuid.UUID, incoming: int) -> None:
    limit = settings.media_quota_bytes_per_user
    if limit <= 0:
        return  # unlimited
    if await used_bytes(db, owner_id) + incoming > limit:
        raise _QUOTA


@asynccontextmanager
async def upload_slot(principal: str):
    """Hold one of the principal's concurrent-upload slots for the duration of
    the body read + write. Fails open if Redis is unreachable."""
    limit = settings.max_concurrent_uploads_per_user
    key = _INFLIGHT_KEY.format(principal)
    acquired = False
    if limit > 0:
        try:
            n = await redis.incr(key)
            await redis.expire(key, _INFLIGHT_TTL)
            acquired = True
            if n > limit:
                raise _BUSY
        except HTTPException:
            await _release(key)
            raise
        except Exception:  # noqa: BLE001 — Redis down: don't block uploads
            acquired = False
    try:
        yield
    finally:
        if acquired:
            await _release(key)


async def _release(key: str) -> None:
    try:
        if await redis.decr(key) <= 0:
            await redis.delete(key)
    except Exception:  # noqa: BLE001
        pass
