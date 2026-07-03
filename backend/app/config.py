from functools import lru_cache

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_DEV_ENVS = {"dev", "development", "local", "test"}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # "production" (default) enforces a strong SECRET_KEY at startup. Set
    # ENVIRONMENT=development in the dev compose to allow the placeholder key.
    environment: str = "production"

    # Core infra
    database_url: str = "postgresql+asyncpg://kryptovox:kryptovox@postgres:5432/kryptovox"
    redis_url: str = "redis://redis:6379/0"
    # Per-worker connection pool. With N gunicorn workers the ceiling is
    # N * (pool_size + max_overflow); keep it well under Postgres max_connections.
    db_pool_size: int = 5
    db_max_overflow: int = 5

    # Auth / JWT
    secret_key: str = "dev-secret-change-me"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 15
    refresh_token_expire_days: int = 90

    @model_validator(mode="after")
    def _require_strong_secret(self) -> "Settings":
        if self.environment.lower() not in _DEV_ENVS:
            weak = (
                len(self.secret_key) < 32
                or "change-me" in self.secret_key
                or "dev-secret" in self.secret_key
            )
            if weak:
                raise ValueError(
                    "SECRET_KEY must be a strong 32+ char value in production "
                    "(ENVIRONMENT is not dev). Generate one with: "
                    "python -c \"import secrets; print(secrets.token_hex(32))\""
                )
        return self

    # Default message retention (days) seeded onto NEW conversations. 0 = keep
    # forever. Changing this does not touch existing conversations.
    default_retention_days: int = 0

    # Encrypted media (image) blob store.
    media_dir: str = "media"
    max_media_bytes: int = 25 * 1024 * 1024  # 25 MB ciphertext cap

    # CORS — comma-separated list of allowed origins
    allowed_origins: str = "https://localhost:5173"

    # Native iOS push via the self-hosted push-relay (APNs). Leave URL/key blank
    # to disable APNs entirely — web push (VAPID) is unaffected either way.
    push_relay_url: str = ""  # e.g. http://192.168.1.42:8088
    push_relay_api_key: str = ""
    apns_bundle_id: str = "com.jworthington.kryptovox"

    # WebAuthn (passkeys). Passkeys are cryptographically bound to rp_id, and the
    # browser origin must match `webauthn_origin` exactly. Set these to your real
    # domain in production: WEBAUTHN_RP_ID=chat.example.com and
    # WEBAUTHN_ORIGIN=https://chat.example.com
    webauthn_rp_id: str = "localhost"
    webauthn_origin: str = "http://localhost:5173"

    # Web Push (Phase 6). If keys aren't provided they're generated once and
    # persisted to vapid_key_path so subscriptions survive restarts.
    vapid_private_key: str = ""
    vapid_public_key: str = ""
    vapid_email: str = "mailto:admin@example.com"
    vapid_key_path: str = "vapid_private.pem"

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
