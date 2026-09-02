import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import get_current_admin
from app.models import User
from app.schemas import AdminUserCreate, AdminUserOut, AdminUserUpdate
from app.security import hash_password

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/users", response_model=list[AdminUserOut])
async def list_users(
    _: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
) -> list[User]:
    # Cap the result and project only the columns AdminUserOut renders — the full
    # row carries heavy JSONB (encrypted_private_key, backup_codes, recovery blob)
    # a user list never needs.
    rows = await db.execute(
        select(
            User.id, User.username, User.display_name, User.is_admin, User.created_at
        ).order_by(User.created_at).limit(1000)
    )
    return [
        AdminUserOut(
            id=r.id, username=r.username, display_name=r.display_name,
            is_admin=r.is_admin, created_at=r.created_at,
        )
        for r in rows.all()
    ]


@router.post("/users", response_model=AdminUserOut, status_code=201)
async def create_user(
    body: AdminUserCreate,
    _: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
) -> User:
    existing = await db.scalar(select(User).where(User.username == body.username))
    if existing:
        raise HTTPException(status.HTTP_409_CONFLICT, "Username already taken")

    # No device is created here — the new user generates their own X25519
    # keypair on first sign-in (the private key never touches the server).
    user = User(
        username=body.username,
        display_name=body.display_name or body.username,
        password_hash=await hash_password(body.password),
        is_admin=body.is_admin,
    )
    db.add(user)
    await db.flush()
    await db.refresh(user)
    return user


@router.patch("/users/{user_id}", response_model=AdminUserOut)
async def update_user(
    user_id: uuid.UUID,
    body: AdminUserUpdate,
    admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
) -> User:
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")

    if body.is_admin is not None:
        # Don't let an admin revoke their own last admin rights and lock everyone out.
        if user.id == admin.id and body.is_admin is False:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, "You cannot revoke your own admin rights"
            )
        user.is_admin = body.is_admin
    if body.password is not None:
        user.password_hash = await hash_password(body.password)

    db.add(user)
    await db.flush()
    return user


@router.delete("/users/{user_id}", status_code=204)
async def delete_user(
    user_id: uuid.UUID,
    admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
) -> None:
    if user_id == admin.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "You cannot delete yourself")
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    await db.delete(user)
