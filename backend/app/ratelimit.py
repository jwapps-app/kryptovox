"""Shared rate limiter (Redis-backed sliding window via slowapi/limits).

Keyed by the real client IP. Behind the Cloudflare tunnel, CF sets
CF-Connecting-IP itself and strips any client-supplied copy, so it's a trusted
source of the real address. We deliberately do NOT trust X-Forwarded-For (nginx
appends to it, and a client can prepend a forged entry) — trusting it would let
an attacker rotate fake IPs to defeat the auth/recovery brute-force limits.
Without CF-Connecting-IP (a non-CF path) we fall back to the socket peer, which
is unspoofable even if it means a shared bucket behind a reverse proxy.
"""
from fastapi import Request
from slowapi import Limiter

from app.config import settings


def client_ip(request: Request) -> str:
    cf = request.headers.get("cf-connecting-ip")
    if cf:
        return cf
    return request.client.host if request.client else "unknown"


# Single shared limiter, Redis-backed so limits hold across worker processes.
# swallow_errors: if Redis is unreachable, fail OPEN (allow the request) rather
# than 500 every rate-limited endpoint — availability of login beats the limit.
limiter = Limiter(
    key_func=client_ip, storage_uri=settings.redis_url, swallow_errors=True
)
