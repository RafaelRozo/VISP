"""
Pydantic v2 schemas for Price Proposal API.

Covers:
- Create proposal requests (provider or platform proposing a price for L3/L4 job)
- Respond to proposal (customer accepts or rejects)
- Price adjustment (on-site scope change for L3/L4)
- Proposal response output
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


# ---------------------------------------------------------------------------
# Request schemas
# ---------------------------------------------------------------------------

class CreateProposalRequest(BaseModel):
    """Request body for creating a new price proposal."""

    job_id: uuid.UUID = Field(description="UUID of the job to propose a price for")
    proposed_price_cents: int = Field(
        gt=0,
        description="Proposed price in cents (must be positive)",
    )
    description: Optional[str] = Field(
        default=None,
        max_length=2000,
        description="Optional explanation of the proposed price",
    )


class RespondToProposalRequest(BaseModel):
    """Request body for accepting or rejecting a price proposal."""

    accept: bool = Field(
        description="True to accept the proposal, False to reject it",
    )


class AdjustPriceRequest(BaseModel):
    """Request body for an on-site scope change price adjustment (L3/L4)."""

    new_price_cents: int = Field(
        gt=0,
        description="New proposed price in cents reflecting the updated scope",
    )
    reason: str = Field(
        min_length=1,
        max_length=2000,
        description="Reason for the price adjustment (required for auditing)",
    )


# ---------------------------------------------------------------------------
# Response schemas
# ---------------------------------------------------------------------------

class ProposalResponse(BaseModel):
    """Price proposal response object."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    job_id: uuid.UUID
    proposed_by_id: uuid.UUID
    proposed_by_role: str
    proposed_price_cents: int
    description: Optional[str] = None
    status: str
    responded_at: Optional[datetime] = None
    created_at: datetime
