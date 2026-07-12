"""Per-account anti-automation for the second-factor step, backed by Redis.

The slowapi rate limit is per source IP; these guards are per *account*, so they
hold even if an attacker rotates IPs. Two things:
  - a failed-attempt counter that locks the account's 2FA step after N tries, and
  - single-use enforcement of the pending-2FA token (by its jti) so a completed
    sign-in can't be replayed to mint a second session.
"""
import logging
import uuid

from fastapi import HTTPException, status

from app.redis_client import redis

log = logging.getLogger("kryptovox")

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
_UNAVAILABLE = HTTPException(
    status.HTTP_503_SERVICE_UNAVAILABLE,
    "Sign-in temporarily unavailable. Please try again.",
)


# Asymmetric Redis-outage handling by design:
#  - the failed-attempt LOCKOUT check fails OPEN — a Redis outage must not lock
#    every account out of login (slowapi per-IP limiting still applies), and a
#    missing counter carries no security signal on its own; whereas
#  - the pending-token REPLAY check fails CLOSED (below) — without Redis we can't
#    guarantee a completed sign-in is single-use, so we reject rather than risk a
#    replayed session mint. 2FA logins are refused for the (rare, short) outage.
async def assert_not_locked(user_id: uuid.UUID) -> None:
    try:
        n = await redis.get(_FAIL_PREFIX + str(user_id))
    except Exception as exc:  # noqa: BLE001
        log.warning("2FA lockout check skipped (Redis): %s", exc)
        return
    if n is not None and int(n) >= _MAX_FAILS:
        raise _LOCKED


async def record_failure(user_id: uuid.UUID) -> None:
    try:
        key = _FAIL_PREFIX + str(user_id)
        n = await redis.incr(key)
        if n == 1:
            await redis.expire(key, _FAIL_WINDOW)
    except Exception as exc:  # noqa: BLE001
        log.warning("2FA failure record skipped (Redis): %s", exc)


async def clear_failures(user_id: uuid.UUID) -> None:
    try:
        await redis.delete(_FAIL_PREFIX + str(user_id))
    except Exception as exc:  # noqa: BLE001
        log.warning("2FA failure clear skipped (Redis): %s", exc)


async def assert_pending_unused(jti: str) -> None:
    try:
        used = jti and await redis.exists(_USED_PREFIX + jti)
    except Exception as exc:  # noqa: BLE001
        # Fail CLOSED: can't prove single-use without Redis → refuse the sign-in.
        log.warning("pending-2FA replay check unavailable (Redis): %s", exc)
        raise _UNAVAILABLE from exc
    if used:
        raise _REPLAYED


async def consume_pending(jti: str) -> None:
    if not jti:
        return
    try:
        await redis.set(_USED_PREFIX + jti, "1", ex=_USED_TTL)
    except Exception as exc:  # noqa: BLE001
        log.warning("pending-2FA consume skipped (Redis): %s", exc)
