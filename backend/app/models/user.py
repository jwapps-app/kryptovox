import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, String, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    username: Mapped[str] = mapped_column(String, unique=True, nullable=False, index=True)
    display_name: Mapped[str | None] = mapped_column(String, nullable=True)
    avatar_url: Mapped[str | None] = mapped_column(String, nullable=True)
    password_hash: Mapped[str] = mapped_column(String, nullable=False)
    # Server administrator: can provision new users and grant/revoke admin.
    is_admin: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # One X25519 identity per user, shared across that user's devices.
    # The public key is base64url(raw 32 bytes). The private key is stored only
    # as ciphertext: AES-GCM encrypted under a key derived from the user's
    # password (PBKDF2). The server never sees the plaintext private key.
    identity_public_key: Mapped[str | None] = mapped_column(String, nullable=True)
    encrypted_private_key: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    devices: Mapped[list["Device"]] = relationship(  # noqa: F821
        back_populates="user", cascade="all, delete-orphan"
    )
