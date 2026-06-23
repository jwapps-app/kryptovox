import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator


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


# ---------- Account recovery (recovery key) ----------
class RecoverySetupIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    recovery_key_blob: EncryptedKeyBlob  # private key wrapped under the recovery key
    recovery_verifier: str = Field(min_length=16, max_length=128)


class RecoverBeginIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    username: str
    recovery_verifier: str = Field(min_length=16, max_length=128)


class RecoverBeginOut(BaseModel):
    recovery_key_blob: EncryptedKeyBlob
    identity_public_key: str


class RecoverFinishIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    username: str
    recovery_verifier: str = Field(min_length=16, max_length=128)
    new_password: str = Field(min_length=8, max_length=128)
    encrypted_private_key: EncryptedKeyBlob  # re-wrapped under the new password


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


class LoginResponse(BaseModel):
    # Either tokens (no 2FA) or a 2FA challenge (complete via /auth/2fa[/passkey]).
    twofa_required: bool = False
    pending_token: str | None = None
    methods: list[str] = []  # which second factors are available: totp, passkey
    tokens: "TokenResponse | None" = None


# ---------- Two-factor auth ----------
class TotpSetupOut(BaseModel):
    secret: str
    provisioning_uri: str


class TotpVerifyIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    code: str = Field(min_length=4, max_length=10)


class BackupCodesOut(BaseModel):
    codes: list[str]


class TwoFAStatus(BaseModel):
    totp_enabled: bool
    backup_codes_remaining: int
    passkey_count: int = 0


# ---------- Passkeys (WebAuthn 2FA) ----------
class PasskeyOptionsOut(BaseModel):
    options: dict  # PublicKeyCredential*OptionsJSON for @simplewebauthn/browser
    challenge_token: str


class PasskeyRegisterVerify(BaseModel):
    model_config = ConfigDict(extra="forbid")
    challenge_token: str
    credential: dict
    name: str | None = Field(default=None, max_length=64)


class PasskeyLoginOptionsIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    pending_token: str


class PasskeyLoginVerify(BaseModel):
    model_config = ConfigDict(extra="forbid")
    pending_token: str
    challenge_token: str
    credential: dict
    device_name: str | None = Field(default=None, max_length=64)


class PasskeyOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    name: str | None = None
    created_at: datetime


class TwoFAComplete(BaseModel):
    model_config = ConfigDict(extra="forbid")
    pending_token: str
    code: str = Field(min_length=4, max_length=20)
    device_name: str | None = Field(default=None, max_length=64)


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
    has_avatar: bool = False  # true when an encrypted profile photo is set
    twofa_enabled: bool = False
    has_recovery: bool = False  # account recovery key is set up


class PublicUserOut(BaseModel):
    """What other users may see — no is_admin / twofa_enabled / has_recovery,
    which would leak another account's security posture (recon)."""
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    username: str
    display_name: str | None = None
    avatar_url: str | None = None
    identity_public_key: str | None = None
    has_avatar: bool = False


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


# ---------- E2EE profile photos ----------
_AVATAR_MAX = 400_000  # generous cap for a small encrypted JPEG


class AvatarUpload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    ciphertext: str = Field(max_length=_AVATAR_MAX)
    iv: str = Field(max_length=64)
    self_key: str = Field(max_length=512)  # K wrapped to the owner (self-ECDH)
    encrypted_keys: dict[str, str] = {}  # recipient_id -> K wrapped to that contact


class AvatarKeysUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    encrypted_keys: dict[str, str]  # re-wrapped K for the current contact set


class AvatarOut(BaseModel):
    ciphertext: str
    iv: str
    wrapped_key: str  # K wrapped for the requester (self_key if owner == requester)
    self: bool
    owner_public_key: str | None = None


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
    # null = inherit the global default; 0 = keep forever; N = delete older than N days.
    retention_days: int | None = Field(default=None, ge=0, le=3650)


class AppConfigOut(BaseModel):
    default_retention_days: int
    require_2fa: bool = False


class AppConfigUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    default_retention_days: int | None = Field(default=None, ge=0, le=3650)
    require_2fa: bool | None = None


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
    retention_days: int | None = None  # null = inherit the global default
    disappear_seconds: int = 0
    pinned: bool = False
    muted: bool = False


class ConversationPrefs(BaseModel):
    model_config = ConfigDict(extra="forbid")
    pinned: bool | None = None
    muted: bool | None = None


class DisappearingUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    seconds: int = Field(ge=0, le=2592000)  # up to 30 days


# ---------- Notes (private, E2EE) ----------
_NOTE_MAX = 1_000_000  # generous cap for an encrypted note body


class NoteAttachment(BaseModel):
    model_config = ConfigDict(extra="forbid")
    media_id: str = Field(max_length=64)
    name_ciphertext: str = Field(max_length=8192)
    name_iv: str = Field(max_length=64)
    iv: str = Field(max_length=64)  # iv for the encrypted blob
    mime: str = Field(default="application/octet-stream", max_length=128)
    size: int = Field(ge=0)


class NoteCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    wrapped_key: str = Field(max_length=512)
    title_ciphertext: str = Field(default="", max_length=8192)
    title_iv: str = Field(default="", max_length=64)
    body_ciphertext: str = Field(default="", max_length=_NOTE_MAX)
    body_iv: str = Field(default="", max_length=64)
    attachments: list[NoteAttachment] = []


class NoteUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title_ciphertext: str = Field(default="", max_length=8192)
    title_iv: str = Field(default="", max_length=64)
    body_ciphertext: str = Field(default="", max_length=_NOTE_MAX)
    body_iv: str = Field(default="", max_length=64)
    attachments: list[NoteAttachment] = []


class NoteListItem(BaseModel):
    """List view — title only, no body."""

    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    wrapped_key: str
    title_ciphertext: str
    title_iv: str
    updated_at: datetime


class NoteOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    wrapped_key: str
    title_ciphertext: str
    title_iv: str
    body_ciphertext: str
    body_iv: str
    attachments: list[NoteAttachment] = []
    created_at: datetime
    updated_at: datetime


# ---------- Messages ----------
# Bounds for inline (DB-stored) message fields — the encrypted bytes are base64,
# so these are generous but keep a single row from exhausting storage/memory.
_MSG_CT_MAX = 262_144  # 256 KB of ciphertext (text/location); media/files go to blobs
_THUMB_MAX = 262_144  # inline encrypted thumbnail
_IV_MAX = 64


def _validate_keys(v: dict[str, str]) -> dict[str, str]:
    if len(v) > 512:
        raise ValueError("too many recipient keys")
    for val in v.values():
        if len(val) > 1024:
            raise ValueError("wrapped key too long")
    return v


class MediaRef(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(max_length=64)
    iv: str = Field(max_length=_IV_MAX)
    thumb: str = Field(max_length=_THUMB_MAX)  # base64url encrypted thumbnail
    thumb_iv: str = Field(max_length=_IV_MAX)
    w: int = Field(ge=1, le=20000)
    h: int = Field(ge=1, le=20000)
    mime: str = Field(max_length=64)
    size: int = Field(ge=0)


class FileRef(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(max_length=64)
    iv: str = Field(max_length=_IV_MAX)  # iv for the encrypted blob (filename is ciphertext)
    mime: str = Field(default="application/octet-stream", max_length=128)
    size: int = Field(ge=0)


class MessageCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    ciphertext: str = Field(default="", max_length=_MSG_CT_MAX)
    iv: str = Field(default="", max_length=_IV_MAX)
    encrypted_keys: dict[str, str]  # device_id -> base64url wrapped key
    type: str = Field(
        default="text", pattern="^(text|image|reaction|system|location|file)$"
    )
    reply_to_id: uuid.UUID | None = None
    media: MediaRef | None = None
    file: FileRef | None = None

    _ck = field_validator("encrypted_keys")(_validate_keys)


class MessageEdit(BaseModel):
    model_config = ConfigDict(extra="forbid")
    ciphertext: str = Field(max_length=_MSG_CT_MAX)
    iv: str = Field(max_length=_IV_MAX)
    encrypted_keys: dict[str, str]

    _ck = field_validator("encrypted_keys")(_validate_keys)


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
    media: dict | None = None
    reply_to_id: uuid.UUID | None
    edited_at: datetime | None
    deleted_at: datetime | None
    disappear_seconds: int = 0
    disappear_started_at: datetime | None = None
    created_at: datetime
    reactions: list[ReactionOut] = []


class MessagePage(BaseModel):
    messages: list[MessageOut]
    next_cursor: str | None = None


# ---------- Secret-link guest threads ----------
_CIPHER_MAX = 500_000  # generous cap for an encrypted text message


class GuestThreadCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    wrapped_key: str = Field(max_length=512)  # K wrapped under the creator's key
    expires_in_days: int | None = Field(default=7, ge=0, le=365)
    burn_minutes: int | None = Field(default=None, ge=1, le=1440)  # clock starts on open
    ciphertext: str = Field(max_length=_CIPHER_MAX)  # the first message
    iv: str = Field(max_length=64)
    label_ciphertext: str | None = Field(default=None, max_length=4096)
    label_iv: str | None = Field(default=None, max_length=64)


class GuestMessageIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    type: str = Field(default="text", pattern="^(text|location|image|file)$")
    ciphertext: str = Field(default="", max_length=_CIPHER_MAX)
    iv: str = Field(default="", max_length=64)
    media: MediaRef | None = None
    file: FileRef | None = None


class GuestMessageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    sender: str
    type: str = "text"
    ciphertext: str
    iv: str
    media: dict | None = None
    created_at: datetime


class GuestThreadOut(BaseModel):
    """Creator-side list item."""
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    created_at: datetime
    last_message_at: datetime
    expires_at: datetime | None
    burn_minutes: int | None = None
    wrapped_key: str
    label_ciphertext: str | None = None
    label_iv: str | None = None
    unread: bool = False
    last: GuestMessageOut | None = None


class GuestThreadDetail(BaseModel):
    id: uuid.UUID
    created_at: datetime
    expires_at: datetime | None
    burn_minutes: int | None = None
    wrapped_key: str
    label_ciphertext: str | None = None
    label_iv: str | None = None
    messages: list[GuestMessageOut]


class PublicThreadOut(BaseModel):
    """Guest-side view — no wrapped_key (the guest has K from the link)."""
    id: uuid.UUID
    created_at: datetime
    expires_at: datetime | None
    messages: list[GuestMessageOut]


TokenResponse.model_rebuild()
LoginResponse.model_rebuild()
ConversationOut.model_rebuild()
