"""Small HTTP helpers shared across routers."""
from fastapi import HTTPException, Request, status

from app.config import settings


async def read_capped_body(request: Request) -> bytes:
    """Read a raw request body, rejecting oversized uploads.

    Checks the declared Content-Length first so an oversized upload is refused
    before it's buffered into memory, then re-checks the actual length (a client
    can lie about or omit Content-Length). nginx also caps bodies at the edge;
    this keeps the backend self-defending if it's ever reached directly.
    """
    cap = settings.max_media_bytes
    declared = request.headers.get("content-length")
    if declared is not None:
        try:
            if int(declared) > cap:
                raise HTTPException(
                    status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Too large"
                )
        except ValueError:
            pass  # malformed header — fall through to the real length check
    body = await request.body()
    if len(body) > cap:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Too large")
    if not body:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Empty body")
    return body
