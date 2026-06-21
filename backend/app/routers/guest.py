import uuid
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import GuestMessage, GuestThread
from app.ratelimit import limiter
from app.schemas import GuestMessageIn, GuestMessageOut, PublicThreadOut
from app.services.fanout import fanout_user
from app.services.push import notify_user
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
    thread_id: uuid.UUID, db: AsyncSession = Depends(get_db)
) -> PublicThreadOut:
    thread = await _active_thread(db, thread_id)
    rows = await db.execute(
        select(GuestMessage)
        .where(GuestMessage.thread_id == thread_id)
        .order_by(GuestMessage.created_at)
    )
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
    msg = GuestMessage(
        thread_id=thread_id, sender="guest", ciphertext=body.ciphertext, iv=body.iv
    )
    db.add(msg)
    thread.last_message_at = datetime.now(UTC)
    await db.commit()
    await db.refresh(msg)
    # Notify the creator (live if open, push if not).
    await fanout_user(
        thread.creator_id, envelope(GUEST_REPLY, {"thread_id": str(thread_id)})
    )
    await notify_user(
        db,
        thread.creator_id,
        {"title": "Secret link", "body": "New reply", "url": f"/links/{thread_id}"},
    )
    return GuestMessageOut.model_validate(msg)
