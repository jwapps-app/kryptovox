import redis.asyncio as aioredis

from app.config import settings

# Single shared connection pool for the process. WebSocket pub/sub uses
# dedicated connections obtained from this client.
redis = aioredis.from_url(
    settings.redis_url,
    encoding="utf-8",
    decode_responses=True,
)
