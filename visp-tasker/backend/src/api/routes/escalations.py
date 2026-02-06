"""
Auto-Escalation API routes -- VISP-BE-ESCALATION-008
=====================================================

Endpoints for managing job escalations triggered by keyword detection.

  GET  /api/v1/escalations/pending           -- List pending escalations
  POST /api/v1/escalations/check             -- Check text for escalation triggers
  POST /api/v1/escalations/approve/{id}      -- Admin approve an escalation
  POST /api/v1/escalations/reject/{id}       -- Admin reject an escalation
"""

from __future__ import annotations

import logging
import uuid
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, status

from src.api.deps import DBSession
from src.api.schemas.escalation import (
    EscalationActionOut,
    EscalationApproveRequest,
    EscalationCheckRequest,
    EscalationCheckResultOut,
    EscalationDetailOut,
    EscalationRejectRequest,
    MatchedKeywordOut,
    PendingEscalationsOut,
)
from src.services.escalationService import (
    approve_escalation,
    check_escalation,
    get_pending_escalations,
    reject_escalation,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/escalations", tags=["Escalations"])


# ---------------------------------------------------------------------------
# GET /api/v1/escalations/pending
# ---------------------------------------------------------------------------

@router.get(
    "/pending",
    response_model=PendingEscalationsOut,
    summary="List pending escalations (admin)",
    description=(
        "Returns all unresolved escalations, ordered by creation date "
        "(most recent first).  Admin use only."
    ),
)
async def list_pending_escalations(
    db: DBSession,
    limit: int = Query(default=50, ge=1, le=100, description="Maximum results"),
    offset: int = Query(default=0, ge=0, description="Number of results to skip"),
) -> PendingEscalationsOut:
    escalations, total_count = await get_pending_escalations(
        db=db,
        limit=limit,
        offset=offset,
    )

    return PendingEscalationsOut(
        escalations=[
            EscalationDetailOut(
                id=e.id,
                job_id=e.job_id,
                escalation_type=e.escalation_type,
                from_level=e.from_level,
                to_level=e.to_level,
                trigger_keyword=e.trigger_keyword,
                trigger_description=e.trigger_description,
                resolved=e.resolved,
                resolved_at=e.resolved_at,
                resolved_by=e.resolved_by,
                resolution_notes=e.resolution_notes,
                created_at=e.created_at,
            )
            for e in escalations
        ],
        total_count=total_count,
    )


# ---------------------------------------------------------------------------
# POST /api/v1/escalations/check
# ---------------------------------------------------------------------------

@router.post(
    "/check",
    response_model=EscalationCheckResultOut,
    summary="Check text for escalation triggers",
    description=(
        "Scans the provided text for escalation trigger keywords.  If any "
        "keywords match a level higher than the job's current level, an "
        "escalation record is automatically created (pending admin approval).  "
        "Keywords are checked highest level first (L4, L3, L2)."
    ),
)
async def check_escalation_route(
    body: EscalationCheckRequest,
    db: DBSession,
) -> EscalationCheckResultOut:
    try:
        result = await check_escalation(
            db=db,
            job_id=body.job_id,
            text_to_check=body.text_to_check,
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

    matched_out = [
        MatchedKeywordOut(
            keyword=m.keyword,
            target_level=m.target_level,
            found_in_text=m.found_in_text,
        )
        for m in result.matched_keywords
    ]

    return EscalationCheckResultOut(
        job_id=result.job_id,
        should_escalate=result.should_escalate,
        current_level=result.current_level,
        target_level=result.target_level,
        matched_keywords=matched_out,
        escalation_id=result.escalation_id,
        escalation_type=result.escalation_type,
    )


# ---------------------------------------------------------------------------
# POST /api/v1/escalations/approve/{escalation_id}
# ---------------------------------------------------------------------------

@router.post(
    "/approve/{escalation_id}",
    response_model=EscalationActionOut,
    summary="Admin approve an escalation",
    description=(
        "Approve a pending escalation.  For Level 4 escalations, the job is "
        "automatically marked as an emergency.  The escalation is marked as "
        "resolved with the approval recorded."
    ),
)
async def approve_escalation_route(
    escalation_id: uuid.UUID,
    body: EscalationApproveRequest,
    db: DBSession,
) -> EscalationActionOut:
    try:
        result = await approve_escalation(
            db=db,
            escalation_id=escalation_id,
            admin_user_id=body.admin_user_id,
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

    return EscalationActionOut(
        escalation_id=result.escalation_id,
        action=result.action,
        job_id=result.job_id,
        from_level=result.from_level,
        to_level=result.to_level,
        performed_by=result.performed_by,
        performed_at=result.performed_at,
    )


# ---------------------------------------------------------------------------
# POST /api/v1/escalations/reject/{escalation_id}
# ---------------------------------------------------------------------------

@router.post(
    "/reject/{escalation_id}",
    response_model=EscalationActionOut,
    summary="Admin reject an escalation",
    description=(
        "Reject a pending escalation with a mandatory reason.  The escalation "
        "is marked as resolved and the job remains at its current level."
    ),
)
async def reject_escalation_route(
    escalation_id: uuid.UUID,
    body: EscalationRejectRequest,
    db: DBSession,
) -> EscalationActionOut:
    try:
        result = await reject_escalation(
            db=db,
            escalation_id=escalation_id,
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

    return EscalationActionOut(
        escalation_id=result.escalation_id,
        action=result.action,
        job_id=result.job_id,
        from_level=result.from_level,
        to_level=result.to_level,
        performed_by=result.performed_by,
        performed_at=result.performed_at,
    )
