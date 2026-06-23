import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import get_current_user
from app.http_util import read_capped_body
from app.models import Note, User
from app.schemas import NoteCreate, NoteListItem, NoteOut, NoteUpdate
from app.services import media_store

router = APIRouter(prefix="/notes", tags=["notes"])


async def _own_note(db: AsyncSession, note_id: uuid.UUID, user_id: uuid.UUID) -> Note:
    note = await db.get(Note, note_id)
    if note is None or note.owner_id != user_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Note not found")
    return note


def _media_ids(attachments: list) -> set[str]:
    return {a.get("media_id") for a in (attachments or []) if a.get("media_id")}


@router.get("", response_model=list[NoteListItem])
async def list_notes(
    current: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[Note]:
    rows = await db.execute(
        select(Note).where(Note.owner_id == current.id).order_by(Note.updated_at.desc())
    )
    return list(rows.scalars().all())


@router.post("", response_model=NoteOut, status_code=201)
async def create_note(
    body: NoteCreate,
    current: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Note:
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
    new_attachments = [a.model_dump() for a in body.attachments]
    # Delete blobs for attachments that were removed.
    for mid in _media_ids(note.attachments) - _media_ids(new_attachments):
        media_store.delete(mid)
    note.title_ciphertext = body.title_ciphertext
    note.title_iv = body.title_iv
    note.body_ciphertext = body.body_ciphertext
    note.body_iv = body.body_iv
    note.attachments = new_attachments
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
    for mid in _media_ids(note.attachments):
        media_store.delete(mid)
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
    blob = await read_capped_body(request)
    return {"id": media_store.save(blob)}


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
    data = media_store.load(media_id)
    if data is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    return Response(
        content=data,
        media_type="application/octet-stream",
        headers={"Cache-Control": "private, max-age=31536000, immutable"},
    )
