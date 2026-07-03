import json
from datetime import UTC, datetime

from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response, status
from jwt import InvalidTokenError
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from webauthn import (
    generate_authentication_options,
    options_to_json,
    verify_authentication_response,
)
from webauthn.helpers import base64url_to_bytes, bytes_to_base64url
from webauthn.helpers.structs import (
    AuthenticatorTransport,
    PublicKeyCredentialDescriptor,
    UserVerificationRequirement,
)

from app.config import settings
from app.database import get_db
from app.deps import CurrentIdentity, get_current_identity
from app.models import ApnsToken, AuthToken, Device, User, WebauthnCredential
from app.ratelimit import limiter
from app.schemas import (
    LoginRequest,
    LoginResponse,
    PasskeyLoginOptionsIn,
    PasskeyLoginVerify,
    PasskeyOptionsOut,
    RefreshRequest,
    RegisterRequest,
    SetupStatus,
    TokenResponse,
    TwoFAComplete,
    UserOut,
)
from app.services.webauthn_svc import (
    create_challenge_token,
    decode_challenge_token,
    rp_and_origin,
)
from app.security import (
    consume_totp,
    create_access_token,
    create_pending_2fa_token,
    decode_pending_2fa_token,
    generate_refresh_token,
    hash_backup_code,
    hash_password,
    hash_refresh_token,
    refresh_token_expiry,
    verify_password,
)
from app.services.twofa_guard import (
    assert_not_locked,
    assert_pending_unused,
    clear_failures,
    consume_pending,
    record_failure,
)

router = APIRouter(prefix="/auth", tags=["auth"])

REFRESH_COOKIE = "kv_refresh"


def _parse_transports(stored: str | None) -> list[AuthenticatorTransport] | None:
    """Stored 'internal,hybrid' -> transport enums for the login descriptor.
    Unknown values are skipped; None means the browser gets no hint (old creds)."""
    if not stored:
        return None
    out: list[AuthenticatorTransport] = []
    for t in stored.split(","):
        try:
            out.append(AuthenticatorTransport(t.strip()))
        except ValueError:
            continue
    return out or None
COOKIE_PATH = "/api/auth"


def _set_refresh_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=REFRESH_COOKIE,
        value=token,
        httponly=True,
        secure=True,
        samesite="lax",  # lax is more reliable than strict on PWA cold launches
        path=COOKIE_PATH,
        max_age=settings.refresh_token_expire_days * 24 * 3600,
    )


async def _issue_tokens(
    db: AsyncSession, response: Response, user: User, device: Device
) -> TokenResponse:
    refresh = generate_refresh_token()
    db.add(
        AuthToken(
            device_id=device.id,
            refresh_token_hash=hash_refresh_token(refresh),
            expires_at=refresh_token_expiry(),
        )
    )
    await db.flush()
    _set_refresh_cookie(response, refresh)
    return TokenResponse(
        access_token=create_access_token(user.id, device.id),
        refresh_token=refresh,
        expires_in=settings.access_token_expire_minutes * 60,
        user=UserOut.model_validate(user),
        device_id=device.id,
    )


async def _user_count(db: AsyncSession) -> int:
    return int(await db.scalar(select(func.count(User.id))) or 0)


@router.get("/setup-status", response_model=SetupStatus)
async def setup_status(db: AsyncSession = Depends(get_db)) -> SetupStatus:
    # Bootstrap registration is open only while the server has no users.
    return SetupStatus(needs_setup=await _user_count(db) == 0)


@router.post("/register", response_model=TokenResponse, status_code=201)
@limiter.limit("10/hour")
async def register(
    request: Request,
    body: RegisterRequest,
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> TokenResponse:
    # Open registration is allowed only for the very first account, which
    # becomes the server administrator. After that, an admin must provision
    # users via POST /admin/users.
    if await _user_count(db) > 0:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Registration is closed. Ask an administrator to create your account.",
        )

    existing = await db.scalar(select(User).where(User.username == body.username))
    if existing:
        raise HTTPException(status.HTTP_409_CONFLICT, "Username already taken")

    user = User(
        username=body.username,
        display_name=body.display_name or body.username,
        password_hash=hash_password(body.password),
        is_admin=True,  # first user bootstraps as admin
        identity_public_key=body.identity_public_key,
        encrypted_private_key=body.encrypted_private_key.model_dump(),
    )
    db.add(user)
    await db.flush()

    device = Device(
        user_id=user.id,
        device_name=body.device_name,
        public_key=body.identity_public_key,
    )
    db.add(device)
    await db.flush()

    return await _issue_tokens(db, response, user, device)


async def _login_device(db: AsyncSession, response: Response, user: User, name: str | None):
    # Each login establishes a fresh device row (browser). The client recovers
    # the shared identity key separately via GET/PUT /users/me/identity.
    device = Device(
        user_id=user.id,
        device_name=name,
        public_key=user.identity_public_key,
    )
    db.add(device)
    await db.flush()
    return await _issue_tokens(db, response, user, device)


@router.post("/login", response_model=LoginResponse)
@limiter.limit("10/minute")
async def login(
    request: Request,
    body: LoginRequest,
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> LoginResponse:
    user = await db.scalar(select(User).where(User.username == body.username))
    if user is None or not verify_password(body.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid credentials")

    # 2FA enrolled → don't issue a session yet; require the second factor.
    if user.twofa_enabled:
        methods = []
        if user.totp_enabled:
            methods.append("totp")
        if user.has_passkey:
            methods.append("passkey")
        return LoginResponse(
            twofa_required=True,
            pending_token=create_pending_2fa_token(user.id),
            methods=methods,
        )

    tokens = await _login_device(db, response, user, body.device_name)
    return LoginResponse(tokens=tokens)


@router.post("/2fa", response_model=LoginResponse)
@limiter.limit("10/minute")
async def complete_2fa(
    request: Request,
    body: TwoFAComplete,
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> LoginResponse:
    try:
        user_id, jti = decode_pending_2fa_token(body.pending_token)
    except InvalidTokenError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session expired — sign in again")
    user = await db.get(User, user_id)
    if user is None or not user.twofa_enabled:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid session")
    await assert_not_locked(user_id)
    await assert_pending_unused(jti)

    code = body.code.replace(" ", "").replace("-", "")
    ok = consume_totp(user, code)  # replay-resistant (tracks last timestep)
    if not ok:
        # Try a one-time backup code.
        h = hash_backup_code(body.code)
        codes = list(user.backup_codes or [])
        for entry in codes:
            if not entry.get("used") and entry.get("hash") == h:
                entry["used"] = True
                ok = True
                break
        if ok:
            user.backup_codes = codes  # reassign so JSONB change is tracked
    if not ok:
        await record_failure(user_id)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid code")

    await clear_failures(user_id)
    await consume_pending(jti)
    tokens = await _login_device(db, response, user, body.device_name)
    return LoginResponse(tokens=tokens)


@router.post("/2fa/passkey/options", response_model=PasskeyOptionsOut)
@limiter.limit("20/minute")
async def passkey_login_options(
    request: Request,
    body: PasskeyLoginOptionsIn,
    db: AsyncSession = Depends(get_db),
) -> PasskeyOptionsOut:
    try:
        user_id, _ = decode_pending_2fa_token(body.pending_token)
    except InvalidTokenError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session expired — sign in again")
    rows = await db.execute(
        select(WebauthnCredential).where(WebauthnCredential.user_id == user_id)
    )
    creds = list(rows.scalars().all())
    if not creds:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No passkeys")
    rp_id, _ = rp_and_origin(request)
    options = generate_authentication_options(
        rp_id=rp_id,
        allow_credentials=[
            PublicKeyCredentialDescriptor(
                id=base64url_to_bytes(c.credential_id),
                transports=_parse_transports(c.transports),
            )
            for c in creds
        ],
        user_verification=UserVerificationRequirement.PREFERRED,
    )
    token = create_challenge_token(user_id, bytes_to_base64url(options.challenge))
    return PasskeyOptionsOut(options=json.loads(options_to_json(options)), challenge_token=token)


@router.post("/2fa/passkey/verify", response_model=LoginResponse)
@limiter.limit("20/minute")
async def passkey_login_verify(
    request: Request,
    body: PasskeyLoginVerify,
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> LoginResponse:
    try:
        uid_a, jti = decode_pending_2fa_token(body.pending_token)
        uid_b, challenge_b64 = decode_challenge_token(body.challenge_token)
    except InvalidTokenError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session expired — sign in again")
    if uid_a != uid_b:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid session")
    await assert_not_locked(uid_a)
    await assert_pending_unused(jti)
    cred_id = body.credential.get("id") or body.credential.get("rawId")
    cred = await db.scalar(
        select(WebauthnCredential).where(
            WebauthnCredential.user_id == uid_a,
            WebauthnCredential.credential_id == cred_id,
        )
    )
    if cred is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Unknown passkey")
    rp_id, origin = rp_and_origin(request)
    try:
        v = verify_authentication_response(
            credential=json.dumps(body.credential),
            expected_challenge=base64url_to_bytes(challenge_b64),
            expected_rp_id=rp_id,
            expected_origin=origin,
            credential_public_key=base64url_to_bytes(cred.public_key),
            credential_current_sign_count=cred.sign_count,
            require_user_verification=False,
        )
    except Exception:
        await record_failure(uid_a)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Passkey check failed")
    cred.sign_count = v.new_sign_count
    await clear_failures(uid_a)
    await consume_pending(jti)
    user = await db.get(User, uid_a)
    tokens = await _login_device(db, response, user, body.device_name)
    return LoginResponse(tokens=tokens)


@router.post("/refresh", response_model=TokenResponse)
@limiter.limit("60/minute")
async def refresh(
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
    body: RefreshRequest | None = None,
    kv_refresh: str | None = Cookie(default=None),
) -> TokenResponse:
    # No CSRF origin check needed: the refresh token comes from the request body
    # (client-persisted in localStorage), which a cross-site attacker cannot
    # read or forge. The cookie fallback is SameSite=Lax. The earlier origin
    # check broke session restore whenever the Origin didn't exactly match
    # ALLOWED_ORIGINS.
    token = (body.refresh_token if body else None) or kv_refresh
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "No refresh token")

    token_hash = hash_refresh_token(token)
    record = await db.scalar(
        select(AuthToken).where(AuthToken.refresh_token_hash == token_hash)
    )
    now = datetime.now(UTC)
    if (
        record is None
        or record.revoked
        or record.expires_at <= now
    ):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid refresh token")

    device = await db.get(Device, record.device_id)
    if device is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Device revoked")
    user = await db.get(User, device.user_id)
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "User not found")

    # Keep the SAME refresh token (no rotation). Rotation broke installed PWAs:
    # the rotated cookie often isn't persisted before the app closes, so the next
    # launch presented a revoked token and got bounced to the login screen. A
    # stable token (hashed-at-rest, server-revocable) avoids that.
    #
    # We deliberately do NOT slide the expiry: the token keeps its original
    # issuance-time expiry, so a leaked token is valid for at most
    # REFRESH_TOKEN_EXPIRE_DAYS from login (not indefinitely renewable). Active
    # users simply re-login when it lapses.
    _set_refresh_cookie(response, token)
    return TokenResponse(
        access_token=create_access_token(user.id, device.id),
        refresh_token=token,
        expires_in=settings.access_token_expire_minutes * 60,
        user=UserOut.model_validate(user),
        device_id=device.id,
    )


@router.post("/logout", status_code=204)
async def logout(
    response: Response,
    identity: CurrentIdentity = Depends(get_current_identity),
    db: AsyncSession = Depends(get_db),
    body: RefreshRequest | None = None,
    kv_refresh: str | None = Cookie(default=None),
) -> Response:
    # Revoke whichever token the client presents — body (localStorage) or cookie.
    # Clients that authenticate via the body token have no cookie, so revoking
    # only the cookie would leave their DB token live.
    presented = (body.refresh_token if body else None) or kv_refresh
    if presented:
        token_hash = hash_refresh_token(presented)
        record = await db.scalar(
            select(AuthToken).where(AuthToken.refresh_token_hash == token_hash)
        )
        if record:
            record.revoked = True
    # Drop this session's APNs token so the logged-out phone stops receiving push.
    await db.execute(delete(ApnsToken).where(ApnsToken.device_id == identity.device.id))
    response.delete_cookie(REFRESH_COOKIE, path=COOKIE_PATH)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
