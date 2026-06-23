import json
import uuid

import pyotp
from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from webauthn import (
    generate_registration_options,
    options_to_json,
    verify_registration_response,
)
from webauthn.helpers import base64url_to_bytes, bytes_to_base64url
from webauthn.helpers.structs import (
    AuthenticatorSelectionCriteria,
    PublicKeyCredentialDescriptor,
    ResidentKeyRequirement,
    UserVerificationRequirement,
)

from app.database import get_db
from app.deps import get_current_user
from app.models import User, WebauthnCredential
from app.schemas import (
    BackupCodesOut,
    PasskeyOptionsOut,
    PasskeyOut,
    PasskeyRegisterVerify,
    TotpSetupOut,
    TotpVerifyIn,
    TwoFAStatus,
)
from app.security import generate_backup_codes, hash_backup_code
from app.services.webauthn_svc import (
    create_challenge_token,
    decode_challenge_token,
    rp_and_origin,
)

router = APIRouter(prefix="/2fa", tags=["2fa"])


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
async def totp_setup(current: User = Depends(get_current_user)) -> TotpSetupOut:
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
    body: TotpVerifyIn, current: User = Depends(get_current_user)
) -> BackupCodesOut:
    if not current.totp_secret:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Run setup first")
    if not pyotp.TOTP(current.totp_secret).verify(body.code.strip(), valid_window=1):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "That code didn't match")
    current.totp_enabled = True
    return BackupCodesOut(codes=_new_backup_codes(current))


@router.post("/backup/regenerate", response_model=BackupCodesOut)
async def regenerate_backup(
    current: User = Depends(get_current_user),
) -> BackupCodesOut:
    if not current.totp_enabled:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Enable two-factor first")
    return BackupCodesOut(codes=_new_backup_codes(current))


@router.delete("/totp", status_code=204)
async def disable_totp(current: User = Depends(get_current_user)) -> None:
    current.totp_secret = None
    current.totp_enabled = False
    if not current.has_passkey:
        current.backup_codes = []


@router.delete("", status_code=204)
async def disable_all_2fa(
    current: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
) -> None:
    """Turn off two-factor entirely — TOTP and every passkey."""
    from sqlalchemy import delete

    current.totp_secret = None
    current.totp_enabled = False
    current.has_passkey = False
    current.backup_codes = []
    await db.execute(
        delete(WebauthnCredential).where(WebauthnCredential.user_id == current.id)
    )


# ---------- Passkey (WebAuthn) enrollment ----------
@router.post("/passkey/register/options", response_model=PasskeyOptionsOut)
async def passkey_register_options(
    request: Request,
    current: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> PasskeyOptionsOut:
    rp_id, _ = rp_and_origin()
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
    current: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> BackupCodesOut:
    rp_id, origin = rp_and_origin()
    user_id, challenge_b64 = decode_challenge_token(body.challenge_token)
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
    db.add(
        WebauthnCredential(
            user_id=current.id,
            credential_id=bytes_to_base64url(v.credential_id),
            public_key=bytes_to_base64url(v.credential_public_key),
            sign_count=v.sign_count,
            name=body.name,
        )
    )
    current.has_passkey = True
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
async def delete_passkey(
    cred_id: uuid.UUID,
    current: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    cred = await db.get(WebauthnCredential, cred_id)
    if cred is None or cred.user_id != current.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    await db.delete(cred)
    await db.flush()
    remaining = await db.scalar(
        select(func.count())
        .select_from(WebauthnCredential)
        .where(WebauthnCredential.user_id == current.id)
    )
    current.has_passkey = (remaining or 0) > 0
