import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import get_current_user
from app.models import Note, User
from app.schemas import NoteCreate, NoteListItem, NoteOut, NoteUpdate

router = APIRouter(prefix="/notes", tags=["notes"])


async def _own_note(db: AsyncSession, note_id: uuid.UUID, user_id: uuid.UUID) -> Note:
    note = await db.get(Note, note_id)
    if note is None or note.owner_id != user_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Note not found")
    return note


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
    await db.delete(note)
    await db.commit()
