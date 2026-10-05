import json
import uuid

import pyotp
from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from webauthn import (
    generate_registration_options,
    options_to_json,
    verify_registration_response,
)
from webauthn.helpers import base64url_to_bytes, bytes_to_base64url
from webauthn.helpers.structs import (
    AuthenticatorSelectionCriteria,
    ResidentKeyRequirement,
    UserVerificationRequirement,
)

from app.database import get_db
from app.deps import CurrentIdentity, get_current_identity, get_current_user
from app.models import User, WebauthnCredential
from app.ratelimit import limiter
from app.schemas import (
    BackupCodesOut,
    PasskeyOptionsOut,
    PasskeyOut,
    PasskeyRegisterOptionsIn,
    PasskeyRegisterVerify,
    StepUpIn,
    TotpSetupOut,
    TotpVerifyIn,
    TwoFAStatus,
)
from app.security import consume_totp, generate_backup_codes, hash_backup_code
from app.services.app_settings import get_require_2fa
from app.services.sessions import revoke_sessions
from app.services.stepup import require_password
from app.services.webauthn_svc import (
    create_challenge_token,
    decode_challenge_token,
    rp_and_origin,
)

router = APIRouter(prefix="/2fa", tags=["2fa"])

# Every factor-changing route below takes a fresh password (step-up): a bearer
# session alone must not be able to weaken the account's future protection.
# Enrolling a factor also evicts the user's OTHER sessions — whoever enabled
# 2FA is the one who should hold the only live session afterwards.

_POLICY_LOCKED = HTTPException(
    status.HTTP_403_FORBIDDEN,
    "This server requires two-factor authentication; you can't remove your last method.",
)


async def _user_passkeys(db: AsyncSession, user_id: uuid.UUID) -> list[WebauthnCredential]:
    rows = await db.execute(
        select(WebauthnCredential)
        .where(WebauthnCredential.user_id == user_id)
        .order_by(WebauthnCredential.created_at)
    )
    return list(rows.scalars().all())


def _new_backup_codes(user: User) -> list[str]:
    codes = generate_backup_codes()
    user.backup_codes = [{"hash": hash_backup_code(c), "used": False} for c in codes]
    return codes


async def _enabled_here(db: AsyncSession, identity: CurrentIdentity) -> None:
    """A factor was just enabled from this device: end every other session."""
    await revoke_sessions(db, identity.user.id, except_device_id=identity.device.id)


@router.get("/status", response_model=TwoFAStatus)
async def status_2fa(
    current: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
) -> TwoFAStatus:
    remaining = sum(1 for c in (current.backup_codes or []) if not c.get("used"))
    count = await db.scalar(
        select(func.count())
        .select_from(WebauthnCredential)
        .where(WebauthnCredential.user_id == current.id)
    )
    return TwoFAStatus(
        totp_enabled=current.totp_enabled,
        backup_codes_remaining=remaining,
        passkey_count=count or 0,
    )


@router.post("/totp/setup", response_model=TotpSetupOut)
@limiter.limit("10/minute")
async def totp_setup(
    request: Request,
    body: StepUpIn,
    current: User = Depends(get_current_user),
) -> TotpSetupOut:
    await require_password(current, body.password)
    if current.totp_enabled:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Two-factor already enabled")
    secret = pyotp.random_base32()
    current.totp_secret = secret  # pending until verified
    uri = pyotp.TOTP(secret).provisioning_uri(
        name=current.username, issuer_name="Kryptovox"
    )
    return TotpSetupOut(secret=secret, provisioning_uri=uri)


@router.post("/totp/verify", response_model=BackupCodesOut)
async def totp_verify(
    body: TotpVerifyIn,
    identity: CurrentIdentity = Depends(get_current_identity),
    db: AsyncSession = Depends(get_db),
) -> BackupCodesOut:
    current = identity.user
    if not current.totp_secret:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Run setup first")
    if not consume_totp(current, body.code.strip()):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "That code didn't match")
    current.totp_enabled = True
    await _enabled_here(db, identity)
    # Only issue codes if this is the first 2FA method; don't clobber existing ones.
    if not current.backup_codes:
        return BackupCodesOut(codes=_new_backup_codes(current))
    return BackupCodesOut(codes=[])


@router.post("/backup/regenerate", response_model=BackupCodesOut)
@limiter.limit("10/minute")
async def regenerate_backup(
    request: Request,
    body: StepUpIn,
    current: User = Depends(get_current_user),
) -> BackupCodesOut:
    await require_password(current, body.password)
    if not current.totp_enabled:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Enable two-factor first")
    return BackupCodesOut(codes=_new_backup_codes(current))


@router.delete("/totp", status_code=204)
@limiter.limit("10/minute")
async def disable_totp(
    request: Request,
    body: StepUpIn,
    current: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    await require_password(current, body.password)
    if not current.has_passkey and await get_require_2fa(db):
        raise _POLICY_LOCKED  # TOTP is the last factor
    current.totp_secret = None
    current.totp_enabled = False
    if not current.has_passkey:
        current.backup_codes = []


@router.delete("", status_code=204)
@limiter.limit("10/minute")
async def disable_all_2fa(
    request: Request,
    body: StepUpIn,
    current: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Turn off two-factor entirely — TOTP and every passkey."""
    await require_password(current, body.password)
    if await get_require_2fa(db):
        raise _POLICY_LOCKED
    current.totp_secret = None
    current.totp_enabled = False
    current.has_passkey = False
    current.backup_codes = []
    await db.execute(
        delete(WebauthnCredential).where(WebauthnCredential.user_id == current.id)
    )


# ---------- Passkey (WebAuthn) enrollment ----------
@router.post("/passkey/register/options", response_model=PasskeyOptionsOut)
@limiter.limit("10/minute")
async def passkey_register_options(
    request: Request,
    body: PasskeyRegisterOptionsIn,
    current: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> PasskeyOptionsOut:
    await require_password(current, body.password)
    rp_id, _ = rp_and_origin(request)
    # No exclude_credentials: synced passkey managers (Bitwarden, iCloud) treat an
    # already-synced credential as "excluded" and refuse to register, even on a new
    # device. Allowing a second passkey is harmless — both are valid 2FA factors.
    options = generate_registration_options(
        rp_id=rp_id,
        rp_name="Kryptovox",
        user_name=current.username,
        user_id=str(current.id).encode(),
        authenticator_selection=AuthenticatorSelectionCriteria(
            user_verification=UserVerificationRequirement.PREFERRED,
            resident_key=ResidentKeyRequirement.DISCOURAGED,
        ),
    )
    token = create_challenge_token(current.id, bytes_to_base64url(options.challenge))
    return PasskeyOptionsOut(options=json.loads(options_to_json(options)), challenge_token=token)


@router.post("/passkey/register/verify", response_model=BackupCodesOut)
async def passkey_register_verify(
    request: Request,
    body: PasskeyRegisterVerify,
    identity: CurrentIdentity = Depends(get_current_identity),
    db: AsyncSession = Depends(get_db),
) -> BackupCodesOut:
    current = identity.user
    rp_id, origin = rp_and_origin(request)
    user_id, challenge_b64, _ = decode_challenge_token(body.challenge_token)
    if user_id != current.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Bad challenge")
    try:
        v = verify_registration_response(
            credential=json.dumps(body.credential),
            expected_challenge=base64url_to_bytes(challenge_b64),
            expected_rp_id=rp_id,
            expected_origin=origin,
            require_user_verification=False,
        )
    except Exception:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Passkey registration failed")
    # Capture the authenticator's reported transports (e.g. ["internal","hybrid"])
    # so login can steer the browser to a local passkey instead of the QR flow.
    raw_transports = (body.credential.get("response") or {}).get("transports") or []
    transports = ",".join(t for t in raw_transports if isinstance(t, str))[:128] or None
    db.add(
        WebauthnCredential(
            user_id=current.id,
            credential_id=bytes_to_base64url(v.credential_id),
            public_key=bytes_to_base64url(v.credential_public_key),
            sign_count=v.sign_count,
            name=body.name,
            transports=transports,
        )
    )
    current.has_passkey = True
    await _enabled_here(db, identity)
    # Issue backup codes if this is the user's first 2FA method.
    if not current.backup_codes:
        return BackupCodesOut(codes=_new_backup_codes(current))
    return BackupCodesOut(codes=[])


@router.get("/passkey", response_model=list[PasskeyOut])
async def list_passkeys(
    current: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
) -> list[WebauthnCredential]:
    return await _user_passkeys(db, current.id)


@router.delete("/passkey/{cred_id}", status_code=204)
@limiter.limit("10/minute")
async def delete_passkey(
    request: Request,
    cred_id: uuid.UUID,
    body: StepUpIn,
    current: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    await require_password(current, body.password)
    cred = await db.get(WebauthnCredential, cred_id)
    if cred is None or cred.user_id != current.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    remaining = await db.scalar(
        select(func.count())
        .select_from(WebauthnCredential)
        .where(WebauthnCredential.user_id == current.id, WebauthnCredential.id != cred_id)
    )
    if not remaining and not current.totp_enabled and await get_require_2fa(db):
        raise _POLICY_LOCKED  # this passkey is the last factor
    await db.delete(cred)
    await db.flush()
    current.has_passkey = (remaining or 0) > 0
