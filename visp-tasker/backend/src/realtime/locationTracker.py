"""
Real-time location tracking service -- VISP-INT-REALTIME-004
==============================================================

Manages provider location updates during active jobs using Redis for
low-latency reads (GEOADD / GEOSEARCH) and PostgreSQL for durable
audit history.

Architecture:
  - **Redis geo set** (``visp:provider_locations``): stores the latest
    position of every online provider for spatial queries.
  - **Redis hash** (``visp:provider_loc_detail:{provider_id}``): stores
    heading, speed, and timestamp alongside the geo set entry.
  - **Redis sorted set** (``visp:tracking:{session_id}``): time-ordered
    location breadcrumbs for a tracking session, scored by Unix
    timestamp.
  - **PostgreSQL** ``location_history`` table: durable audit log written
    in batches every ``_FLUSH_INTERVAL_SECONDS`` to reduce DB write
    pressure.

Concurrency model: all functions are async and designed for use within
a single asyncio event loop.  The batch flusher is an ``asyncio.Task``
that runs for the lifetime of each tracking session.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Final
from uuid import UUID

import redis.asyncio as aioredis
from sqlalchemy import Column, DateTime, Float, ForeignKey, String, Text, func, text
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import settings
from src.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_REDIS_GEO_KEY: Final[str] = "visp:provider_locations"
_REDIS_DETAIL_PREFIX: Final[str] = "visp:provider_loc_detail"
_REDIS_TRACKING_PREFIX: Final[str] = "visp:tracking"
_REDIS_SESSION_META_PREFIX: Final[str] = "visp:tracking_meta"

# Provider location entries in Redis expire after 10 minutes of no update,
# so stale entries are automatically cleaned.
_LOCATION_TTL_SECONDS: Final[int] = 600

# Batch flush interval: location history rows are buffered and flushed to
# PostgreSQL every N seconds.
_FLUSH_INTERVAL_SECONDS: Final[float] = 5.0

# Maximum number of points to buffer before forcing an early flush.
_FLUSH_BUFFER_MAX: Final[int] = 100

# Tracking session entries expire from Redis after 24 hours.
_SESSION_TTL_SECONDS: Final[int] = 86400


# ---------------------------------------------------------------------------
# SQLAlchemy model for durable location history
# ---------------------------------------------------------------------------


class LocationHistory(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Durable audit log of provider location updates during a tracking
    session.  Written in batches from the in-memory buffer."""

    __tablename__ = "location_history"

    session_id: str = Column(String(36), nullable=False, index=True)
    provider_id = Column(
        PG_UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    job_id = Column(
        PG_UUID(as_uuid=True),
        ForeignKey("jobs.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    latitude = Column(Float, nullable=False)
    longitude = Column(Float, nullable=False)
    heading = Column(Float, nullable=True)
    speed = Column(Float, nullable=True)
    recorded_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    def __repr__(self) -> str:
        return (
            f"<LocationHistory(session={self.session_id}, "
            f"provider={self.provider_id}, lat={self.latitude}, "
            f"lng={self.longitude})>"
        )


# ---------------------------------------------------------------------------
# Data transfer objects
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ProviderLocation:
    """Current location snapshot for a provider."""

    provider_id: UUID
    lat: float
    lng: float
    heading: float
    speed: float
    updated_at: datetime


@dataclass(frozen=True)
class LocationPoint:
    """A single point in a tracking history trail."""

    lat: float
    lng: float
    timestamp: datetime
    heading: float
    speed: float


# ---------------------------------------------------------------------------
# Internal state for active tracking sessions
# ---------------------------------------------------------------------------


@dataclass
class _TrackingSession:
    """In-memory state for an active tracking session."""

    session_id: str
    job_id: UUID
    provider_id: UUID
    buffer: list[dict[str, Any]] = field(default_factory=list)
    flush_task: asyncio.Task[None] | None = None
    stopped: bool = False


_active_sessions: dict[str, _TrackingSession] = {}


# ---------------------------------------------------------------------------
# Redis connection
# ---------------------------------------------------------------------------


_redis_pool: aioredis.Redis | None = None


async def _get_redis() -> aioredis.Redis:
    """Lazily initialize and return the shared Redis connection pool."""
    global _redis_pool
    if _redis_pool is None:
        _redis_pool = aioredis.from_url(
            settings.redis_url,
            decode_responses=True,
        )
    return _redis_pool


async def close_redis() -> None:
    """Gracefully close the Redis connection pool.  Call on app shutdown."""
    global _redis_pool
    if _redis_pool is not None:
        await _redis_pool.close()
        _redis_pool = None
        logger.info("Redis connection pool closed")


# ---------------------------------------------------------------------------
# Provider location updates (real-time)
# ---------------------------------------------------------------------------


async def update_provider_location(
    provider_id: UUID,
    lat: float,
    lng: float,
    heading: float = 0.0,
    speed: float = 0.0,
) -> None:
    """Update a provider's real-time location in Redis.

    This writes to both the Redis geo set (for spatial queries) and a
    detail hash (for heading/speed metadata).  Each entry has a TTL so
    stale locations are automatically evicted.

    If the provider has an active tracking session, the point is also
    appended to the session buffer for eventual PostgreSQL persistence.

    Args:
        provider_id: The provider's user UUID.
        lat: Current latitude.
        lng: Current longitude.
        heading: Compass heading in degrees (0-360).  Defaults to 0.
        speed: Speed in km/h.  Defaults to 0.
    """
    redis = await _get_redis()
    provider_key = str(provider_id)
    now = datetime.now(tz=timezone.utc)
    now_ts = now.timestamp()

    pipe = redis.pipeline(transaction=False)

    # Geo set: GEOADD key longitude latitude member
    pipe.geoadd(_REDIS_GEO_KEY, (lng, lat, provider_key))

    # Detail hash
    detail_key = f"{_REDIS_DETAIL_PREFIX}:{provider_key}"
    pipe.hset(
        detail_key,
        mapping={
            "lat": str(lat),
            "lng": str(lng),
            "heading": str(heading),
            "speed": str(speed),
            "updated_at": now.isoformat(),
        },
    )
    pipe.expire(detail_key, _LOCATION_TTL_SECONDS)

    await pipe.execute()

    logger.debug(
        "Updated location for provider %s: (%.6f, %.6f) heading=%.1f speed=%.1f",
        provider_key,
        lat,
        lng,
        heading,
        speed,
    )

    # Append to any active tracking session for this provider
    for session in _active_sessions.values():
        if session.provider_id == provider_id and not session.stopped:
            point_data = {
                "lat": lat,
                "lng": lng,
                "heading": heading,
                "speed": speed,
                "timestamp": now.isoformat(),
                "timestamp_unix": now_ts,
            }
            session.buffer.append(point_data)

            # Also store in Redis sorted set for retrieval
            await redis.zadd(
                f"{_REDIS_TRACKING_PREFIX}:{session.session_id}",
                {json.dumps(point_data): now_ts},
            )

            # Force flush if buffer is large
            if len(session.buffer) >= _FLUSH_BUFFER_MAX:
                await _flush_session_buffer(session)

            break  # provider can only have one active session


async def get_provider_location(provider_id: UUID) -> ProviderLocation | None:
    """Retrieve a provider's most recent location from Redis.

    Args:
        provider_id: The provider's user UUID.

    Returns:
        ProviderLocation if available, or None if no location data exists
        (provider offline or TTL expired).
    """
    redis = await _get_redis()
    detail_key = f"{_REDIS_DETAIL_PREFIX}:{str(provider_id)}"

    data = await redis.hgetall(detail_key)
    if not data:
        return None

    try:
        return ProviderLocation(
            provider_id=provider_id,
            lat=float(data["lat"]),
            lng=float(data["lng"]),
            heading=float(data.get("heading", "0")),
            speed=float(data.get("speed", "0")),
            updated_at=datetime.fromisoformat(data["updated_at"]),
        )
    except (KeyError, ValueError) as exc:
        logger.warning(
            "Malformed location data for provider %s: %s",
            provider_id,
            exc,
        )
        return None


async def get_nearby_providers(
    lat: float,
    lng: float,
    radius_km: float,
) -> list[ProviderLocation]:
    """Find providers within a radius of a point using Redis GEOSEARCH.

    Args:
        lat: Center latitude.
        lng: Center longitude.
        radius_km: Search radius in kilometres.

    Returns:
        List of ProviderLocation objects sorted by distance (closest first).
    """
    redis = await _get_redis()

    # GEOSEARCH returns members within the radius, ordered by distance
    members = await redis.geosearch(
        _REDIS_GEO_KEY,
        longitude=lng,
        latitude=lat,
        radius=radius_km,
        unit="km",
        sort="ASC",
    )

    if not members:
        return []

    results: list[ProviderLocation] = []
    for member_id in members:
        detail_key = f"{_REDIS_DETAIL_PREFIX}:{member_id}"
        data = await redis.hgetall(detail_key)
        if not data:
            continue

        try:
            results.append(
                ProviderLocation(
                    provider_id=UUID(member_id),
                    lat=float(data["lat"]),
                    lng=float(data["lng"]),
                    heading=float(data.get("heading", "0")),
                    speed=float(data.get("speed", "0")),
                    updated_at=datetime.fromisoformat(data["updated_at"]),
                )
            )
        except (KeyError, ValueError) as exc:
            logger.warning(
                "Skipping malformed location data for provider %s: %s",
                member_id,
                exc,
            )
            continue

    return results


# ---------------------------------------------------------------------------
# Tracking sessions
# ---------------------------------------------------------------------------


async def start_tracking_session(
    job_id: UUID,
    provider_id: UUID,
    db: AsyncSession | None = None,
) -> str:
    """Start a location tracking session for a job.

    Creates in-memory state and a background flush task that periodically
    writes buffered location points to PostgreSQL.

    Args:
        job_id: The job being tracked.
        provider_id: The provider whose location is being tracked.
        db: Optional async DB session.  If provided, location history
            rows will be flushed to this session.  If not provided,
            points are only stored in Redis.

    Returns:
        A unique session_id string (UUID4).
    """
    session_id = str(uuid.uuid4())

    session = _TrackingSession(
        session_id=session_id,
        job_id=job_id,
        provider_id=provider_id,
    )
    _active_sessions[session_id] = session

    # Store session metadata in Redis for cross-process visibility
    redis = await _get_redis()
    meta_key = f"{_REDIS_SESSION_META_PREFIX}:{session_id}"
    await redis.hset(
        meta_key,
        mapping={
            "job_id": str(job_id),
            "provider_id": str(provider_id),
            "started_at": datetime.now(tz=timezone.utc).isoformat(),
        },
    )
    await redis.expire(meta_key, _SESSION_TTL_SECONDS)

    # Start background flush task
    session.flush_task = asyncio.create_task(
        _periodic_flush_loop(session, db),
        name=f"location-flush-{session_id}",
    )

    logger.info(
        "Started tracking session %s for job %s / provider %s",
        session_id,
        job_id,
        provider_id,
    )
    return session_id


async def stop_tracking_session(session_id: str) -> None:
    """Stop a tracking session and flush any remaining buffered points.

    Args:
        session_id: The session ID returned by ``start_tracking_session``.

    Raises:
        ValueError: If the session ID is not found.
    """
    session = _active_sessions.get(session_id)
    if session is None:
        raise ValueError(f"Tracking session '{session_id}' not found")

    session.stopped = True

    # Cancel the periodic flush task
    if session.flush_task is not None and not session.flush_task.done():
        session.flush_task.cancel()
        try:
            await session.flush_task
        except asyncio.CancelledError:
            pass

    # Final flush of any remaining buffer
    if session.buffer:
        await _flush_session_buffer(session)

    # Set TTL on the Redis tracking data so it eventually expires
    redis = await _get_redis()
    tracking_key = f"{_REDIS_TRACKING_PREFIX}:{session_id}"
    await redis.expire(tracking_key, _SESSION_TTL_SECONDS)

    # Remove from active sessions
    del _active_sessions[session_id]

    logger.info("Stopped tracking session %s", session_id)


async def get_tracking_history(session_id: str) -> list[LocationPoint]:
    """Retrieve the full location trail for a tracking session.

    Reads from the Redis sorted set, which contains all points recorded
    during the session (both buffered and flushed).

    Args:
        session_id: The tracking session ID.

    Returns:
        List of LocationPoint objects ordered chronologically.
    """
    redis = await _get_redis()
    tracking_key = f"{_REDIS_TRACKING_PREFIX}:{session_id}"

    # ZRANGEBYSCORE returns members ordered by score (timestamp)
    raw_entries = await redis.zrangebyscore(
        tracking_key,
        min="-inf",
        max="+inf",
    )

    points: list[LocationPoint] = []
    for entry in raw_entries:
        try:
            data = json.loads(entry)
            points.append(
                LocationPoint(
                    lat=float(data["lat"]),
                    lng=float(data["lng"]),
                    timestamp=datetime.fromisoformat(data["timestamp"]),
                    heading=float(data.get("heading", 0)),
                    speed=float(data.get("speed", 0)),
                )
            )
        except (json.JSONDecodeError, KeyError, ValueError) as exc:
            logger.warning(
                "Skipping malformed tracking entry in session %s: %s",
                session_id,
                exc,
            )
            continue

    return points


# ---------------------------------------------------------------------------
# Background flush logic
# ---------------------------------------------------------------------------


async def _periodic_flush_loop(
    session: _TrackingSession,
    db: AsyncSession | None,
) -> None:
    """Background coroutine that periodically flushes the session buffer
    to PostgreSQL."""
    try:
        while not session.stopped:
            await asyncio.sleep(_FLUSH_INTERVAL_SECONDS)
            if session.buffer:
                await _flush_session_buffer(session, db)
    except asyncio.CancelledError:
        # Expected when the session is stopped
        pass
    except Exception as exc:
        logger.error(
            "Flush loop for session %s failed: %s",
            session.session_id,
            exc,
            exc_info=True,
        )


async def _flush_session_buffer(
    session: _TrackingSession,
    db: AsyncSession | None = None,
) -> None:
    """Flush all buffered points to PostgreSQL in a single batch insert.

    If no DB session is available (e.g. during tests or when the DB is
    down), the buffer is still cleared to prevent unbounded growth. The
    points remain in the Redis sorted set regardless.
    """
    if not session.buffer:
        return

    # Drain the buffer atomically
    points = session.buffer[:]
    session.buffer.clear()

    if db is None:
        logger.debug(
            "No DB session for session %s; discarded %d buffered points "
            "(they remain in Redis)",
            session.session_id,
            len(points),
        )
        return

    try:
        rows = [
            LocationHistory(
                session_id=session.session_id,
                provider_id=session.provider_id,
                job_id=session.job_id,
                latitude=p["lat"],
                longitude=p["lng"],
                heading=p.get("heading"),
                speed=p.get("speed"),
                recorded_at=datetime.fromisoformat(p["timestamp"]),
            )
            for p in points
        ]
        db.add_all(rows)
        await db.flush()

        logger.debug(
            "Flushed %d location points for session %s to PostgreSQL",
            len(rows),
            session.session_id,
        )
    except Exception as exc:
        logger.error(
            "Failed to flush %d location points for session %s: %s",
            len(points),
            session.session_id,
            exc,
            exc_info=True,
        )
        # Re-add points to buffer so they are not lost
        session.buffer = points + session.buffer


# ---------------------------------------------------------------------------
# Cleanup helper (for app shutdown)
# ---------------------------------------------------------------------------


async def stop_all_tracking_sessions() -> None:
    """Stop all active tracking sessions.  Call on application shutdown."""
    session_ids = list(_active_sessions.keys())
    for sid in session_ids:
        try:
            await stop_tracking_session(sid)
        except Exception as exc:
            logger.warning(
                "Error stopping tracking session %s during shutdown: %s",
                sid,
                exc,
            )
    logger.info("All %d tracking sessions stopped", len(session_ids))
