"""WebAuthn (passkey) helpers: relying-party info derived from the request, and
short-lived challenge tokens so the ceremony stays stateless."""
import uuid
from datetime import UTC, datetime, timedelta
from urllib.parse import urlparse

import jwt
from fastapi import Request
from jwt import InvalidTokenError

from app.config import settings


def rp_and_origin(request: Request) -> tuple[str, str]:
    """rp_id + origin from the browser-set Origin header (validated against the
    configured CORS origins when present). The Origin header can't be forged by
    page JS, so it's a safe basis behind the Cloudflare tunnel."""
    origin = request.headers.get("origin") or ""
    allowed = settings.cors_origins
    if origin and allowed and origin not in allowed:
        # Fall back to the configured origin rather than trust an unexpected one.
        origin = allowed[0]
    if not origin:
        origin = allowed[0] if allowed else "https://localhost"
    rp_id = urlparse(origin).hostname or "localhost"
    return rp_id, origin


def create_challenge_token(user_id: uuid.UUID, challenge_b64: str) -> str:
    now = datetime.now(UTC)
    payload = {
        "sub": str(user_id),
        "type": "webauthn_challenge",
        "ch": challenge_b64,
        "iat": now,
        "exp": now + timedelta(minutes=5),
    }
    return jwt.encode(payload, settings.secret_key, algorithm=settings.jwt_algorithm)


def decode_challenge_token(token: str) -> tuple[uuid.UUID, str]:
    claims = jwt.decode(token, settings.secret_key, algorithms=[settings.jwt_algorithm])
    if claims.get("type") != "webauthn_challenge":
        raise InvalidTokenError("not a challenge token")
    return uuid.UUID(claims["sub"]), claims["ch"]
