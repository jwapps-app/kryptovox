import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Device(Base):
    __tablename__ = "devices"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    device_name: Mapped[str | None] = mapped_column(String, nullable=True)
    # Legacy per-device public key. Messaging now uses the per-user identity
    # key (users.identity_public_key), so this is kept only for back-compat and
    # may mirror the user's identity public key.
    public_key: Mapped[str | None] = mapped_column(String, nullable=True)
    push_subscription: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    last_seen: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    user: Mapped["User"] = relationship(back_populates="devices")  # noqa: F821
