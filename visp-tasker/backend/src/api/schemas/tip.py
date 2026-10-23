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
    # La tarjeta guardada con la que se cobra la propina, igual que la retención
    # del trabajo (authorize-payment). Sin ella no se puede cobrar.
    payment_method: Optional[str] = Field(
        default=None,
        description="Saved Stripe PaymentMethod id to charge the tip to",
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
