"""VISP API -- Main Application Entry Point

Creates the FastAPI application, configures CORS middleware, registers
all API route modules under the /api/v1 prefix, and mounts the Socket.IO
ASGI application for real-time WebSocket communication.

Run with::

    uvicorn src.main:app --host 0.0.0.0 --port 8000 --reload
"""

from __future__ import annotations

from contextlib import asynccontextmanager

from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

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
# Apple App Site Association (AASA) -- enables iOS Password AutoFill
# ---------------------------------------------------------------------------
# Served at the well-known path with Content-Type: application/json and NO
# redirects, per Apple requirements. Associates iCloud Keychain credentials
# for api.richieyanez.com with the iOS app (Team ID + bundle id).

_AASA = {
    "webcredentials": {
        "apps": ["X3332DJG89.com.droz.vispapp"],
    },
}


@app.get("/.well-known/apple-app-site-association", include_in_schema=False)
async def apple_app_site_association():
    """Return the AASA file for iOS webcredentials (Password AutoFill)."""
    from fastapi.responses import JSONResponse

    return JSONResponse(content=_AASA, media_type="application/json")


# ---------------------------------------------------------------------------
# Register API route modules
# ---------------------------------------------------------------------------
# Each router already defines its own prefix (e.g. /categories, /jobs) and
# tags.  We mount them under the shared /api/v1 prefix so the full paths
# become /api/v1/categories, /api/v1/jobs, etc.
# ---------------------------------------------------------------------------

from src.api.routes import (  # noqa: E402
    admin,
    auth,
    categories,
    chat,
    consents,
    escalations,
    geolocation,
    jobs,
    matching,
    notifications,
    payments,
    pricing,
    proposals,
    providers,
    scoring,
    stripe_redirect,
    tasks,
    tips,
    users,
    verification,
)

_prefix = settings.api_v1_prefix

app.include_router(auth.router, prefix=_prefix)
app.include_router(categories.router, prefix=_prefix)
app.include_router(tasks.router, prefix=_prefix)
app.include_router(consents.router, prefix=_prefix)
app.include_router(verification.router, prefix=_prefix)
app.include_router(jobs.router, prefix=_prefix)
app.include_router(providers.router, prefix=_prefix)
app.include_router(matching.router, prefix=_prefix)
app.include_router(scoring.router, prefix=_prefix)
app.include_router(pricing.router, prefix=_prefix)
app.include_router(escalations.router, prefix=_prefix)
app.include_router(payments.router, prefix=_prefix)
app.include_router(proposals.router, prefix=_prefix)
app.include_router(tips.router, prefix=_prefix)
app.include_router(chat.router, prefix=_prefix)
app.include_router(notifications.router, prefix=_prefix)
app.include_router(geolocation.router, prefix=_prefix)
app.include_router(users.router, prefix=_prefix)
app.include_router(admin.router, prefix=_prefix)

# Public HTML redirect pages (no /api/v1 prefix — Stripe redirects users here)
app.include_router(stripe_redirect.router)


# ---------------------------------------------------------------------------
# Mount static uploads directory (avatars, etc.)
# ---------------------------------------------------------------------------
# Served at /uploads/<path>. Files are written by upload endpoints under
# backend/uploads/. The directory is created on demand.
# ---------------------------------------------------------------------------

_uploads_dir = Path(__file__).resolve().parent.parent / "uploads"
_uploads_dir.mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=str(_uploads_dir)), name="uploads")


# ---------------------------------------------------------------------------
# Mount Socket.IO ASGI application
# ---------------------------------------------------------------------------

from src.realtime.socketServer import socket_app  # noqa: E402

app.mount("/ws", socket_app)
