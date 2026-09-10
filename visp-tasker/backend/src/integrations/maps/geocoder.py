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
from typing import Any, Final, Generic, TypeVar

from src.integrations.maps.mapboxService import (
    MapboxError,
    geocode_address,
    relevance_to_location_type,
)

logger = logging.getLogger(__name__)

_T = TypeVar("_T")

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_CACHE_MAX_SIZE: Final[int] = 1000

# Default country filter for the Canada/USA/Mexico service area.  Sent to
# Mapbox as the ``country`` parameter — never appended to the query text.
DEFAULT_COUNTRIES: Final[str] = "MX,CA,US"

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

_MEXICO_BOUNDS = {
    "lat_min": 14.5,
    "lat_max": 32.7,
    "lng_min": -118.5,
    "lng_max": -86.7,
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


class _GeocodingCache(Generic[_T]):
    """Simple LRU cache backed by an ``OrderedDict``.

    Thread-safety note: this is designed for single-threaded asyncio usage.
    All cache operations happen on the event loop thread, so no lock is
    needed.
    """

    def __init__(self, max_size: int = _CACHE_MAX_SIZE) -> None:
        self._max_size = max_size
        self._store: OrderedDict[str, _T] = OrderedDict()

    def get(self, key: str) -> _T | None:
        if key in self._store:
            self._store.move_to_end(key)
            return self._store[key]
        return None

    def put(self, key: str, value: _T) -> None:
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


_cache: _GeocodingCache[GeocodingResult] = _GeocodingCache()
_suggestion_cache: _GeocodingCache[list[GeocodingResult]] = _GeocodingCache(max_size=250)


def clear_geocoding_cache() -> None:
    """Clear the in-memory geocoding caches.  Useful in tests."""
    _cache.clear()
    _suggestion_cache.clear()
    logger.info("Geocoding cache cleared")


# ---------------------------------------------------------------------------
# Coordinate validation
# ---------------------------------------------------------------------------


def _is_within_service_area(lat: float, lng: float) -> bool:
    """Return True if the coordinates fall within Canada, the USA, or Mexico."""
    in_canada = (
        _CANADA_BOUNDS["lat_min"] <= lat <= _CANADA_BOUNDS["lat_max"]
        and _CANADA_BOUNDS["lng_min"] <= lng <= _CANADA_BOUNDS["lng_max"]
    )
    in_usa = (
        _USA_BOUNDS["lat_min"] <= lat <= _USA_BOUNDS["lat_max"]
        and _USA_BOUNDS["lng_min"] <= lng <= _USA_BOUNDS["lng_max"]
    )
    in_mexico = (
        _MEXICO_BOUNDS["lat_min"] <= lat <= _MEXICO_BOUNDS["lat_max"]
        and _MEXICO_BOUNDS["lng_min"] <= lng <= _MEXICO_BOUNDS["lng_max"]
    )
    return in_canada or in_usa or in_mexico


# ---------------------------------------------------------------------------
# Address composition helpers
# ---------------------------------------------------------------------------


def _compose_full_address(
    address: str,
    city: str,
    province: str,
    postal: str,
) -> str:
    """Build a comma-separated search string from the address components.

    The country is deliberately **not** part of this string.  It travels as
    the Mapbox ``country`` *filter*; appending it to the query text made
    Mapbox tokenize "CA" as California and rank US matches above Canadian
    ones for every ambiguous street — "25 York St" came back as San
    Francisco instead of Toronto.
    """
    parts = [p.strip() for p in (address, city, province, postal) if p.strip()]
    return ", ".join(parts)


def _compose_partial_address(
    city: str,
    province: str,
    postal: str,
) -> str:
    """Build a fallback search string without the street line."""
    parts = [p.strip() for p in (city, province, postal) if p.strip()]
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
    country: str = DEFAULT_COUNTRIES,
) -> GeocodingResult:
    """Geocode a structured service address with fallback and caching.

    Strategy:
      1. Compose the search string (street, city, province, postal — never
         the country) and check the cache.
      2. Call the Mapbox Geocoding API with the country as a *filter*.
      3. If no results, fall back to a partial query (city + province +
         postal) so the job can still be created with approximate
         coordinates.
      4. Warn — never block — if the coordinates fall outside the service area.
      5. Cache the result before returning.

    Args:
        address: Street address line (e.g. "123 Main Street").
        city: City name.
        province: Province or state code (e.g. "ON", "CA").
        postal: Postal or ZIP code.
        country: Country filter — ISO 3166-1 alpha-2 code(s), comma-separated.

    Returns:
        GeocodingResult with coordinates, formatted address, and confidence.

    Raises:
        MapboxError: If both full and partial geocoding fail at the
            API level (network errors, invalid key, etc.).
    """
    full_address = _compose_full_address(address, city, province, postal)
    key = _cache_key(f"{full_address}|{country}")

    # -- Check cache ---
    cached = _cache.get(key)
    if cached is not None:
        logger.debug("Geocoding cache hit for '%s'", full_address)
        return cached

    # -- Try full address --
    result = await _try_geocode(full_address, country=country)

    # -- Fallback to partial address --
    if result is None:
        partial = _compose_partial_address(city, province, postal)
        logger.info(
            "Full geocoding returned no results for '%s'; "
            "falling back to partial address '%s'",
            full_address,
            partial,
        )
        if partial:
            result = await _try_geocode(partial, country=country)

    if result is None:
        raise MapboxError(
            f"Could not geocode address '{full_address}' or its partial fallback. "
            f"No results from Mapbox API."
        )

    # -- Validate service area (warn but don't block) --
    if not _is_within_service_area(result.lat, result.lng):
        logger.warning(
            "Geocoded coordinates (%.6f, %.6f) for '%s' are outside the "
            "expected service area — allowing anyway",
            result.lat, result.lng, full_address,
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


async def _try_geocode(address_string: str, *, country: str = "") -> GeocodingResult | None:
    """Attempt to geocode an address string, returning None on ZERO_RESULTS."""
    try:
        data = await geocode_address(address_string, country=country)
    except MapboxError:
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


def _feature_to_result(feature: dict[str, Any]) -> GeocodingResult | None:
    """Convert one raw Mapbox feature into a GeocodingResult."""
    center = feature.get("center") or []
    place_name = feature.get("place_name")
    if len(center) < 2 or not place_name:
        return None

    confidence = _LOCATION_TYPE_CONFIDENCE.get(
        relevance_to_location_type(feature.get("relevance", 0)), "low"
    )

    return GeocodingResult(
        lat=center[1],  # GeoJSON is [lng, lat]
        lng=center[0],
        formatted_address=place_name,
        place_id=feature.get("id"),
        confidence=confidence,
    )


async def search_address_suggestions(
    query: str,
    *,
    country: str = DEFAULT_COUNTRIES,
    proximity: tuple[float, float] | None = None,
    limit: int = 5,
) -> list[GeocodingResult]:
    """Autocomplete-style address search returning up to ``limit`` candidates.

    This is what the app's address pickers call while the user types.  Unlike
    :func:`geocode_service_address` it never falls back to a coarser query and
    never raises on "no results" — an empty list is the normal answer for a
    half-typed street name.

    Args:
        query: Free text typed by the user.
        country: Country filter — ISO 3166-1 alpha-2 code(s), comma-separated.
        proximity: Optional ``(lat, lng)`` used to bias the ranking.  Bias
            only, never a restriction, so a stale or coarse position is safe
            to pass here.
        limit: Maximum number of suggestions (1-10).

    Returns:
        List of GeocodingResult, best match first.

    Raises:
        MapboxError: On API-level failure (network, bad token).
    """
    text = query.strip()
    if len(text) < 3:
        return []

    limit = max(1, min(limit, 10))
    key = _cache_key(
        f"{text}|{country}|{limit}|"
        + (f"{proximity[0]:.2f},{proximity[1]:.2f}" if proximity else "-")
    )

    cached = _suggestion_cache.get(key)
    if cached is not None:
        return cached

    data = await geocode_address(
        text, country=country, proximity=proximity, limit=limit
    )

    results = [
        converted
        for converted in (
            _feature_to_result(feature)
            for feature in data.get("all_results", [])[:limit]
        )
        if converted is not None
    ]

    _suggestion_cache.put(key, results)
    logger.info(
        "Address search '%s' (country=%s) -> %d suggestion(s)",
        text, country or "any", len(results),
    )
    return results
