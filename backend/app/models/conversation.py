import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, String, func, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Conversation(Base):
    __tablename__ = "conversations"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    # 'direct' or 'group'
    type: Mapped[str] = mapped_column(String, nullable=False, default="direct")
    name: Mapped[str | None] = mapped_column(String, nullable=True)  # null for direct
    avatar_url: Mapped[str | None] = mapped_column(String, nullable=True)
    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    # Days to keep messages; 0 = forever, NULL = inherit the global default.
    # Swept by services/retention.py.
    retention_days: Mapped[int | None] = mapped_column(
        Integer, nullable=True, default=None
    )
    # Disappearing-messages timer in seconds; 0 = off.
    disappear_seconds: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default="0", default=0
    )

    members: Mapped[list["ConversationMember"]] = relationship(
        back_populates="conversation", cascade="all, delete-orphan"
    )


class ConversationMember(Base):
    __tablename__ = "conversation_members"
    # The PK is (conversation_id, user_id); "WHERE user_id = ?" (conversation
    # list, unread totals) can't use it, so user_id gets its own index.
    __table_args__ = (Index("ix_conversation_members_user_id", "user_id"),)

    conversation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("conversations.id", ondelete="CASCADE"),
        primary_key=True,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    )
    role: Mapped[str] = mapped_column(String, default="member", nullable=False)
    joined_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    last_read_message_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), nullable=True
    )
    # Manually marked unread (shows as 1 when nothing newer is actually unread).
    marked_unread: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false"), default=False
    )
    pinned: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false"), default=False
    )
    muted: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false"), default=False
    )
    # Messages before this time are hidden for this member only ("clear history").
    cleared_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    conversation: Mapped["Conversation"] = relationship(back_populates="members")
