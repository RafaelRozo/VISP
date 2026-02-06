"""
Pydantic v2 schemas for the Auto-Escalation API (VISP-BE-ESCALATION-008).

Covers:
- Escalation check results
- Escalation creation
- Admin approval and rejection of escalations
- Pending escalation listing
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


# ---------------------------------------------------------------------------
# Request schemas
# ---------------------------------------------------------------------------

class EscalationCheckRequest(BaseModel):
    """Request to check text for escalation trigger keywords."""

    job_id: uuid.UUID = Field(
        description="UUID of the job to check for escalation",
    )
    text_to_check: str = Field(
        min_length=1,
        max_length=5000,
        description="Text to scan for escalation trigger keywords",
    )


class EscalationApproveRequest(BaseModel):
    """Admin request to approve an escalation."""

    admin_user_id: uuid.UUID = Field(
        description="UUID of the admin user approving the escalation",
    )


class EscalationRejectRequest(BaseModel):
    """Admin request to reject an escalation."""

    admin_user_id: uuid.UUID = Field(
        description="UUID of the admin user rejecting the escalation",
    )
    reason: str = Field(
        min_length=1,
        max_length=2000,
        description="Mandatory reason for rejecting the escalation",
    )


# ---------------------------------------------------------------------------
# Response schemas
# ---------------------------------------------------------------------------

class MatchedKeywordOut(BaseModel):
    """A single keyword that was matched during escalation check."""

    model_config = ConfigDict(from_attributes=True)

    keyword: str
    target_level: str
    found_in_text: str = Field(
        description="The portion of text where the keyword was found",
    )


class EscalationCheckResultOut(BaseModel):
    """Result of an escalation check against text."""

    model_config = ConfigDict(from_attributes=True)

    job_id: uuid.UUID
    should_escalate: bool
    current_level: str
    target_level: Optional[str] = None
    matched_keywords: list[MatchedKeywordOut]
    escalation_id: Optional[uuid.UUID] = Field(
        default=None,
        description="UUID of the created escalation record, if one was created",
    )
    escalation_type: Optional[str] = None


class EscalationDetailOut(BaseModel):
    """Detailed view of a single escalation."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    job_id: uuid.UUID
    escalation_type: str
    from_level: Optional[str] = None
    to_level: Optional[str] = None
    trigger_keyword: Optional[str] = None
    trigger_description: Optional[str] = None
    resolved: bool
    resolved_at: Optional[datetime] = None
    resolved_by: Optional[uuid.UUID] = None
    resolution_notes: Optional[str] = None
    created_at: datetime


class EscalationActionOut(BaseModel):
    """Result of an admin approve or reject action on an escalation."""

    model_config = ConfigDict(from_attributes=True)

    escalation_id: uuid.UUID
    action: str
    job_id: uuid.UUID
    from_level: Optional[str] = None
    to_level: Optional[str] = None
    performed_by: uuid.UUID
    performed_at: datetime


class PendingEscalationsOut(BaseModel):
    """List of pending (unresolved) escalations."""

    model_config = ConfigDict(from_attributes=True)

    escalations: list[EscalationDetailOut]
    total_count: int
