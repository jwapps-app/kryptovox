import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from app.config import settings
from app.ratelimit import limiter
from app.redis_client import redis
from app.routers import (
    admin,
    auth,
    config,
    conversations,
    devices,
    guest,
    links,
    media,
    messages,
    notes,
    push,
    recovery,
    twofa,
    users,
)
from app.services.retention import retention_loop
from app.ws.endpoint import router as ws_router
from app.ws.hub import hub

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("kryptovox")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await hub.start()
    try:
        await redis.ping()
        log.info("Connected to Redis")
    except Exception as exc:  # noqa: BLE001
        log.warning("Redis ping failed: %s", exc)
    sweeper = asyncio.create_task(retention_loop())
    yield
    sweeper.cancel()
    await hub.stop()
    await redis.aclose()


app = FastAPI(title="Kryptovox API", version="0.1.0", lifespan=lifespan)

# Rate limiting (slowapi). Per-route limits live on the auth router.
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Everything lives under /api so the frontend can proxy a single prefix.
api = APIRouter(prefix="/api")


@api.get("/health", tags=["health"])
async def health() -> dict[str, str]:
    return {"status": "ok"}


api.include_router(auth.router)
api.include_router(twofa.router)
api.include_router(recovery.router)
api.include_router(admin.router)
api.include_router(users.router)
api.include_router(devices.router)
api.include_router(conversations.router)
api.include_router(messages.router)
api.include_router(notes.router)
api.include_router(push.router)
api.include_router(media.router)
api.include_router(config.router)
api.include_router(links.router)
api.include_router(guest.router)
api.include_router(ws_router)  # WS /api/ws

app.include_router(api)
