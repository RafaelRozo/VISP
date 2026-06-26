"""
Business logic for the company supervisor->collaborator job-assignment flow
(VISP for Business, SP4 Stage 1).

ADDITIVE ONLY. This service never mutates ``Job`` / ``JobAssignment`` rows
(the provider matching/offer flow), it only reads ``Job`` to surface claimable
work and to resolve a payout destination. A job is "claimed by a company" iff a
``CompanyJobAssignment`` row exists for it.

Assumptions (documented per the task brief):
  * "Available to claim" = a Job in ``PENDING_MATCH`` or ``MATCHED`` status
    (pre-acceptance states where no provider has committed) that has no
    ``CompanyJobAssignment`` row yet, and whose ``task_id`` is in the company's
    enabled ``company_services``.
  * A "collaborator" is a ``CompanyMember`` with role COLLABORATOR + ACTIVE,
    whose user owns a ``ProviderProfile``. Credentials are tracked on the
    provider profile via ``ProviderCredential`` (reused as-is).
  * A task "requires a credential" when ``ServiceTask.license_required`` or
    ``ServiceTask.certification_required`` is true. Eligibility for such a task
    requires a matching ``ProviderCredential`` for that ``task_id`` in status
    VERIFIED. Tasks that require no credential admit any active collaborator.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from src.models.company import (
    Company,
    CompanyMember,
    CompanyMemberRole,
    CompanyMemberStatus,
    CompanyService,
    CompanyStatus,
)
from src.models.company_job import (
    CompanyJobAssignment,
    CompanyJobStatus,
    CompanyPayoutTarget,
)
from src.models.job import Job, JobStatus
from src.models.provider import ProviderProfile
from src.models.taxonomy import ServiceTask
from src.models.user import User
from src.models.verification import CredentialStatus, ProviderCredential

# Job statuses considered "available to be claimed" by a company. These are
# pre-acceptance states; claiming here does not touch the provider offer flow.
CLAIMABLE_JOB_STATUSES = (JobStatus.PENDING_MATCH, JobStatus.MATCHED)


class AssignmentError(Exception):
    """Domain error for the company-assignment flow (maps to HTTP 4xx)."""


# ---------------------------------------------------------------------------
# Authorization helpers
# ---------------------------------------------------------------------------


async def get_member(
    db: AsyncSession, company_id: uuid.UUID, user_id: uuid.UUID
) -> Optional[CompanyMember]:
    result = await db.execute(
        select(CompanyMember).where(
            CompanyMember.company_id == company_id,
            CompanyMember.user_id == user_id,
        )
    )
    return result.scalar_one_or_none()


async def get_company(db: AsyncSession, company_id: uuid.UUID) -> Optional[Company]:
    result = await db.execute(select(Company).where(Company.id == company_id))
    return result.scalar_one_or_none()


async def require_validated_company(db: AsyncSession, company_id: uuid.UUID) -> Company:
    company = await get_company(db, company_id)
    if company is None:
        raise AssignmentError("Company not found.")
    if company.status != CompanyStatus.VALIDATED:
        raise AssignmentError("Company is not validated.")
    return company


async def require_supervisor(
    db: AsyncSession, company_id: uuid.UUID, user_id: uuid.UUID
) -> CompanyMember:
    """Ensure the user is an ADMIN or SUPERVISOR (and ACTIVE) of the company."""
    member = await get_member(db, company_id, user_id)
    if member is None or member.status != CompanyMemberStatus.ACTIVE:
        raise AssignmentError("You are not an active member of this company.")
    if member.role not in (CompanyMemberRole.ADMIN, CompanyMemberRole.SUPERVISOR):
        raise AssignmentError("Only a company admin or supervisor can perform this action.")
    return member


# ---------------------------------------------------------------------------
# Claimable jobs
# ---------------------------------------------------------------------------


async def list_claimable_jobs(db: AsyncSession, company_id: uuid.UUID) -> list[Job]:
    """Jobs the company may claim: status in CLAIMABLE_JOB_STATUSES, task in the
    company's enabled services, and not already claimed by any company."""
    enabled_subq = (
        select(CompanyService.task_id)
        .where(CompanyService.company_id == company_id)
        .scalar_subquery()
    )
    already_claimed_subq = select(CompanyJobAssignment.job_id).scalar_subquery()

    stmt = (
        select(Job)
        .options(selectinload(Job.task))
        .where(
            Job.status.in_(CLAIMABLE_JOB_STATUSES),
            Job.task_id.in_(enabled_subq),
            Job.id.notin_(already_claimed_subq),
        )
        .order_by(Job.created_at.desc())
    )
    result = await db.execute(stmt)
    return list(result.scalars().all())


# ---------------------------------------------------------------------------
# Claim
# ---------------------------------------------------------------------------


async def get_assignment_for_job(
    db: AsyncSession, job_id: uuid.UUID
) -> Optional[CompanyJobAssignment]:
    result = await db.execute(
        select(CompanyJobAssignment).where(CompanyJobAssignment.job_id == job_id)
    )
    return result.scalar_one_or_none()


async def claim_job(
    db: AsyncSession,
    *,
    company: Company,
    supervisor_user_id: uuid.UUID,
    job_id: uuid.UUID,
) -> CompanyJobAssignment:
    """Claim a job on behalf of the company. Validates the job is claimable,
    the task is enabled, and the job is not already claimed."""
    job = await db.get(Job, job_id)
    if job is None:
        raise AssignmentError("Job not found.")
    if job.status not in CLAIMABLE_JOB_STATUSES:
        raise AssignmentError("This job is not available to be claimed.")

    existing = await get_assignment_for_job(db, job_id)
    if existing is not None:
        raise AssignmentError("This job has already been claimed.")

    enabled = await db.execute(
        select(CompanyService.task_id).where(
            CompanyService.company_id == company.id,
            CompanyService.task_id == job.task_id,
        )
    )
    if enabled.scalar_one_or_none() is None:
        raise AssignmentError("This job's task is not enabled for your company.")

    assignment = CompanyJobAssignment(
        job_id=job.id,
        company_id=company.id,
        claimed_by=supervisor_user_id,
        status=CompanyJobStatus.CLAIMED,
        payout_target=CompanyPayoutTarget.COMPANY,
        claimed_at=datetime.now(timezone.utc),
    )
    db.add(assignment)
    await db.flush()
    return assignment


# ---------------------------------------------------------------------------
# Eligible collaborators
# ---------------------------------------------------------------------------


def task_requires_credential(task: ServiceTask) -> bool:
    return bool(task.license_required or task.certification_required)


async def list_eligible_collaborators(
    db: AsyncSession, *, company_id: uuid.UUID, task_id: uuid.UUID
) -> list[dict]:
    """Return active collaborators of the company who may take the task.

    For a credential-requiring task, only collaborators whose provider profile
    holds a VERIFIED ``ProviderCredential`` for that ``task_id`` are eligible.
    For a non-credential task every active collaborator is eligible.
    """
    task = await db.get(ServiceTask, task_id)
    if task is None:
        raise AssignmentError("Task not found.")
    requires_cred = task_requires_credential(task)

    # Active collaborators that own a provider profile.
    rows = await db.execute(
        select(CompanyMember, ProviderProfile, User)
        .join(ProviderProfile, ProviderProfile.user_id == CompanyMember.user_id)
        .join(User, User.id == CompanyMember.user_id)
        .where(
            CompanyMember.company_id == company_id,
            CompanyMember.role == CompanyMemberRole.COLLABORATOR,
            CompanyMember.status == CompanyMemberStatus.ACTIVE,
        )
    )
    candidates = rows.all()
    if not candidates:
        return []

    # Map provider_id -> True if they hold a VERIFIED credential for this task.
    provider_ids = [pp.id for (_m, pp, _u) in candidates]
    verified_provider_ids: set[uuid.UUID] = set()
    if requires_cred:
        cred_rows = await db.execute(
            select(ProviderCredential.provider_id).where(
                ProviderCredential.provider_id.in_(provider_ids),
                ProviderCredential.task_id == task_id,
                ProviderCredential.status == CredentialStatus.VERIFIED,
            )
        )
        verified_provider_ids = {row[0] for row in cred_rows.all()}

    eligible: list[dict] = []
    for (_member, profile, user) in candidates:
        has_cred = profile.id in verified_provider_ids
        if requires_cred and not has_cred:
            continue
        eligible.append(
            {
                "user_id": user.id,
                "email": user.email,
                "provider_id": profile.id,
                "has_required_credential": has_cred if requires_cred else True,
            }
        )
    return eligible


# ---------------------------------------------------------------------------
# Assign
# ---------------------------------------------------------------------------


async def assign_to_collaborator(
    db: AsyncSession,
    *,
    assignment: CompanyJobAssignment,
    collaborator_user_id: uuid.UUID,
) -> CompanyJobAssignment:
    """Assign a claimed job to an eligible collaborator (validates credentials)."""
    if assignment.status not in (CompanyJobStatus.CLAIMED, CompanyJobStatus.DECLINED):
        raise AssignmentError("This assignment cannot be (re)assigned in its current state.")

    job = await db.get(Job, assignment.job_id)
    if job is None:
        raise AssignmentError("Job not found.")

    eligible = await list_eligible_collaborators(
        db, company_id=assignment.company_id, task_id=job.task_id
    )
    if not any(c["user_id"] == collaborator_user_id for c in eligible):
        raise AssignmentError(
            "Collaborator is not eligible for this task "
            "(must be an active collaborator with the required credential)."
        )

    assignment.assigned_collaborator_id = collaborator_user_id
    assignment.status = CompanyJobStatus.ASSIGNED
    assignment.assigned_at = datetime.now(timezone.utc)
    assignment.responded_at = None
    assignment.decline_reason = None
    await db.flush()
    return assignment


# ---------------------------------------------------------------------------
# Collaborator accept / decline
# ---------------------------------------------------------------------------


async def list_my_assignments(
    db: AsyncSession, collaborator_user_id: uuid.UUID
) -> list[CompanyJobAssignment]:
    result = await db.execute(
        select(CompanyJobAssignment)
        .where(CompanyJobAssignment.assigned_collaborator_id == collaborator_user_id)
        .order_by(CompanyJobAssignment.assigned_at.desc())
    )
    return list(result.scalars().all())


async def get_assignment(
    db: AsyncSession, assignment_id: uuid.UUID
) -> Optional[CompanyJobAssignment]:
    result = await db.execute(
        select(CompanyJobAssignment).where(CompanyJobAssignment.id == assignment_id)
    )
    return result.scalar_one_or_none()


async def collaborator_accept(
    db: AsyncSession,
    *,
    assignment: CompanyJobAssignment,
    collaborator_user_id: uuid.UUID,
) -> CompanyJobAssignment:
    if assignment.assigned_collaborator_id != collaborator_user_id:
        raise AssignmentError("This assignment is not assigned to you.")
    if assignment.status != CompanyJobStatus.ASSIGNED:
        raise AssignmentError("This assignment cannot be accepted in its current state.")
    assignment.status = CompanyJobStatus.ACCEPTED
    assignment.responded_at = datetime.now(timezone.utc)
    await db.flush()
    return assignment


async def collaborator_decline(
    db: AsyncSession,
    *,
    assignment: CompanyJobAssignment,
    collaborator_user_id: uuid.UUID,
    reason: Optional[str] = None,
) -> CompanyJobAssignment:
    if assignment.assigned_collaborator_id != collaborator_user_id:
        raise AssignmentError("This assignment is not assigned to you.")
    if assignment.status != CompanyJobStatus.ASSIGNED:
        raise AssignmentError("This assignment cannot be declined in its current state.")
    assignment.status = CompanyJobStatus.DECLINED
    assignment.responded_at = datetime.now(timezone.utc)
    assignment.decline_reason = reason
    await db.flush()
    return assignment


# ---------------------------------------------------------------------------
# Payout resolution
# ---------------------------------------------------------------------------


async def resolve_payout_account(db: AsyncSession, job_id: uuid.UUID) -> Optional[str]:
    """Return the Stripe account that should receive the payout for ``job_id``.

    If the job is a company assignment with payout_target COMPANY, this is the
    company's ``stripe_account_id``. Returns ``None`` if the job is not a
    company assignment (the caller then falls back to the provider account —
    the existing provider path is unchanged).
    """
    assignment = await get_assignment_for_job(db, job_id)
    if assignment is None or assignment.payout_target != CompanyPayoutTarget.COMPANY:
        return None
    company = await db.get(Company, assignment.company_id)
    if company is None:
        return None
    return company.stripe_account_id
