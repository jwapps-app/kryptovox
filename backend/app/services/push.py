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
from app.services.presence import filter_online, is_online

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


async def _unread_totals(
    db: AsyncSession, user_ids: list[uuid.UUID]
) -> dict[uuid.UUID, int]:
    """Total unread messages per user across all their conversations — drives the
    app-icon badge. One grouped query for ANY number of users (the message fanout
    used to run the single-user version once per recipient, per push flavor): join
    each membership to its last-read message for the cutoff time, then count newer
    inbound messages per conversation, with a +1 for manually marked-unread empty
    conversations."""
    if not user_ids:
        return {}
    m = aliased(Message)
    lr = aliased(Message)  # the member's last-read message (for its created_at)
    rows = await db.execute(
        select(
            ConversationMember.user_id,
            ConversationMember.marked_unread,
            func.count(m.id)
            .filter(
                and_(
                    m.sender_id != ConversationMember.user_id,
                    m.deleted_at.is_(None),
                    or_(lr.created_at.is_(None), m.created_at > lr.created_at),
                )
            )
            .label("unread"),
        )
        .select_from(ConversationMember)
        .outerjoin(lr, lr.id == ConversationMember.last_read_message_id)
        .outerjoin(m, m.conversation_id == ConversationMember.conversation_id)
        .where(ConversationMember.user_id.in_(user_ids))
        .group_by(
            ConversationMember.user_id,
            ConversationMember.conversation_id,
            ConversationMember.marked_unread,
        )
    )
    totals: dict[uuid.UUID, int] = dict.fromkeys(user_ids, 0)
    for uid, marked_unread, unread in rows.all():
        unread = int(unread or 0)
        if marked_unread and unread == 0:
            unread = 1
        totals[uid] = totals.get(uid, 0) + unread
    return totals


async def _unread_total(db: AsyncSession, user_id: uuid.UUID) -> int:
    return (await _unread_totals(db, [user_id])).get(user_id, 0)


async def user_badge_total(db: AsyncSession, user_id: uuid.UUID) -> int:
    """Total unread for the app-icon badge: conversation unread + secret-link
    threads with an unread guest reply. Runs on every guest reply, so the last
    message per thread comes from ONE DISTINCT ON query, not one per thread."""
    total = await _unread_total(db, user_id)
    threads = (
        await db.execute(
            select(GuestThread.id, GuestThread.host_read_at).where(
                GuestThread.creator_id == user_id
            )
        )
    ).all()
    if not threads:
        return total
    lasts = (
        await db.execute(
            select(GuestMessage)
            .where(GuestMessage.thread_id.in_([t.id for t in threads]))
            .order_by(GuestMessage.thread_id, GuestMessage.created_at.desc())
            .distinct(GuestMessage.thread_id)
        )
    ).scalars()
    last_by_thread = {gm.thread_id: gm for gm in lasts}
    for tid, host_read_at in threads:
        last = last_by_thread.get(tid)
        if (
            last
            and last.sender == "guest"
            and (host_read_at is None or last.created_at > host_read_at)
        ):
            total += 1
    return total


async def notify_user(
    db: AsyncSession,
    user_id: uuid.UUID,
    payload: dict,
    *,
    ignore_presence: bool = False,
) -> None:
    """Push a payload to a user's subscribed devices (used for secret-link replies
    and call rings, which aren't tied to a conversation).

    By default skips devices with a live socket. `ignore_presence=True` pushes to
    every subscribed device regardless: for a time-sensitive call ring, a just
    force-closed app can linger "online" (presence TTL) and silently swallow the
    push — the same lag that used to drop message pushes. A foregrounded app rings
    from the live WS offer, so the extra banner is a tolerable trade for not
    missing a call."""
    rows = await db.execute(
        select(Device).where(
            Device.user_id == user_id, Device.push_subscription.isnot(None)
        )
    )
    seen_endpoints: set[str] = set()
    considered = online = pushed = 0
    for device in rows.scalars().all():
        considered += 1
        if not ignore_presence and await is_online(device.id):
            online += 1
            continue
        endpoint = (device.push_subscription or {}).get("endpoint")
        if endpoint and endpoint in seen_endpoints:
            continue
        if endpoint:
            seen_endpoints.add(endpoint)
        await _send(device.push_subscription, payload, device, db)
        pushed += 1
    log.info(
        "notify_user user=%s: %d device(s), %d online-skipped, %d pushed (ignore_presence=%s)",
        user_id,
        considered,
        online,
        pushed,
        ignore_presence,
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


_relay: httpx.AsyncClient | None = None


def _relay_client() -> httpx.AsyncClient:
    """One keep-alive connection pool to the relay per process — not a fresh
    client (new pool + TLS handshake) per message or call."""
    global _relay
    if _relay is None:
        _relay = httpx.AsyncClient(timeout=5.0)
    return _relay


async def _relay_post(body: dict) -> httpx.Response | None:
    try:
        return await _relay_client().post(
            f"{settings.push_relay_url.rstrip('/')}/notify",
            json=body,
            headers={"X-API-Key": settings.push_relay_api_key},
        )
    except Exception as exc:  # noqa: BLE001 — relay is best-effort
        log.warning("push-relay call failed (%s): %s", settings.push_relay_url, exc)
        return None


async def _post_notify(
    token: ApnsToken,
    conversation_id: uuid.UUID,
    sandbox: bool,
    title: str,
    body_text: str,
    badge: int | None,
) -> httpx.Response | None:
    body = {
        "bundle_id": settings.apns_bundle_id,
        "device_token": token.apns_token,
        "title": title,
        "body": body_text,  # content is E2EE — never the message text
        "custom_data": {"conversation_id": str(conversation_id)},
        "sandbox": sandbox,
    }
    if badge is not None:
        body["badge"] = int(badge)  # calls omit badge so they don't reset it
    return await _relay_post(body)


async def _send_apns_one(
    db: AsyncSession,
    token: ApnsToken,
    conversation_id: uuid.UUID,
    *,
    title: str = "Kryptovox",
    body_text: str = "New message",
    badge: int | None = None,
) -> bool:
    """Send one notification. `sandbox` is derived from the stored environment,
    but if Apple returns BadDeviceToken (the classic env/flag mismatch) we retry
    once with the opposite flag and, on success, correct the stored environment —
    so a mislabeled token (e.g. a production token registered as 'sandbox') still
    delivers and self-heals."""
    prefer_sandbox = (token.environment or "").strip().lower() == "sandbox"
    resp = await _post_notify(
        token, conversation_id, prefer_sandbox, title, body_text, badge
    )
    if resp is None:
        return False
    if resp.status_code == 200:
        return True
    if resp.status_code == 403:
        log.error(
            "push-relay 403: API key mismatch for %s — check PUSH_RELAY_API_KEY",
            settings.apns_bundle_id,
        )
        return False
    if resp.status_code == 502 and "BadDeviceToken" in resp.text:
        # Wrong environment flag → retry flipped and learn the right value.
        retry = await _post_notify(
            token, conversation_id, not prefer_sandbox, title, body_text, badge
        )
        if retry is not None and retry.status_code == 200:
            token.environment = "production" if prefer_sandbox else "sandbox"
            log.info(
                "APNs delivered on retry; corrected environment to %r (token=%s…)",
                token.environment,
                token.apns_token[:8],
            )
            return True
        # Both environments rejected → genuinely stale token; drop it.
        log.info("APNs BadDeviceToken on both environments — pruning token")
        await db.delete(token)
        return False
    if resp.status_code == 502 and "Unregistered" in resp.text:
        await db.delete(token)  # Apple says the token is dead
        return False
    log.warning(
        "push-relay %s (sandbox=%s): %s", resp.status_code, prefer_sandbox, resp.text[:200]
    )
    return False


async def notify_offline_all(
    conversation_id: uuid.UUID, sender_user_id: uuid.UUID, sender_name: str
) -> None:
    """Fire-and-forget push fanout for a new message — web push AND APNs in one
    pass. Runs as a background task in its OWN session, so the sender's response
    never waits on push-service round-trips (the web half used to run inline).

    Constant query count regardless of conversation size: members+mute, badge
    totals, subscribed devices, and APNs tokens are each ONE query for the whole
    conversation (previously ~4 queries per recipient, run twice — once per push
    flavor — with the badge aggregate recomputed for both).

    Web push skips devices holding a live socket; APNs deliberately does NOT skip
    WS-online recipients (iOS suppresses banners for a foregrounded app itself,
    and presence lag was silently dropping pushes)."""
    try:
        async with SessionLocal() as db:
            rows = await db.execute(
                select(ConversationMember.user_id, ConversationMember.muted).where(
                    ConversationMember.conversation_id == conversation_id
                )
            )
            recipients = [
                uid for uid, muted in rows.all() if uid != sender_user_id and not muted
            ]
            if not recipients:
                return
            badges = await _unread_totals(db, recipients)

            # --- Web push (VAPID) ---
            base = {
                "title": sender_name or "Kryptovox",
                "body": "New message",
                "url": f"/chat/{conversation_id}",
            }
            devices = (
                await db.execute(
                    select(Device).where(
                        Device.user_id.in_(recipients),
                        Device.push_subscription.isnot(None),
                    )
                )
            ).scalars().all()
            online_ids = await filter_online(d.id for d in devices)
            pushed = 0
            seen_endpoints: set[str] = set()
            for device in devices:
                if device.id in online_ids:
                    continue
                # Re-logins create multiple device rows that may share one browser
                # push endpoint — dedupe so the user gets a single banner.
                endpoint = (device.push_subscription or {}).get("endpoint")
                if endpoint and endpoint in seen_endpoints:
                    continue
                if endpoint:
                    seen_endpoints.add(endpoint)
                payload = {**base, "badge": badges.get(device.user_id, 0)}
                await _send(device.push_subscription, payload, device, db)
                pushed += 1
            log.info(
                "push fanout conv=%s: %d subscribed device(s), %d online (skipped), %d pushed",
                conversation_id,
                len(devices),
                len(online_ids),
                pushed,
            )

            # --- APNs via the relay ---
            if apns_enabled():
                tokens = (
                    await db.execute(
                        select(ApnsToken).where(ApnsToken.user_id.in_(recipients))
                    )
                ).scalars().all()
                sent = 0
                for token in tokens:
                    if await _send_apns_one(
                        db, token, conversation_id, badge=badges.get(token.user_id, 0)
                    ):
                        sent += 1
                await db.commit()  # persist stale-token deletions / env corrections
                if tokens:
                    log.info(
                        "APNs fanout conv=%s: %d token(s), %d sent",
                        conversation_id,
                        len(tokens),
                        sent,
                    )
    except Exception as exc:  # noqa: BLE001 — best-effort, must not raise into the caller
        log.warning("push fanout failed for conv=%s: %s", conversation_id, exc)


async def _post_voip(
    voip_token: str,
    custom_data: dict,
    sandbox: bool,
) -> httpx.Response | None:
    """PushKit / VoIP push — wakes the app so CallKit can ring a closed device.
    CallKit (not a banner) draws the UI, but the relay requires title/body on
    every push, so we send placeholders derived from the caller name."""
    caller = custom_data.get("name") or "Someone"
    body = {
        "bundle_id": settings.apns_bundle_id,
        "device_token": voip_token,
        "push_type": "voip",
        "title": "Incoming call",
        "body": f"{caller} is calling",
        "custom_data": custom_data,
        "sandbox": sandbox,
    }
    return await _relay_post(body)


async def _send_voip_one(
    db: AsyncSession,
    token: ApnsToken,
    custom_data: dict,
) -> bool:
    """Send one VoIP push, deriving sandbox from the stored environment and
    retrying flipped on BadDeviceToken (same self-heal as the alert path)."""
    prefer_sandbox = (token.environment or "").strip().lower() == "sandbox"
    resp = await _post_voip(token.voip_token, custom_data, prefer_sandbox)
    if resp is None:
        return False
    if resp.status_code == 200:
        return True
    if resp.status_code == 403:
        log.error("push-relay 403 on VoIP — check PUSH_RELAY_API_KEY")
        return False
    if resp.status_code == 502 and "BadDeviceToken" in resp.text:
        retry = await _post_voip(
            token.voip_token, custom_data, not prefer_sandbox
        )
        if retry is not None and retry.status_code == 200:
            token.environment = "production" if prefer_sandbox else "sandbox"
            return True
        # A dead VoIP token doesn't mean the alert token is dead — just clear it.
        token.voip_token = None
        return False
    if resp.status_code == 502 and "Unregistered" in resp.text:
        token.voip_token = None
        return False
    log.warning("push-relay VoIP %s: %s", resp.status_code, resp.text[:200])
    return False


async def ring_call(
    callee_id: uuid.UUID,
    caller_name: str,
    conversation_id: uuid.UUID,
    offer: dict,
) -> None:
    """Ring a callee's offline/background devices about an incoming 1:1 call.

    - Native devices with a VoIP token get a PushKit push carrying the SDP offer,
      so CallKit rings even from a fully closed app.
    - Other devices fall back to an alert: web push for PWAs, APNs alert for older
      native builds.
    A callee with a live socket already rings from the WS offer, so the wake-up
    pushes (VoIP + APNs alert) are skipped for them; web push self-skips online
    devices regardless."""
    body_text = f"{caller_name or 'Someone'} is calling"
    payload = {
        "title": "Kryptovox",
        "body": body_text,
        "url": f"/chat/{conversation_id}",
        "type": "call",
    }
    voip = alert = skipped = 0
    try:
        async with SessionLocal() as db:
            # Ring every subscribed device — don't let presence lag on a just
            # force-closed PWA swallow the call banner (messages already do this).
            await notify_user(db, callee_id, payload, ignore_presence=True)
            if apns_enabled():
                # The VoIP push carries only enough to wake the app and ring
                # CallKit. The SDP offer is deliberately NOT included: a video
                # offer exceeds APNs's ~5KB VoIP payload cap (PayloadTooLarge).
                # The woken app connects its WS and receives the buffered offer +
                # ICE via deliver_buffered_calls — the standard PushKit flow.
                voip_custom = {
                    "from": str(offer.get("from") or ""),
                    "conversation_id": str(conversation_id),
                    "name": caller_name or "Someone",
                    "video": bool(offer.get("video")),
                }
                tokens = (
                    await db.execute(
                        select(ApnsToken).where(ApnsToken.user_id == callee_id)
                    )
                ).scalars().all()
                for token in tokens:
                    # Only skip a device whose OWN session holds a live socket
                    # (it rings from the WS offer). Presence is per-device, so
                    # another device being online — e.g. a browser tab left
                    # open — never suppresses a closed phone's wake-up push.
                    if token.device_id is not None and await is_online(
                        token.device_id
                    ):
                        skipped += 1
                        continue
                    if token.voip_token:
                        if await _send_voip_one(db, token, voip_custom):
                            voip += 1
                    elif await _send_apns_one(
                        db,
                        token,
                        conversation_id,
                        title="Incoming call",
                        body_text=body_text,
                    ):
                        alert += 1
                await db.commit()
        log.info(
            "call ring callee=%s: %d voip, %d alert, %d skipped(online)",
            callee_id,
            voip,
            alert,
            skipped,
        )
    except Exception as exc:  # noqa: BLE001 — best-effort
        log.warning("call ring failed for callee=%s: %s", callee_id, exc)
