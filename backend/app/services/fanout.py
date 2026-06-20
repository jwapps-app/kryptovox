import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import ConversationMember
from app.ws.hub import hub


async def conversation_member_ids(
    db: AsyncSession, conversation_id: uuid.UUID
) -> list[uuid.UUID]:
    rows = await db.execute(
        select(ConversationMember.user_id).where(
            ConversationMember.conversation_id == conversation_id
        )
    )
    return list(rows.scalars().all())


async def fanout_user(user_id: uuid.UUID, envelope: dict[str, Any]) -> None:
    """Publish an event to a single user's channel — i.e. all of THEIR devices.
    Used to sync per-user state (read/unread) across a user's own devices."""
    await hub.publish_user(str(user_id), envelope)


async def fanout_conversation(
    db: AsyncSession,
    conversation_id: uuid.UUID,
    envelope: dict[str, Any],
    exclude_user_id: uuid.UUID | None = None,
) -> None:
    """Publish an event to every member's user channel.

    Routing through user channels (rather than a per-conversation channel)
    means a member added after a socket connected still receives events
    without needing to resubscribe.
    """
    for uid in await conversation_member_ids(db, conversation_id):
        if exclude_user_id is not None and uid == exclude_user_id:
            continue
        await hub.publish_user(str(uid), envelope)
