import pyotp
from fastapi import APIRouter, Depends, HTTPException, status

from app.deps import get_current_user
from app.models import User
from app.schemas import BackupCodesOut, TotpSetupOut, TotpVerifyIn, TwoFAStatus
from app.security import generate_backup_codes, hash_backup_code

router = APIRouter(prefix="/2fa", tags=["2fa"])


def _new_backup_codes(user: User) -> list[str]:
    codes = generate_backup_codes()
    user.backup_codes = [{"hash": hash_backup_code(c), "used": False} for c in codes]
    return codes


@router.get("/status", response_model=TwoFAStatus)
async def status_2fa(current: User = Depends(get_current_user)) -> TwoFAStatus:
    remaining = sum(1 for c in (current.backup_codes or []) if not c.get("used"))
    return TwoFAStatus(
        totp_enabled=current.totp_enabled, backup_codes_remaining=remaining
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
    current.backup_codes = []
