import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import get_current_user
from app.models import Device, User
from app.schemas import DeviceOut

router = APIRouter(tags=["devices"])


@router.get("/devices", response_model=list[DeviceOut])
async def list_my_devices(
    current: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[Device]:
    rows = await db.execute(select(Device).where(Device.user_id == current.id))
    return list(rows.scalars().all())


@router.get("/users/{user_id}/devices", response_model=list[DeviceOut])
async def get_recipient_devices(
    user_id: uuid.UUID,
    current: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[Device]:
    """Public keys for a recipient's devices — needed to wrap message keys."""
    rows = await db.execute(select(Device).where(Device.user_id == user_id))
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
