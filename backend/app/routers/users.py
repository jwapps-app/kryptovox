import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import get_current_user
from app.models import AvatarKey, User
from app.schemas import (
    AccountDeleteIn,
    AvatarKeysUpdate,
    AvatarOut,
    AvatarUpload,
    IdentityOut,
    IdentitySet,
    PasswordChangeIn,
    PublicUserOut,
    UserOut,
    UserUpdate,
)
from app.security import hash_password, verify_password

router = APIRouter(tags=["users"])


@router.get("/users/search", response_model=list[PublicUserOut])
async def search_users(
    q: str = Query(min_length=1, max_length=32),
    current: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[User]:
    rows = await db.execute(
        select(User)
        .where(User.username.ilike(f"%{q}%"), User.id != current.id)
        .limit(20)
    )
    return list(rows.scalars().all())


@router.get("/users/me", response_model=UserOut)
async def get_me(current: User = Depends(get_current_user)) -> User:
    return current


@router.patch("/users/me", response_model=UserOut)
async def update_me(
    body: UserUpdate,
    current: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> User:
    if body.display_name is not None:
        current.display_name = body.display_name
    if body.avatar_url is not None:
        current.avatar_url = body.avatar_url
    db.add(current)
    return current


@router.post("/users/me/password", status_code=204)
async def change_password(
    body: PasswordChangeIn,
    current: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Change the password while logged in. The client re-wraps the identity key
    under the new password (the server can't — it never holds the plaintext key)
    and sends the new blob, so message history stays decryptable. Other signed-in
    devices keep working: the public key is unchanged and they hold the key already."""
    if not verify_password(body.current_password, current.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Current password is incorrect")
    current.password_hash = hash_password(body.new_password)
    current.encrypted_private_key = body.encrypted_private_key.model_dump()


@router.delete("/users/me", status_code=204)
async def delete_me(
    body: AccountDeleteIn,
    current: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Self-service account deletion (password-confirmed). Cascades devices,
    passkeys, receipts, reactions, notes, avatar keys, and recovery data; the
    user's sent messages are kept (sender set null) so recipients' history is
    intact, and the blob GC reclaims any now-orphaned attachments."""
    if not verify_password(body.password, current.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Password is incorrect")
    await db.delete(current)


@router.get("/users/me/identity", response_model=IdentityOut)
async def get_my_identity(current: User = Depends(get_current_user)) -> IdentityOut:
    """The user's public identity key + password-wrapped private key (or nulls
    if not yet established). A new device fetches this and unwraps locally."""
    return IdentityOut(
        identity_public_key=current.identity_public_key,
        encrypted_private_key=current.encrypted_private_key,
    )


@router.put("/users/me/identity", response_model=IdentityOut)
async def set_my_identity(
    body: IdentitySet,
    current: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> IdentityOut:
    """Establish the user's identity if not already set. Idempotent: if another
    device set it first, returns the existing one (the client should use that)."""
    if current.identity_public_key is None:
        current.identity_public_key = body.identity_public_key
        current.encrypted_private_key = body.encrypted_private_key.model_dump()
        db.add(current)
        await db.flush()
    return IdentityOut(
        identity_public_key=current.identity_public_key,
        encrypted_private_key=current.encrypted_private_key,
    )


def _avatar_keys(owner_id: uuid.UUID, encrypted_keys: dict[str, str]) -> list[AvatarKey]:
    rows = []
    for rid, wk in encrypted_keys.items():
        try:
            recipient = uuid.UUID(rid)
        except ValueError:
            continue  # skip malformed ids rather than 500
        rows.append(AvatarKey(owner_id=owner_id, recipient_id=recipient, wrapped_key=wk))
    return rows


@router.put("/users/me/avatar", response_model=UserOut)
async def set_avatar(
    body: AvatarUpload,
    current: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> User:
    current.avatar_ciphertext = body.ciphertext
    current.avatar_iv = body.iv
    current.avatar_self_key = body.self_key
    await db.execute(delete(AvatarKey).where(AvatarKey.owner_id == current.id))
    for row in _avatar_keys(current.id, body.encrypted_keys):
        db.add(row)
    db.add(current)
    await db.flush()
    return current


@router.delete("/users/me/avatar", response_model=UserOut)
async def clear_avatar(
    current: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> User:
    current.avatar_ciphertext = None
    current.avatar_iv = None
    current.avatar_self_key = None
    await db.execute(delete(AvatarKey).where(AvatarKey.owner_id == current.id))
    db.add(current)
    await db.flush()
    return current


@router.put("/users/me/avatar/keys", status_code=status.HTTP_204_NO_CONTENT)
async def sync_avatar_keys(
    body: AvatarKeysUpdate,
    current: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """Re-wrap the avatar key for the current contact set (replace-all)."""
    await db.execute(delete(AvatarKey).where(AvatarKey.owner_id == current.id))
    for row in _avatar_keys(current.id, body.encrypted_keys):
        db.add(row)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/users/{user_id}/avatar", response_model=AvatarOut)
async def get_avatar(
    user_id: uuid.UUID,
    current: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> AvatarOut:
    owner = await db.get(User, user_id)
    if owner is None or owner.avatar_ciphertext is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No avatar")
    if owner.id == current.id:
        return AvatarOut(
            ciphertext=owner.avatar_ciphertext,
            iv=owner.avatar_iv or "",
            wrapped_key=owner.avatar_self_key or "",
            self=True,
            owner_public_key=owner.identity_public_key,
        )
    ak = await db.get(AvatarKey, (user_id, current.id))
    if ak is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No avatar key for you")
    return AvatarOut(
        ciphertext=owner.avatar_ciphertext,
        iv=owner.avatar_iv or "",
        wrapped_key=ak.wrapped_key,
        self=False,
        owner_public_key=owner.identity_public_key,
    )


@router.get("/users/{user_id}", response_model=PublicUserOut)
async def get_user(
    user_id: uuid.UUID,
    current: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> User:
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    return user
