"""Device presence in Redis.

A device is "online" while it holds a live WebSocket. We store a short-TTL key
per device, refreshed on connect and on every inbound frame (the client sends a
heartbeat). If the key is absent, the device is offline and eligible for push.
"""
import uuid

from app.redis_client import redis

PRESENCE_TTL = 90  # seconds


def _key(device_id: uuid.UUID) -> str:
    return f"presence:device:{device_id}"


async def mark_online(device_id: uuid.UUID) -> None:
    await redis.set(_key(device_id), "1", ex=PRESENCE_TTL)


async def mark_offline(device_id: uuid.UUID) -> None:
    await redis.delete(_key(device_id))


async def is_online(device_id: uuid.UUID) -> bool:
    return bool(await redis.exists(_key(device_id)))
