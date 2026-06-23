"""Admin-adjustable global settings, stored in the app_settings table.

Currently just the default message retention. Resolution order: the DB row if an
admin has set one, else the DEFAULT_RETENTION_DAYS env var (initial bootstrap).
"""
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import AppSetting

_DEFAULT_RETENTION_KEY = "default_retention_days"
_REQUIRE_2FA_KEY = "require_2fa"


async def get_require_2fa(db: AsyncSession) -> bool:
    row = await db.get(AppSetting, _REQUIRE_2FA_KEY)
    return row is not None and row.value == "1"


async def set_require_2fa(db: AsyncSession, value: bool) -> None:
    row = await db.get(AppSetting, _REQUIRE_2FA_KEY)
    if row is None:
        db.add(AppSetting(key=_REQUIRE_2FA_KEY, value="1" if value else "0"))
    else:
        row.value = "1" if value else "0"
    await db.commit()


async def get_default_retention_days(db: AsyncSession) -> int:
    row = await db.get(AppSetting, _DEFAULT_RETENTION_KEY)
    if row is not None:
        try:
            return int(row.value)
        except ValueError:
            pass
    return settings.default_retention_days


async def set_default_retention_days(db: AsyncSession, value: int) -> None:
    row = await db.get(AppSetting, _DEFAULT_RETENTION_KEY)
    if row is None:
        db.add(AppSetting(key=_DEFAULT_RETENTION_KEY, value=str(value)))
    else:
        row.value = str(value)
    await db.commit()
