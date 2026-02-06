"""
Matching API Routes -- VISP-BE-MATCHING-003
=============================================

REST endpoints for provider matching, assignment, and reassignment.

Routes:
  POST /api/v1/matching/find      -- Find matching providers for a job
  POST /api/v1/matching/assign    -- Assign a provider to a job
  POST /api/v1/matching/reassign  -- Reassign a job to a different provider
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException, status

from src.api.deps import DBSession
from src.api.schemas.matching import (
    AssignmentOut,
    AssignProviderRequest,
    FindMatchRequest,
    FindMatchResponse,
    MatchResult,
    ReassignProviderRequest,
)
from src.services import jobService, matchingEngine

router = APIRouter(prefix="/matching", tags=["Matching"])


# ---------------------------------------------------------------------------
# POST /api/v1/matching/find -- Find matching providers for a job
# ---------------------------------------------------------------------------

@router.post(
    "/find",
    response_model=FindMatchResponse,
    summary="Find matching providers for a job",
    description=(
        "Runs the full matching pipeline for a job: geographic filtering, "
        "hard qualification checks (level, background check, license, insurance, "
        "on-call), and soft ranking by composite score. Returns a ranked list "
        "of qualified providers."
    ),
)
async def find_matching_providers(
    db: DBSession,
    body: FindMatchRequest,
) -> FindMatchResponse:
    # Load the job
    job = await jobService.get_job(db, body.job_id)
    if job is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Job with id '{body.job_id}' not found.",
        )

    try:
        result = await matchingEngine.find_matching_providers(
            db,
            job,
            radius_km=body.radius_km,
            max_results=body.max_results,
        )
    except matchingEngine.JobNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        )

    return FindMatchResponse(
        job_id=result["job_id"],
        job_reference=result["job_reference"],
        job_level=result["job_level"],
        total_candidates_evaluated=result["total_candidates_evaluated"],
        total_qualified=result["total_qualified"],
        matches=[MatchResult(**m) for m in result["matches"]],
    )


# ---------------------------------------------------------------------------
# POST /api/v1/matching/assign -- Assign provider to job
# ---------------------------------------------------------------------------

@router.post(
    "/assign",
    response_model=AssignmentOut,
    status_code=status.HTTP_201_CREATED,
    summary="Assign a provider to a job",
    description=(
        "Creates a JobAssignment record linking a provider to a job. "
        "The assignment starts in 'offered' status. SLA deadlines are "
        "computed from the job's SLA snapshot. If the job is in "
        "'pending_match' status, it transitions to 'matched'."
    ),
)
async def assign_provider(
    db: DBSession,
    body: AssignProviderRequest,
) -> AssignmentOut:
    try:
        assignment = await matchingEngine.assign_provider(
            db,
            body.job_id,
            body.provider_id,
            match_score=body.match_score,
        )
    except matchingEngine.JobNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        )
    except matchingEngine.ProviderNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        )
    except matchingEngine.AssignmentError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(exc),
        )

    return AssignmentOut.model_validate(assignment)


# ---------------------------------------------------------------------------
# POST /api/v1/matching/reassign -- Reassign to different provider
# ---------------------------------------------------------------------------

@router.post(
    "/reassign",
    response_model=AssignmentOut,
    summary="Reassign a job to a different provider",
    description=(
        "Cancels any existing active assignment for the job and creates "
        "a new assignment for the specified provider. The job status is "
        "reset to 'pending_match' before the new assignment transitions "
        "it to 'matched'."
    ),
)
async def reassign_provider(
    db: DBSession,
    body: ReassignProviderRequest,
) -> AssignmentOut:
    try:
        assignment = await matchingEngine.reassign_provider(
            db,
            body.job_id,
            body.new_provider_id,
            reason=body.reason,
        )
    except matchingEngine.JobNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        )
    except matchingEngine.ProviderNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        )
    except matchingEngine.AssignmentError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(exc),
        )

    return AssignmentOut.model_validate(assignment)
