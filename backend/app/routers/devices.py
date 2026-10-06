import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import CurrentIdentity, get_current_identity, get_current_user
from app.models import ApnsToken, AuthToken, Device, User
from app.services.sessions import close_device_sockets
from app.schemas import ApnsTokenIn, DeviceOut

router = APIRouter(tags=["devices"])


@router.post("/devices", status_code=204)
async def register_apns_token(
    body: ApnsTokenIn,
    identity: CurrentIdentity = Depends(get_current_identity),
    db: AsyncSession = Depends(get_db, scope="function"),
) -> None:
    """Register (or re-register) this device's APNs token. Idempotent — keyed on
    the token, so the client's liberal retries are safe. If the same token shows
    up under a different account (phone switched users), it's reassigned."""
    existing = await db.scalar(
        select(ApnsToken).where(ApnsToken.apns_token == body.apns_token)
    )
    if existing is not None and existing.user_id != identity.user.id:
        # Reassigning another account's token is legitimate only when that
        # account is no longer signed in on the device (the app deletes its
        # token row on logout; this covers an uninstall without one). While the
        # previous owner still holds a live session, refuse — otherwise anyone
        # who learned a token string could redirect that account's pushes.
        live = await db.scalar(
            select(AuthToken.id).where(
                AuthToken.device_id == existing.device_id,
                AuthToken.revoked.is_(False),
                AuthToken.expires_at > datetime.now(UTC),
            ).limit(1)
        ) if existing.device_id is not None else None
        if live is not None:
            raise HTTPException(
                status.HTTP_409_CONFLICT, "Push token is registered to another active account"
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
    db: AsyncSession = Depends(get_db, scope="function"),
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
    db: AsyncSession = Depends(get_db, scope="function"),
) -> list[Device]:
    rows = await db.execute(select(Device).where(Device.user_id == current.id))
    return list(rows.scalars().all())


@router.delete("/devices/{device_id}", status_code=204)
async def revoke_device(
    device_id: uuid.UUID,
    current: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db, scope="function"),
) -> None:
    device = await db.get(Device, device_id)
    if device is None or device.user_id != current.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Device not found")
    await db.delete(device)
    await close_device_sockets(current.id, [str(device_id)])  # end its live socket too
