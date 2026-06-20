from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import get_current_admin, get_current_user
from app.models import User
from app.schemas import AppConfigOut, AppConfigUpdate
from app.services.app_settings import (
    get_default_retention_days,
    set_default_retention_days,
)

router = APIRouter(prefix="/config", tags=["config"])


@router.get("", response_model=AppConfigOut)
async def get_config(
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> AppConfigOut:
    # Readable by any user so clients can show the resolved "default" retention.
    return AppConfigOut(default_retention_days=await get_default_retention_days(db))


@router.put("", response_model=AppConfigOut)
async def update_config(
    body: AppConfigUpdate,
    _: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
) -> AppConfigOut:
    await set_default_retention_days(db, body.default_retention_days)
    return AppConfigOut(default_retention_days=body.default_retention_days)
