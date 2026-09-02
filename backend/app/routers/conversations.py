import uuid
from collections import defaultdict
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.database import get_db
from app.deps import get_current_user
from app.models import Conversation, ConversationMember, Message, User
from app.schemas import (
    ConversationCreate,
    ConversationOut,
    ConversationPrefs,
    ConversationUpdate,
    DisappearingUpdate,
    MessageOut,
    PublicUserOut,
    RetentionUpdate,
)
from app.services import media_store
from app.services.fanout import fanout_conversation
from app.ws.events import CONVERSATION_UPDATED, envelope

router = APIRouter(prefix="/conversations", tags=["conversations"])


async def _cleanup_if_empty(db: AsyncSession, conversation_id: uuid.UUID) -> None:
    """When the last member leaves, the conversation can never be reached again —
    free its image/file blobs and delete it (messages cascade), so it doesn't
    linger forever with orphaned blobs."""
    remaining = await db.scalar(
        select(func.count())
        .select_from(ConversationMember)
        .where(ConversationMember.conversation_id == conversation_id)
    )
    if remaining:
        return
    media_ids = await db.execute(
        select(Message.media["id"].astext).where(
            Message.conversation_id == conversation_id, Message.media.isnot(None)
        )
    )
    for mid in media_ids.scalars().all():
        if mid:
            media_store.delete(mid)
    conv = await db.get(Conversation, conversation_id)
    if conv is not None:
        await db.delete(conv)


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
    count = int(await db.scalar(stmt) or 0)
    # Manually marked unread shows as 1 when nothing newer is actually unread.
    if member.marked_unread and count == 0:
        return 1
    return count


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
        members=[PublicUserOut.model_validate(m) for m in members],
        my_role=member.role,
        last_message=MessageOut.model_validate(last) if last else None,
        unread_count=await _unread_count(db, member, user.id),
        retention_days=conv.retention_days,
        disappear_seconds=conv.disappear_seconds,
        pinned=member.pinned,
        muted=member.muted,
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

    # retention_days left NULL → the conversation inherits the live global
    # default until someone sets an explicit per-conversation override.
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


_EPOCH = datetime(1970, 1, 1, tzinfo=UTC)


@router.get("", response_model=list[ConversationOut])
async def list_conversations(
    current: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[ConversationOut]:
    """Batched to a constant handful of queries regardless of conversation count
    (was ~5 per conversation: conv fetch + members + last message + unread)."""
    memberships = list(
        (
            await db.execute(
                select(ConversationMember).where(
                    ConversationMember.user_id == current.id
                )
            )
        )
        .scalars()
        .all()
    )
    if not memberships:
        return []
    conv_ids = [m.conversation_id for m in memberships]

    # Conversations, in one query.
    convs = {
        c.id: c
        for c in (
            await db.execute(select(Conversation).where(Conversation.id.in_(conv_ids)))
        ).scalars()
    }

    # Every member of every conversation, in one query.
    members_by_conv: dict[uuid.UUID, list[User]] = defaultdict(list)
    for conv_id, member_user in (
        await db.execute(
            select(ConversationMember.conversation_id, User).join(
                User, User.id == ConversationMember.user_id
            ).where(ConversationMember.conversation_id.in_(conv_ids))
        )
    ).all():
        members_by_conv[conv_id].append(member_user)

    # Latest message per conversation, in one query (DISTINCT ON).
    last_by_conv = {
        m.conversation_id: m
        for m in (
            await db.execute(
                select(Message)
                .where(Message.conversation_id.in_(conv_ids))
                .order_by(Message.conversation_id, Message.created_at.desc())
                .distinct(Message.conversation_id)
            )
        ).scalars()
    }

    # Unread count per conversation, in one aggregate query.
    m, lr = aliased(Message), aliased(Message)
    unread_by_conv: dict[uuid.UUID, int] = {}
    for conv_id, marked_unread, unread in (
        await db.execute(
            select(
                ConversationMember.conversation_id,
                ConversationMember.marked_unread,
                func.count(m.id).label("unread"),
            )
            .select_from(ConversationMember)
            .outerjoin(lr, lr.id == ConversationMember.last_read_message_id)
            # Predicates in the JOIN (not a count() FILTER) so the created_at
            # cutoff rides ix_messages_conv_created instead of scanning every
            # message of every conversation.
            .outerjoin(
                m,
                and_(
                    m.conversation_id == ConversationMember.conversation_id,
                    m.sender_id != current.id,
                    m.deleted_at.is_(None),
                    or_(lr.created_at.is_(None), m.created_at > lr.created_at),
                ),
            )
            .where(ConversationMember.user_id == current.id)
            .group_by(
                ConversationMember.conversation_id, ConversationMember.marked_unread
            )
        )
    ).all():
        u = int(unread or 0)
        if marked_unread and u == 0:
            u = 1
        unread_by_conv[conv_id] = u

    out: list[ConversationOut] = []
    for member in memberships:
        conv = convs.get(member.conversation_id)
        if conv is None:
            continue
        last = last_by_conv.get(conv.id)
        out.append(
            ConversationOut(
                id=conv.id,
                type=conv.type,
                name=conv.name,
                avatar_url=conv.avatar_url,
                members=[
                    PublicUserOut.model_validate(u) for u in members_by_conv.get(conv.id, [])
                ],
                my_role=member.role,
                last_message=MessageOut.model_validate(last) if last else None,
                unread_count=unread_by_conv.get(conv.id, 0),
                retention_days=conv.retention_days,
                disappear_seconds=conv.disappear_seconds,
                pinned=member.pinned,
                muted=member.muted,
            )
        )
    # Most recent activity first (empty conversations sort last).
    out.sort(
        key=lambda c: c.last_message.created_at if c.last_message else _EPOCH,
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


@router.patch("/{conversation_id}/retention", response_model=ConversationOut)
async def set_retention(
    conversation_id: uuid.UUID,
    body: RetentionUpdate,
    current: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ConversationOut:
    # Shortening retention permanently deletes shared history on the next sweep,
    # so in a GROUP only an admin may change it (one member can't nuke everyone's
    # history); in a 1:1 either party may (both equally own the history).
    member = await _ensure_member(db, conversation_id, current.id)
    conv = await db.get(Conversation, conversation_id)
    if conv is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversation not found")
    if conv.type == "group" and member.role != "admin":
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Only an admin can change retention"
        )
    conv.retention_days = body.retention_days
    await db.flush()
    await fanout_conversation(
        db,
        conversation_id,
        envelope(CONVERSATION_UPDATED, {"conversation_id": str(conversation_id)}),
    )
    return await _to_out(db, conv, member, current)


@router.patch("/{conversation_id}/disappearing", response_model=ConversationOut)
async def set_disappearing(
    conversation_id: uuid.UUID,
    body: DisappearingUpdate,
    current: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ConversationOut:
    member = await _ensure_member(db, conversation_id, current.id)
    conv = await db.get(Conversation, conversation_id)
    if conv is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversation not found")
    conv.disappear_seconds = body.seconds
    await db.flush()
    await fanout_conversation(
        db,
        conversation_id,
        envelope(CONVERSATION_UPDATED, {"conversation_id": str(conversation_id)}),
    )
    return await _to_out(db, conv, member, current)


@router.patch("/{conversation_id}/prefs", response_model=ConversationOut)
async def set_prefs(
    conversation_id: uuid.UUID,
    body: ConversationPrefs,
    current: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ConversationOut:
    member = await _ensure_member(db, conversation_id, current.id)
    if body.pinned is not None:
        member.pinned = body.pinned
    if body.muted is not None:
        member.muted = body.muted
    await db.flush()
    conv = await db.get(Conversation, conversation_id)
    return await _to_out(db, conv, member, current)


@router.post("/{conversation_id}/clear", status_code=204)
async def clear_history(
    conversation_id: uuid.UUID,
    current: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    # Hide messages up to now for THIS member only (the other side keeps theirs).
    member = await _ensure_member(db, conversation_id, current.id)
    member.cleared_at = datetime.now(UTC)
    await db.commit()


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
    await _cleanup_if_empty(db, conversation_id)


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
    await _cleanup_if_empty(db, conversation_id)
