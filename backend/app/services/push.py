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

import httpx
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from pywebpush import WebPushException, webpush
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.config import settings
from app.database import SessionLocal
from app.models import (
    ApnsToken,
    ConversationMember,
    Device,
    GuestMessage,
    GuestThread,
    Message,
)
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


def _send_sync(subscription: dict, payload: dict) -> None:
    # IMPORTANT: pass the PEM *file path*, not the PEM string. pywebpush treats a
    # non-path string as a base64url RAW key (Vapid.from_raw) and fails to parse
    # a PEM ("ASN.1 parsing error"). A path routes through Vapid.from_file.
    _private_key()  # ensure the PEM file exists at vapid_key_path
    webpush(
        subscription_info=subscription,
        data=json.dumps(payload),
        vapid_private_key=settings.vapid_key_path,
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


async def _unread_total(db: AsyncSession, user_id: uuid.UUID) -> int:
    """Total unread messages for a user across all their conversations — drives
    the app-icon badge. Computed in a SINGLE query (was ~2 per conversation): join
    each membership to its last-read message for the cutoff time, then count newer
    inbound messages per conversation, with a +1 for manually marked-unread empty
    conversations."""
    m = aliased(Message)
    lr = aliased(Message)  # the member's last-read message (for its created_at)
    rows = await db.execute(
        select(
            ConversationMember.marked_unread,
            func.count(m.id)
            .filter(
                and_(
                    m.sender_id != user_id,
                    m.deleted_at.is_(None),
                    or_(lr.created_at.is_(None), m.created_at > lr.created_at),
                )
            )
            .label("unread"),
        )
        .select_from(ConversationMember)
        .outerjoin(lr, lr.id == ConversationMember.last_read_message_id)
        .outerjoin(m, m.conversation_id == ConversationMember.conversation_id)
        .where(ConversationMember.user_id == user_id)
        .group_by(ConversationMember.conversation_id, ConversationMember.marked_unread)
    )
    total = 0
    for marked_unread, unread in rows.all():
        unread = int(unread or 0)
        if marked_unread and unread == 0:
            unread = 1
        total += unread
    return total


async def notify_offline(
    db: AsyncSession,
    conversation_id: uuid.UUID,
    sender_user_id: uuid.UUID,
    sender_name: str,
) -> None:
    """Push to every recipient device that is currently offline + subscribed."""
    base = {
        "title": sender_name or "Kryptovox",
        "body": "New message",
        "url": f"/chat/{conversation_id}",
    }
    considered = online = pushed = 0
    seen_endpoints: set[str] = set()
    for uid in await conversation_member_ids(db, conversation_id):
        if uid == sender_user_id:
            continue
        # Respect per-member mute.
        member = await db.get(ConversationMember, (conversation_id, uid))
        if member is not None and member.muted:
            continue
        # Per-recipient unread total for the home-screen icon badge.
        payload = {**base, "badge": await _unread_total(db, uid)}
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
            # Re-logins create multiple device rows that may share one browser
            # push endpoint — dedupe so the user gets a single banner.
            endpoint = (device.push_subscription or {}).get("endpoint")
            if endpoint and endpoint in seen_endpoints:
                continue
            if endpoint:
                seen_endpoints.add(endpoint)
            await _send(device.push_subscription, payload, device, db)
            pushed += 1
    log.info(
        "push fanout conv=%s: %d subscribed device(s), %d online (skipped), %d pushed",
        conversation_id,
        considered,
        online,
        pushed,
    )


async def user_badge_total(db: AsyncSession, user_id: uuid.UUID) -> int:
    """Total unread for the app-icon badge: conversation unread + secret-link
    threads with an unread guest reply."""
    total = await _unread_total(db, user_id)
    rows = await db.execute(
        select(GuestThread).where(GuestThread.creator_id == user_id)
    )
    for t in rows.scalars().all():
        last = await db.scalar(
            select(GuestMessage)
            .where(GuestMessage.thread_id == t.id)
            .order_by(GuestMessage.created_at.desc())
            .limit(1)
        )
        if (
            last
            and last.sender == "guest"
            and (t.host_read_at is None or last.created_at > t.host_read_at)
        ):
            total += 1
    return total


async def notify_user(db: AsyncSession, user_id: uuid.UUID, payload: dict) -> None:
    """Push a payload to a user's offline, subscribed devices (used for secret-
    link replies, which aren't tied to a conversation)."""
    rows = await db.execute(
        select(Device).where(
            Device.user_id == user_id, Device.push_subscription.isnot(None)
        )
    )
    seen_endpoints: set[str] = set()
    for device in rows.scalars().all():
        if await is_online(device.id):
            continue
        endpoint = (device.push_subscription or {}).get("endpoint")
        if endpoint and endpoint in seen_endpoints:
            continue
        if endpoint:
            seen_endpoints.add(endpoint)
        await _send(device.push_subscription, payload, device, db)


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
    seen_endpoints: set[str] = set()
    sent = pruned = 0
    for d in devices:
        endpoint = (d.push_subscription or {}).get("endpoint")
        if endpoint and endpoint in seen_endpoints:
            continue
        if endpoint:
            seen_endpoints.add(endpoint)
        try:
            await asyncio.to_thread(_send_sync, d.push_subscription, payload)
            sent += 1
            results.append({"device": str(d.id), "ok": True})
        except WebPushException as exc:
            status = getattr(exc.response, "status_code", None)
            if status in (404, 410):
                d.push_subscription = None  # expired — prune it
                pruned += 1
                results.append({"device": str(d.id), "ok": False, "error": "expired (removed)"})
            else:
                results.append({"device": str(d.id), "ok": False, "error": str(exc)[:300]})
        except Exception as exc:  # noqa: BLE001
            results.append({"device": str(d.id), "ok": False, "error": str(exc)[:300]})
    if pruned:
        await db.commit()
    return {
        "subscribed_devices": len(devices),
        "sent": sent,
        "pruned": pruned,
        "results": results,
    }


# ---------- Native iOS push via the push-relay (APNs) ----------
# Entirely separate from the web-push path above (VAPID / Device.push_subscription).
# Disabled unless PUSH_RELAY_URL + PUSH_RELAY_API_KEY are configured.
def apns_enabled() -> bool:
    return bool(settings.push_relay_url and settings.push_relay_api_key)


async def _send_apns_one(
    client: httpx.AsyncClient,
    db: AsyncSession,
    token: ApnsToken,
    badge: int,
    conversation_id: uuid.UUID,
) -> bool:
    """POST one notification to the relay. Returns True if the relay accepted it."""
    body = {
        "bundle_id": settings.apns_bundle_id,
        "device_token": token.apns_token,
        "title": "Kryptovox",
        "body": "New message",  # content is E2EE — never included
        "custom_data": {"conversation_id": str(conversation_id)},
        "badge": int(badge),
        "sandbox": token.environment == "sandbox",
    }
    try:
        resp = await client.post(
            f"{settings.push_relay_url.rstrip('/')}/notify",
            json=body,
            headers={"X-API-Key": settings.push_relay_api_key},
        )
    except Exception as exc:  # noqa: BLE001 — relay is best-effort
        log.warning("APNs relay call failed (%s): %s", settings.push_relay_url, exc)
        return False
    if resp.status_code == 200:
        return True
    if resp.status_code == 502 and (
        "BadDeviceToken" in resp.text or "Unregistered" in resp.text
    ):
        log.info("APNs token stale — pruning (%s)", resp.text[:80])
        await db.delete(token)  # stale token — drop it
        return False
    if resp.status_code == 403:
        log.error(
            "push-relay 403: API key mismatch for %s — check PUSH_RELAY_API_KEY",
            settings.apns_bundle_id,
        )
        return False
    log.warning("push-relay %s: %s", resp.status_code, resp.text[:200])
    return False


async def notify_offline_apns(
    conversation_id: uuid.UUID, sender_user_id: uuid.UUID
) -> None:
    """Fire-and-forget APNs fanout for a new message. Runs in its OWN session (so
    it never touches the request's transaction or delays the sender's response).

    We deliberately do NOT skip WS-online recipients: iOS suppresses banners for a
    foregrounded app itself, and presence lag was silently dropping pushes. So we
    send to every registered token of every non-sender, non-muted member. A single
    summary line is logged per message so the hook is verifiable in the logs."""
    if not apns_enabled():
        log.debug("APNs disabled (PUSH_RELAY_URL / PUSH_RELAY_API_KEY unset)")
        return
    tokens_total = sent = 0
    try:
        async with SessionLocal() as db, httpx.AsyncClient(timeout=5.0) as client:
            for uid in await conversation_member_ids(db, conversation_id):
                if uid == sender_user_id:
                    continue
                member = await db.get(ConversationMember, (conversation_id, uid))
                if member is not None and member.muted:
                    continue
                tokens = list(
                    (
                        await db.execute(
                            select(ApnsToken).where(ApnsToken.user_id == uid)
                        )
                    )
                    .scalars()
                    .all()
                )
                if not tokens:
                    continue
                badge = await _unread_total(db, uid)
                for token in tokens:
                    tokens_total += 1
                    if await _send_apns_one(client, db, token, badge, conversation_id):
                        sent += 1
            await db.commit()  # persist any stale-token deletions
        log.info(
            "APNs fanout conv=%s: %d token(s), %d sent", conversation_id, tokens_total, sent
        )
    except Exception as exc:  # noqa: BLE001 — best-effort, must not raise into the caller
        log.warning("APNs message fanout failed for conv=%s: %s", conversation_id, exc)
