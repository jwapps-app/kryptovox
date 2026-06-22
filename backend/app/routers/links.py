import uuid
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
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
from app.services import media_store


async def delete_thread_media(db: AsyncSession, thread_id: uuid.UUID) -> None:
    """Remove a thread's encrypted image blobs before the thread is deleted."""
    rows = await db.execute(
        select(GuestMessage.media["id"].astext).where(
            GuestMessage.thread_id == thread_id, GuestMessage.media.isnot(None)
        )
    )
    for mid in rows.scalars().all():
        if mid:
            media_store.delete(mid)

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
    # Burn threads start their clock on the guest's first open (expires_at stays
    # NULL here). Time-based threads get a fixed expiry now.
    expires_at = None
    if not body.burn_minutes and body.expires_in_days and body.expires_in_days > 0:
        expires_at = datetime.now(UTC) + timedelta(days=body.expires_in_days)
    thread = GuestThread(
        creator_id=identity.user.id,
        wrapped_key=body.wrapped_key,
        expires_at=expires_at,
        burn_minutes=body.burn_minutes,
        label_ciphertext=body.label_ciphertext,
        label_iv=body.label_iv,
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
        burn_minutes=thread.burn_minutes,
        wrapped_key=thread.wrapped_key,
        label_ciphertext=thread.label_ciphertext,
        label_iv=thread.label_iv,
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
        unread = bool(
            last
            and last.sender == "guest"
            and (t.host_read_at is None or last.created_at > t.host_read_at)
        )
        out.append(
            GuestThreadOut(
                id=t.id,
                created_at=t.created_at,
                last_message_at=t.last_message_at,
                expires_at=t.expires_at,
                burn_minutes=t.burn_minutes,
                wrapped_key=t.wrapped_key,
                label_ciphertext=t.label_ciphertext,
                label_iv=t.label_iv,
                unread=unread,
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
    detail = GuestThreadDetail(
        id=thread.id,
        created_at=thread.created_at,
        expires_at=thread.expires_at,
        burn_minutes=thread.burn_minutes,
        wrapped_key=thread.wrapped_key,
        label_ciphertext=thread.label_ciphertext,
        label_iv=thread.label_iv,
        messages=msgs,
    )
    # Burn thread whose window has closed: this read IS the trigger to delete —
    # the creator is guaranteed to have seen everything (including the last
    # reply) before it's gone. We return the already-serialized detail.
    if (
        thread.burn_minutes
        and thread.expires_at is not None
        and thread.expires_at <= datetime.now(UTC)
    ):
        await delete_thread_media(db, thread.id)
        await db.delete(thread)
        await db.commit()
    else:
        thread.host_read_at = datetime.now(UTC)  # clears the unread/badge state
        await db.commit()
    return detail


@router.post("/{thread_id}/messages", response_model=GuestMessageOut, status_code=201)
async def host_reply(
    thread_id: uuid.UUID,
    body: GuestMessageIn,
    identity: CurrentIdentity = Depends(get_current_identity),
    db: AsyncSession = Depends(get_db),
) -> GuestMessageOut:
    thread = await _own_thread(db, thread_id, identity.user.id)
    msg = GuestMessage(
        thread_id=thread_id,
        sender="host",
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
    return GuestMessageOut.model_validate(msg)


@router.delete("/{thread_id}", status_code=204)
async def revoke_link(
    thread_id: uuid.UUID,
    identity: CurrentIdentity = Depends(get_current_identity),
    db: AsyncSession = Depends(get_db),
) -> None:
    thread = await _own_thread(db, thread_id, identity.user.id)
    await delete_thread_media(db, thread.id)
    await db.delete(thread)
    await db.commit()


@router.post("/{thread_id}/media", status_code=201)
async def host_upload_media(
    thread_id: uuid.UUID,
    request: Request,
    identity: CurrentIdentity = Depends(get_current_identity),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    await _own_thread(db, thread_id, identity.user.id)
    body = await request.body()
    if not body:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Empty body")
    if len(body) > settings.max_media_bytes:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Too large")
    return {"id": media_store.save(body)}


@router.get("/{thread_id}/media/{media_id}")
async def host_get_media(
    thread_id: uuid.UUID,
    media_id: str,
    identity: CurrentIdentity = Depends(get_current_identity),
    db: AsyncSession = Depends(get_db),
) -> Response:
    await _own_thread(db, thread_id, identity.user.id)
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
    data = media_store.load(media_id)
    if data is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    return Response(
        content=data,
        media_type="application/octet-stream",
        headers={"Cache-Control": "private, max-age=31536000, immutable"},
    )
