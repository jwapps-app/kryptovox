"""Web Push (VAPID) delivery to offline recipient devices.

Per the E2EE design, the server never learns message content, so push payloads
carry only the sender's display name + "New message" and a deep-link — never
plaintext.
"""
import asyncio
import base64
import json
import logging
import os
import uuid
from functools import lru_cache

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from pywebpush import WebPushException, webpush
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import Device
from app.services.fanout import conversation_member_ids
from app.services.presence import is_online

log = logging.getLogger("kryptovox.push")


def _load_or_create_private_key() -> ec.EllipticCurvePrivateKey:
    path = settings.vapid_key_path
    if os.path.exists(path):
        with open(path, "rb") as f:
            return serialization.load_pem_private_key(f.read(), password=None)
    key = ec.generate_private_key(ec.SECP256R1())
    pem = key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    )
    with open(path, "wb") as f:
        f.write(pem)
    log.info("Generated new VAPID key at %s", path)
    return key


@lru_cache
def _private_key() -> ec.EllipticCurvePrivateKey:
    return _load_or_create_private_key()


@lru_cache
def application_server_key() -> str:
    """base64url uncompressed public point — the browser's applicationServerKey."""
    if settings.vapid_public_key:
        return settings.vapid_public_key
    raw = _private_key().public_key().public_bytes(
        serialization.Encoding.X962,
        serialization.PublicFormat.UncompressedPoint,
    )
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def _vapid_private_pem() -> str:
    return _private_key().private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    ).decode()


def _send_sync(subscription: dict, payload: dict) -> None:
    webpush(
        subscription_info=subscription,
        data=json.dumps(payload),
        vapid_private_key=_vapid_private_pem(),
        vapid_claims={"sub": settings.vapid_email},
    )


async def _send(subscription: dict, payload: dict, device: Device, db: AsyncSession) -> None:
    # Push is strictly best-effort: it must never break message sending.
    try:
        await asyncio.to_thread(_send_sync, subscription, payload)
    except WebPushException as exc:
        # 404/410 => subscription expired; drop it.
        status = getattr(exc.response, "status_code", None)
        if status in (404, 410):
            device.push_subscription = None
            await db.commit()
        else:
            log.warning("Push failed (%s): %s", status, exc)
    except Exception as exc:  # noqa: BLE001 — network/DNS/etc.
        log.warning("Push delivery error: %s", exc)


async def notify_offline(
    db: AsyncSession,
    conversation_id: uuid.UUID,
    sender_user_id: uuid.UUID,
    sender_name: str,
) -> None:
    """Push to every recipient device that is currently offline + subscribed."""
    payload = {
        "title": sender_name or "Kryptovox",
        "body": "New message",
        "url": f"/chat/{conversation_id}",
    }
    considered = online = pushed = 0
    for uid in await conversation_member_ids(db, conversation_id):
        if uid == sender_user_id:
            continue
        rows = await db.execute(
            select(Device).where(
                Device.user_id == uid, Device.push_subscription.isnot(None)
            )
        )
        for device in rows.scalars().all():
            considered += 1
            if await is_online(device.id):
                online += 1
                continue
            await _send(device.push_subscription, payload, device, db)
            pushed += 1
    log.info(
        "push fanout conv=%s: %d subscribed device(s), %d online (skipped), %d pushed",
        conversation_id,
        considered,
        online,
        pushed,
    )


async def send_test_to_user(db: AsyncSession, user_id: uuid.UUID) -> dict:
    """Push a test notification to all of the user's subscribed devices,
    ignoring presence. Returns per-device success/error for diagnostics."""
    rows = await db.execute(
        select(Device).where(
            Device.user_id == user_id, Device.push_subscription.isnot(None)
        )
    )
    devices = list(rows.scalars().all())
    payload = {"title": "Kryptovox", "body": "Test notification ✅", "url": "/"}
    results = []
    for d in devices:
        try:
            await asyncio.to_thread(_send_sync, d.push_subscription, payload)
            results.append({"device": str(d.id), "ok": True})
        except Exception as exc:  # noqa: BLE001
            results.append({"device": str(d.id), "ok": False, "error": str(exc)[:300]})
    return {"subscribed_devices": len(devices), "results": results}
