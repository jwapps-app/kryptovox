import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import get_current_user
from app.models import Conversation, ConversationMember, Message, User
from app.schemas import (
    ConversationCreate,
    ConversationOut,
    ConversationUpdate,
    MessageOut,
    UserOut,
)
from app.services.fanout import fanout_conversation
from app.ws.events import CONVERSATION_UPDATED, envelope

router = APIRouter(prefix="/conversations", tags=["conversations"])


async def _members(db: AsyncSession, conversation_id: uuid.UUID) -> list[User]:
    rows = await db.execute(
        select(User)
        .join(ConversationMember, ConversationMember.user_id == User.id)
        .where(ConversationMember.conversation_id == conversation_id)
    )
    return list(rows.scalars().all())


async def _ensure_member(
    db: AsyncSession, conversation_id: uuid.UUID, user_id: uuid.UUID
) -> ConversationMember:
    member = await db.get(ConversationMember, (conversation_id, user_id))
    if member is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversation not found")
    return member


async def _last_message(db: AsyncSession, conversation_id: uuid.UUID) -> Message | None:
    return await db.scalar(
        select(Message)
        .where(Message.conversation_id == conversation_id)
        .order_by(Message.created_at.desc())
        .limit(1)
    )


async def _unread_count(
    db: AsyncSession, member: ConversationMember, current_user_id: uuid.UUID
) -> int:
    after = None
    if member.last_read_message_id:
        last_read = await db.get(Message, member.last_read_message_id)
        after = last_read.created_at if last_read else None
    stmt = select(func.count(Message.id)).where(
        Message.conversation_id == member.conversation_id,
        Message.sender_id != current_user_id,
        Message.deleted_at.is_(None),
    )
    if after is not None:
        stmt = stmt.where(Message.created_at > after)
    return int(await db.scalar(stmt) or 0)


async def _to_out(
    db: AsyncSession, conv: Conversation, member: ConversationMember, user: User
) -> ConversationOut:
    members = await _members(db, conv.id)
    last = await _last_message(db, conv.id)
    return ConversationOut(
        id=conv.id,
        type=conv.type,
        name=conv.name,
        avatar_url=conv.avatar_url,
        members=[UserOut.model_validate(m) for m in members],
        my_role=member.role,
        last_message=MessageOut.model_validate(last) if last else None,
        unread_count=await _unread_count(db, member, user.id),
    )


@router.post("", response_model=ConversationOut, status_code=201)
async def create_conversation(
    body: ConversationCreate,
    current: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ConversationOut:
    member_ids = {current.id, *body.member_ids}

    # Reject unknown user ids so a caller can't seed a conversation with bogus
    # (or guessed) ids. Other-user membership is intentional (you start chats),
    # but every id must resolve to a real user.
    found = await db.execute(select(User.id).where(User.id.in_(member_ids)))
    known = set(found.scalars().all())
    if known != member_ids:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Unknown member id(s)")

    if body.type == "direct":
        if len(member_ids) != 2:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "Direct conversations must have exactly two members",
            )
        existing = await _find_direct(db, list(member_ids))
        if existing:
            member = await _ensure_member(db, existing.id, current.id)
            return await _to_out(db, existing, member, current)

    conv = Conversation(
        type=body.type,
        name=body.name if body.type == "group" else None,
        created_by=current.id,
    )
    db.add(conv)
    await db.flush()

    for uid in member_ids:
        db.add(
            ConversationMember(
                conversation_id=conv.id,
                user_id=uid,
                role="admin" if uid == current.id else "member",
            )
        )
    await db.flush()

    member = await _ensure_member(db, conv.id, current.id)
    out = await _to_out(db, conv, member, current)
    await fanout_conversation(
        db, conv.id, envelope(CONVERSATION_UPDATED, {"conversation_id": str(conv.id)})
    )
    return out


async def _find_direct(db: AsyncSession, user_ids: list[uuid.UUID]) -> Conversation | None:
    """Find an existing direct conversation between exactly these two users."""
    a, b = user_ids
    subq = (
        select(ConversationMember.conversation_id)
        .where(ConversationMember.user_id.in_([a, b]))
        .group_by(ConversationMember.conversation_id)
        .having(func.count(ConversationMember.user_id) == 2)
    )
    return await db.scalar(
        select(Conversation).where(
            Conversation.type == "direct", Conversation.id.in_(subq)
        )
    )


@router.get("", response_model=list[ConversationOut])
async def list_conversations(
    current: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[ConversationOut]:
    memberships = await db.execute(
        select(ConversationMember).where(ConversationMember.user_id == current.id)
    )
    out: list[ConversationOut] = []
    for member in memberships.scalars().all():
        conv = await db.get(Conversation, member.conversation_id)
        if conv:
            out.append(await _to_out(db, conv, member, current))
    # Most recent activity first.
    out.sort(
        key=lambda c: c.last_message.created_at if c.last_message else None,
        reverse=True,
    )
    return out


@router.get("/{conversation_id}", response_model=ConversationOut)
async def get_conversation(
    conversation_id: uuid.UUID,
    current: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ConversationOut:
    member = await _ensure_member(db, conversation_id, current.id)
    conv = await db.get(Conversation, conversation_id)
    if conv is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversation not found")
    return await _to_out(db, conv, member, current)


@router.post("/{conversation_id}/members", response_model=ConversationOut)
async def add_member(
    conversation_id: uuid.UUID,
    user_id: uuid.UUID,
    current: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ConversationOut:
    member = await _ensure_member(db, conversation_id, current.id)
    conv = await db.get(Conversation, conversation_id)
    if conv is None or conv.type != "group":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Not a group conversation")
    if member.role != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Admin only")

    if await db.get(User, user_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")

    existing = await db.get(ConversationMember, (conversation_id, user_id))
    if existing is None:
        db.add(
            ConversationMember(conversation_id=conversation_id, user_id=user_id)
        )
        await db.flush()
        await fanout_conversation(
            db,
            conversation_id,
            envelope(CONVERSATION_UPDATED, {"conversation_id": str(conversation_id)}),
        )
    return await _to_out(db, conv, member, current)


@router.patch("/{conversation_id}", response_model=ConversationOut)
async def rename_conversation(
    conversation_id: uuid.UUID,
    body: ConversationUpdate,
    current: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ConversationOut:
    member = await _ensure_member(db, conversation_id, current.id)
    conv = await db.get(Conversation, conversation_id)
    if conv is None or conv.type != "group":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Not a group conversation")
    if member.role != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Admin only")
    conv.name = body.name
    await db.flush()
    await fanout_conversation(
        db,
        conversation_id,
        envelope(CONVERSATION_UPDATED, {"conversation_id": str(conversation_id)}),
    )
    return await _to_out(db, conv, member, current)


@router.delete("/{conversation_id}/members/{user_id}", status_code=204)
async def remove_member(
    conversation_id: uuid.UUID,
    user_id: uuid.UUID,
    current: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    member = await _ensure_member(db, conversation_id, current.id)
    conv = await db.get(Conversation, conversation_id)
    if conv is None or conv.type != "group":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Not a group conversation")
    # Admins can remove anyone; members can only remove themselves (leave).
    if member.role != "admin" and user_id != current.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Admin only")

    target = await db.get(ConversationMember, (conversation_id, user_id))
    if target is None:
        return
    # Notify the conversation (and the removed user) before deleting.
    await fanout_conversation(
        db,
        conversation_id,
        envelope(CONVERSATION_UPDATED, {"conversation_id": str(conversation_id)}),
    )
    await db.delete(target)
    await db.flush()


@router.post("/{conversation_id}/leave", status_code=204)
async def leave_conversation(
    conversation_id: uuid.UUID,
    current: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    member = await _ensure_member(db, conversation_id, current.id)
    await fanout_conversation(
        db,
        conversation_id,
        envelope(CONVERSATION_UPDATED, {"conversation_id": str(conversation_id)}),
    )
    await db.delete(member)
    await db.flush()
