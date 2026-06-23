import secrets

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import get_current_user
from app.models import User
from app.ratelimit import limiter
from app.schemas import (
    RecoverBeginIn,
    RecoverBeginOut,
    RecoverFinishIn,
    RecoverySetupIn,
)
from app.security import hash_password

router = APIRouter(prefix="/recovery", tags=["recovery"])

_INVALID = HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid recovery key")


def _verify(user: User | None, verifier: str) -> User:
    # Constant-time check; identical error whether the user or recovery is missing
    # (no account/recovery-setup enumeration).
    if (
        user is None
        or user.recovery_verifier is None
        or user.recovery_key_blob is None
        or not secrets.compare_digest(user.recovery_verifier, verifier)
    ):
        raise _INVALID
    return user


@router.post("/setup", status_code=204)
async def setup_recovery(
    body: RecoverySetupIn,
    current: User = Depends(get_current_user),
) -> None:
    """Store the recovery-key-wrapped private key + verifier. The server never
    sees the recovery key, only the verifier (a hash), so it can't decrypt this."""
    current.recovery_key_blob = body.recovery_key_blob.model_dump()
    current.recovery_verifier = body.recovery_verifier


@router.delete("/setup", status_code=204)
async def clear_recovery(current: User = Depends(get_current_user)) -> None:
    current.recovery_key_blob = None
    current.recovery_verifier = None


@router.post("/begin", response_model=RecoverBeginOut)
@limiter.limit("10/minute")
async def begin_recovery(
    request: Request,
    body: RecoverBeginIn,
    db: AsyncSession = Depends(get_db),
) -> RecoverBeginOut:
    user = await db.scalar(select(User).where(User.username == body.username))
    user = _verify(user, body.recovery_verifier)
    return RecoverBeginOut(
        recovery_key_blob=user.recovery_key_blob,
        identity_public_key=user.identity_public_key or "",
    )


@router.post("/finish", status_code=204)
@limiter.limit("10/minute")
async def finish_recovery(
    request: Request,
    body: RecoverFinishIn,
    db: AsyncSession = Depends(get_db),
) -> None:
    """Reset the password and replace the password-wrapped identity blob (re-wrapped
    client-side under the new password). 2FA, if enabled, still applies at login."""
    user = await db.scalar(select(User).where(User.username == body.username))
    user = _verify(user, body.recovery_verifier)
    user.password_hash = hash_password(body.new_password)
    user.encrypted_private_key = body.encrypted_private_key.model_dump()
