"""Admin-adjustable global settings, stored in the app_settings table.

Currently just the default message retention. Resolution order: the DB row if an
admin has set one, else the DEFAULT_RETENTION_DAYS env var (initial bootstrap).
"""
import time

from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import AppSetting

_DEFAULT_RETENTION_KEY = "default_retention_days"
_REQUIRE_2FA_KEY = "require_2fa"

# require_2fa gates EVERY content request (deps.require_enrolled) but changes
# ~never, so cache it per process for a short TTL instead of paying a DB query
# per request. A toggle updates this worker at once; other workers converge
# within the TTL — fine for an admin policy switch.
_REQUIRE_2FA_TTL = 30.0
_require_2fa_cache: tuple[float, bool] | None = None


async def get_require_2fa(db: AsyncSession) -> bool:
    global _require_2fa_cache
    now = time.monotonic()
    if _require_2fa_cache is not None and now - _require_2fa_cache[0] < _REQUIRE_2FA_TTL:
        return _require_2fa_cache[1]
    row = await db.get(AppSetting, _REQUIRE_2FA_KEY)
    value = row is not None and row.value == "1"
    _require_2fa_cache = (now, value)
    return value


async def set_require_2fa(db: AsyncSession, value: bool) -> None:
    global _require_2fa_cache
    row = await db.get(AppSetting, _REQUIRE_2FA_KEY)
    if row is None:
        db.add(AppSetting(key=_REQUIRE_2FA_KEY, value="1" if value else "0"))
    else:
        row.value = "1" if value else "0"
    await db.commit()
    _require_2fa_cache = (time.monotonic(), value)


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
