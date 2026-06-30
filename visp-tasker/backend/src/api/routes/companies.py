"""User-facing routes for VISP for Business (SP1)."""

from __future__ import annotations

import hashlib
import uuid

from fastapi import APIRouter, File, Form, HTTPException, UploadFile, status

from src.api.deps import CurrentUser, DBSession
from src.api.schemas.company import (
    CompanyCreateIn,
    CompanyInviteIn,
    CompanyServicesIn,
    RedeemInviteIn,
)
from src.services import company_service
from src.services.file_service import save_upload_file

router = APIRouter(prefix="/companies", tags=["Companies"])


def _member_to_out(m):
    """Serialize a CompanyMember, enriching it with the linked user's identity.

    Guards against ``m.user`` being None (e.g. a user row that was hard-deleted)
    so serialization never crashes.
    """
    u = getattr(m, "user", None)
    return {
        "id": str(m.id),
        "user_id": str(m.user_id),
        "role": m.role.value,
        "status": m.status.value,
        "first_name": u.first_name if u else None,
        "last_name": u.last_name if u else None,
        "display_name": u.display_name if u else None,
        "email": u.email if u else None,
    }


def _company_to_out(company, enabled_task_ids, enabled_services=None):
    return {
        "data": {
            "services": enabled_services or [],
            "id": str(company.id),
            "legal_name": company.legal_name,
            "trade_name": company.trade_name,
            "status": company.status.value,
            "stripe_account_id": company.stripe_account_id,
            "rejection_reason": company.rejection_reason,
            # Fiscal address + tax (read-only on the dashboard).
            "fiscal_address_line1": company.fiscal_address_line1,
            "fiscal_address_line2": company.fiscal_address_line2,
            "fiscal_city": company.fiscal_city,
            "fiscal_province": company.fiscal_province,
            "fiscal_postal_code": company.fiscal_postal_code,
            "fiscal_country": company.fiscal_country,
            "tax_registered": company.tax_registered,
            "tax_number": company.tax_number,
            "members": [_member_to_out(m) for m in (company.members or [])],
            "documents": [
                {"id": str(d.id), "doc_type": d.doc_type.value, "status": d.status.value,
                 "document_url": d.document_url, "rejection_reason": d.rejection_reason}
                for d in (company.documents or [])
            ],
            "enabled_task_ids": [str(t) for t in enabled_task_ids],
        }
    }


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_company(db: DBSession, user: CurrentUser, payload: CompanyCreateIn):
    existing = await company_service.get_my_company(db, user)
    if existing is not None:
        raise HTTPException(status_code=400, detail="You already belong to a company.")
    await company_service.create_company(db, user, payload)
    # Re-fetch through get_my_company so the members/documents relationships are
    # eager-loaded (selectinload); serializing the freshly-created instance would
    # otherwise trigger a lazy load outside the async greenlet context.
    company = await company_service.get_my_company(db, user)
    return _company_to_out(company, [])


@router.get("/me")
async def get_my_company(db: DBSession, user: CurrentUser):
    company = await company_service.get_my_company(db, user)
    if company is None:
        raise HTTPException(status_code=404, detail="No company for this user.")
    enabled = await company_service.get_enabled_task_ids(db, company.id)
    services = await company_service.get_enabled_services(db, company.id)
    return _company_to_out(company, enabled, services)


@router.post("/me/documents", status_code=status.HTTP_201_CREATED)
async def upload_document(db: DBSession, user: CurrentUser, doc_type: str = Form(...), file: UploadFile = File(...)):
    company = await company_service.get_my_company(db, user)
    if company is None:
        raise HTTPException(status_code=404, detail="No company for this user.")
    contents = await file.read()
    file_hash = hashlib.sha256(contents).hexdigest()
    await file.seek(0)
    url = await save_upload_file(file)
    try:
        doc = await company_service.add_document(db, company, doc_type, url, file_hash)
    except ValueError:
        raise HTTPException(status_code=400, detail="Unknown document type.")
    return {"data": {"id": str(doc.id), "doc_type": doc.doc_type.value, "status": doc.status.value}}


@router.post("/me/submit")
async def submit_company(db: DBSession, user: CurrentUser):
    company = await company_service.get_my_company(db, user)
    if company is None:
        raise HTTPException(status_code=404, detail="No company for this user.")
    try:
        company = await company_service.submit_for_review(db, company)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"data": {"status": company.status.value}}


@router.put("/me/services")
async def set_services(db: DBSession, user: CurrentUser, payload: CompanyServicesIn):
    company = await company_service.get_my_company(db, user)
    if company is None:
        raise HTTPException(status_code=404, detail="No company for this user.")
    try:
        enabled = await company_service.set_services(
            db, company, all_tasks=payload.all, task_ids=payload.task_ids, services=payload.services,
        )
    except company_service.CompanyRateOutOfRangeError as exc:
        raise HTTPException(
            status_code=422,
            detail={
                "error": "price_out_of_range",
                "taskId": str(exc.task_id),
                "minCents": exc.min_cents,
                "maxCents": exc.max_cents,
            },
        )
    services = await company_service.get_enabled_services(db, company.id)
    return {"data": {"enabled_task_ids": [str(t) for t in enabled], "services": services}}


@router.post("/me/invites", status_code=status.HTTP_201_CREATED)
async def create_invite(db: DBSession, user: CurrentUser, payload: CompanyInviteIn):
    company = await company_service.get_my_company(db, user)
    if company is None:
        raise HTTPException(status_code=404, detail="No company for this user.")
    member = await company_service.get_member(db, company.id, user.id)
    if member is None or member.role.value != "admin":
        raise HTTPException(status_code=403, detail="Only a company admin can invite members.")
    invite = await company_service.create_invite(db, company, payload.email, payload.role)
    return {"data": {"id": str(invite.id), "email": invite.email, "role": invite.role.value,
                     "code": invite.code, "status": invite.status.value,
                     "expires_at": invite.expires_at.isoformat()}}


async def _require_admin_company(db, user):
    """Return (company, member) for the caller, asserting they are an admin.

    Raises 404 if the caller has no company, 403 if they are not an admin.
    """
    company = await company_service.get_my_company(db, user)
    if company is None:
        raise HTTPException(status_code=404, detail="No company for this user.")
    member = await company_service.get_member(db, company.id, user.id)
    if member is None or member.role.value != "admin":
        raise HTTPException(status_code=403, detail="Only a company admin can manage members.")
    return company, member


@router.get("/me/invites")
async def list_invites(db: DBSession, user: CurrentUser):
    company, _ = await _require_admin_company(db, user)
    invites = await company_service.list_invites(db, company.id)
    return {
        "data": [
            {
                "id": str(inv.id),
                "email": inv.email,
                "role": inv.role.value,
                "code": inv.code,
                "status": inv.status.value,
                "expires_at": inv.expires_at.isoformat(),
                "created_at": inv.created_at.isoformat() if inv.created_at else None,
            }
            for inv in invites
        ]
    }


@router.delete("/me/invites/{invite_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_invite(db: DBSession, user: CurrentUser, invite_id: str):
    company, _ = await _require_admin_company(db, user)
    try:
        invite_uuid = uuid.UUID(invite_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Invite not found.")
    try:
        await company_service.revoke_invite(db, company.id, invite_uuid)
    except LookupError:
        raise HTTPException(status_code=404, detail="Invite not found.")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return None


@router.delete("/me/members/{member_id}")
async def remove_member(db: DBSession, user: CurrentUser, member_id: str):
    company, _ = await _require_admin_company(db, user)
    try:
        member_uuid = uuid.UUID(member_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Member not found.")
    try:
        member = await company_service.remove_member(db, company.id, member_uuid, user.id)
    except LookupError:
        raise HTTPException(status_code=404, detail="Member not found.")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"data": {"id": str(member.id), "status": member.status.value}}


@router.post("/redeem-invite")
async def redeem_invite(db: DBSession, user: CurrentUser, payload: RedeemInviteIn):
    try:
        member = await company_service.redeem_invite(db, user, payload.code)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"data": {"company_id": str(member.company_id), "role": member.role.value}}
