"""
High-level geocoding service -- VISP-INT-MAPS-001
===================================================

Provides a domain-aware geocoding layer on top of the raw Google Maps
wrapper.  Handles address composition, fallback strategies, result
caching, and coordinate validation for the Canada/USA service area.

The main entry point is ``geocode_service_address()``, which accepts
structured address components, composes the full address, geocodes it
via the Google Maps API, and returns a typed ``GeocodingResult``.

An in-memory LRU cache (1 000 entries) avoids redundant API calls for
repeated addresses (e.g. same postal code area during a matching cycle).
"""

from __future__ import annotations

import hashlib
import logging
from collections import OrderedDict
from dataclasses import dataclass
from typing import Final

from src.integrations.maps.googleMapsService import (
    GoogleMapsError,
    geocode_address,
)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_CACHE_MAX_SIZE: Final[int] = 1000

# Bounding boxes for Canada and USA (lat/lng rectangles).
# These are generous bounds to avoid false negatives near borders.
_CANADA_BOUNDS = {
    "lat_min": 41.6,
    "lat_max": 83.2,
    "lng_min": -141.0,
    "lng_max": -52.6,
}

_USA_BOUNDS = {
    "lat_min": 24.4,
    "lat_max": 71.4,  # includes Alaska
    "lng_min": -179.2,  # includes Alaska/Aleutians
    "lng_max": -66.9,
}


# ---------------------------------------------------------------------------
# Result dataclass
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class GeocodingResult:
    """Geocoding result for a service address."""

    lat: float
    lng: float
    formatted_address: str
    place_id: str | None
    confidence: str  # "high", "medium", "low"


# ---------------------------------------------------------------------------
# LRU cache (async-safe, single-writer assumption in asyncio event loop)
# ---------------------------------------------------------------------------


class _GeocodingCache:
    """Simple LRU cache backed by an ``OrderedDict``.

    Thread-safety note: this is designed for single-threaded asyncio usage.
    All cache operations happen on the event loop thread, so no lock is
    needed.
    """

    def __init__(self, max_size: int = _CACHE_MAX_SIZE) -> None:
        self._max_size = max_size
        self._store: OrderedDict[str, GeocodingResult] = OrderedDict()

    def get(self, key: str) -> GeocodingResult | None:
        if key in self._store:
            self._store.move_to_end(key)
            return self._store[key]
        return None

    def put(self, key: str, value: GeocodingResult) -> None:
        if key in self._store:
            self._store.move_to_end(key)
            self._store[key] = value
            return
        if len(self._store) >= self._max_size:
            self._store.popitem(last=False)  # evict oldest
        self._store[key] = value

    def clear(self) -> None:
        self._store.clear()

    @property
    def size(self) -> int:
        return len(self._store)


_cache = _GeocodingCache()


def clear_geocoding_cache() -> None:
    """Clear the in-memory geocoding cache.  Useful in tests."""
    _cache.clear()
    logger.info("Geocoding cache cleared")


# ---------------------------------------------------------------------------
# Coordinate validation
# ---------------------------------------------------------------------------


def _is_within_service_area(lat: float, lng: float) -> bool:
    """Return True if the coordinates fall within Canada or the USA."""
    in_canada = (
        _CANADA_BOUNDS["lat_min"] <= lat <= _CANADA_BOUNDS["lat_max"]
        and _CANADA_BOUNDS["lng_min"] <= lng <= _CANADA_BOUNDS["lng_max"]
    )
    in_usa = (
        _USA_BOUNDS["lat_min"] <= lat <= _USA_BOUNDS["lat_max"]
        and _USA_BOUNDS["lng_min"] <= lng <= _USA_BOUNDS["lng_max"]
    )
    return in_canada or in_usa


# ---------------------------------------------------------------------------
# Address composition helpers
# ---------------------------------------------------------------------------


def _compose_full_address(
    address: str,
    city: str,
    province: str,
    postal: str,
    country: str,
) -> str:
    """Build a comma-separated address string from components."""
    parts = [p.strip() for p in (address, city, province, postal, country) if p.strip()]
    return ", ".join(parts)


def _compose_partial_address(
    city: str,
    province: str,
    postal: str,
    country: str,
) -> str:
    """Build a fallback address without the street line."""
    parts = [p.strip() for p in (city, province, postal, country) if p.strip()]
    return ", ".join(parts)


def _cache_key(address_string: str) -> str:
    """Deterministic cache key from the normalized address string."""
    normalized = address_string.strip().lower()
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------
# Confidence mapping
# ---------------------------------------------------------------------------


_LOCATION_TYPE_CONFIDENCE: dict[str | None, str] = {
    "ROOFTOP": "high",
    "RANGE_INTERPOLATED": "medium",
    "GEOMETRIC_CENTER": "low",
    "APPROXIMATE": "low",
    None: "low",
}


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


async def geocode_service_address(
    address: str,
    city: str,
    province: str,
    postal: str,
    country: str = "CA",
) -> GeocodingResult:
    """Geocode a structured service address with fallback and caching.

    Strategy:
      1. Compose the full address and check the cache.
      2. Call Google Maps Geocoding API with the full address.
      3. If no results, fall back to a partial address (city + province +
         postal + country) so the job can still be created with
         approximate coordinates.
      4. Validate that the resulting coordinates are within Canada/USA.
      5. Cache the result before returning.

    Args:
        address: Street address line (e.g. "123 Main Street").
        city: City name.
        province: Province or state code (e.g. "ON", "CA").
        postal: Postal or ZIP code.
        country: ISO 3166-1 alpha-2 country code. Defaults to "CA".

    Returns:
        GeocodingResult with coordinates, formatted address, and confidence.

    Raises:
        GoogleMapsError: If both full and partial geocoding fail at the
            API level (network errors, invalid key, etc.).
        ValueError: If the geocoded coordinates are outside the
            Canada/USA service area.
    """
    full_address = _compose_full_address(address, city, province, postal, country)
    key = _cache_key(full_address)

    # -- Check cache ---
    cached = _cache.get(key)
    if cached is not None:
        logger.debug("Geocoding cache hit for '%s'", full_address)
        return cached

    # -- Try full address --
    result = await _try_geocode(full_address)

    # -- Fallback to partial address --
    if result is None:
        partial = _compose_partial_address(city, province, postal, country)
        logger.info(
            "Full geocoding returned no results for '%s'; "
            "falling back to partial address '%s'",
            full_address,
            partial,
        )
        result = await _try_geocode(partial)

    if result is None:
        raise GoogleMapsError(
            f"Could not geocode address '{full_address}' or its partial fallback. "
            f"No results from Google Maps API."
        )

    # -- Validate service area --
    if not _is_within_service_area(result.lat, result.lng):
        raise ValueError(
            f"Geocoded coordinates ({result.lat}, {result.lng}) for "
            f"'{full_address}' are outside the Canada/USA service area"
        )

    # -- Cache and return --
    _cache.put(key, result)
    logger.info(
        "Geocoded '%s' -> (%.6f, %.6f) confidence=%s",
        full_address,
        result.lat,
        result.lng,
        result.confidence,
    )
    return result


async def _try_geocode(address_string: str) -> GeocodingResult | None:
    """Attempt to geocode an address string, returning None on ZERO_RESULTS."""
    try:
        data = await geocode_address(address_string)
    except GoogleMapsError:
        # Re-raise API/network errors -- these are not "no results"
        raise

    if data["lat"] is None:
        return None

    location_type = data.get("location_type")
    confidence = _LOCATION_TYPE_CONFIDENCE.get(location_type, "low")

    return GeocodingResult(
        lat=data["lat"],
        lng=data["lng"],
        formatted_address=data.get("formatted_address") or address_string,
        place_id=data.get("place_id"),
        confidence=confidence,
    )
