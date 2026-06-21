import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class Note(Base):
    """A private, E2EE note. Title and body are AES-GCM encrypted with a per-note
    key K, which is wrapped only to the owner (self-ECDH). The server stores only
    ciphertext — the same zero-knowledge model as messages, single-recipient."""

    __tablename__ = "notes"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    owner_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    wrapped_key: Mapped[str] = mapped_column(Text, nullable=False)  # K self-wrapped
    title_ciphertext: Mapped[str] = mapped_column(Text, nullable=False, default="")
    title_iv: Mapped[str] = mapped_column(String, nullable=False, default="")
    body_ciphertext: Mapped[str] = mapped_column(Text, nullable=False, default="")
    body_iv: Mapped[str] = mapped_column(String, nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
