"""WebAuthn (passkey) helpers. The origin is taken from the browser-set Origin
header (the real public origin behind the tunnel — nginx forwards it), so it
works without extra config; WEBAUTHN_RP_ID/WEBAUTHN_ORIGIN are optional overrides
(e.g. to bind passkeys to a registrable parent domain across subdomains).
Challenge tokens keep the ceremony stateless."""
import uuid
from datetime import UTC, datetime, timedelta
from urllib.parse import urlparse

import jwt
from fastapi import Request
from jwt import InvalidTokenError

from app.config import settings


def rp_and_origin(request: Request) -> tuple[str, str]:
    # The real browser origin (forbidden header — JS can't forge it). Fall back to
    # the configured value only if it's somehow absent.
    origin = request.headers.get("origin") or settings.webauthn_origin
    # rp_id: an explicit WEBAUTHN_RP_ID wins; otherwise the origin's hostname.
    if settings.webauthn_rp_id and settings.webauthn_rp_id != "localhost":
        rp_id = settings.webauthn_rp_id
    else:
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
