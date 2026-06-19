import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from jwt import PyJWTError as JWTError
from sqlalchemy import select

from app.database import SessionLocal
from app.models import ConversationMember, Device
from app.security import decode_access_token
from app.services.fanout import fanout_conversation
from app.services.presence import mark_offline, mark_online
from app.ws.events import (
    TYPING_START,
    TYPING_STOP,
    envelope,
)
from app.ws.hub import hub

router = APIRouter()


async def _conversation_ids(user_id: uuid.UUID) -> list[str]:
    async with SessionLocal() as db:
        rows = await db.execute(
            select(ConversationMember.conversation_id).where(
                ConversationMember.user_id == user_id
            )
        )
        return [str(cid) for cid in rows.scalars().all()]


async def _touch_last_seen(device_id: uuid.UUID) -> None:
    async with SessionLocal() as db:
        device = await db.get(Device, device_id)
        if device:
            device.last_seen = datetime.now(UTC)
            await db.commit()


@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, token: str = "") -> None:
    # Authenticate before accepting.
    try:
        claims = decode_access_token(token)
        user_id = uuid.UUID(claims["sub"])
        device_id = uuid.UUID(claims["did"])
    except (JWTError, KeyError, ValueError):
        await websocket.close(code=4401)
        return

    await websocket.accept()
    conversation_ids = await _conversation_ids(user_id)
    hub.register(websocket, str(user_id), conversation_ids)
    await mark_online(device_id)
    await _touch_last_seen(device_id)

    try:
        while True:
            data = await websocket.receive_json()
            await _handle_client_event(user_id, device_id, data)
    except WebSocketDisconnect:
        pass
    except Exception:  # noqa: BLE001
        pass
    finally:
        hub.unregister(websocket, str(user_id), conversation_ids)
        await mark_offline(device_id)
        await _touch_last_seen(device_id)


async def _handle_client_event(
    user_id: uuid.UUID, device_id: uuid.UUID, data: dict
) -> None:
    """Handle inbound client → server events (presence + typing).

    Message creation goes through the REST endpoint (which then fans out),
    keeping persistence in one place. The socket carries ephemeral signals.
    """
    event_type = data.get("type")

    # Presence: foreground => online (push suppressed); backgrounded/hidden =>
    # offline (eligible for push) even though the socket stays connected.
    if event_type in ("ping", "presence.active"):
        await mark_online(device_id)
        return
    if event_type == "presence.away":
        await mark_offline(device_id)
        return

    payload = data.get("payload") or {}
    conversation_id = payload.get("conversation_id")
    if not conversation_id:
        return

    if event_type in (TYPING_START, TYPING_STOP):
        await mark_online(device_id)
        async with SessionLocal() as db:
            await fanout_conversation(
                db,
                uuid.UUID(conversation_id),
                envelope(
                    event_type,
                    {
                        "conversation_id": conversation_id,
                        "user_id": str(user_id),
                    },
                ),
                exclude_user_id=user_id,
            )
