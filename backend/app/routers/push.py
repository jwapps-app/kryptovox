import ipaddress
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import CurrentIdentity, get_current_identity
from app.ratelimit import limiter
from app.services.push import application_server_key, send_test_to_user

router = APIRouter(prefix="/push", tags=["push"])


class PushKeys(BaseModel):
    p256dh: str
    auth: str


class PushSubscription(BaseModel):
    model_config = ConfigDict(extra="ignore")
    endpoint: str = Field(max_length=2048)
    keys: PushKeys
    expirationTime: float | None = None

    @field_validator("endpoint")
    @classmethod
    def _public_https_endpoint(cls, v: str) -> str:
        # The server POSTs to this URL. Without this check a user could point it
        # at loopback / RFC1918 / link-local and turn web push into SSRF.
        u = urlparse(v)
        host = (u.hostname or "").lower()
        if u.scheme != "https" or not host:
            raise ValueError("push endpoint must be an https URL")
        if host in ("localhost",) or host.endswith(".local") or host.endswith(".internal"):
            raise ValueError("push endpoint host not allowed")
        try:
            ip = ipaddress.ip_address(host)
        except ValueError:
            return v  # a hostname, not an IP literal — allowed
        if not ip.is_global:
            raise ValueError("push endpoint host not allowed")
        return v


@router.get("/vapid-public-key")
async def vapid_public_key() -> dict[str, str]:
    return {"public_key": application_server_key()}


@router.post("/subscribe", status_code=204)
async def subscribe(
    sub: PushSubscription,
    identity: CurrentIdentity = Depends(get_current_identity),
    db: AsyncSession = Depends(get_db),
) -> None:
    identity.device.push_subscription = sub.model_dump()
    db.add(identity.device)
    await db.commit()


@router.post("/test")
@limiter.limit("3/minute")
async def test_push(
    request: Request,
    identity: CurrentIdentity = Depends(get_current_identity),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Send a test notification to the current user's subscribed devices,
    bypassing presence — for verifying push works end-to-end."""
    return await send_test_to_user(db, identity.user.id)
