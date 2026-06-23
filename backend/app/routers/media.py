from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import CurrentIdentity, get_current_identity
from app.http_util import read_capped_body
from app.models import ConversationMember, Message
from app.services import media_store

router = APIRouter(prefix="/media", tags=["media"])


@router.post("", status_code=201)
async def upload_media(
    request: Request,
    identity: CurrentIdentity = Depends(get_current_identity),
) -> dict[str, str]:
    """Store an encrypted blob (raw ciphertext body) and return its id."""
    body = await read_capped_body(request)
    return {"id": media_store.save(body)}


@router.get("/{media_id}")
async def get_media(
    media_id: str,
    identity: CurrentIdentity = Depends(get_current_identity),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """Return an encrypted blob — only to a member of a conversation that
    references it (the id is also unguessable, but this enforces membership)."""
    allowed = await db.scalar(
        select(Message.id)
        .join(
            ConversationMember,
            ConversationMember.conversation_id == Message.conversation_id,
        )
        .where(
            ConversationMember.user_id == identity.user.id,
            Message.media["id"].astext == media_id,
        )
        .limit(1)
    )
    if allowed is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    data = media_store.load(media_id)
    if data is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    # Opaque ciphertext; cache aggressively since the id is content-stable.
    return Response(
        content=data,
        media_type="application/octet-stream",
        headers={"Cache-Control": "private, max-age=31536000, immutable"},
    )
