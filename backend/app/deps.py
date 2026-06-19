import uuid
from dataclasses import dataclass

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import PyJWTError as JWTError
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Device, User
from app.security import decode_access_token

bearer = HTTPBearer(auto_error=True)


@dataclass
class CurrentIdentity:
    user: User
    device: Device


async def get_current_identity(
    creds: HTTPAuthorizationCredentials = Depends(bearer),
    db: AsyncSession = Depends(get_db),
) -> CurrentIdentity:
    try:
        claims = decode_access_token(creds.credentials)
        user_id = uuid.UUID(claims["sub"])
        device_id = uuid.UUID(claims["did"])
    except (JWTError, KeyError, ValueError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user = await db.get(User, user_id)
    device = await db.get(Device, device_id)
    if user is None or device is None or device.user_id != user.id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Identity no longer valid",
        )
    return CurrentIdentity(user=user, device=device)


async def get_current_user(
    identity: CurrentIdentity = Depends(get_current_identity),
) -> User:
    return identity.user


async def get_current_admin(
    user: User = Depends(get_current_user),
) -> User:
    if not user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Administrator privileges required",
        )
    return user
