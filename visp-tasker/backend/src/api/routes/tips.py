"""
Tip API Routes
==============

REST endpoints for customer tips on completed jobs.

  POST /api/v1/tips            -- Add a tip for a completed job
  GET  /api/v1/tips/{job_id}   -- Get the tip for a job (if any)
"""

from __future__ import annotations

import logging
import uuid

from fastapi import APIRouter, HTTPException, status

from src.api.deps import CurrentUser, DBSession
from src.api.schemas.tip import CreateTipRequest, TipResponse
from src.services import tipService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/tips", tags=["Tips"])


# ---------------------------------------------------------------------------
# POST /tips
# ---------------------------------------------------------------------------

@router.post(
    "",
    response_model=TipResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Add a tip for a completed job",
    description=(
        "Customer adds a monetary tip for the provider after the job is marked "
        "COMPLETED. Creates a tip record in 'pending' status. Call "
        "POST /tips/{tip_id}/confirm after the Stripe payment succeeds to "
        "mark it as paid."
    ),
)
async def add_tip(
    body: CreateTipRequest,
    db: DBSession,
    current_user: CurrentUser,
) -> TipResponse:
    try:
        tip = await tipService.add_tip(
            db=db,
            job_id=body.job_id,
            customer_id=current_user.id,
            amount_cents=body.amount_cents,
        )
    except ValueError as exc:
        message = str(exc)
        if "not found" in message.lower():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=message)
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=message
        )
    return TipResponse.model_validate(tip)


# ---------------------------------------------------------------------------
# GET /tips/{job_id}
# ---------------------------------------------------------------------------

@router.get(
    "/{job_id}",
    response_model=TipResponse,
    summary="Get the tip for a job",
    description=(
        "Returns the most recent tip for the given job. "
        "Returns 404 if no tip has been added yet."
    ),
)
async def get_tip(
    job_id: uuid.UUID,
    db: DBSession,
    current_user: CurrentUser,
) -> TipResponse:
    tip = await tipService.get_tip_for_job(db=db, job_id=job_id)
    if tip is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No tip found for job {job_id}",
        )
    return TipResponse.model_validate(tip)
