"""
Weather API Integration Stub -- VISP-BE-PRICING-006.

Provides weather condition data for the dynamic pricing engine.  In production
this would call an external weather API (e.g., OpenWeatherMap, Environment
Canada, Weather.gov) to determine if extreme weather conditions exist at the
service location.

The pricing engine uses weather data to apply the 2.0x extreme weather
multiplier for emergency jobs only.

Extreme weather conditions that trigger the multiplier:
- Severe thunderstorms
- Blizzard / ice storms
- Tornado warnings
- Extreme cold (below -30C) or extreme heat (above +40C)
- Flooding

This is a stub implementation that always returns clear conditions unless
overridden for testing.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from decimal import Decimal
from enum import Enum
from typing import Optional

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Weather condition types
# ---------------------------------------------------------------------------

class WeatherSeverity(str, Enum):
    """Severity level for weather conditions."""
    NORMAL = "normal"
    ADVISORY = "advisory"
    WARNING = "warning"
    EXTREME = "extreme"


class WeatherCondition(str, Enum):
    """Known weather condition types."""
    CLEAR = "clear"
    RAIN = "rain"
    SNOW = "snow"
    THUNDERSTORM = "thunderstorm"
    BLIZZARD = "blizzard"
    ICE_STORM = "ice_storm"
    TORNADO = "tornado"
    EXTREME_COLD = "extreme_cold"
    EXTREME_HEAT = "extreme_heat"
    FLOODING = "flooding"
    FOG = "fog"
    WIND = "wind"


# Conditions that qualify as "extreme" for pricing purposes
EXTREME_CONDITIONS: set[WeatherCondition] = {
    WeatherCondition.BLIZZARD,
    WeatherCondition.ICE_STORM,
    WeatherCondition.TORNADO,
    WeatherCondition.EXTREME_COLD,
    WeatherCondition.EXTREME_HEAT,
    WeatherCondition.FLOODING,
}

# Conditions that qualify as "severe" (advisory-level, not full multiplier)
SEVERE_CONDITIONS: set[WeatherCondition] = {
    WeatherCondition.THUNDERSTORM,
    WeatherCondition.SNOW,
    WeatherCondition.WIND,
}


# ---------------------------------------------------------------------------
# Response DTO
# ---------------------------------------------------------------------------

@dataclass
class WeatherInfo:
    """Weather information for a given location."""
    condition: WeatherCondition
    severity: WeatherSeverity
    temperature_celsius: Optional[float] = None
    wind_speed_kmh: Optional[float] = None
    description: str = ""
    is_extreme: bool = False

    def __post_init__(self) -> None:
        self.is_extreme = self.condition in EXTREME_CONDITIONS


# ---------------------------------------------------------------------------
# Stub override for testing
# ---------------------------------------------------------------------------

_override_weather: Optional[WeatherInfo] = None


def set_weather_override(weather: Optional[WeatherInfo]) -> None:
    """Set a weather override for testing purposes.

    Pass None to clear the override and return to default (clear) conditions.

    Args:
        weather: The WeatherInfo to return from get_weather_conditions(),
                 or None to clear.
    """
    global _override_weather
    _override_weather = weather
    if weather:
        logger.info(
            "Weather override set: condition=%s, severity=%s, extreme=%s",
            weather.condition.value,
            weather.severity.value,
            weather.is_extreme,
        )
    else:
        logger.info("Weather override cleared")


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def get_weather_conditions(
    latitude: Decimal,
    longitude: Decimal,
) -> WeatherInfo:
    """Get current weather conditions for a geographic location.

    In production, this would make an HTTP call to a weather API.
    The stub returns clear conditions unless an override is set.

    Args:
        latitude: Latitude of the location (-90 to 90).
        longitude: Longitude of the location (-180 to 180).

    Returns:
        WeatherInfo with current conditions and severity.
    """
    if _override_weather is not None:
        logger.debug(
            "Returning overridden weather for (%s, %s): %s",
            latitude,
            longitude,
            _override_weather.condition.value,
        )
        return _override_weather

    # ---- Stub: always return clear conditions ----
    logger.debug(
        "WEATHER STUB: Returning clear conditions for (%s, %s). "
        "In production, this would call an external weather API.",
        latitude,
        longitude,
    )

    return WeatherInfo(
        condition=WeatherCondition.CLEAR,
        severity=WeatherSeverity.NORMAL,
        temperature_celsius=20.0,
        wind_speed_kmh=10.0,
        description="Clear skies (stub response)",
        is_extreme=False,
    )


async def is_extreme_weather(
    latitude: Decimal,
    longitude: Decimal,
) -> bool:
    """Quick check for whether extreme weather conditions exist at a location.

    Convenience wrapper around get_weather_conditions().

    Args:
        latitude: Latitude of the location.
        longitude: Longitude of the location.

    Returns:
        True if extreme weather conditions are detected.
    """
    weather = await get_weather_conditions(latitude, longitude)
    return weather.is_extreme
