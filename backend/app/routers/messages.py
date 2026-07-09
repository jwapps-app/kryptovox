import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import CurrentIdentity, get_current_identity
from app.models import (
    Conversation,
    ConversationMember,
    Message,
    MessageReaction,
    MessageReceipt,
)
from app.schemas import (
    MessageCreate,
    MessageEdit,
    MessageOut,
    MessagePage,
    ReactionCreate,
    ReactionOut,
)
from app.services import media_store
from app.services.fanout import fanout_conversation, fanout_user
from app.services.push import notify_offline_all
from app.ws.events import (
    CONVERSATION_UPDATED,
    MESSAGE_DELETE,
    MESSAGE_DISAPPEAR_START,
    MESSAGE_EDIT,
    MESSAGE_NEW,
    REACTION_ADD,
    REACTION_REMOVE,
    RECEIPT_READ,
    envelope,
)

router = APIRouter(tags=["messages"])

PAGE_SIZE = 50


async def _require_member(
    db: AsyncSession, conversation_id: uuid.UUID, user_id: uuid.UUID
) -> ConversationMember:
    member = await db.get(ConversationMember, (conversation_id, user_id))
    if member is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversation not found")
    return member


@router.get("/conversations/{conversation_id}/messages", response_model=MessagePage)
async def get_messages(
    conversation_id: uuid.UUID,
    cursor: str | None = Query(default=None, description="ISO timestamp; fetch older"),
    identity: CurrentIdentity = Depends(get_current_identity),
    db: AsyncSession = Depends(get_db),
) -> MessagePage:
    member = await _require_member(db, conversation_id, identity.user.id)

    stmt = (
        select(Message)
        .where(Message.conversation_id == conversation_id)
        .order_by(Message.created_at.desc())
        .limit(PAGE_SIZE + 1)
    )
    # "Clear history" hides messages before cleared_at, for this member only.
    if member.cleared_at is not None:
        stmt = stmt.where(Message.created_at > member.cleared_at)
    if cursor:
        try:
            cursor_dt = datetime.fromisoformat(cursor)
        except ValueError:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid cursor")
        stmt = stmt.where(Message.created_at < cursor_dt)

    rows = list((await db.execute(stmt)).scalars().all())
    has_more = len(rows) > PAGE_SIZE
    page = rows[:PAGE_SIZE]
    next_cursor = page[-1].created_at.isoformat() if has_more and page else None
    # Return chronological (oldest first) for natural rendering.
    page.reverse()

    # Attach reactions for this page in one query.
    reactions_by_msg: dict = {}
    if page:
        rx = await db.execute(
            select(MessageReaction).where(
                MessageReaction.message_id.in_([m.id for m in page])
            )
        )
        for r in rx.scalars().all():
            reactions_by_msg.setdefault(r.message_id, []).append(
                ReactionOut.model_validate(r)
            )

    out = []
    for m in page:
        mo = MessageOut.model_validate(m)
        mo.reactions = reactions_by_msg.get(m.id, [])
        out.append(mo)
    return MessagePage(messages=out, next_cursor=next_cursor)


@router.post(
    "/conversations/{conversation_id}/messages",
    response_model=MessageOut,
    status_code=201,
)
async def send_message(
    conversation_id: uuid.UUID,
    body: MessageCreate,
    background_tasks: BackgroundTasks,
    identity: CurrentIdentity = Depends(get_current_identity),
    db: AsyncSession = Depends(get_db),
) -> MessageOut:
    await _require_member(db, conversation_id, identity.user.id)

    # Bake the conversation's current disappearing window onto the message, so
    # toggling the setting only affects new messages, not existing history.
    conv = await db.get(Conversation, conversation_id)
    disappear_seconds = conv.disappear_seconds if conv else 0

    msg = Message(
        conversation_id=conversation_id,
        sender_id=identity.user.id,
        sender_device_id=identity.device.id,
        ciphertext=body.ciphertext,
        iv=body.iv,
        encrypted_keys=body.encrypted_keys,
        type=body.type,
        media=(
            body.media.model_dump()
            if body.media
            else body.file.model_dump() if body.file else None
        ),
        reply_to_id=body.reply_to_id,
        disappear_seconds=disappear_seconds,
    )
    db.add(msg)
    await db.flush()

    out = MessageOut.model_validate(msg)
    # Commit before fanout so subscribers can read the row if they re-fetch.
    await db.commit()
    await fanout_conversation(
        db, conversation_id, envelope(MESSAGE_NEW, out.model_dump(mode="json"))
    )
    # Push fanout (web + APNs) runs after the response is sent, in its own
    # session — the sender never waits on push-service round-trips.
    sender_name = identity.user.display_name or identity.user.username
    background_tasks.add_task(
        notify_offline_all, conversation_id, identity.user.id, sender_name
    )
    return out


@router.patch("/messages/{message_id}", response_model=MessageOut)
async def edit_message(
    message_id: uuid.UUID,
    body: MessageEdit,
    identity: CurrentIdentity = Depends(get_current_identity),
    db: AsyncSession = Depends(get_db),
) -> MessageOut:
    msg = await db.get(Message, message_id)
    if msg is None or msg.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Message not found")
    if msg.sender_id != identity.user.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not your message")
    if msg.type != "text":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Only text can be edited")
    msg.ciphertext = body.ciphertext
    msg.iv = body.iv
    msg.encrypted_keys = body.encrypted_keys
    msg.edited_at = datetime.now(UTC)
    await db.flush()
    out = MessageOut.model_validate(msg)
    await db.commit()
    await fanout_conversation(
        db, msg.conversation_id, envelope(MESSAGE_EDIT, out.model_dump(mode="json"))
    )
    return out


@router.delete("/messages/{message_id}", status_code=200, response_model=MessageOut)
async def unsend_message(
    message_id: uuid.UUID,
    identity: CurrentIdentity = Depends(get_current_identity),
    db: AsyncSession = Depends(get_db),
) -> MessageOut:
    msg = await db.get(Message, message_id)
    if msg is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Message not found")
    if msg.sender_id != identity.user.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not your message")

    conversation_id = msg.conversation_id
    msg.deleted_at = datetime.now(UTC)
    msg.ciphertext = ""
    msg.encrypted_keys = {}
    # Drop the encrypted image blob + inline thumbnail on unsend.
    if msg.media:
        media_store.delete(msg.media.get("id", ""))
        msg.media = None
    await db.flush()

    out = MessageOut.model_validate(msg)
    await db.commit()
    await fanout_conversation(
        db,
        conversation_id,
        envelope(
            MESSAGE_DELETE,
            {"id": str(message_id), "conversation_id": str(conversation_id)},
        ),
    )
    return out


@router.post(
    "/conversations/{conversation_id}/read/{message_id}", status_code=204
)
async def mark_read(
    conversation_id: uuid.UUID,
    message_id: uuid.UUID,
    identity: CurrentIdentity = Depends(get_current_identity),
    db: AsyncSession = Depends(get_db),
) -> None:
    member = await _require_member(db, conversation_id, identity.user.id)

    # Bind the message to this conversation — don't let a member stamp a read
    # receipt on a message that lives in a conversation they're not part of.
    read_msg = await db.get(Message, message_id)
    if read_msg is None or read_msg.conversation_id != conversation_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Message not found")

    member.last_read_message_id = message_id
    member.marked_unread = False

    now = datetime.now(UTC)
    stmt = (
        pg_insert(MessageReceipt)
        .values(
            message_id=message_id,
            user_id=identity.user.id,
            delivered_at=now,
            read_at=now,
        )
        .on_conflict_do_update(
            index_elements=["message_id", "user_id"],
            set_={"read_at": now},
        )
    )
    await db.execute(stmt)

    # Disappearing messages: start the clock on the recipient's first read, so
    # the timer counts from open time. Covers everything up to the read point
    # that someone else sent and that hasn't started yet.
    started_at: datetime | None = None
    up_to_iso: str | None = None
    if read_msg is not None:
        # Only messages that were themselves sent as ephemeral (disappear_seconds
        # > 0) get a clock — older permanent messages are never affected.
        result = await db.execute(
            update(Message)
            .where(
                Message.conversation_id == conversation_id,
                Message.disappear_seconds > 0,
                Message.sender_id != identity.user.id,
                Message.disappear_started_at.is_(None),
                Message.created_at <= read_msg.created_at,
            )
            .values(disappear_started_at=now)
        )
        if result.rowcount:
            started_at = now
            up_to_iso = read_msg.created_at.isoformat()
    await db.commit()

    await fanout_conversation(
        db,
        conversation_id,
        envelope(
            RECEIPT_READ,
            {
                "conversation_id": str(conversation_id),
                "message_id": str(message_id),
                "user_id": str(identity.user.id),
            },
        ),
        exclude_user_id=identity.user.id,
    )
    if started_at is not None:
        # Tell every device (incl. the reader's and the sender's) to start hiding
        # those messages on time.
        await fanout_conversation(
            db,
            conversation_id,
            envelope(
                MESSAGE_DISAPPEAR_START,
                {
                    "conversation_id": str(conversation_id),
                    "reader_id": str(identity.user.id),
                    "up_to": up_to_iso,
                    "started_at": started_at.isoformat(),
                },
            ),
        )
    # Sync this user's other devices so their unread/badge clears too.
    await fanout_user(
        identity.user.id,
        envelope(CONVERSATION_UPDATED, {"conversation_id": str(conversation_id)}),
    )


@router.post("/conversations/{conversation_id}/unread", status_code=204)
async def mark_unread(
    conversation_id: uuid.UUID,
    identity: CurrentIdentity = Depends(get_current_identity),
    db: AsyncSession = Depends(get_db),
) -> None:
    member = await _require_member(db, conversation_id, identity.user.id)
    member.marked_unread = True
    await db.commit()
    # Sync this user's other devices so their unread/badge updates too.
    await fanout_user(
        identity.user.id,
        envelope(CONVERSATION_UPDATED, {"conversation_id": str(conversation_id)}),
    )


@router.post("/messages/{message_id}/reactions", status_code=204)
async def add_reaction(
    message_id: uuid.UUID,
    body: ReactionCreate,
    identity: CurrentIdentity = Depends(get_current_identity),
    db: AsyncSession = Depends(get_db),
) -> None:
    msg = await db.get(Message, message_id)
    if msg is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Message not found")
    await _require_member(db, msg.conversation_id, identity.user.id)

    existing = await db.get(
        MessageReaction, (message_id, identity.user.id, body.emoji)
    )
    if existing is None:
        db.add(
            MessageReaction(
                message_id=message_id, user_id=identity.user.id, emoji=body.emoji
            )
        )
        await db.commit()
    await fanout_conversation(
        db,
        msg.conversation_id,
        envelope(
            REACTION_ADD,
            {
                "conversation_id": str(msg.conversation_id),
                "message_id": str(message_id),
                "user_id": str(identity.user.id),
                "emoji": body.emoji,
            },
        ),
    )


@router.delete("/messages/{message_id}/reactions/{emoji}", status_code=204)
async def remove_reaction(
    message_id: uuid.UUID,
    emoji: str,
    identity: CurrentIdentity = Depends(get_current_identity),
    db: AsyncSession = Depends(get_db),
) -> None:
    msg = await db.get(Message, message_id)
    if msg is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Message not found")
    await _require_member(db, msg.conversation_id, identity.user.id)

    existing = await db.get(MessageReaction, (message_id, identity.user.id, emoji))
    if existing is not None:
        await db.delete(existing)
        await db.commit()
    await fanout_conversation(
        db,
        msg.conversation_id,
        envelope(
            REACTION_REMOVE,
            {
                "conversation_id": str(msg.conversation_id),
                "message_id": str(message_id),
                "user_id": str(identity.user.id),
                "emoji": emoji,
            },
        ),
    )
