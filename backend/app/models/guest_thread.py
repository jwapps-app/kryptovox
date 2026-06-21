import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class GuestThread(Base):
    """A "secret link" thread between a registered creator and a link-holding
    guest (no account). All messages are encrypted with one symmetric key K that
    lives in the link fragment — the server never sees it. `wrapped_key` is K
    wrapped under the creator's identity key so their devices can read it."""

    __tablename__ = "guest_threads"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    creator_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    wrapped_key: Mapped[str] = mapped_column(Text, nullable=False)
    # Optional label, encrypted with the thread key K (server never sees it).
    label_ciphertext: Mapped[str | None] = mapped_column(Text, nullable=True)
    label_iv: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    last_message_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # "Burn after reading": NULL = time-based (expires_at fixed at creation).
    # Non-NULL = expires_at starts on the guest's first open (now + burn_minutes).
    burn_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)

    messages: Mapped[list["GuestMessage"]] = relationship(
        back_populates="thread", cascade="all, delete-orphan"
    )


class GuestMessage(Base):
    __tablename__ = "guest_messages"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    thread_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("guest_threads.id", ondelete="CASCADE"),
        index=True,
    )
    # 'host' (the registered creator) or 'guest' (the link holder)
    sender: Mapped[str] = mapped_column(String, nullable=False)
    ciphertext: Mapped[str] = mapped_column(Text, nullable=False)
    iv: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    thread: Mapped["GuestThread"] = relationship(back_populates="messages")
