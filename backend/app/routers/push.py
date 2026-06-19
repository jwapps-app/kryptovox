from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import CurrentIdentity, get_current_identity
from app.services.push import application_server_key, send_test_to_user

router = APIRouter(prefix="/push", tags=["push"])


class PushKeys(BaseModel):
    p256dh: str
    auth: str


class PushSubscription(BaseModel):
    model_config = ConfigDict(extra="ignore")
    endpoint: str
    keys: PushKeys
    expirationTime: float | None = None


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
async def test_push(
    identity: CurrentIdentity = Depends(get_current_identity),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Send a test notification to the current user's subscribed devices,
    bypassing presence — for verifying push works end-to-end."""
    return await send_test_to_user(db, identity.user.id)
