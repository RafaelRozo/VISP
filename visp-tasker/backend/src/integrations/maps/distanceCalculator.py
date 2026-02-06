"""
Distance and ETA calculator -- VISP-INT-MAPS-001
==================================================

Provides driving distance, duration, and ETA calculations between two
points using the Google Maps Distance Matrix API with automatic fallback
to haversine-based estimates when the API is unavailable.

The haversine fallback multiplies the great-circle distance by 1.3 to
approximate real road distance (empirically reasonable for North
American suburban/urban road networks).

All public functions are async and designed for use in the matching
engine, job assignment flow, and real-time ETA updates.
"""

from __future__ import annotations

import logging
import math
from dataclasses import dataclass
from typing import Final

from src.integrations.maps.googleMapsService import (
    GoogleMapsError,
    get_distance_matrix,
    get_directions,
)
from src.services.geoService import EARTH_RADIUS_KM, haversine_distance

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Road-distance correction factor applied to haversine when the API is
# unavailable.  1.3 is a commonly used heuristic for North American
# road networks (roads are ~30% longer than great-circle distance).
_HAVERSINE_ROAD_FACTOR: Final[float] = 1.3

# Average driving speed assumption (km/h) for haversine-based ETA
# fallback.  40 km/h accounts for city driving with stops.
_FALLBACK_AVG_SPEED_KMH: Final[float] = 40.0

# Maximum number of destinations per batch request (Google API limit is
# 25 origins or destinations, 100 elements total).
_MAX_BATCH_DESTINATIONS: Final[int] = 25


# ---------------------------------------------------------------------------
# Result dataclasses
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class DistanceResult:
    """Result of a distance/duration calculation between two points."""

    distance_km: float
    duration_minutes: float
    route_polyline: str | None = None
    is_fallback: bool = False


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _haversine_fallback(
    origin_lat: float,
    origin_lng: float,
    dest_lat: float,
    dest_lng: float,
) -> DistanceResult:
    """Compute an approximate driving distance using haversine * 1.3 and
    estimate travel time assuming average city driving speed."""
    straight_line_km = haversine_distance(origin_lat, origin_lng, dest_lat, dest_lng)
    road_km = straight_line_km * _HAVERSINE_ROAD_FACTOR
    duration_minutes = (road_km / _FALLBACK_AVG_SPEED_KMH) * 60.0

    return DistanceResult(
        distance_km=round(road_km, 2),
        duration_minutes=round(duration_minutes, 1),
        route_polyline=None,
        is_fallback=True,
    )


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


async def calculate_driving_distance(
    origin_lat: float,
    origin_lng: float,
    dest_lat: float,
    dest_lng: float,
) -> DistanceResult:
    """Calculate the driving distance and duration between two points.

    Tries the Google Maps Directions API first for accurate route data
    (including a polyline).  Falls back to haversine * 1.3 if the API
    call fails for any reason.

    Args:
        origin_lat: Origin latitude.
        origin_lng: Origin longitude.
        dest_lat: Destination latitude.
        dest_lng: Destination longitude.

    Returns:
        DistanceResult with distance in km, duration in minutes, and an
        optional encoded polyline.  The ``is_fallback`` flag indicates
        whether the result came from the haversine estimate.
    """
    try:
        data = await get_directions(
            origin=(origin_lat, origin_lng),
            destination=(dest_lat, dest_lng),
            mode="driving",
            departure_time="now",
        )

        if data["distance_meters"] is None:
            logger.info(
                "Directions API returned no route for (%.5f,%.5f)->(%.5f,%.5f); "
                "falling back to haversine",
                origin_lat,
                origin_lng,
                dest_lat,
                dest_lng,
            )
            return _haversine_fallback(origin_lat, origin_lng, dest_lat, dest_lng)

        distance_km = data["distance_meters"] / 1000.0

        # Prefer traffic-aware duration when available
        duration_seconds = (
            data["duration_in_traffic_seconds"]
            if data["duration_in_traffic_seconds"] is not None
            else data["duration_seconds"]
        )
        duration_minutes = duration_seconds / 60.0

        return DistanceResult(
            distance_km=round(distance_km, 2),
            duration_minutes=round(duration_minutes, 1),
            route_polyline=data.get("overview_polyline"),
            is_fallback=False,
        )

    except GoogleMapsError as exc:
        logger.warning(
            "Google Maps Directions API failed for (%.5f,%.5f)->(%.5f,%.5f): %s; "
            "falling back to haversine",
            origin_lat,
            origin_lng,
            dest_lat,
            dest_lng,
            exc,
        )
        return _haversine_fallback(origin_lat, origin_lng, dest_lat, dest_lng)

    except Exception as exc:
        logger.error(
            "Unexpected error in calculate_driving_distance: %s",
            exc,
            exc_info=True,
        )
        return _haversine_fallback(origin_lat, origin_lng, dest_lat, dest_lng)


async def calculate_eta(
    origin_lat: float,
    origin_lng: float,
    dest_lat: float,
    dest_lng: float,
) -> int:
    """Calculate the estimated time of arrival in whole minutes.

    Convenience wrapper around ``calculate_driving_distance`` that
    returns only the rounded-up duration.

    Args:
        origin_lat: Origin latitude.
        origin_lng: Origin longitude.
        dest_lat: Destination latitude.
        dest_lng: Destination longitude.

    Returns:
        ETA in minutes (rounded up to the nearest whole minute).
    """
    result = await calculate_driving_distance(
        origin_lat, origin_lng, dest_lat, dest_lng
    )
    return math.ceil(result.duration_minutes)


async def batch_distances(
    origin: tuple[float, float],
    destinations: list[tuple[float, float]],
) -> list[DistanceResult]:
    """Calculate distances from a single origin to multiple destinations.

    Uses the Google Distance Matrix API for efficient batch lookups.
    Falls back to individual haversine calculations if the API call fails.

    If the destination list exceeds the per-request element limit, it is
    automatically split into batches.

    Args:
        origin: (lat, lng) of the origin point.
        destinations: List of (lat, lng) tuples for destinations.

    Returns:
        List of DistanceResult objects, one per destination, in the same
        order as the input list.
    """
    if not destinations:
        return []

    # Split into batches of _MAX_BATCH_DESTINATIONS to stay within API limits
    all_results: list[DistanceResult] = []

    for batch_start in range(0, len(destinations), _MAX_BATCH_DESTINATIONS):
        batch = destinations[batch_start : batch_start + _MAX_BATCH_DESTINATIONS]
        batch_results = await _batch_distances_single(origin, batch)
        all_results.extend(batch_results)

    return all_results


async def _batch_distances_single(
    origin: tuple[float, float],
    destinations: list[tuple[float, float]],
) -> list[DistanceResult]:
    """Process a single batch of destinations against one origin."""
    try:
        matrix = await get_distance_matrix(
            origins=[origin],
            destinations=destinations,
            mode="driving",
            departure_time="now",
        )

        if not matrix or not matrix[0]:
            logger.warning(
                "Distance matrix returned empty result for origin (%.5f,%.5f) "
                "with %d destinations; falling back to haversine",
                origin[0],
                origin[1],
                len(destinations),
            )
            return _batch_haversine_fallback(origin, destinations)

        results: list[DistanceResult] = []
        row = matrix[0]  # single origin, so one row

        for idx, element in enumerate(row):
            if element["status"] != "OK" or element["distance_meters"] is None:
                logger.debug(
                    "Distance matrix element %d status=%s; using haversine fallback",
                    idx,
                    element.get("status"),
                )
                results.append(
                    _haversine_fallback(
                        origin[0], origin[1],
                        destinations[idx][0], destinations[idx][1],
                    )
                )
                continue

            distance_km = element["distance_meters"] / 1000.0
            duration_seconds = (
                element["duration_in_traffic_seconds"]
                if element.get("duration_in_traffic_seconds") is not None
                else element["duration_seconds"]
            )
            duration_minutes = duration_seconds / 60.0

            results.append(
                DistanceResult(
                    distance_km=round(distance_km, 2),
                    duration_minutes=round(duration_minutes, 1),
                    route_polyline=None,  # Matrix API does not return polylines
                    is_fallback=False,
                )
            )

        return results

    except GoogleMapsError as exc:
        logger.warning(
            "Distance matrix API failed for origin (%.5f,%.5f) with %d "
            "destinations: %s; falling back to haversine",
            origin[0],
            origin[1],
            len(destinations),
            exc,
        )
        return _batch_haversine_fallback(origin, destinations)

    except Exception as exc:
        logger.error(
            "Unexpected error in batch_distances: %s",
            exc,
            exc_info=True,
        )
        return _batch_haversine_fallback(origin, destinations)


def _batch_haversine_fallback(
    origin: tuple[float, float],
    destinations: list[tuple[float, float]],
) -> list[DistanceResult]:
    """Compute haversine-based fallback results for an entire batch."""
    return [
        _haversine_fallback(origin[0], origin[1], dest[0], dest[1])
        for dest in destinations
    ]
