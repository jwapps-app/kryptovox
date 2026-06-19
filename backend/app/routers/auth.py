import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.deps import CurrentIdentity, get_current_identity
from app.models import AuthToken, Device, User
from app.ratelimit import limiter
from app.schemas import (
    LoginRequest,
    RegisterRequest,
    SetupStatus,
    TokenResponse,
    UserOut,
)
from app.security import (
    create_access_token,
    generate_refresh_token,
    hash_password,
    hash_refresh_token,
    refresh_token_expiry,
    verify_password,
)

router = APIRouter(prefix="/auth", tags=["auth"])

REFRESH_COOKIE = "kv_refresh"
COOKIE_PATH = "/api/auth"


def _set_refresh_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=REFRESH_COOKIE,
        value=token,
        httponly=True,
        secure=True,
        samesite="strict",
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
    )
    db.add(user)
    await db.flush()

    device = Device(
        user_id=user.id,
        device_name=body.device_name,
        public_key=body.public_key,
    )
    db.add(device)
    await db.flush()

    return await _issue_tokens(db, response, user, device)


@router.post("/login", response_model=TokenResponse)
@limiter.limit("10/minute")
async def login(
    request: Request,
    body: LoginRequest,
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> TokenResponse:
    user = await db.scalar(select(User).where(User.username == body.username))
    if user is None or not verify_password(body.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid credentials")

    # A login from a given public key reuses that device row if present, else creates one.
    device = await db.scalar(
        select(Device).where(
            Device.user_id == user.id, Device.public_key == body.public_key
        )
    )
    if device is None:
        device = Device(
            user_id=user.id,
            device_name=body.device_name,
            public_key=body.public_key,
        )
        db.add(device)
        await db.flush()

    return await _issue_tokens(db, response, user, device)


@router.post("/refresh", response_model=TokenResponse)
@limiter.limit("60/minute")
async def refresh(
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
    kv_refresh: str | None = Cookie(default=None),
) -> TokenResponse:
    # CSRF defense-in-depth: the refresh cookie is SameSite=Strict, but if a
    # cross-origin request still arrives with an Origin header, reject it.
    origin = request.headers.get("origin")
    if origin and origin not in settings.cors_origins:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Bad origin")
    if not kv_refresh:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "No refresh token")

    token_hash = hash_refresh_token(kv_refresh)
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

    # Rotate: revoke old, issue new.
    record.revoked = True
    device = await db.get(Device, record.device_id)
    if device is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Device revoked")
    user = await db.get(User, device.user_id)
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "User not found")

    return await _issue_tokens(db, response, user, device)


@router.post("/logout", status_code=204)
async def logout(
    response: Response,
    identity: CurrentIdentity = Depends(get_current_identity),
    db: AsyncSession = Depends(get_db),
    kv_refresh: str | None = Cookie(default=None),
) -> Response:
    if kv_refresh:
        token_hash = hash_refresh_token(kv_refresh)
        record = await db.scalar(
            select(AuthToken).where(AuthToken.refresh_token_hash == token_hash)
        )
        if record:
            record.revoked = True
    response.delete_cookie(REFRESH_COOKIE, path=COOKIE_PATH)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
