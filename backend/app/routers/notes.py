import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import get_current_user
from app.http_util import read_capped_body
from app.models import Note, User
from app.schemas import NoteCreate, NoteListItem, NoteOut, NoteUpdate
from app.services import media_owner, media_store, quota

router = APIRouter(prefix="/notes", tags=["notes"])


async def _own_note(db: AsyncSession, note_id: uuid.UUID, user_id: uuid.UUID) -> Note:
    note = await db.get(Note, note_id)
    if note is None or note.owner_id != user_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Note not found")
    return note


def _media_ids(attachments: list) -> set[str]:
    return {a.get("media_id") for a in (attachments or []) if a.get("media_id")}


async def _assert_attachments_owned(db: AsyncSession, attachments, owner_id: uuid.UUID) -> None:
    """Every referenced blob must be one this user uploaded — a client-supplied
    id could otherwise point at (and expose/affect) another resource's blob."""
    wanted = {a.media_id for a in (attachments or [])}
    if wanted and await media_owner.owned_ids(db, owner_id, wanted) != wanted:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Unknown or foreign media id")


@router.get("", response_model=list[NoteListItem])
async def list_notes(
    current: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[NoteListItem]:
    # Project only list columns — the full row carries the (large) body ciphertext.
    rows = await db.execute(
        select(Note.id, Note.wrapped_key, Note.title_ciphertext, Note.title_iv, Note.updated_at)
        .where(Note.owner_id == current.id)
        .order_by(Note.updated_at.desc())
    )
    return [
        NoteListItem(
            id=r.id, wrapped_key=r.wrapped_key, title_ciphertext=r.title_ciphertext,
            title_iv=r.title_iv, updated_at=r.updated_at,
        )
        for r in rows.all()
    ]


@router.post("", response_model=NoteOut, status_code=201)
async def create_note(
    body: NoteCreate,
    current: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Note:
    await _assert_attachments_owned(db, body.attachments, current.id)
    note = Note(
        owner_id=current.id,
        wrapped_key=body.wrapped_key,
        title_ciphertext=body.title_ciphertext,
        title_iv=body.title_iv,
        body_ciphertext=body.body_ciphertext,
        body_iv=body.body_iv,
        attachments=[a.model_dump() for a in body.attachments],
    )
    db.add(note)
    await db.flush()
    await db.commit()
    await db.refresh(note)
    return note


@router.get("/{note_id}", response_model=NoteOut)
async def get_note(
    note_id: uuid.UUID,
    current: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Note:
    return await _own_note(db, note_id, current.id)


@router.patch("/{note_id}", response_model=NoteOut)
async def update_note(
    note_id: uuid.UUID,
    body: NoteUpdate,
    current: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Note:
    note = await _own_note(db, note_id, current.id)
    note.title_ciphertext = body.title_ciphertext
    note.title_iv = body.title_iv
    note.body_ciphertext = body.body_ciphertext
    note.body_iv = body.body_iv
    # attachments omitted => keep as-is (a text-only PATCH must not drop files);
    # explicitly [] => remove all. Blob files are reclaimed by the GC sweep once
    # unreferenced, never deleted inline from a client-supplied id.
    if body.attachments is not None:
        await _assert_attachments_owned(db, body.attachments, current.id)
        note.attachments = [a.model_dump() for a in body.attachments]
    note.updated_at = datetime.now(UTC)
    await db.commit()
    await db.refresh(note)
    return note


@router.delete("/{note_id}", status_code=204)
async def delete_note(
    note_id: uuid.UUID,
    current: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    note = await _own_note(db, note_id, current.id)
    # Attachment blobs are reclaimed by the GC sweep once unreferenced — not
    # deleted here from ids the client controls (see media ownership notes).
    await db.delete(note)
    await db.commit()


@router.post("/{note_id}/media", status_code=201)
async def upload_note_media(
    note_id: uuid.UUID,
    request: Request,
    current: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    await _own_note(db, note_id, current.id)
    async with quota.upload_slot(str(current.id)):
        blob = await read_capped_body(request)
        await quota.assert_within_quota(db, current.id, len(blob))
        media_id = await media_store.save(blob)
    await media_owner.record(db, media_id, owner_id=current.id, size_bytes=len(blob))
    return {"id": media_id}


@router.get("/{note_id}/media/{media_id}")
async def get_note_media(
    note_id: uuid.UUID,
    media_id: str,
    current: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    note = await _own_note(db, note_id, current.id)
    if media_id not in _media_ids(note.attachments):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    path = media_store.path_for(media_id)
    if path is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    # Streamed off the event loop like the other media routes (blob up to 25 MB).
    return FileResponse(
        path,
        media_type="application/octet-stream",
        headers={"Cache-Control": "private, max-age=31536000, immutable"},
    )
