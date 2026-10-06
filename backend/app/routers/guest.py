import uuid
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.http_util import read_capped_body
from app.models import GuestMessage, GuestThread
from app.ratelimit import limiter
from app.schemas import GuestMessageIn, GuestMessageOut, PublicThreadOut
from app.services import media_owner, media_store, quota
from app.services.fanout import fanout_user
from app.services.push import notify_user, user_badge_total
from app.ws.events import GUEST_REPLY, envelope

# Public (no auth): a guest only ever holds a link to a single thread, and can
# only read/reply within it — they can never create a thread or reach anyone
# else. So there's no anonymous "create", only "reply within a thread a real
# user started".
router = APIRouter(prefix="/guest", tags=["guest"])


async def _active_thread(db: AsyncSession, thread_id: uuid.UUID) -> GuestThread:
    thread = await db.get(GuestThread, thread_id)
    if thread is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    now = datetime.now(UTC)
    # Burn thread, first open: start the clock.
    if thread.burn_minutes and thread.expires_at is None:
        thread.expires_at = now + timedelta(minutes=thread.burn_minutes)
        await db.commit()
    if thread.expires_at and thread.expires_at <= now:
        raise HTTPException(status.HTTP_410_GONE, "This link has expired")
    return thread


@router.get("/{thread_id}", response_model=PublicThreadOut)
async def get_thread(
    thread_id: uuid.UUID,
    after: uuid.UUID | None = Query(
        default=None,
        description="Only messages newer than this message id (incremental poll).",
    ),
    db: AsyncSession = Depends(get_db),
) -> PublicThreadOut:
    thread = await _active_thread(db, thread_id)
    q = select(GuestMessage).where(GuestMessage.thread_id == thread_id)
    if after is not None:
        # The guest page polls; returning only the tail keeps a long thread from
        # being re-sent and re-decrypted in full every interval.
        anchor = select(GuestMessage.created_at).where(
            GuestMessage.id == after, GuestMessage.thread_id == thread_id
        ).scalar_subquery()
        q = q.where(GuestMessage.created_at > anchor)
    rows = await db.execute(q.order_by(GuestMessage.created_at))
    msgs = [GuestMessageOut.model_validate(m) for m in rows.scalars().all()]
    return PublicThreadOut(
        id=thread.id,
        created_at=thread.created_at,
        expires_at=thread.expires_at,
        messages=msgs,
    )


@router.post("/{thread_id}/messages", response_model=GuestMessageOut, status_code=201)
@limiter.limit("20/minute")
async def guest_reply(
    request: Request,
    thread_id: uuid.UUID,
    body: GuestMessageIn,
    db: AsyncSession = Depends(get_db),
) -> GuestMessageOut:
    thread = await _active_thread(db, thread_id)
    if body.media is not None:
        await media_owner.assert_in_thread(db, body.media.id, thread_id)
    msg = GuestMessage(
        thread_id=thread_id,
        sender="guest",
        type=body.type,
        ciphertext=body.ciphertext,
        iv=body.iv,
        media=(
            body.media.model_dump()
            if body.media
            else body.file.model_dump() if body.file else None
        ),
    )
    db.add(msg)
    thread.last_message_at = datetime.now(UTC)
    await db.commit()
    await db.refresh(msg)
    # Notify the creator (live if open, push if not).
    await fanout_user(
        thread.creator_id, envelope(GUEST_REPLY, {"thread_id": str(thread_id)})
    )
    badge = await user_badge_total(db, thread.creator_id)
    await notify_user(
        thread.creator_id,
        {
            "title": "Secret link",
            "body": "New reply",
            "url": f"/links/{thread_id}",
            "thread_id": str(thread_id),  # native app routes on this
            "badge": badge,
        },
    )
    return GuestMessageOut.model_validate(msg)


@router.post("/{thread_id}/media", status_code=201)
@limiter.limit("10/minute")
async def guest_upload_media(
    request: Request,
    thread_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    thread = await _active_thread(db, thread_id)
    # A guest's uploads count against the link creator's quota and share the
    # thread's concurrency budget (the guest is anonymous).
    async with quota.upload_slot(f"thread:{thread_id}"):
        body = await read_capped_body(request)
        await quota.assert_within_quota(db, thread.creator_id, len(body))
        media_id = await media_store.save(body)
    await media_owner.record(db, media_id, thread_id=thread_id, size_bytes=len(body))
    return {"id": media_id}


@router.get("/{thread_id}/media/{media_id}")
async def guest_get_media(
    thread_id: uuid.UUID,
    media_id: str,
    db: AsyncSession = Depends(get_db),
) -> Response:
    await _active_thread(db, thread_id)
    ok = await db.scalar(
        select(GuestMessage.id)
        .where(
            GuestMessage.thread_id == thread_id,
            GuestMessage.media["id"].astext == media_id,
        )
        .limit(1)
    )
    if ok is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    path = media_store.path_for(media_id)
    if path is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    # Streamed off the event loop (blob up to 25 MB); opaque, content-stable id.
    return FileResponse(
        path,
        media_type="application/octet-stream",
        headers={"Cache-Control": "private, max-age=31536000, immutable"},
    )
