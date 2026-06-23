"""Per-account anti-automation for the second-factor step, backed by Redis.

The slowapi rate limit is per source IP; these guards are per *account*, so they
hold even if an attacker rotates IPs. Two things:
  - a failed-attempt counter that locks the account's 2FA step after N tries, and
  - single-use enforcement of the pending-2FA token (by its jti) so a completed
    sign-in can't be replayed to mint a second session.
"""
import uuid

from fastapi import HTTPException, status

from app.redis_client import redis

_FAIL_PREFIX = "2fa_fail:"
_USED_PREFIX = "2fa_used:"
_MAX_FAILS = 10
_FAIL_WINDOW = 900  # 15 minutes
_USED_TTL = 600  # > the pending token's 5-minute lifetime

_LOCKED = HTTPException(
    status.HTTP_429_TOO_MANY_REQUESTS,
    "Too many attempts. Wait a few minutes and try again.",
)
_REPLAYED = HTTPException(
    status.HTTP_401_UNAUTHORIZED,
    "This sign-in was already completed. Start again.",
)


async def assert_not_locked(user_id: uuid.UUID) -> None:
    n = await redis.get(_FAIL_PREFIX + str(user_id))
    if n is not None and int(n) >= _MAX_FAILS:
        raise _LOCKED


async def record_failure(user_id: uuid.UUID) -> None:
    key = _FAIL_PREFIX + str(user_id)
    n = await redis.incr(key)
    if n == 1:
        await redis.expire(key, _FAIL_WINDOW)


async def clear_failures(user_id: uuid.UUID) -> None:
    await redis.delete(_FAIL_PREFIX + str(user_id))


async def assert_pending_unused(jti: str) -> None:
    if jti and await redis.exists(_USED_PREFIX + jti):
        raise _REPLAYED


async def consume_pending(jti: str) -> None:
    if jti:
        await redis.set(_USED_PREFIX + jti, "1", ex=_USED_TTL)
