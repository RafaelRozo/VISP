"""
Price Proposal API Routes
==========================

REST endpoints for the price negotiation lifecycle on L3/L4 jobs.

  POST /api/v1/proposals                    -- Create a price proposal
  POST /api/v1/proposals/{proposal_id}/respond  -- Accept or reject a proposal
  POST /api/v1/proposals/{job_id}/adjust    -- On-site scope adjustment
  GET  /api/v1/proposals/{job_id}           -- List all proposals for a job
"""

from __future__ import annotations

import logging
import uuid

from fastapi import APIRouter, HTTPException, status

from src.api.deps import CurrentUser, DBSession
from src.api.schemas.proposal import (
    AdjustPriceRequest,
    CreateProposalRequest,
    ProposalResponse,
    RespondToProposalRequest,
)
from src.services import priceProposalService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/proposals", tags=["Proposals"])


# ---------------------------------------------------------------------------
# POST /proposals
# ---------------------------------------------------------------------------

@router.post(
    "",
    response_model=ProposalResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a price proposal for a job",
    description=(
        "Allows a provider or platform admin to submit a price proposal for "
        "an L3/L4 job that is in PENDING_PRICE_AGREEMENT status. "
        "The customer must then accept or reject the proposal."
    ),
)
async def create_proposal(
    body: CreateProposalRequest,
    db: DBSession,
    current_user: CurrentUser,
) -> ProposalResponse:
    proposed_by_role = current_user.role if hasattr(current_user, "role") else "provider"
    try:
        proposal = await priceProposalService.create_price_proposal(
            db=db,
            job_id=body.job_id,
            proposer_id=current_user.id,
            proposed_by_role=proposed_by_role,
            proposed_price_cents=body.proposed_price_cents,
            description=body.description,
        )
    except ValueError as exc:
        message = str(exc)
        if "not found" in message.lower():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=message)
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=message
        )
    return ProposalResponse.model_validate(proposal)


# ---------------------------------------------------------------------------
# POST /proposals/{proposal_id}/respond
# ---------------------------------------------------------------------------

@router.post(
    "/{proposal_id}/respond",
    response_model=ProposalResponse,
    summary="Accept or reject a price proposal",
    description=(
        "Customer accepts or rejects an outstanding price proposal. "
        "On acceptance the job transitions to SCHEDULED and the agreed price "
        "is locked on the job record."
    ),
)
async def respond_to_proposal(
    proposal_id: uuid.UUID,
    body: RespondToProposalRequest,
    db: DBSession,
    current_user: CurrentUser,
) -> ProposalResponse:
    try:
        proposal = await priceProposalService.respond_to_proposal(
            db=db,
            proposal_id=proposal_id,
            responder_id=current_user.id,
            accept=body.accept,
        )
    except ValueError as exc:
        message = str(exc)
        if "not found" in message.lower():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=message)
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=message
        )
    return ProposalResponse.model_validate(proposal)


# ---------------------------------------------------------------------------
# POST /proposals/{job_id}/adjust
# ---------------------------------------------------------------------------

@router.post(
    "/{job_id}/adjust",
    response_model=ProposalResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Submit an on-site price adjustment",
    description=(
        "Provider submits a revised price due to an on-site scope change. "
        "All existing accepted/pending proposals for the job are superseded and "
        "the job is put back into PENDING_PRICE_AGREEMENT so the customer "
        "must re-approve the new price."
    ),
)
async def adjust_price(
    job_id: uuid.UUID,
    body: AdjustPriceRequest,
    db: DBSession,
    current_user: CurrentUser,
) -> ProposalResponse:
    try:
        proposal = await priceProposalService.create_price_adjustment(
            db=db,
            job_id=job_id,
            proposer_id=current_user.id,
            new_price_cents=body.new_price_cents,
            reason=body.reason,
        )
    except ValueError as exc:
        message = str(exc)
        if "not found" in message.lower():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=message)
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=message
        )
    return ProposalResponse.model_validate(proposal)


# ---------------------------------------------------------------------------
# GET /proposals/{job_id}
# ---------------------------------------------------------------------------

@router.get(
    "/{job_id}",
    response_model=list[ProposalResponse],
    summary="List all price proposals for a job",
    description=(
        "Returns all price proposals for a job, ordered newest first. "
        "Includes proposals in all statuses (pending, accepted, rejected, superseded)."
    ),
)
async def list_proposals(
    job_id: uuid.UUID,
    db: DBSession,
    current_user: CurrentUser,
) -> list[ProposalResponse]:
    proposals = await priceProposalService.get_proposals_for_job(db=db, job_id=job_id)
    return [ProposalResponse.model_validate(p) for p in proposals]
