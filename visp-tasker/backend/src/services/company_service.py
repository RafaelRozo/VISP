"""Business logic for VISP for Business (SP1)."""

from __future__ import annotations

import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from src.models.company import (
    Company,
    CompanyDocument,
    CompanyDocumentStatus,
    CompanyDocumentType,
    CompanyInvite,
    CompanyInviteStatus,
    CompanyMember,
    CompanyMemberRole,
    CompanyMemberStatus,
    CompanyService,
    CompanyStatus,
)
from src.models.taxonomy import ServiceTask

_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
_INVITE_TTL_DAYS = 14


def generate_invite_code(length: int = 8) -> str:
    """Return a random, human-friendly uppercase invite code."""
    return "".join(secrets.choice(_CODE_ALPHABET) for _ in range(length))


async def create_company(db: AsyncSession, user, payload) -> Company:
    """Create a company in DRAFT and make the creator its ADMIN member."""
    company = Company(
        legal_name=payload.legal_name,
        trade_name=payload.trade_name,
        business_address=payload.business_address,
        phone=payload.phone,
        email=str(payload.email) if payload.email else None,
        website=payload.website,
        status=CompanyStatus.DRAFT,
    )
    db.add(company)
    await db.flush()

    member = CompanyMember(
        company_id=company.id,
        user_id=user.id,
        role=CompanyMemberRole.ADMIN,
        status=CompanyMemberStatus.ACTIVE,
    )
    db.add(member)
    await db.flush()
    return company


def assert_invite_redeemable(invite: CompanyInvite, user_email: str) -> None:
    """Raise ValueError if the invite cannot be redeemed by ``user_email``."""
    if invite.status == CompanyInviteStatus.REDEEMED:
        raise ValueError("This invite has already been redeemed.")
    if invite.status == CompanyInviteStatus.EXPIRED:
        raise ValueError("This invite has expired.")
    now = datetime.now(timezone.utc)
    expires = invite.expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if expires < now:
        raise ValueError("This invite has expired.")
    if invite.email.strip().lower() != user_email.strip().lower():
        raise ValueError("This invite was issued for a different email address.")


async def get_my_company(db: AsyncSession, user) -> Optional[Company]:
    """Return the company the user belongs to (first membership), or None."""
    result = await db.execute(
        select(Company)
        .join(CompanyMember, CompanyMember.company_id == Company.id)
        .where(CompanyMember.user_id == user.id)
        .options(
            selectinload(Company.members).selectinload(CompanyMember.user),
            selectinload(Company.documents),
        )
        .limit(1)
    )
    return result.scalar_one_or_none()


async def get_member(db: AsyncSession, company_id: uuid.UUID, user_id: uuid.UUID):
    result = await db.execute(
        select(CompanyMember)
        .where(
            CompanyMember.company_id == company_id,
            CompanyMember.user_id == user_id,
        )
        .options(selectinload(CompanyMember.user))
    )
    return result.scalar_one_or_none()


async def add_document(db: AsyncSession, company: Company, doc_type: str, url: str, file_hash: str | None) -> CompanyDocument:
    doc = CompanyDocument(
        company_id=company.id,
        doc_type=CompanyDocumentType(doc_type),
        document_url=url,
        document_hash=file_hash,
        status=CompanyDocumentStatus.PENDING,
    )
    db.add(doc)
    await db.flush()
    return doc


async def submit_for_review(db: AsyncSession, company: Company) -> Company:
    if company.status not in (CompanyStatus.DRAFT, CompanyStatus.REJECTED):
        raise ValueError("Company can only be submitted from draft or rejected state.")
    company.status = CompanyStatus.PENDING_REVIEW
    company.rejection_reason = None
    await db.flush()
    return company


async def set_services(db: AsyncSession, company: Company, *, all_tasks: bool, task_ids: list[uuid.UUID]) -> list[uuid.UUID]:
    """Replace the company's enabled services."""
    existing = await db.execute(
        select(CompanyService).where(CompanyService.company_id == company.id)
    )
    for row in existing.scalars().all():
        await db.delete(row)

    if all_tasks:
        ids_result = await db.execute(select(ServiceTask.id))
        task_ids = [row[0] for row in ids_result.all()]

    for tid in task_ids:
        db.add(CompanyService(company_id=company.id, task_id=tid))
    await db.flush()
    return task_ids


async def create_invite(db: AsyncSession, company: Company, email: str, role: str) -> CompanyInvite:
    invite = CompanyInvite(
        company_id=company.id,
        email=email.strip().lower(),
        role=CompanyMemberRole(role),
        code=generate_invite_code(),
        status=CompanyInviteStatus.PENDING,
        expires_at=datetime.now(timezone.utc) + timedelta(days=_INVITE_TTL_DAYS),
    )
    db.add(invite)
    await db.flush()
    return invite


async def redeem_invite(db: AsyncSession, user, code: str) -> CompanyMember:
    result = await db.execute(select(CompanyInvite).where(CompanyInvite.code == code.strip().upper()))
    invite = result.scalar_one_or_none()
    if invite is None:
        raise ValueError("Invalid invite code.")
    assert_invite_redeemable(invite, user.email)

    member = CompanyMember(
        company_id=invite.company_id,
        user_id=user.id,
        role=invite.role,
        status=CompanyMemberStatus.ACTIVE,
    )
    db.add(member)
    invite.status = CompanyInviteStatus.REDEEMED
    invite.redeemed_by = user.id
    await db.flush()
    return member


async def list_invites(db: AsyncSession, company_id: uuid.UUID) -> list[CompanyInvite]:
    """Return all invites for a company, newest first."""
    result = await db.execute(
        select(CompanyInvite)
        .where(CompanyInvite.company_id == company_id)
        .order_by(CompanyInvite.created_at.desc())
    )
    return list(result.scalars().all())


async def revoke_invite(db: AsyncSession, company_id: uuid.UUID, invite_id: uuid.UUID) -> None:
    """Delete a PENDING invite that belongs to ``company_id``.

    Raises LookupError if the invite is not found / not this company's, and
    ValueError if it has already been redeemed.
    """
    result = await db.execute(select(CompanyInvite).where(CompanyInvite.id == invite_id))
    invite = result.scalar_one_or_none()
    if invite is None or invite.company_id != company_id:
        raise LookupError("Invite not found.")
    if invite.status == CompanyInviteStatus.REDEEMED:
        raise ValueError("This invite has already been redeemed.")
    await db.delete(invite)
    await db.flush()


async def remove_member(
    db: AsyncSession,
    company_id: uuid.UUID,
    member_id: uuid.UUID,
    acting_user_id: uuid.UUID,
) -> CompanyMember:
    """Disable (soft-remove) a member of ``company_id``.

    Status is set to DISABLED rather than hard-deleting so membership history
    is preserved. Guards: a member cannot remove themselves, and the last
    remaining active ADMIN cannot be removed.

    Raises LookupError if the member is not found / not this company's, and
    ValueError on a guard violation.
    """
    result = await db.execute(select(CompanyMember).where(CompanyMember.id == member_id))
    member = result.scalar_one_or_none()
    if member is None or member.company_id != company_id:
        raise LookupError("Member not found.")
    if member.status == CompanyMemberStatus.DISABLED:
        raise ValueError("This member is already disabled.")
    if member.user_id == acting_user_id:
        raise ValueError("You cannot remove yourself from the company.")

    if member.role == CompanyMemberRole.ADMIN:
        active_admins = await db.execute(
            select(CompanyMember).where(
                CompanyMember.company_id == company_id,
                CompanyMember.role == CompanyMemberRole.ADMIN,
                CompanyMember.status == CompanyMemberStatus.ACTIVE,
            )
        )
        if len(active_admins.scalars().all()) <= 1:
            raise ValueError("Cannot remove the last remaining admin.")

    member.status = CompanyMemberStatus.DISABLED
    await db.flush()
    return member


async def get_enabled_task_ids(db: AsyncSession, company_id: uuid.UUID) -> list[uuid.UUID]:
    result = await db.execute(
        select(CompanyService.task_id).where(CompanyService.company_id == company_id)
    )
    return [row[0] for row in result.all()]


async def list_companies_by_status(db: AsyncSession, status: Optional[str]) -> list[Company]:
    stmt = select(Company)
    if status:
        stmt = stmt.where(Company.status == CompanyStatus(status))
    result = await db.execute(stmt.order_by(Company.created_at.desc()))
    return list(result.scalars().all())


async def get_company(db: AsyncSession, company_id: uuid.UUID) -> Optional[Company]:
    result = await db.execute(
        select(Company).where(Company.id == company_id).options(selectinload(Company.documents))
    )
    return result.scalar_one_or_none()


async def review_document(db: AsyncSession, doc_id: uuid.UUID, admin_id: uuid.UUID, *, approve: bool, reason: str | None) -> CompanyDocument:
    result = await db.execute(select(CompanyDocument).where(CompanyDocument.id == doc_id))
    doc = result.scalar_one_or_none()
    if doc is None:
        raise ValueError("Document not found.")
    doc.status = CompanyDocumentStatus.APPROVED if approve else CompanyDocumentStatus.REJECTED
    doc.verified_by = admin_id
    doc.verified_at = datetime.now(timezone.utc)
    doc.rejection_reason = None if approve else reason
    await db.flush()
    return doc


async def set_company_validation(db: AsyncSession, company: Company, *, validated: bool, reason: str | None) -> Company:
    company.status = CompanyStatus.VALIDATED if validated else CompanyStatus.REJECTED
    company.rejection_reason = None if validated else reason
    await db.flush()
    return company
