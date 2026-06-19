import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import get_current_user
from app.models import User
from app.schemas import IdentityOut, IdentitySet, UserOut, UserUpdate

router = APIRouter(tags=["users"])


@router.get("/users/search", response_model=list[UserOut])
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


@router.get("/users/{user_id}", response_model=UserOut)
async def get_user(
    user_id: uuid.UUID,
    current: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> User:
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    return user
