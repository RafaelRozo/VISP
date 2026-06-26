"""Pydantic schemas — VISP for Business (SP1)."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, EmailStr, Field


class CompanyCreateIn(BaseModel):
    legal_name: str = Field(min_length=1, max_length=300)
    trade_name: Optional[str] = Field(default=None, max_length=300)
    business_address: Optional[str] = None
    phone: Optional[str] = Field(default=None, max_length=40)
    email: Optional[EmailStr] = None
    website: Optional[str] = Field(default=None, max_length=500)


class CompanyMemberOut(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    role: str
    status: str


class CompanyDocumentOut(BaseModel):
    id: uuid.UUID
    doc_type: str
    status: str
    document_url: Optional[str] = None
    rejection_reason: Optional[str] = None


class CompanyOut(BaseModel):
    id: uuid.UUID
    legal_name: str
    trade_name: Optional[str] = None
    status: str
    stripe_account_id: Optional[str] = None
    rejection_reason: Optional[str] = None
    members: list[CompanyMemberOut] = []
    documents: list[CompanyDocumentOut] = []
    enabled_task_ids: list[uuid.UUID] = []


class CompanyServicesIn(BaseModel):
    """Set enabled services. If ``all`` is true, every catalog task is enabled
    and ``task_ids`` is ignored."""
    all: bool = False
    task_ids: list[uuid.UUID] = []


class CompanyInviteIn(BaseModel):
    email: EmailStr
    role: str = Field(default="collaborator", pattern="^(admin|supervisor|collaborator)$")


class CompanyInviteOut(BaseModel):
    id: uuid.UUID
    email: str
    role: str
    code: str
    status: str
    expires_at: datetime


class RedeemInviteIn(BaseModel):
    code: str = Field(min_length=4, max_length=16)


class RejectIn(BaseModel):
    reason: str = Field(min_length=1, max_length=2000)


# ---------------------------------------------------------------------------
# Company job assignments (SP4 Stage 1)
# ---------------------------------------------------------------------------


class ClaimableJobOut(BaseModel):
    """A job the company is eligible to claim."""
    job_id: uuid.UUID
    reference_number: str
    task_id: uuid.UUID
    task_name: Optional[str] = None
    status: str
    service_city: Optional[str] = None
    requested_date: Optional[str] = None


class AssignToCollaboratorIn(BaseModel):
    collaborator_user_id: uuid.UUID


class EligibleCollaboratorOut(BaseModel):
    user_id: uuid.UUID
    email: Optional[str] = None
    provider_id: uuid.UUID
    has_required_credential: bool


class CompanyJobAssignmentOut(BaseModel):
    id: uuid.UUID
    job_id: uuid.UUID
    company_id: uuid.UUID
    claimed_by: uuid.UUID
    assigned_collaborator_id: Optional[uuid.UUID] = None
    status: str
    payout_target: str
    decline_reason: Optional[str] = None


class DeclineAssignmentIn(BaseModel):
    reason: Optional[str] = Field(default=None, max_length=2000)
