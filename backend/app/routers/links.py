import uuid
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import CurrentIdentity, get_current_identity
from app.models import GuestMessage, GuestThread
from app.schemas import (
    GuestMessageIn,
    GuestMessageOut,
    GuestThreadCreate,
    GuestThreadDetail,
    GuestThreadOut,
)

router = APIRouter(prefix="/links", tags=["links"])


async def _own_thread(
    db: AsyncSession, thread_id: uuid.UUID, user_id: uuid.UUID
) -> GuestThread:
    thread = await db.get(GuestThread, thread_id)
    if thread is None or thread.creator_id != user_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    return thread


@router.post("", response_model=GuestThreadDetail, status_code=201)
async def create_link(
    body: GuestThreadCreate,
    identity: CurrentIdentity = Depends(get_current_identity),
    db: AsyncSession = Depends(get_db),
) -> GuestThreadDetail:
    expires_at = None
    if body.expires_in_days and body.expires_in_days > 0:
        expires_at = datetime.now(UTC) + timedelta(days=body.expires_in_days)
    thread = GuestThread(
        creator_id=identity.user.id, wrapped_key=body.wrapped_key, expires_at=expires_at
    )
    db.add(thread)
    await db.flush()
    msg = GuestMessage(
        thread_id=thread.id, sender="host", ciphertext=body.ciphertext, iv=body.iv
    )
    db.add(msg)
    await db.commit()
    await db.refresh(thread)
    return GuestThreadDetail(
        id=thread.id,
        created_at=thread.created_at,
        expires_at=thread.expires_at,
        wrapped_key=thread.wrapped_key,
        messages=[GuestMessageOut.model_validate(msg)],
    )


@router.get("", response_model=list[GuestThreadOut])
async def list_links(
    identity: CurrentIdentity = Depends(get_current_identity),
    db: AsyncSession = Depends(get_db),
) -> list[GuestThreadOut]:
    rows = await db.execute(
        select(GuestThread)
        .where(GuestThread.creator_id == identity.user.id)
        .order_by(GuestThread.last_message_at.desc())
    )
    out: list[GuestThreadOut] = []
    for t in rows.scalars().all():
        last = await db.scalar(
            select(GuestMessage)
            .where(GuestMessage.thread_id == t.id)
            .order_by(GuestMessage.created_at.desc())
            .limit(1)
        )
        out.append(
            GuestThreadOut(
                id=t.id,
                created_at=t.created_at,
                last_message_at=t.last_message_at,
                expires_at=t.expires_at,
                wrapped_key=t.wrapped_key,
                last=GuestMessageOut.model_validate(last) if last else None,
            )
        )
    return out


@router.get("/{thread_id}", response_model=GuestThreadDetail)
async def get_link(
    thread_id: uuid.UUID,
    identity: CurrentIdentity = Depends(get_current_identity),
    db: AsyncSession = Depends(get_db),
) -> GuestThreadDetail:
    thread = await _own_thread(db, thread_id, identity.user.id)
    rows = await db.execute(
        select(GuestMessage)
        .where(GuestMessage.thread_id == thread_id)
        .order_by(GuestMessage.created_at)
    )
    msgs = [GuestMessageOut.model_validate(m) for m in rows.scalars().all()]
    return GuestThreadDetail(
        id=thread.id,
        created_at=thread.created_at,
        expires_at=thread.expires_at,
        wrapped_key=thread.wrapped_key,
        messages=msgs,
    )


@router.post("/{thread_id}/messages", response_model=GuestMessageOut, status_code=201)
async def host_reply(
    thread_id: uuid.UUID,
    body: GuestMessageIn,
    identity: CurrentIdentity = Depends(get_current_identity),
    db: AsyncSession = Depends(get_db),
) -> GuestMessageOut:
    thread = await _own_thread(db, thread_id, identity.user.id)
    msg = GuestMessage(
        thread_id=thread_id, sender="host", ciphertext=body.ciphertext, iv=body.iv
    )
    db.add(msg)
    thread.last_message_at = datetime.now(UTC)
    await db.commit()
    await db.refresh(msg)
    return GuestMessageOut.model_validate(msg)


@router.delete("/{thread_id}", status_code=204)
async def revoke_link(
    thread_id: uuid.UUID,
    identity: CurrentIdentity = Depends(get_current_identity),
    db: AsyncSession = Depends(get_db),
) -> None:
    thread = await _own_thread(db, thread_id, identity.user.id)
    await db.delete(thread)
    await db.commit()
