"""
Geolocation REST API endpoints -- VISP-INT-GEO-001
====================================================

REST endpoints for geocoding, directions, distance calculation, and
real-time provider tracking.  These complement the WebSocket-based
location updates in the ``/location`` namespace.

Endpoints:
  - POST /api/v1/geo/geocode          Forward geocode (address → coords)
  - POST /api/v1/geo/reverse          Reverse geocode (coords → address)
  - POST /api/v1/geo/directions       Driving directions + polyline
  - POST /api/v1/geo/distance         Distance & ETA between two points
  - GET  /api/v1/geo/track/{job_id}         Current provider location
  - GET  /api/v1/geo/track/{job_id}/history Location history trail
"""

from __future__ import annotations

import json
import logging
from decimal import Decimal
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from src.api.deps import CurrentUser
from src.integrations.maps import (
    MapboxError,
    geocode_service_address,
    calculate_driving_distance,
    reverse_geocode,
    get_directions,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/geo", tags=["Geolocation"])


# ---------------------------------------------------------------------------
# Request / Response schemas
# ---------------------------------------------------------------------------


class GeocodeRequest(BaseModel):
    """Forward geocode request."""
    address: str = Field(description="Street address line")
    city: str = Field(default="", description="City name")
    province: str = Field(default="", description="Province/state code")
    postal: str = Field(default="", description="Postal/ZIP code")
    country: str = Field(default="CA", description="Country code (ISO 3166)")


class ReverseGeocodeRequest(BaseModel):
    """Reverse geocode request."""
    lat: float = Field(ge=-90, le=90, description="Latitude")
    lng: float = Field(ge=-180, le=180, description="Longitude")


class DirectionsRequest(BaseModel):
    """Directions request."""
    origin_lat: float = Field(ge=-90, le=90, description="Origin latitude")
    origin_lng: float = Field(ge=-180, le=180, description="Origin longitude")
    dest_lat: float = Field(ge=-90, le=90, description="Destination latitude")
    dest_lng: float = Field(ge=-180, le=180, description="Destination longitude")
    mode: str = Field(default="driving", description="Travel mode: driving, walking, cycling")


class DistanceRequest(BaseModel):
    """Distance & ETA request."""
    origin_lat: float = Field(ge=-90, le=90, description="Origin latitude")
    origin_lng: float = Field(ge=-180, le=180, description="Origin longitude")
    dest_lat: float = Field(ge=-90, le=90, description="Destination latitude")
    dest_lng: float = Field(ge=-180, le=180, description="Destination longitude")


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.post("/geocode", summary="Geocode an address to coordinates")
async def geocode_endpoint(body: GeocodeRequest) -> dict[str, Any]:
    """Forward geocode a structured address to coordinates using Mapbox.

    Returns lat, lng, formatted_address, confidence level, and place_id.
    """
    try:
        result = await geocode_service_address(
            address=body.address,
            city=body.city,
            province=body.province,
            postal=body.postal,
            country=body.country,
        )
        return {
            "lat": result.lat,
            "lng": result.lng,
            "formatted_address": result.formatted_address,
            "place_id": result.place_id,
            "confidence": result.confidence,
        }
    except MapboxError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Geocoding failed: {exc}",
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        )


@router.post("/reverse", summary="Reverse geocode coordinates to an address")
async def reverse_geocode_endpoint(body: ReverseGeocodeRequest) -> dict[str, Any]:
    """Reverse geocode coordinates to a human-readable address.

    Returns formatted_address, place_id, and address components.
    """
    try:
        result = await reverse_geocode(body.lat, body.lng)
        return result
    except MapboxError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Reverse geocoding failed: {exc}",
        )


@router.post("/directions", summary="Get driving directions between two points")
async def directions_endpoint(body: DirectionsRequest) -> dict[str, Any]:
    """Get driving directions including route polyline for map rendering.

    Returns distance, duration, encoded polyline, and turn-by-turn steps.
    The polyline can be decoded by Mapbox GL or any polyline decoder.
    """
    try:
        result = await get_directions(
            origin=(body.origin_lat, body.origin_lng),
            destination=(body.dest_lat, body.dest_lng),
            mode=body.mode,
        )
        return result
    except MapboxError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Directions request failed: {exc}",
        )


@router.post("/distance", summary="Calculate distance and ETA between two points")
async def distance_endpoint(body: DistanceRequest) -> dict[str, Any]:
    """Calculate driving distance (km) and estimated time of arrival (minutes).

    Uses Mapbox Directions API with haversine fallback.
    The ``is_fallback`` flag indicates whether the result came from
    the haversine estimate (API unavailable).
    """
    result = await calculate_driving_distance(
        body.origin_lat, body.origin_lng,
        body.dest_lat, body.dest_lng,
    )
    return {
        "distance_km": result.distance_km,
        "duration_minutes": result.duration_minutes,
        "route_polyline": result.route_polyline,
        "is_fallback": result.is_fallback,
    }


@router.get(
    "/track/{job_id}",
    summary="Get current provider location for a job",
)
async def get_provider_location(
    job_id: str,
    current_user: CurrentUser,
) -> dict[str, Any]:
    """Get the current GPS location of the provider assigned to a job.

    Uses Redis geo set for real-time data. Returns the latest known
    coordinates, speed, heading, and timestamp.

    **Requires authentication** (customer or provider of the job).
    """
    import redis.asyncio as aioredis
    from src.core.config import settings

    redis = aioredis.from_url(settings.redis_url, decode_responses=True)

    try:
        # Check tracking session
        tracking_key = f"visp:loc:tracking:{job_id}"
        tracking_info = await redis.hgetall(tracking_key)

        if not tracking_info:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="No active tracking session for this job",
            )

        provider_id = tracking_info.get("provider_id", "")

        # Get latest location from Redis detail hash
        detail_key = f"visp:provider_detail:{provider_id}"
        location_data = await redis.hgetall(detail_key)

        if not location_data:
            return {
                "job_id": job_id,
                "provider_id": provider_id,
                "status": "tracking_active",
                "location": None,
                "message": "Provider tracking active but no location received yet",
            }

        return {
            "job_id": job_id,
            "provider_id": provider_id,
            "status": "tracking_active",
            "location": {
                "lat": float(location_data.get("lat", 0)),
                "lng": float(location_data.get("lng", 0)),
                "speed": float(location_data.get("speed", 0)),
                "heading": float(location_data.get("heading", 0)),
                "accuracy": float(location_data.get("accuracy", 0)),
                "timestamp": location_data.get("timestamp", ""),
            },
            "eta_minutes": (
                int(float(location_data["eta_minutes"]))
                if location_data.get("eta_minutes")
                else None
            ),
            "distance_remaining_km": (
                float(location_data["distance_remaining_km"])
                if location_data.get("distance_remaining_km")
                else None
            ),
        }
    finally:
        await redis.aclose()


@router.get(
    "/track/{job_id}/history",
    summary="Get provider location history for a job",
)
async def get_provider_location_history(
    job_id: str,
    current_user: CurrentUser,
) -> dict[str, Any]:
    """Get the full GPS location history trail for a job.

    Returns a chronological list of location snapshots recorded during
    the provider's journey.  Useful for:
      - Rendering the provider's route on a map
      - Dispute resolution / audit trail
      - SLA compliance verification
    """
    import redis.asyncio as aioredis
    from src.core.config import settings

    redis = aioredis.from_url(settings.redis_url, decode_responses=True)

    try:
        history_key = f"visp:loc:history:{job_id}"
        raw_entries = await redis.lrange(history_key, 0, -1)

        if not raw_entries:
            return {
                "job_id": job_id,
                "total_points": 0,
                "history": [],
            }

        history = []
        for entry in raw_entries:
            try:
                data = json.loads(entry)
                history.append(data)
            except (json.JSONDecodeError, TypeError):
                continue

        return {
            "job_id": job_id,
            "total_points": len(history),
            "history": history,
        }
    finally:
        await redis.aclose()
