"""Shared rate limiter (Redis-backed sliding window via slowapi/limits).

Keyed by the real client IP. Behind Cloudflare + nginx the source address is a
proxy, so we trust CF-Connecting-IP / X-Forwarded-For when present.
"""
from fastapi import Request
from slowapi import Limiter

from app.config import settings


def client_ip(request: Request) -> str:
    cf = request.headers.get("cf-connecting-ip")
    if cf:
        return cf
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


# Single shared limiter, Redis-backed so limits hold across worker processes.
limiter = Limiter(key_func=client_ip, storage_uri=settings.redis_url)
