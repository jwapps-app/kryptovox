from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

from app.config import settings

engine = create_async_engine(
    settings.database_url,
    echo=False,
    pool_pre_ping=True,  # transparently drop connections the DB closed under us
    pool_size=settings.db_pool_size,
    max_overflow=settings.db_max_overflow,
    pool_recycle=1800,  # recycle every 30 min to avoid stale server-side timeouts
    pool_timeout=30,
)

SessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """Request-scoped session; commits when the handler returns.

    Always depend on it as ``Depends(get_db, scope="function")``: since
    FastAPI 0.118 a yield-dependency's exit code runs *after the response is
    sent* by default, which made this commit land after the client already
    had its reply — a login's device row didn't exist yet when the client's
    next request arrived, so it got a 401. "function" scope runs the commit
    before the response goes out (read-your-writes preserved)."""
    async with SessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
