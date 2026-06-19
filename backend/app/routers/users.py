from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import get_current_user
from app.models import User
from app.schemas import UserOut, UserUpdate

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
