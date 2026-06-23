"""WebAuthn (passkey) helpers: the relying-party id/origin come from explicit
config (set to your real domain) — deriving them from request headers is fragile
behind a reverse proxy / tunnel. Challenge tokens keep the ceremony stateless."""
import uuid
from datetime import UTC, datetime, timedelta

import jwt
from jwt import InvalidTokenError

from app.config import settings


def rp_and_origin() -> tuple[str, str]:
    return settings.webauthn_rp_id, settings.webauthn_origin


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
