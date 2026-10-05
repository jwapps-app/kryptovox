"""Step-up authentication for security-factor changes.

A bearer session is enough to read messages; it is not enough to weaken the
account's future protection. Disabling a second factor, deleting a passkey,
regenerating backup codes, enrolling a new factor, or replacing recovery
material must prove the caller still knows the password *now* — so a stolen
or left-open session can't turn a short compromise into a lasting one.
"""
from fastapi import HTTPException, status

from app.models import User
from app.security import verify_password

_WRONG = HTTPException(status.HTTP_401_UNAUTHORIZED, "Password is incorrect")


async def require_password(user: User, password: str | None) -> None:
    if not password or not await verify_password(password, user.password_hash):
        raise _WRONG
