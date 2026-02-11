"""
Mapbox API wrapper service -- VISP-INT-MAPS-001
=================================================

Async wrapper around the Mapbox Platform APIs, providing geocoding,
reverse geocoding, directions, distance matrix, and address validation.

All HTTP calls use httpx with retry logic (3 attempts, exponential backoff).
The access token is read from the MAPBOX_ACCESS_TOKEN environment variable.
"""

from __future__ import annotations

import asyncio
import logging
import os
from typing import Any

import httpx

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

MAPBOX_ACCESS_TOKEN: str = os.environ.get("MAPBOX_ACCESS_TOKEN", "")

_BASE_URL = "https://api.mapbox.com"

_MAX_RETRIES = 3
_INITIAL_BACKOFF_SECONDS = 0.5  # doubles each retry: 0.5, 1.0, 2.0
_REQUEST_TIMEOUT_SECONDS = 10.0


# ---------------------------------------------------------------------------
# Custom exception
# ---------------------------------------------------------------------------


class MapboxError(Exception):
    """Raised when a Mapbox API request fails after all retries or
    returns an error status from the API itself."""

    def __init__(
        self, message: str, status: str | None = None, raw: Any = None
    ) -> None:
        super().__init__(message)
        self.status = status
        self.raw = raw


# Backward-compat alias so existing code that catches GoogleMapsError still works
GoogleMapsError = MapboxError


# ---------------------------------------------------------------------------
# Internal HTTP helpers
# ---------------------------------------------------------------------------


async def _request_with_retry(
    client: httpx.AsyncClient,
    method: str,
    url: str,
    *,
    params: dict[str, Any] | None = None,
    json_body: dict[str, Any] | None = None,
) -> dict[str, Any] | list[Any]:
    """Execute an HTTP request with exponential-backoff retry logic.

    Retries on transient HTTP errors (5xx, timeouts, connection errors).
    Does *not* retry on 4xx or successful responses with API-level errors
    -- those are surfaced immediately.

    Returns:
        Parsed JSON response.

    Raises:
        MapboxError: After all retries are exhausted or on non-retryable
            API errors.
    """
    last_exception: Exception | None = None
    backoff = _INITIAL_BACKOFF_SECONDS

    for attempt in range(1, _MAX_RETRIES + 1):
        try:
            if method == "GET":
                response = await client.get(
                    url, params=params, timeout=_REQUEST_TIMEOUT_SECONDS
                )
            else:
                response = await client.post(
                    url,
                    params=params,
                    json=json_body,
                    timeout=_REQUEST_TIMEOUT_SECONDS,
                )

            if 400 <= response.status_code < 500:
                raise MapboxError(
                    f"Mapbox API client error: HTTP {response.status_code}",
                    status=str(response.status_code),
                    raw=response.text,
                )

            if response.status_code >= 500:
                last_exception = MapboxError(
                    f"Mapbox API server error: HTTP {response.status_code}",
                    status=str(response.status_code),
                    raw=response.text,
                )
                logger.warning(
                    "Mapbox API server error on attempt %d/%d: HTTP %d",
                    attempt,
                    _MAX_RETRIES,
                    response.status_code,
                )
                if attempt < _MAX_RETRIES:
                    await asyncio.sleep(backoff)
                    backoff *= 2
                continue

            return response.json()

        except httpx.TimeoutException as exc:
            last_exception = exc
            logger.warning(
                "Mapbox API timeout on attempt %d/%d: %s",
                attempt,
                _MAX_RETRIES,
                exc,
            )
            if attempt < _MAX_RETRIES:
                await asyncio.sleep(backoff)
                backoff *= 2

        except httpx.ConnectError as exc:
            last_exception = exc
            logger.warning(
                "Mapbox API connection error on attempt %d/%d: %s",
                attempt,
                _MAX_RETRIES,
                exc,
            )
            if attempt < _MAX_RETRIES:
                await asyncio.sleep(backoff)
                backoff *= 2

    raise MapboxError(
        f"Mapbox API request failed after {_MAX_RETRIES} attempts",
        raw=str(last_exception),
    )


def _ensure_access_token() -> str:
    """Return the access token or raise if not configured."""
    token = MAPBOX_ACCESS_TOKEN
    if not token:
        raise MapboxError(
            "MAPBOX_ACCESS_TOKEN environment variable is not set"
        )
    return token


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


async def geocode_address(address: str) -> dict[str, Any]:
    """Forward-geocode a human-readable address to coordinates.

    Uses the Mapbox Geocoding API v5.

    Args:
        address: Full or partial street address string.

    Returns:
        Dict with keys: lat, lng, formatted_address, place_id, location_type,
        and the full results list under "all_results".

    Raises:
        MapboxError: On API failure or missing results.
    """
    token = _ensure_access_token()
    encoded_address = address.replace("#", "")

    async with httpx.AsyncClient() as client:
        data = await _request_with_retry(
            client,
            "GET",
            f"{_BASE_URL}/geocoding/v5/mapbox.places/{encoded_address}.json",
            params={
                "access_token": token,
                "limit": 5,
                "types": "address,place,locality,neighborhood,postcode",
            },
        )

    features = data.get("features", []) if isinstance(data, dict) else []
    if not features:
        return {
            "lat": None,
            "lng": None,
            "formatted_address": None,
            "place_id": None,
            "location_type": None,
            "all_results": [],
        }

    best = features[0]
    coords = best.get("center", [0, 0])  # [lng, lat] in GeoJSON
    relevance = best.get("relevance", 0)

    # Map Mapbox relevance to Google-style location_type
    if relevance >= 0.9:
        location_type = "ROOFTOP"
    elif relevance >= 0.7:
        location_type = "RANGE_INTERPOLATED"
    elif relevance >= 0.5:
        location_type = "GEOMETRIC_CENTER"
    else:
        location_type = "APPROXIMATE"

    return {
        "lat": coords[1],  # GeoJSON is [lng, lat]
        "lng": coords[0],
        "formatted_address": best.get("place_name"),
        "place_id": best.get("id"),
        "location_type": location_type,
        "all_results": features,
    }


async def reverse_geocode(lat: float, lng: float) -> dict[str, Any]:
    """Reverse-geocode coordinates to a human-readable address.

    Args:
        lat: Latitude in decimal degrees.
        lng: Longitude in decimal degrees.

    Returns:
        Dict with keys: formatted_address, place_id, address_components,
        and the full results list under "all_results".

    Raises:
        MapboxError: On API failure.
    """
    token = _ensure_access_token()

    async with httpx.AsyncClient() as client:
        data = await _request_with_retry(
            client,
            "GET",
            f"{_BASE_URL}/geocoding/v5/mapbox.places/{lng},{lat}.json",
            params={
                "access_token": token,
                "types": "address,place,locality,neighborhood,postcode",
            },
        )

    features = data.get("features", []) if isinstance(data, dict) else []
    if not features:
        return {
            "formatted_address": None,
            "place_id": None,
            "address_components": [],
            "all_results": [],
        }

    best = features[0]

    # Convert Mapbox context to address_components format
    address_components = []
    for ctx in best.get("context", []):
        ctx_id = ctx.get("id", "")
        component = {
            "long_name": ctx.get("text", ""),
            "short_name": ctx.get("short_code", ctx.get("text", "")),
            "types": [ctx_id.split(".")[0]] if "." in ctx_id else [ctx_id],
        }
        address_components.append(component)

    return {
        "formatted_address": best.get("place_name"),
        "place_id": best.get("id"),
        "address_components": address_components,
        "all_results": features,
    }


async def get_directions(
    origin: tuple[float, float],
    destination: tuple[float, float],
    *,
    mode: str = "driving",
    departure_time: str | None = None,
    avoid: str | None = None,
) -> dict[str, Any]:
    """Get driving (or other mode) directions between two points.

    Uses the Mapbox Directions API v5.

    Args:
        origin: (lat, lng) tuple for the start point.
        destination: (lat, lng) tuple for the end point.
        mode: Travel mode -- "driving", "walking", "cycling".
        departure_time: Optional (unused in Mapbox free tier, kept for
            interface compatibility).
        avoid: Optional (unused, kept for interface compatibility).

    Returns:
        Dict with keys: distance_meters, distance_text, duration_seconds,
        duration_text, duration_in_traffic_seconds (always None for Mapbox),
        overview_polyline, steps, and the raw routes list.

    Raises:
        MapboxError: On API failure.
    """
    token = _ensure_access_token()

    # Mapbox uses "driving", "walking", "cycling" (not "bicycling")
    profile_map = {
        "driving": "driving-traffic",
        "walking": "walking",
        "bicycling": "cycling",
        "cycling": "cycling",
        "transit": "driving",  # Mapbox doesn't have transit; fallback
    }
    profile = profile_map.get(mode, "driving-traffic")

    # Mapbox coordinates format: lng,lat;lng,lat
    coords_str = (
        f"{origin[1]},{origin[0]};{destination[1]},{destination[0]}"
    )

    async with httpx.AsyncClient() as client:
        data = await _request_with_retry(
            client,
            "GET",
            f"{_BASE_URL}/directions/v5/mapbox/{profile}/{coords_str}",
            params={
                "access_token": token,
                "geometries": "polyline",
                "overview": "full",
                "steps": "true",
                "language": "es",
            },
        )

    if not isinstance(data, dict):
        raise MapboxError("Unexpected response format from Mapbox Directions API")

    code = data.get("code", "")
    if code != "Ok":
        if code == "NoRoute":
            return {
                "distance_meters": None,
                "distance_text": None,
                "duration_seconds": None,
                "duration_text": None,
                "duration_in_traffic_seconds": None,
                "overview_polyline": None,
                "steps": [],
                "routes": [],
            }
        raise MapboxError(
            f"Mapbox Directions API error: {code} -- {data.get('message', '')}",
            status=code,
            raw=data,
        )

    routes = data.get("routes", [])
    if not routes:
        return {
            "distance_meters": None,
            "distance_text": None,
            "duration_seconds": None,
            "duration_text": None,
            "duration_in_traffic_seconds": None,
            "overview_polyline": None,
            "steps": [],
            "routes": [],
        }

    route = routes[0]
    distance_meters = route.get("distance", 0)
    duration_seconds = route.get("duration", 0)

    # Format human-readable text
    distance_km = distance_meters / 1000.0
    if distance_km >= 1:
        distance_text = f"{distance_km:.1f} km"
    else:
        distance_text = f"{int(distance_meters)} m"

    duration_minutes = duration_seconds / 60.0
    if duration_minutes >= 60:
        hours = int(duration_minutes // 60)
        mins = int(duration_minutes % 60)
        duration_text = f"{hours} h {mins} min"
    else:
        duration_text = f"{int(duration_minutes)} min"

    # Parse steps from legs
    steps = []
    for leg in route.get("legs", []):
        for step in leg.get("steps", []):
            maneuver = step.get("maneuver", {})
            steps.append(
                {
                    "distance_meters": step.get("distance", 0),
                    "duration_seconds": step.get("duration", 0),
                    "instruction": maneuver.get("instruction", ""),
                    "polyline": step.get("geometry"),
                }
            )

    return {
        "distance_meters": distance_meters,
        "distance_text": distance_text,
        "duration_seconds": duration_seconds,
        "duration_text": duration_text,
        "duration_in_traffic_seconds": None,
        "overview_polyline": route.get("geometry"),
        "steps": steps,
        "routes": routes,
    }


async def get_distance_matrix(
    origins: list[tuple[float, float]],
    destinations: list[tuple[float, float]],
    *,
    mode: str = "driving",
    departure_time: str | None = None,
) -> list[list[dict[str, Any]]]:
    """Get a matrix of distances and durations between origins and destinations.

    Uses the Mapbox Matrix API v1.

    The Mapbox Matrix API allows up to 25 total coordinates per request.

    Args:
        origins: List of (lat, lng) tuples for start points.
        destinations: List of (lat, lng) tuples for end points.
        mode: Travel mode.
        departure_time: Optional (kept for interface compatibility).

    Returns:
        2D list where result[i][j] is a dict with keys: distance_meters,
        distance_text, duration_seconds, duration_text,
        duration_in_traffic_seconds, status.

    Raises:
        MapboxError: On API failure or if coordinate count exceeds 25.
    """
    total_coords = len(origins) + len(destinations)
    if total_coords > 25:
        raise MapboxError(
            f"Total coordinate count {total_coords} exceeds Mapbox Matrix API "
            f"limit of 25. Split into smaller batches."
        )

    token = _ensure_access_token()

    profile_map = {
        "driving": "driving",
        "walking": "walking",
        "cycling": "cycling",
        "bicycling": "cycling",
    }
    profile = profile_map.get(mode, "driving")

    # Build coordinates string: origins first, then destinations
    # Format: lng,lat;lng,lat;...
    all_coords = []
    for lat, lng in origins:
        all_coords.append(f"{lng},{lat}")
    for lat, lng in destinations:
        all_coords.append(f"{lng},{lat}")
    coords_str = ";".join(all_coords)

    # Source indices are the origin positions, destination indices follow
    source_indices = ";".join(str(i) for i in range(len(origins)))
    dest_indices = ";".join(
        str(i + len(origins)) for i in range(len(destinations))
    )

    async with httpx.AsyncClient() as client:
        data = await _request_with_retry(
            client,
            "GET",
            f"{_BASE_URL}/directions-matrix/v1/mapbox/{profile}/{coords_str}",
            params={
                "access_token": token,
                "sources": source_indices,
                "destinations": dest_indices,
                "annotations": "duration,distance",
            },
        )

    if not isinstance(data, dict):
        raise MapboxError(
            "Unexpected response format from Mapbox Matrix API"
        )

    code = data.get("code", "")
    if code != "Ok":
        raise MapboxError(
            f"Mapbox Matrix API error: {code}", status=code, raw=data
        )

    durations = data.get("durations", [])
    distances = data.get("distances", [])

    result: list[list[dict[str, Any]]] = []
    for i in range(len(origins)):
        row_results: list[dict[str, Any]] = []
        for j in range(len(destinations)):
            duration_val = (
                durations[i][j] if i < len(durations) and j < len(durations[i])
                else None
            )
            distance_val = (
                distances[i][j] if i < len(distances) and j < len(distances[i])
                else None
            )

            if duration_val is None or distance_val is None:
                row_results.append(
                    {
                        "distance_meters": None,
                        "distance_text": None,
                        "duration_seconds": None,
                        "duration_text": None,
                        "duration_in_traffic_seconds": None,
                        "status": "NOT_FOUND",
                    }
                )
                continue

            distance_km = distance_val / 1000.0
            duration_minutes = duration_val / 60.0

            row_results.append(
                {
                    "distance_meters": distance_val,
                    "distance_text": f"{distance_km:.1f} km",
                    "duration_seconds": duration_val,
                    "duration_text": f"{int(duration_minutes)} min",
                    "duration_in_traffic_seconds": None,
                    "status": "OK",
                }
            )
        result.append(row_results)

    return result


async def validate_address(address: str) -> dict[str, Any]:
    """Validate an address using the Mapbox Geocoding API.

    Checks whether the address can be geocoded and assesses the quality
    of the result via the relevance score.

    Args:
        address: The address string to validate.

    Returns:
        Dict with keys: is_valid, confidence ("high", "medium", "low"),
        formatted_address, lat, lng, place_id, location_type,
        missing_components.

    Raises:
        MapboxError: On API failure.
    """
    geocode_result = await geocode_address(address)

    if geocode_result["lat"] is None:
        return {
            "is_valid": False,
            "confidence": "none",
            "formatted_address": None,
            "lat": None,
            "lng": None,
            "place_id": None,
            "location_type": None,
            "missing_components": [],
        }

    location_type = geocode_result.get("location_type", "APPROXIMATE")
    confidence_map = {
        "ROOFTOP": "high",
        "RANGE_INTERPOLATED": "medium",
        "GEOMETRIC_CENTER": "low",
        "APPROXIMATE": "low",
    }
    confidence = confidence_map.get(location_type, "low")

    return {
        "is_valid": True,
        "confidence": confidence,
        "formatted_address": geocode_result["formatted_address"],
        "lat": geocode_result["lat"],
        "lng": geocode_result["lng"],
        "place_id": geocode_result["place_id"],
        "location_type": location_type,
        "missing_components": [],
    }
