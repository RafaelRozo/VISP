"""
Location Tracking Handler -- VISP-INT-REALTIME-004
===================================================

WebSocket handler for real-time provider location updates on the
``/location`` namespace. Tracks provider GPS coordinates during active
jobs (provider_en_route and in_progress statuses) and relays position
updates to the customer.

Architecture:
  - Provider pushes ``location:update`` events with GPS data
  - Updates are throttled to max 1 per 3 seconds per provider
  - Provider positions are stored in Redis using GEOADD for geo queries
  - Location history is appended to a Redis list for job audit trail
  - ETA is recalculated on each update using haversine distance
  - Customers in the job room receive ``location:provider_moved`` events

Redis keys:
  - ``visp:geo:active_providers``         GEOADD sorted set of active providers
  - ``visp:loc:throttle:{provider_id}``   Throttle flag (TTL 3s)
  - ``visp:loc:tracking:{job_id}``        Hash: provider_id, started_at
  - ``visp:loc:history:{job_id}``         List of location snapshots (audit)
"""

from __future__ import annotations

import json
import logging
import time
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from src.services.geoService import haversine_distance

from ..locationTracker import (
    update_provider_location as tracker_update_location,
)
from ..socketServer import (
    broadcast_to_job,
    get_redis,
    get_sid_meta,
    sio,
)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Minimum interval between location updates per provider (seconds)
THROTTLE_INTERVAL_SECONDS: int = 3

# Redis key prefixes
_GEO_KEY: str = "visp:geo:active_providers"
_THROTTLE_PREFIX: str = "visp:loc:throttle:"
_TRACKING_PREFIX: str = "visp:loc:tracking:"
_HISTORY_PREFIX: str = "visp:loc:history:"

# Maximum number of history entries per job (prevents unbounded growth)
_MAX_HISTORY_ENTRIES: int = 5000

# Average driving speed for ETA estimation (km/h) when no route API is
# available.  In production this should call the Maps integration.
_AVG_SPEED_KMH: float = 30.0


# ---------------------------------------------------------------------------
# Tracking session management
# ---------------------------------------------------------------------------

async def start_tracking(job_id: str, provider_id: str) -> None:
    """Begin a location tracking session for a job.

    Called when a provider marks themselves as en route.  Records the
    provider and start time in a Redis hash so the location handler
    knows which job to associate incoming updates with.

    Args:
        job_id: The job UUID string.
        provider_id: The provider's user_id UUID string.
    """
    redis = await get_redis()
    key = f"{_TRACKING_PREFIX}{job_id}"
    await redis.hset(
        key,
        mapping={
            "provider_id": provider_id,
            "started_at": datetime.now(timezone.utc).isoformat(),
        },
    )
    logger.info("Tracking started: job=%s provider=%s", job_id, provider_id)


async def stop_tracking(job_id: str) -> None:
    """End a location tracking session for a job.

    Called when a job is completed, cancelled, or the provider finishes
    work.  Cleans up the tracking hash and removes the provider from
    the geo sorted set.

    Args:
        job_id: The job UUID string.
    """
    redis = await get_redis()
    key = f"{_TRACKING_PREFIX}{job_id}"

    # Retrieve provider_id before deleting the tracking key
    provider_id = await redis.hget(key, "provider_id")

    # Remove tracking session
    await redis.delete(key)

    # Remove from geo set
    if provider_id:
        await redis.zrem(_GEO_KEY, provider_id)
        # Clean up throttle key
        await redis.delete(f"{_THROTTLE_PREFIX}{provider_id}")

    logger.info("Tracking stopped: job=%s provider=%s", job_id, provider_id)


async def get_tracking_info(job_id: str) -> dict[str, str] | None:
    """Return the tracking session info for a job, or None if not tracking."""
    redis = await get_redis()
    key = f"{_TRACKING_PREFIX}{job_id}"
    data = await redis.hgetall(key)
    return data if data else None


async def is_provider_tracking(provider_id: str) -> str | None:
    """Check if a provider is actively tracking for any job.

    Scans tracking keys to find the job.  In production, maintain a
    reverse index ``visp:loc:provider_job:{provider_id}`` for O(1) lookup.

    Returns the job_id or None.
    """
    redis = await get_redis()
    # Scan for tracking keys -- acceptable for moderate scale
    async for key in redis.scan_iter(match=f"{_TRACKING_PREFIX}*", count=100):
        tracked_provider = await redis.hget(key, "provider_id")
        if tracked_provider == provider_id:
            # Extract job_id from key
            return key.replace(_TRACKING_PREFIX, "")
    return None


# ---------------------------------------------------------------------------
# Throttling
# ---------------------------------------------------------------------------

async def _is_throttled(provider_id: str) -> bool:
    """Check whether a provider's location update should be throttled.

    Returns True if the provider sent an update within the last
    THROTTLE_INTERVAL_SECONDS.
    """
    redis = await get_redis()
    key = f"{_THROTTLE_PREFIX}{provider_id}"
    exists = await redis.exists(key)
    return bool(exists)


async def _set_throttle(provider_id: str) -> None:
    """Set the throttle flag for a provider with a TTL."""
    redis = await get_redis()
    key = f"{_THROTTLE_PREFIX}{provider_id}"
    await redis.set(key, "1", ex=THROTTLE_INTERVAL_SECONDS)


# ---------------------------------------------------------------------------
# ETA calculation
# ---------------------------------------------------------------------------

def _estimate_eta_minutes(
    provider_lat: float,
    provider_lng: float,
    destination_lat: float,
    destination_lng: float,
    speed_kmh: float = _AVG_SPEED_KMH,
) -> int:
    """Estimate travel time in minutes using straight-line distance.

    In production this should call Google Maps Directions API / Mapbox
    for route-based ETA.  The haversine approximation with a fixed
    average speed is a reasonable fallback.

    Args:
        provider_lat: Provider's current latitude.
        provider_lng: Provider's current longitude.
        destination_lat: Job location latitude.
        destination_lng: Job location longitude.
        speed_kmh: Average travel speed in km/h.

    Returns:
        Estimated minutes to arrival (minimum 1).
    """
    distance_km = haversine_distance(
        provider_lat, provider_lng,
        destination_lat, destination_lng,
    )
    if speed_kmh <= 0:
        return 1
    eta_hours = distance_km / speed_kmh
    eta_minutes = int(eta_hours * 60)
    return max(1, eta_minutes)


# ---------------------------------------------------------------------------
# Location history (audit trail)
# ---------------------------------------------------------------------------

async def _append_history(job_id: str, entry: dict[str, Any]) -> None:
    """Append a location snapshot to the job's history list in Redis."""
    redis = await get_redis()
    key = f"{_HISTORY_PREFIX}{job_id}"
    await redis.rpush(key, json.dumps(entry))
    # Trim to prevent unbounded growth
    await redis.ltrim(key, -_MAX_HISTORY_ENTRIES, -1)


async def get_location_history(job_id: str) -> list[dict[str, Any]]:
    """Retrieve the full location history for a job (for audit/disputes).

    Returns:
        List of location snapshot dicts in chronological order.
    """
    redis = await get_redis()
    key = f"{_HISTORY_PREFIX}{job_id}"
    raw_entries = await redis.lrange(key, 0, -1)
    return [json.loads(entry) for entry in raw_entries]


# ---------------------------------------------------------------------------
# Inbound event handler
# ---------------------------------------------------------------------------

@sio.on("location:update", namespace="/location")
async def handle_location_update(sid: str, data: dict[str, Any]) -> dict[str, Any]:
    """Process a location update from a provider.

    Payload: {
        "lat": <float>,
        "lng": <float>,
        "heading": <float | null>,
        "speed": <float | null>,       # m/s
        "accuracy": <float | null>,     # meters
        "timestamp": "<iso string>"     # client-side timestamp
    }

    Validation:
      - Caller must be an authenticated provider
      - Provider must have an active tracking session
      - Update is throttled to max 1 per 3 seconds

    On success:
      - Provider position stored in Redis geo set
      - Location snapshot appended to history
      - ``location:provider_moved`` emitted to the job room
    """
    meta = get_sid_meta(sid)
    if not meta:
        return {"ok": False, "error": "Not authenticated"}

    provider_id: str = meta.get("user_id", "")
    role: str = meta.get("role", "")

    if role != "provider":
        return {"ok": False, "error": "Only providers can send location updates"}

    # Validate required fields
    lat = data.get("lat")
    lng = data.get("lng")
    if lat is None or lng is None:
        return {"ok": False, "error": "lat and lng are required"}

    try:
        lat = float(lat)
        lng = float(lng)
    except (ValueError, TypeError):
        return {"ok": False, "error": "lat and lng must be valid numbers"}

    # Basic coordinate sanity check
    if not (-90 <= lat <= 90) or not (-180 <= lng <= 180):
        return {"ok": False, "error": "Invalid coordinates"}

    # Check throttle
    if await _is_throttled(provider_id):
        return {"ok": False, "error": "Rate limited", "retry_after_seconds": THROTTLE_INTERVAL_SECONDS}

    # Find the active tracking session for this provider
    job_id = await is_provider_tracking(provider_id)
    if job_id is None:
        return {"ok": False, "error": "No active tracking session"}

    # Set throttle
    await _set_throttle(provider_id)

    heading = data.get("heading")
    speed = data.get("speed")
    accuracy = data.get("accuracy")
    client_timestamp = data.get("timestamp", datetime.now(timezone.utc).isoformat())

    # Store in Redis geo set (handler-level for WebSocket ETA)
    redis = await get_redis()
    await redis.geoadd(_GEO_KEY, (lng, lat, provider_id))

    # Delegate to locationTracker for durable persistence (geo set,
    # detail hash, tracking session buffer, PostgreSQL batch flush)
    try:
        await tracker_update_location(
            provider_id=UUID(provider_id),
            lat=lat,
            lng=lng,
            heading=float(heading) if heading is not None else 0.0,
            speed=float(speed) if speed is not None else 0.0,
        )
    except Exception:
        logger.warning(
            "locationTracker.update_provider_location failed for provider=%s; "
            "continuing with handler-level tracking",
            provider_id,
            exc_info=True,
        )

    # Calculate ETA -- we need the job's destination coordinates
    # Load from a lightweight Redis cache or fetch from DB
    eta_minutes: int | None = None
    tracking_info = await get_tracking_info(job_id)
    if tracking_info:
        # Attempt to get job destination from Redis cache
        dest_key = f"visp:job:destination:{job_id}"
        dest_data = await redis.hgetall(dest_key)
        if dest_data and "lat" in dest_data and "lng" in dest_data:
            dest_lat = float(dest_data["lat"])
            dest_lng = float(dest_data["lng"])
            eta_minutes = _estimate_eta_minutes(lat, lng, dest_lat, dest_lng)
        else:
            # Fallback: load destination from DB and cache it
            eta_minutes = await _load_and_cache_destination_eta(
                job_id, lat, lng, redis,
            )

    # Build the history snapshot
    snapshot = {
        "provider_id": provider_id,
        "lat": lat,
        "lng": lng,
        "heading": heading,
        "speed": speed,
        "accuracy": accuracy,
        "eta_minutes": eta_minutes,
        "client_timestamp": client_timestamp,
        "server_timestamp": datetime.now(timezone.utc).isoformat(),
    }

    # Append to audit history
    await _append_history(job_id, snapshot)

    # Broadcast to the job room on /location namespace
    await broadcast_to_job(
        job_id,
        "location:provider_moved",
        {
            "lat": lat,
            "lng": lng,
            "heading": heading,
            "speed": speed,
            "eta_minutes": eta_minutes,
            "timestamp": snapshot["server_timestamp"],
        },
        namespace="/location",
        skip_sid=sid,  # Provider does not need their own update echoed back
    )

    return {"ok": True, "eta_minutes": eta_minutes}


# ---------------------------------------------------------------------------
# Internal helper: load job destination and cache in Redis
# ---------------------------------------------------------------------------

async def _load_and_cache_destination_eta(
    job_id: str,
    provider_lat: float,
    provider_lng: float,
    redis: Any,
) -> int | None:
    """Load the job's service location from the database, cache it in Redis,
    and compute ETA.

    This is called once per tracking session when the destination is not
    yet cached.
    """
    import uuid as _uuid

    from sqlalchemy import select as sa_select

    from src.api.deps import async_session_factory
    from src.models.job import Job

    try:
        async with async_session_factory() as db:
            stmt = sa_select(
                Job.service_latitude,
                Job.service_longitude,
            ).where(Job.id == _uuid.UUID(job_id))
            result = await db.execute(stmt)
            row = result.one_or_none()

            if row is None:
                return None

            dest_lat = float(row.service_latitude)
            dest_lng = float(row.service_longitude)

            # Cache for the duration of this job's tracking
            dest_key = f"visp:job:destination:{job_id}"
            await redis.hset(
                dest_key,
                mapping={"lat": str(dest_lat), "lng": str(dest_lng)},
            )
            # TTL of 24 hours -- cleaned up by stop_tracking
            await redis.expire(dest_key, 86400)

            return _estimate_eta_minutes(provider_lat, provider_lng, dest_lat, dest_lng)

    except Exception:
        logger.exception("Failed to load job destination for job=%s", job_id)
        return None
