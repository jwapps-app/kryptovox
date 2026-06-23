import hashlib
import secrets
import uuid
from datetime import UTC, datetime, timedelta

import jwt
from jwt import InvalidTokenError
from passlib.context import CryptContext

from app.config import settings

_pwd = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(password: str) -> str:
    return _pwd.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    return _pwd.verify(password, password_hash)


def create_access_token(user_id: uuid.UUID, device_id: uuid.UUID) -> str:
    now = datetime.now(UTC)
    payload = {
        "sub": str(user_id),
        "did": str(device_id),
        "type": "access",
        "iat": now,
        "exp": now + timedelta(minutes=settings.access_token_expire_minutes),
    }
    return jwt.encode(payload, settings.secret_key, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> dict:
    """Returns the decoded claims. Raises InvalidTokenError on invalid/expired tokens."""
    claims = jwt.decode(token, settings.secret_key, algorithms=[settings.jwt_algorithm])
    if claims.get("type") != "access":
        raise InvalidTokenError("not an access token")
    return claims


def generate_refresh_token() -> str:
    """Opaque high-entropy refresh token. Only its hash is stored server-side."""
    return secrets.token_urlsafe(48)


def hash_refresh_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def refresh_token_expiry() -> datetime:
    return datetime.now(UTC) + timedelta(days=settings.refresh_token_expire_days)


# ---------- Two-factor: pending-login token + backup codes ----------
def create_pending_2fa_token(user_id: uuid.UUID) -> str:
    """Short-lived token issued after a correct password, redeemable only by
    completing the second factor. Grants no access on its own."""
    now = datetime.now(UTC)
    payload = {
        "sub": str(user_id),
        "type": "pending_2fa",
        "iat": now,
        "exp": now + timedelta(minutes=5),
    }
    return jwt.encode(payload, settings.secret_key, algorithm=settings.jwt_algorithm)


def decode_pending_2fa_token(token: str) -> uuid.UUID:
    claims = jwt.decode(token, settings.secret_key, algorithms=[settings.jwt_algorithm])
    if claims.get("type") != "pending_2fa":
        raise InvalidTokenError("not a pending-2fa token")
    return uuid.UUID(claims["sub"])


def generate_backup_codes(n: int = 10) -> list[str]:
    # 10 chars of base32-ish, grouped for readability (e.g. abcde-fghij).
    out = []
    for _ in range(n):
        raw = secrets.token_hex(5)  # 10 hex chars
        out.append(f"{raw[:5]}-{raw[5:]}")
    return out


def hash_backup_code(code: str) -> str:
    return hashlib.sha256(code.replace("-", "").lower().encode()).hexdigest()
