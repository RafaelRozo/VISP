"""
Routes for the company supervisor->collaborator job-assignment flow
(VISP for Business, SP4 Stage 1).

ADDITIVE ONLY — mirrors the shape of the provider routes but never touches the
provider matching/offer endpoints. Supervisor/admin endpoints are guarded so
only an active admin/supervisor of a *validated* company can claim/assign;
collaborator endpoints only allow the assigned collaborator to accept/decline.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException, status

from src.api.deps import CurrentUser, DBSession
from src.api.schemas.company import (
    AssignToCollaboratorIn,
    DeclineAssignmentIn,
)
from src.services import company_assignment_service as svc

router = APIRouter(prefix="/companies", tags=["Company Job Assignments"])


def _assignment_to_dict(a) -> dict:
    return {
        "id": str(a.id),
        "job_id": str(a.job_id),
        "company_id": str(a.company_id),
        "claimed_by": str(a.claimed_by),
        "assigned_collaborator_id": str(a.assigned_collaborator_id)
        if a.assigned_collaborator_id
        else None,
        "status": a.status.value,
        "payout_target": a.payout_target.value,
        "decline_reason": a.decline_reason,
    }


# ===========================================================================
# Supervisor / admin endpoints
# ===========================================================================


@router.get("/{company_id}/claimable-jobs")
async def list_claimable_jobs(db: DBSession, user: CurrentUser, company_id: uuid.UUID):
    try:
        company = await svc.require_validated_company(db, company_id)
        await svc.require_supervisor(db, company_id, user.id)
    except svc.AssignmentError as exc:
        raise HTTPException(status_code=403, detail=str(exc))

    jobs = await svc.list_claimable_jobs(db, company.id)
    return {
        "data": [
            {
                "job_id": str(j.id),
                "reference_number": j.reference_number,
                "task_id": str(j.task_id),
                "task_name": j.task.name if j.task else None,
                "status": j.status.value,
                "service_city": j.service_city,
                "requested_date": j.requested_date.isoformat() if j.requested_date else None,
            }
            for j in jobs
        ]
    }


@router.post("/{company_id}/jobs/{job_id}/claim", status_code=status.HTTP_201_CREATED)
async def claim_job(
    db: DBSession, user: CurrentUser, company_id: uuid.UUID, job_id: uuid.UUID
):
    try:
        company = await svc.require_validated_company(db, company_id)
        await svc.require_supervisor(db, company_id, user.id)
        assignment = await svc.claim_job(
            db, company=company, supervisor_user_id=user.id, job_id=job_id
        )
    except svc.AssignmentError as exc:
        # 403 for authorization failures, 400 for claim-state failures.
        msg = str(exc)
        code = 403 if ("not validated" in msg or "not an active member" in msg or
                       "admin or supervisor" in msg) else 400
        raise HTTPException(status_code=code, detail=msg)
    return {"data": _assignment_to_dict(assignment)}


@router.get("/{company_id}/jobs/{job_id}/eligible-collaborators")
async def list_eligible_collaborators(
    db: DBSession, user: CurrentUser, company_id: uuid.UUID, job_id: uuid.UUID
):
    try:
        await svc.require_validated_company(db, company_id)
        await svc.require_supervisor(db, company_id, user.id)
    except svc.AssignmentError as exc:
        raise HTTPException(status_code=403, detail=str(exc))

    assignment = await svc.get_assignment_for_job(db, job_id)
    if assignment is None or assignment.company_id != company_id:
        raise HTTPException(status_code=404, detail="This job is not claimed by your company.")

    from src.models.job import Job

    job = await db.get(Job, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found.")

    try:
        eligible = await svc.list_eligible_collaborators(
            db, company_id=company_id, task_id=job.task_id
        )
    except svc.AssignmentError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    return {
        "data": [
            {
                "user_id": str(c["user_id"]),
                "email": c["email"],
                "provider_id": str(c["provider_id"]),
                "has_required_credential": c["has_required_credential"],
            }
            for c in eligible
        ]
    }


@router.post("/{company_id}/jobs/{job_id}/assign")
async def assign_to_collaborator(
    db: DBSession,
    user: CurrentUser,
    company_id: uuid.UUID,
    job_id: uuid.UUID,
    payload: AssignToCollaboratorIn,
):
    try:
        await svc.require_validated_company(db, company_id)
        await svc.require_supervisor(db, company_id, user.id)
    except svc.AssignmentError as exc:
        raise HTTPException(status_code=403, detail=str(exc))

    assignment = await svc.get_assignment_for_job(db, job_id)
    if assignment is None or assignment.company_id != company_id:
        raise HTTPException(status_code=404, detail="This job is not claimed by your company.")

    try:
        assignment = await svc.assign_to_collaborator(
            db, assignment=assignment, collaborator_user_id=payload.collaborator_user_id
        )
    except svc.AssignmentError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"data": _assignment_to_dict(assignment)}


# ===========================================================================
# Collaborator endpoints
# ===========================================================================


@router.get("/my-assignments")
async def list_my_assignments(db: DBSession, user: CurrentUser):
    assignments = await svc.list_my_assignments(db, user.id)
    return {"data": [_assignment_to_dict(a) for a in assignments]}


@router.post("/assignments/{assignment_id}/accept")
async def accept_assignment(db: DBSession, user: CurrentUser, assignment_id: uuid.UUID):
    assignment = await svc.get_assignment(db, assignment_id)
    if assignment is None:
        raise HTTPException(status_code=404, detail="Assignment not found.")
    try:
        assignment = await svc.collaborator_accept(
            db, assignment=assignment, collaborator_user_id=user.id
        )
    except svc.AssignmentError as exc:
        msg = str(exc)
        code = 403 if "not assigned to you" in msg else 400
        raise HTTPException(status_code=code, detail=msg)
    return {"data": _assignment_to_dict(assignment)}


@router.post("/assignments/{assignment_id}/decline")
async def decline_assignment(
    db: DBSession,
    user: CurrentUser,
    assignment_id: uuid.UUID,
    payload: DeclineAssignmentIn,
):
    assignment = await svc.get_assignment(db, assignment_id)
    if assignment is None:
        raise HTTPException(status_code=404, detail="Assignment not found.")
    try:
        assignment = await svc.collaborator_decline(
            db, assignment=assignment, collaborator_user_id=user.id, reason=payload.reason
        )
    except svc.AssignmentError as exc:
        msg = str(exc)
        code = 403 if "not assigned to you" in msg else 400
        raise HTTPException(status_code=code, detail=msg)
    return {"data": _assignment_to_dict(assignment)}


# ===========================================================================
# Customer endpoint — see which collaborator was assigned
# ===========================================================================


@router.get("/jobs/{job_id}/assigned-collaborator")
async def get_assigned_collaborator(db: DBSession, user: CurrentUser, job_id: uuid.UUID):
    """Customer-facing: which collaborator (and company) was assigned a job."""
    from src.models.job import Job

    job = await db.get(Job, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found.")
    if job.customer_id != user.id:
        raise HTTPException(status_code=403, detail="You cannot view this job.")

    assignment = await svc.get_assignment_for_job(db, job_id)
    if assignment is None:
        return {"data": None}

    # Additive: resolve the assigned collaborator's name (null when not yet
    # assigned). Explicit fetch on the users table to avoid async lazy-load.
    first_name: str | None = None
    last_name: str | None = None
    collaborator_name: str | None = None
    if assignment.assigned_collaborator_id is not None:
        from src.models.user import User

        collaborator = await db.get(User, assignment.assigned_collaborator_id)
        if collaborator is not None:
            first_name = collaborator.first_name
            last_name = collaborator.last_name
            last_initial = (
                f" {last_name[0]}." if last_name else ""
            )
            collaborator_name = f"{first_name}{last_initial}".strip() or None

    return {
        "data": {
            "company_id": str(assignment.company_id),
            "assigned_collaborator_id": str(assignment.assigned_collaborator_id)
            if assignment.assigned_collaborator_id
            else None,
            "status": assignment.status.value,
            "collaborator_first_name": first_name,
            "collaborator_last_name": last_name,
            "collaborator_name": collaborator_name,
        }
    }
