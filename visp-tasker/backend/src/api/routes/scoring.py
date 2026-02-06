"""
Provider Scoring API routes -- VISP-BE-SCORING-005
====================================================

Admin-only endpoints for viewing and managing provider internal scores.

  GET  /api/v1/scoring/provider/{provider_id}  -- Get provider score info
  POST /api/v1/scoring/adjust                   -- Manual admin score adjustment
"""

from __future__ import annotations

import logging
import uuid

from fastapi import APIRouter, HTTPException, status

from src.api.deps import DBSession
from src.api.schemas.scoring import (
    PenaltyRecordOut,
    ProviderScoreOut,
    ScoreAdjustOut,
    ScoreAdjustRequest,
)
from src.services.scoringEngine import (
    admin_adjust_score,
    get_provider_score,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/scoring", tags=["Scoring"])


# ---------------------------------------------------------------------------
# GET /api/v1/scoring/provider/{provider_id}
# ---------------------------------------------------------------------------

@router.get(
    "/provider/{provider_id}",
    response_model=ProviderScoreOut,
    summary="Get provider scoring information (admin)",
    description=(
        "Returns the full internal scoring breakdown for a provider, including "
        "current score, level configuration, recent penalties, and incident-free "
        "week count.  This endpoint is admin-only."
    ),
)
async def get_provider_score_route(
    provider_id: uuid.UUID,
    db: DBSession,
) -> ProviderScoreOut:
    try:
        result = await get_provider_score(db=db, provider_id=provider_id)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        )

    penalties_out = [
        PenaltyRecordOut(
            penalty_type=p.penalty_type,
            points_deducted=p.points_deducted,
            job_id=p.job_id,
            reason=p.reason,
            applied_at=p.applied_at,
        )
        for p in result.recent_penalties
    ]

    return ProviderScoreOut(
        provider_id=result.provider_id,
        current_level=result.current_level,
        current_score=result.current_score,
        base_score=result.base_score,
        min_score=result.min_score,
        max_score=result.max_score,
        is_expelled=result.is_expelled,
        recent_penalties=penalties_out,
        incident_free_weeks=result.incident_free_weeks,
        last_penalty_at=result.last_penalty_at,
    )


# ---------------------------------------------------------------------------
# POST /api/v1/scoring/adjust
# ---------------------------------------------------------------------------

@router.post(
    "/adjust",
    response_model=ScoreAdjustOut,
    summary="Manually adjust provider score (admin)",
    description=(
        "Allows an admin to manually adjust a provider's internal score.  "
        "The resulting score is clamped to the level's min/max range.  "
        "A reason is mandatory and will be logged for audit purposes."
    ),
)
async def adjust_provider_score_route(
    body: ScoreAdjustRequest,
    db: DBSession,
) -> ScoreAdjustOut:
    try:
        result = await admin_adjust_score(
            db=db,
            provider_id=body.provider_id,
            adjustment=body.adjustment,
            admin_user_id=body.admin_user_id,
            reason=body.reason,
        )
    except ValueError as exc:
        message = str(exc)
        if "not found" in message.lower():
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=message,
            )
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=message,
        )

    return ScoreAdjustOut(
        provider_id=result.provider_id,
        previous_score=result.previous_score,
        new_score=result.new_score,
        adjustment=result.adjustment,
        adjusted_by=result.adjusted_by,
        adjusted_at=result.adjusted_at,
        reason=result.reason,
    )
