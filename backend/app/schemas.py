import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


# ---------- Auth ----------
class EncryptedKeyBlob(BaseModel):
    # Password-wrapped private key: AES-GCM(ciphertext) under PBKDF2(salt, iter).
    model_config = ConfigDict(extra="forbid")
    salt: str
    iv: str
    ciphertext: str
    iterations: int = Field(default=200_000, ge=10_000, le=2_000_000)


class RegisterRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    username: str = Field(min_length=3, max_length=32)
    password: str = Field(min_length=8, max_length=128)
    display_name: str | None = Field(default=None, max_length=64)
    device_name: str | None = Field(default=None, max_length=64)
    identity_public_key: str = Field(min_length=16, max_length=128)  # base64url X25519
    encrypted_private_key: EncryptedKeyBlob


class LoginRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    username: str
    password: str
    device_name: str | None = Field(default=None, max_length=64)


class IdentityOut(BaseModel):
    identity_public_key: str | None = None
    encrypted_private_key: EncryptedKeyBlob | None = None


class IdentitySet(BaseModel):
    model_config = ConfigDict(extra="forbid")
    identity_public_key: str = Field(min_length=16, max_length=128)
    encrypted_private_key: EncryptedKeyBlob


class TokenResponse(BaseModel):
    access_token: str
    # Long-lived refresh token; the client persists this (survives PWA
    # force-close, unlike the cookie) and sends it back to /auth/refresh.
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int
    user: "UserOut"
    device_id: uuid.UUID


class RefreshRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    refresh_token: str | None = None


# ---------- Users / Devices ----------
class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    username: str
    display_name: str | None = None
    avatar_url: str | None = None
    is_admin: bool = False
    # Public identity key for E2EE wrapping (null until the user establishes it).
    identity_public_key: str | None = None


class SetupStatus(BaseModel):
    needs_setup: bool  # true when there are zero users (bootstrap registration open)


# ---------- Admin: user provisioning ----------
class AdminUserCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    username: str = Field(min_length=3, max_length=32)
    password: str = Field(min_length=8, max_length=128)
    display_name: str | None = Field(default=None, max_length=64)
    is_admin: bool = False


class AdminUserUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    is_admin: bool | None = None
    password: str | None = Field(default=None, min_length=8, max_length=128)


class AdminUserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    username: str
    display_name: str | None = None
    is_admin: bool
    created_at: datetime


class UserUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    display_name: str | None = Field(default=None, max_length=64)
    avatar_url: str | None = None


class DeviceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    device_name: str | None = None
    public_key: str
    last_seen: datetime | None = None
    created_at: datetime


# ---------- Conversations ----------
class ConversationCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    type: str = Field(pattern="^(direct|group)$")
    name: str | None = Field(default=None, max_length=64)
    member_ids: list[uuid.UUID] = Field(min_length=1, max_length=256)


class ConversationUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=64)


class RetentionUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    # 0 = keep forever; otherwise delete messages older than this many days.
    retention_days: int = Field(ge=0, le=3650)


class ConversationMemberOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    user_id: uuid.UUID
    role: str
    last_read_message_id: uuid.UUID | None = None


class ConversationOut(BaseModel):
    id: uuid.UUID
    type: str
    name: str | None
    avatar_url: str | None
    members: list[UserOut]
    my_role: str = "member"
    last_message: "MessageOut | None" = None
    unread_count: int = 0
    retention_days: int = 0


# ---------- Messages ----------
class MessageCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    ciphertext: str
    iv: str
    encrypted_keys: dict[str, str]  # device_id -> base64url wrapped key
    type: str = Field(default="text", pattern="^(text|image|reaction|system)$")
    reply_to_id: uuid.UUID | None = None


class ReactionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    emoji: str
    user_id: uuid.UUID


class ReactionCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    emoji: str = Field(min_length=1, max_length=8)


class MessageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    conversation_id: uuid.UUID
    sender_id: uuid.UUID | None
    sender_device_id: uuid.UUID | None
    ciphertext: str
    iv: str
    encrypted_keys: dict[str, str]
    type: str
    reply_to_id: uuid.UUID | None
    edited_at: datetime | None
    deleted_at: datetime | None
    created_at: datetime
    reactions: list[ReactionOut] = []


class MessagePage(BaseModel):
    messages: list[MessageOut]
    next_cursor: str | None = None


TokenResponse.model_rebuild()
ConversationOut.model_rebuild()
