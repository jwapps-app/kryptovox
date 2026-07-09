import asyncio
import hashlib
import hmac
import secrets
import time
import uuid
from datetime import UTC, datetime, timedelta

import jwt
import pyotp
from jwt import InvalidTokenError
from passlib.context import CryptContext

from app.config import settings

_pwd = CryptContext(schemes=["bcrypt"], deprecated="auto")

# Verified against when a username doesn't exist, so login latency doesn't
# reveal whether an account exists (hashed once at import).
DUMMY_PASSWORD_HASH = _pwd.hash("kryptovox-timing-equalizer")


async def hash_password(password: str) -> str:
    """bcrypt is deliberately ~100-250ms of CPU — run it on the thread pool so
    concurrent logins don't stall every coroutine on the worker."""
    return await asyncio.to_thread(_pwd.hash, password)


async def verify_password(password: str, password_hash: str) -> bool:
    return await asyncio.to_thread(_pwd.verify, password, password_hash)


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
    completing the second factor. Grants no access on its own. The jti lets the
    server mark it consumed so it can't mint a second session after success."""
    now = datetime.now(UTC)
    payload = {
        "sub": str(user_id),
        "type": "pending_2fa",
        "jti": secrets.token_urlsafe(9),
        "iat": now,
        "exp": now + timedelta(minutes=5),
    }
    return jwt.encode(payload, settings.secret_key, algorithm=settings.jwt_algorithm)


def decode_pending_2fa_token(token: str) -> tuple[uuid.UUID, str]:
    """Returns (user_id, jti). Raises InvalidTokenError on a bad token."""
    claims = jwt.decode(token, settings.secret_key, algorithms=[settings.jwt_algorithm])
    if claims.get("type") != "pending_2fa":
        raise InvalidTokenError("not a pending-2fa token")
    return uuid.UUID(claims["sub"]), claims.get("jti", "")


def consume_totp(user, code: str) -> bool:
    """Verify a TOTP code with replay protection: the matched timestep must be
    strictly newer than the last one accepted for this user. Mutates
    user.totp_last_step on success (caller's session commits it)."""
    if not user.totp_secret or not code.isdigit():
        return False
    totp = pyotp.TOTP(user.totp_secret)
    now = time.time()
    matched: int | None = None
    for offset in (-1, 0, 1):  # ±1 step of clock skew, same window as before
        t = now + offset * totp.interval
        if hmac.compare_digest(totp.at(t), code):
            matched = int(t // totp.interval)
            break
    if matched is None:
        return False
    if user.totp_last_step is not None and matched <= user.totp_last_step:
        return False  # already-used (or older) code — replay
    user.totp_last_step = matched
    return True


def generate_backup_codes(n: int = 10) -> list[str]:
    # 16 hex chars (64 bits) grouped for readability (e.g. abcd-efgh-ijkl-mnop).
    out = []
    for _ in range(n):
        raw = secrets.token_hex(8)
        out.append("-".join(raw[i : i + 4] for i in range(0, len(raw), 4)))
    return out


def hash_backup_code(code: str) -> str:
    return hashlib.sha256(code.replace("-", "").lower().encode()).hexdigest()
