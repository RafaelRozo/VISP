"""
Pydantic v2 schemas for the Tip API.

Covers:
- Create tip request (customer adds a tip for a completed job)
- Tip response output
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


# ---------------------------------------------------------------------------
# Request schemas
# ---------------------------------------------------------------------------

class CreateTipRequest(BaseModel):
    """Request body for adding a tip to a completed job."""

    job_id: uuid.UUID = Field(description="UUID of the completed job to tip on")
    amount_cents: int = Field(
        gt=0,
        description="Tip amount in cents (must be positive)",
    )


# ---------------------------------------------------------------------------
# Response schemas
# ---------------------------------------------------------------------------

class TipResponse(BaseModel):
    """Tip response object."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    job_id: uuid.UUID
    amount_cents: int
    status: str
    paid_at: Optional[datetime] = None
    created_at: datetime
