from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Core infra
    database_url: str = "postgresql+asyncpg://kryptovox:kryptovox@postgres:5432/kryptovox"
    redis_url: str = "redis://redis:6379/0"

    # Auth / JWT
    secret_key: str = "dev-secret-change-me"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 15
    refresh_token_expire_days: int = 90

    # CORS — comma-separated list of allowed origins
    allowed_origins: str = "https://localhost:5173"

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
