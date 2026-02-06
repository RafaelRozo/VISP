"""
Maps & Location integration package -- VISP-INT-MAPS-001
==========================================================

Public API for geocoding, distance calculation, and the Google Maps
service wrapper used throughout the VISP/Tasker platform.

Typical usage::

    from src.integrations.maps import (
        geocode_service_address,
        GeocodingResult,
        calculate_driving_distance,
        calculate_eta,
        batch_distances,
        DistanceResult,
        geocode_address,
        reverse_geocode,
        validate_address,
        GoogleMapsError,
    )
"""

from src.integrations.maps.distanceCalculator import (
    DistanceResult,
    batch_distances,
    calculate_driving_distance,
    calculate_eta,
)
from src.integrations.maps.geocoder import (
    GeocodingResult,
    clear_geocoding_cache,
    geocode_service_address,
)
from src.integrations.maps.googleMapsService import (
    GoogleMapsError,
    geocode_address,
    get_directions,
    get_distance_matrix,
    reverse_geocode,
    validate_address,
)

__all__ = [
    # googleMapsService
    "GoogleMapsError",
    "geocode_address",
    "reverse_geocode",
    "get_directions",
    "get_distance_matrix",
    "validate_address",
    # geocoder
    "GeocodingResult",
    "geocode_service_address",
    "clear_geocoding_cache",
    # distanceCalculator
    "DistanceResult",
    "calculate_driving_distance",
    "calculate_eta",
    "batch_distances",
]
