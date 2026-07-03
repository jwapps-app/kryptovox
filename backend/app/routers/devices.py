import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import CurrentIdentity, get_current_identity, get_current_user
from app.models import ApnsToken, Device, User
from app.schemas import ApnsTokenIn, DeviceOut

router = APIRouter(tags=["devices"])


@router.post("/devices", status_code=204)
async def register_apns_token(
    body: ApnsTokenIn,
    identity: CurrentIdentity = Depends(get_current_identity),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Register (or re-register) this device's APNs token. Idempotent — keyed on
    the token, so the client's liberal retries are safe. If the same token shows
    up under a different account (phone switched users), it's reassigned."""
    existing = await db.scalar(
        select(ApnsToken).where(ApnsToken.apns_token == body.apns_token)
    )
    if existing is not None:
        existing.user_id = identity.user.id
        existing.device_id = identity.device.id
        existing.environment = body.environment
        existing.device_name = body.device_name
        existing.voip_token = body.voip_token
    else:
        db.add(
            ApnsToken(
                user_id=identity.user.id,
                device_id=identity.device.id,
                apns_token=body.apns_token,
                voip_token=body.voip_token,
                environment=body.environment,
                device_name=body.device_name,
            )
        )


@router.delete("/devices/apns/{apns_token}", status_code=204)
async def delete_apns_token(
    apns_token: str,
    current: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    row = await db.scalar(
        select(ApnsToken).where(
            ApnsToken.apns_token == apns_token, ApnsToken.user_id == current.id
        )
    )
    if row is not None:
        await db.delete(row)


@router.get("/devices", response_model=list[DeviceOut])
async def list_my_devices(
    current: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[Device]:
    rows = await db.execute(select(Device).where(Device.user_id == current.id))
    return list(rows.scalars().all())


@router.delete("/devices/{device_id}", status_code=204)
async def revoke_device(
    device_id: uuid.UUID,
    current: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    device = await db.get(Device, device_id)
    if device is None or device.user_id != current.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Device not found")
    await db.delete(device)
