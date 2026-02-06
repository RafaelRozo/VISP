"""
Google Maps API wrapper service -- VISP-INT-MAPS-001
=====================================================

Async wrapper around the Google Maps Platform APIs, providing geocoding,
reverse geocoding, directions, distance matrix, and address validation.

All HTTP calls use httpx with retry logic (3 attempts, exponential backoff).
The API key is read from the GOOGLE_MAPS_API_KEY environment variable.
"""

from __future__ import annotations

import logging
import os
from typing import Any

import httpx

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

GOOGLE_MAPS_API_KEY: str = os.environ.get("GOOGLE_MAPS_API_KEY", "")

_BASE_URL = "https://maps.googleapis.com/maps/api"

_MAX_RETRIES = 3
_INITIAL_BACKOFF_SECONDS = 0.5  # doubles each retry: 0.5, 1.0, 2.0
_REQUEST_TIMEOUT_SECONDS = 10.0


# ---------------------------------------------------------------------------
# Custom exception
# ---------------------------------------------------------------------------


class GoogleMapsError(Exception):
    """Raised when a Google Maps API request fails after all retries or
    returns an error status from the API itself."""

    def __init__(self, message: str, status: str | None = None, raw: Any = None) -> None:
        super().__init__(message)
        self.status = status
        self.raw = raw


# ---------------------------------------------------------------------------
# Internal HTTP helpers
# ---------------------------------------------------------------------------


async def _request_with_retry(
    client: httpx.AsyncClient,
    url: str,
    params: dict[str, Any],
) -> dict[str, Any]:
    """Execute a GET request with exponential-backoff retry logic.

    Retries on transient HTTP errors (5xx, timeouts, connection errors).
    Does *not* retry on 4xx or successful responses with API-level errors
    (e.g. ZERO_RESULTS) -- those are surfaced immediately.

    Returns:
        Parsed JSON response dict.

    Raises:
        GoogleMapsError: After all retries are exhausted or on non-retryable
            API errors.
    """
    import asyncio

    last_exception: Exception | None = None
    backoff = _INITIAL_BACKOFF_SECONDS

    for attempt in range(1, _MAX_RETRIES + 1):
        try:
            response = await client.get(
                url,
                params=params,
                timeout=_REQUEST_TIMEOUT_SECONDS,
            )

            # Non-retryable HTTP errors (client errors)
            if 400 <= response.status_code < 500:
                raise GoogleMapsError(
                    f"Google Maps API client error: HTTP {response.status_code}",
                    status=str(response.status_code),
                    raw=response.text,
                )

            # Retryable server errors
            if response.status_code >= 500:
                last_exception = GoogleMapsError(
                    f"Google Maps API server error: HTTP {response.status_code}",
                    status=str(response.status_code),
                    raw=response.text,
                )
                logger.warning(
                    "Google Maps API server error on attempt %d/%d: HTTP %d",
                    attempt,
                    _MAX_RETRIES,
                    response.status_code,
                )
                if attempt < _MAX_RETRIES:
                    await asyncio.sleep(backoff)
                    backoff *= 2
                continue

            return response.json()  # type: ignore[no-any-return]

        except httpx.TimeoutException as exc:
            last_exception = exc
            logger.warning(
                "Google Maps API timeout on attempt %d/%d: %s",
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
                "Google Maps API connection error on attempt %d/%d: %s",
                attempt,
                _MAX_RETRIES,
                exc,
            )
            if attempt < _MAX_RETRIES:
                await asyncio.sleep(backoff)
                backoff *= 2

    raise GoogleMapsError(
        f"Google Maps API request failed after {_MAX_RETRIES} attempts",
        raw=str(last_exception),
    )


def _ensure_api_key() -> str:
    """Return the API key or raise if not configured."""
    key = GOOGLE_MAPS_API_KEY
    if not key:
        raise GoogleMapsError(
            "GOOGLE_MAPS_API_KEY environment variable is not set"
        )
    return key


def _check_api_status(data: dict[str, Any], context: str) -> None:
    """Check the top-level ``status`` field common to most Google Maps API
    responses and raise on error statuses.

    OK and ZERO_RESULTS are not considered errors (ZERO_RESULTS means a
    valid request that matched nothing).
    """
    status = data.get("status", "")
    if status in ("OK", "ZERO_RESULTS"):
        return
    raise GoogleMapsError(
        f"{context}: API returned status '{status}' -- "
        f"{data.get('error_message', 'no error message')}",
        status=status,
        raw=data,
    )


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


async def geocode_address(address: str) -> dict[str, Any]:
    """Forward-geocode a human-readable address to coordinates.

    Args:
        address: Full or partial street address string.

    Returns:
        Dict with keys: lat, lng, formatted_address, place_id, location_type,
        and the full results list under "all_results".

    Raises:
        GoogleMapsError: On API failure or missing results.
    """
    key = _ensure_api_key()

    async with httpx.AsyncClient() as client:
        data = await _request_with_retry(
            client,
            f"{_BASE_URL}/geocode/json",
            params={"address": address, "key": key},
        )

    _check_api_status(data, "Geocoding")

    results = data.get("results", [])
    if not results:
        return {
            "lat": None,
            "lng": None,
            "formatted_address": None,
            "place_id": None,
            "location_type": None,
            "all_results": [],
        }

    best = results[0]
    location = best["geometry"]["location"]

    return {
        "lat": location["lat"],
        "lng": location["lng"],
        "formatted_address": best.get("formatted_address"),
        "place_id": best.get("place_id"),
        "location_type": best["geometry"].get("location_type"),
        "all_results": results,
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
        GoogleMapsError: On API failure.
    """
    key = _ensure_api_key()

    async with httpx.AsyncClient() as client:
        data = await _request_with_retry(
            client,
            f"{_BASE_URL}/geocode/json",
            params={"latlng": f"{lat},{lng}", "key": key},
        )

    _check_api_status(data, "Reverse geocoding")

    results = data.get("results", [])
    if not results:
        return {
            "formatted_address": None,
            "place_id": None,
            "address_components": [],
            "all_results": [],
        }

    best = results[0]
    return {
        "formatted_address": best.get("formatted_address"),
        "place_id": best.get("place_id"),
        "address_components": best.get("address_components", []),
        "all_results": results,
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

    Args:
        origin: (lat, lng) tuple for the start point.
        destination: (lat, lng) tuple for the end point.
        mode: Travel mode -- "driving", "walking", "bicycling", "transit".
        departure_time: Optional departure time as Unix timestamp string or
            "now" for real-time traffic estimates.
        avoid: Optional features to avoid: "tolls", "highways", "ferries"
            (comma-separated).

    Returns:
        Dict with keys: distance_meters, distance_text, duration_seconds,
        duration_text, duration_in_traffic_seconds (if available),
        overview_polyline, steps, and the raw routes list.

    Raises:
        GoogleMapsError: On API failure.
    """
    key = _ensure_api_key()

    params: dict[str, str] = {
        "origin": f"{origin[0]},{origin[1]}",
        "destination": f"{destination[0]},{destination[1]}",
        "mode": mode,
        "key": key,
    }
    if departure_time:
        params["departure_time"] = departure_time
    if avoid:
        params["avoid"] = avoid

    async with httpx.AsyncClient() as client:
        data = await _request_with_retry(
            client,
            f"{_BASE_URL}/directions/json",
            params=params,
        )

    _check_api_status(data, "Directions")

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
    leg = route["legs"][0]

    duration_in_traffic_seconds: int | None = None
    if "duration_in_traffic" in leg:
        duration_in_traffic_seconds = leg["duration_in_traffic"]["value"]

    return {
        "distance_meters": leg["distance"]["value"],
        "distance_text": leg["distance"]["text"],
        "duration_seconds": leg["duration"]["value"],
        "duration_text": leg["duration"]["text"],
        "duration_in_traffic_seconds": duration_in_traffic_seconds,
        "overview_polyline": route.get("overview_polyline", {}).get("points"),
        "steps": [
            {
                "distance_meters": step["distance"]["value"],
                "duration_seconds": step["duration"]["value"],
                "instruction": step.get("html_instructions", ""),
                "polyline": step.get("polyline", {}).get("points"),
            }
            for step in leg.get("steps", [])
        ],
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

    The Google Distance Matrix API allows up to 25 origins or destinations per
    request, and a maximum of 100 elements (origins x destinations) per request.

    Args:
        origins: List of (lat, lng) tuples for start points.
        destinations: List of (lat, lng) tuples for end points.
        mode: Travel mode.
        departure_time: Optional departure time for traffic estimates.

    Returns:
        2D list where result[i][j] is a dict with keys: distance_meters,
        distance_text, duration_seconds, duration_text,
        duration_in_traffic_seconds, status.

    Raises:
        GoogleMapsError: On API failure or if element count exceeds 100.
    """
    if len(origins) * len(destinations) > 100:
        raise GoogleMapsError(
            f"Distance matrix element count {len(origins) * len(destinations)} "
            f"exceeds Google Maps API limit of 100 per request. "
            f"Split into smaller batches."
        )

    key = _ensure_api_key()

    origins_str = "|".join(f"{lat},{lng}" for lat, lng in origins)
    destinations_str = "|".join(f"{lat},{lng}" for lat, lng in destinations)

    params: dict[str, str] = {
        "origins": origins_str,
        "destinations": destinations_str,
        "mode": mode,
        "key": key,
    }
    if departure_time:
        params["departure_time"] = departure_time

    async with httpx.AsyncClient() as client:
        data = await _request_with_retry(
            client,
            f"{_BASE_URL}/distancematrix/json",
            params=params,
        )

    _check_api_status(data, "Distance matrix")

    rows = data.get("rows", [])
    result: list[list[dict[str, Any]]] = []

    for row in rows:
        row_results: list[dict[str, Any]] = []
        for element in row.get("elements", []):
            element_status = element.get("status", "UNKNOWN")
            if element_status != "OK":
                row_results.append({
                    "distance_meters": None,
                    "distance_text": None,
                    "duration_seconds": None,
                    "duration_text": None,
                    "duration_in_traffic_seconds": None,
                    "status": element_status,
                })
                continue

            duration_in_traffic: int | None = None
            if "duration_in_traffic" in element:
                duration_in_traffic = element["duration_in_traffic"]["value"]

            row_results.append({
                "distance_meters": element["distance"]["value"],
                "distance_text": element["distance"]["text"],
                "duration_seconds": element["duration"]["value"],
                "duration_text": element["duration"]["text"],
                "duration_in_traffic_seconds": duration_in_traffic,
                "status": "OK",
            })
        result.append(row_results)

    return result


async def validate_address(address: str) -> dict[str, Any]:
    """Validate an address using the Google Maps Geocoding API.

    This checks whether the address can be geocoded and assesses the
    quality of the result via the ``location_type`` and component
    completeness.

    Location types from most to least precise:
      - ROOFTOP: exact street address
      - RANGE_INTERPOLATED: between two precise points
      - GEOMETRIC_CENTER: center of a region (e.g. postal code)
      - APPROXIMATE: neighborhood or city level

    Args:
        address: The address string to validate.

    Returns:
        Dict with keys: is_valid, confidence ("high", "medium", "low"),
        formatted_address, lat, lng, place_id, location_type,
        missing_components.

    Raises:
        GoogleMapsError: On API failure.
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

    # Check which address components are present
    all_results = geocode_result.get("all_results", [])
    present_types: set[str] = set()
    if all_results:
        for component in all_results[0].get("address_components", []):
            present_types.update(component.get("types", []))

    expected_components = {
        "street_number",
        "route",
        "locality",
        "administrative_area_level_1",
        "postal_code",
        "country",
    }
    missing = expected_components - present_types

    return {
        "is_valid": True,
        "confidence": confidence,
        "formatted_address": geocode_result["formatted_address"],
        "lat": geocode_result["lat"],
        "lng": geocode_result["lng"],
        "place_id": geocode_result["place_id"],
        "location_type": location_type,
        "missing_components": sorted(missing),
    }
