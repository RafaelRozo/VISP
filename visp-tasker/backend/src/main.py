"""VISP/Tasker API -- Main Application Entry Point

Creates the FastAPI application, configures CORS middleware, registers
all API route modules under the /api/v1 prefix, and mounts the Socket.IO
ASGI application for real-time WebSocket communication.

Run with::

    uvicorn src.main:app --host 0.0.0.0 --port 8000 --reload
"""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.core.config import settings


# ---------------------------------------------------------------------------
# Lifespan: startup / shutdown hooks
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan context manager.

    Startup:
      - Import realtime handlers to register Socket.IO event listeners.

    Shutdown:
      - Close the shared Redis client used by the realtime module.
    """
    # Importing handlers is sufficient to register all Socket.IO events
    from src.realtime import handlers  # noqa: F401

    yield

    # Graceful shutdown: close Redis connections
    try:
        from src.realtime.socketServer import _redis_client

        if _redis_client is not None:
            await _redis_client.close()
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Application instance
# ---------------------------------------------------------------------------

app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    lifespan=lifespan,
)


# ---------------------------------------------------------------------------
# CORS middleware
# ---------------------------------------------------------------------------

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------

@app.get("/health", tags=["Health"])
async def health():
    """Lightweight health check for load balancers and readiness probes."""
    return {"status": "ok", "version": settings.app_version}


# ---------------------------------------------------------------------------
# Register API route modules
# ---------------------------------------------------------------------------
# Each router already defines its own prefix (e.g. /categories, /jobs) and
# tags.  We mount them under the shared /api/v1 prefix so the full paths
# become /api/v1/categories, /api/v1/jobs, etc.
# ---------------------------------------------------------------------------

from src.api.routes import (  # noqa: E402
    categories,
    consents,
    escalations,
    jobs,
    matching,
    notifications,
    payments,
    pricing,
    scoring,
    tasks,
    verification,
)

_prefix = settings.api_v1_prefix

app.include_router(categories.router, prefix=_prefix)
app.include_router(tasks.router, prefix=_prefix)
app.include_router(consents.router, prefix=_prefix)
app.include_router(verification.router, prefix=_prefix)
app.include_router(jobs.router, prefix=_prefix)
app.include_router(matching.router, prefix=_prefix)
app.include_router(scoring.router, prefix=_prefix)
app.include_router(pricing.router, prefix=_prefix)
app.include_router(escalations.router, prefix=_prefix)
app.include_router(payments.router, prefix=_prefix)
app.include_router(notifications.router, prefix=_prefix)


# ---------------------------------------------------------------------------
# Mount Socket.IO ASGI application
# ---------------------------------------------------------------------------

from src.realtime.socketServer import socket_app  # noqa: E402

app.mount("/ws", socket_app)
