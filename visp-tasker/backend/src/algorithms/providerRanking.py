"""
Provider Ranking Algorithm -- VISP-BE-MATCHING-003
===================================================

Ranks qualified provider candidates by a composite score derived from
three weighted factors:

  1. Internal score  (weight: 0.6) -- platform trust/quality score
  2. Distance        (weight: 0.3) -- haversine distance from job location
  3. Response time   (weight: 0.1) -- historical average response time

All component scores are normalised to a 0-100 scale before weighting.
The composite score is the weighted sum, also on a 0-100 scale.

The algorithm is deterministic: given the same inputs, it always produces
the same ranking. Ties are broken by internal_score descending, then by
distance ascending.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any


# ---------------------------------------------------------------------------
# Default weights (must sum to 1.0)
# ---------------------------------------------------------------------------

DEFAULT_WEIGHTS: dict[str, float] = {
    "internal_score": 0.6,
    "distance": 0.3,
    "response_time": 0.1,
}

# Normalisation constants
MAX_DISTANCE_KM: float = 50.0       # Distance beyond this scores 0
MAX_RESPONSE_TIME_MIN: float = 60.0  # Response time beyond this scores 0
MAX_INTERNAL_SCORE: float = 100.0    # Maximum possible internal score


# ---------------------------------------------------------------------------
# Candidate data class
# ---------------------------------------------------------------------------

@dataclass
class RankingCandidate:
    """Input data for a single provider to be ranked."""

    provider: Any                   # The provider ORM object or dict
    provider_id: Any                # Provider UUID
    internal_score: float           # Provider's platform score (0-100)
    distance_km: float              # Haversine distance from job location
    response_time_avg_min: float | None = None  # Historical avg response time


@dataclass
class RankedProvider:
    """Output data for a ranked provider, including score breakdown."""

    provider: Any
    provider_id: Any
    internal_score: float
    distance_km: float
    response_time_avg_min: float | None

    # Normalised component scores (0-100)
    score_internal: float = 0.0
    score_distance: float = 0.0
    score_response: float = 0.0

    # Final composite score (0-100)
    composite_score: float = 0.0


# ---------------------------------------------------------------------------
# Normalisation functions
# ---------------------------------------------------------------------------

def _normalise_internal_score(score: float) -> float:
    """Normalise internal score to 0-100 range.

    Higher internal score is better.
    """
    clamped = max(0.0, min(score, MAX_INTERNAL_SCORE))
    return (clamped / MAX_INTERNAL_SCORE) * 100.0


def _normalise_distance(distance_km: float) -> float:
    """Normalise distance to 0-100 range.

    Closer is better: 0 km = 100, MAX_DISTANCE_KM+ = 0.
    """
    if distance_km <= 0:
        return 100.0
    if distance_km >= MAX_DISTANCE_KM:
        return 0.0
    return ((MAX_DISTANCE_KM - distance_km) / MAX_DISTANCE_KM) * 100.0


def _normalise_response_time(response_time_min: float | None) -> float:
    """Normalise response time to 0-100 range.

    Faster is better: 0 min = 100, MAX_RESPONSE_TIME_MIN+ = 0.
    No data defaults to a neutral 50.
    """
    if response_time_min is None:
        return 50.0  # Neutral score when no historical data
    if response_time_min <= 0:
        return 100.0
    if response_time_min >= MAX_RESPONSE_TIME_MIN:
        return 0.0
    return ((MAX_RESPONSE_TIME_MIN - response_time_min) / MAX_RESPONSE_TIME_MIN) * 100.0


# ---------------------------------------------------------------------------
# Ranking function
# ---------------------------------------------------------------------------

def rank_providers(
    candidates: list[RankingCandidate],
    weights: dict[str, float] | None = None,
) -> list[RankedProvider]:
    """Rank a list of provider candidates by composite score.

    Args:
        candidates: List of RankingCandidate objects to rank.
        weights: Optional weight overrides. Keys: ``internal_score``,
            ``distance``, ``response_time``. Must sum to 1.0.

    Returns:
        List of RankedProvider objects sorted by composite_score descending.
        Ties broken by internal_score desc, then distance asc.
    """
    w = weights or DEFAULT_WEIGHTS

    # Validate weights sum to ~1.0
    weight_sum = sum(w.values())
    if abs(weight_sum - 1.0) > 0.01:
        raise ValueError(
            f"Ranking weights must sum to 1.0, got {weight_sum:.4f}. "
            f"Weights: {w}"
        )

    ranked: list[RankedProvider] = []

    for candidate in candidates:
        # Normalise each component
        score_internal = _normalise_internal_score(candidate.internal_score)
        score_distance = _normalise_distance(candidate.distance_km)
        score_response = _normalise_response_time(candidate.response_time_avg_min)

        # Compute weighted composite score
        composite = (
            score_internal * w.get("internal_score", 0.6)
            + score_distance * w.get("distance", 0.3)
            + score_response * w.get("response_time", 0.1)
        )

        ranked.append(
            RankedProvider(
                provider=candidate.provider,
                provider_id=candidate.provider_id,
                internal_score=candidate.internal_score,
                distance_km=candidate.distance_km,
                response_time_avg_min=candidate.response_time_avg_min,
                score_internal=round(score_internal, 2),
                score_distance=round(score_distance, 2),
                score_response=round(score_response, 2),
                composite_score=round(composite, 2),
            )
        )

    # Sort: highest composite first, then internal_score desc, then distance asc
    ranked.sort(
        key=lambda r: (-r.composite_score, -r.internal_score, r.distance_km)
    )

    return ranked
