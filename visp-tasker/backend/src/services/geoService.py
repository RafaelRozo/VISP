"""
Geo Service -- VISP-BE-MATCHING-003
====================================

Geographic utility functions for distance calculations and radius filtering.
Used by the matching engine to filter and rank providers by proximity.

Uses the haversine formula for great-circle distance between two points
on Earth's surface. Accurate enough for service radius calculations
(error < 0.5% for distances under 100 km).
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from decimal import Decimal
from typing import Any, Protocol, Sequence

# Earth's mean radius in kilometres
EARTH_RADIUS_KM: float = 6371.0


def haversine_distance(
    lat1: float,
    lon1: float,
    lat2: float,
    lon2: float,
) -> float:
    """Calculate the great-circle distance between two points using the
    haversine formula.

    Args:
        lat1: Latitude of point 1 in decimal degrees.
        lon1: Longitude of point 1 in decimal degrees.
        lat2: Latitude of point 2 in decimal degrees.
        lon2: Longitude of point 2 in decimal degrees.

    Returns:
        Distance in kilometres.
    """
    # Convert decimal degrees to radians
    lat1_rad = math.radians(lat1)
    lat2_rad = math.radians(lat2)
    delta_lat = math.radians(lat2 - lat1)
    delta_lon = math.radians(lon2 - lon1)

    # Haversine formula
    a = (
        math.sin(delta_lat / 2) ** 2
        + math.cos(lat1_rad) * math.cos(lat2_rad) * math.sin(delta_lon / 2) ** 2
    )
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

    return EARTH_RADIUS_KM * c


class HasLocation(Protocol):
    """Protocol for objects that have latitude and longitude attributes."""

    home_latitude: Decimal | None
    home_longitude: Decimal | None


@dataclass
class ProviderDistance:
    """A provider paired with their calculated distance from a reference point."""

    provider: Any
    distance_km: float


def filter_by_radius(
    providers: Sequence[Any],
    center_lat: float,
    center_lon: float,
    radius_km: float | None = None,
) -> list[ProviderDistance]:
    """Filter a list of providers to those within a given radius of a center
    point.

    If ``radius_km`` is None, each provider's own ``service_radius_km``
    attribute is used as their individual radius.

    Args:
        providers: Sequence of provider objects with ``home_latitude``,
            ``home_longitude``, and ``service_radius_km`` attributes.
        center_lat: Latitude of the job/center location.
        center_lon: Longitude of the job/center location.
        radius_km: Optional fixed radius override in km. If None, uses
            each provider's ``service_radius_km``.

    Returns:
        List of ProviderDistance objects sorted by distance (closest first).
    """
    results: list[ProviderDistance] = []

    for provider in providers:
        # Skip providers without location data
        if provider.home_latitude is None or provider.home_longitude is None:
            continue

        distance = haversine_distance(
            center_lat,
            center_lon,
            float(provider.home_latitude),
            float(provider.home_longitude),
        )

        # Determine the applicable radius
        effective_radius = radius_km if radius_km is not None else float(provider.service_radius_km)

        if distance <= effective_radius:
            results.append(ProviderDistance(provider=provider, distance_km=distance))

    # Sort by distance (closest first)
    results.sort(key=lambda pd: pd.distance_km)

    return results
