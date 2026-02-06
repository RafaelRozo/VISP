"""
Shared FastAPI dependencies for the VISP/Tasker backend.

Provides the async database session dependency used by all route handlers.
"""

from __future__ import annotations

from collections.abc import AsyncGenerator
from typing import Annotated, Optional

from fastapi import Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from src.core.config import settings

# ---------------------------------------------------------------------------
# Async engine & session factory
# ---------------------------------------------------------------------------
# The engine is created once at module import time.  The session factory
# produces lightweight ``AsyncSession`` instances that are scoped to a single
# request via the ``get_db`` dependency below.
# ---------------------------------------------------------------------------

engine = create_async_engine(
    settings.database_url,
    echo=settings.sql_echo,
    pool_size=settings.db_pool_size,
    max_overflow=settings.db_max_overflow,
    pool_pre_ping=True,
)

async_session_factory = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """Yield an async database session that is automatically closed after the
    request completes.  All route handlers should depend on this to get their
    ``AsyncSession``.

    Usage in a route::

        @router.get("/items")
        async def list_items(db: DBSession):
            ...
    """
    async with async_session_factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


# ---------------------------------------------------------------------------
# Annotated type alias for convenience
# ---------------------------------------------------------------------------
DBSession = Annotated[AsyncSession, Depends(get_db)]


# ---------------------------------------------------------------------------
# Request metadata dependencies
# ---------------------------------------------------------------------------

def get_client_ip(request: Request) -> str | None:
    """Extract the client IP address from the request.

    Checks the ``X-Forwarded-For`` header first (set by reverse proxies /
    load balancers), then falls back to the direct client host.
    """
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        # X-Forwarded-For can contain a chain: "client, proxy1, proxy2"
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else None


def get_user_agent(request: Request) -> str | None:
    """Extract the User-Agent header from the request."""
    return request.headers.get("User-Agent")


ClientIP = Annotated[Optional[str], Depends(get_client_ip)]
UserAgent = Annotated[Optional[str], Depends(get_user_agent)]
