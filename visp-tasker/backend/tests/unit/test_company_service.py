import uuid
from datetime import datetime, timedelta, timezone

import pytest

from src.services import company_service
from src.models.company import (
    Company,
    CompanyInvite,
    CompanyInviteStatus,
    CompanyMember,
    CompanyMemberRole,
)


def test_generate_invite_code_format():
    code = company_service.generate_invite_code()
    assert isinstance(code, str)
    assert len(code) == 8
    assert all(c in company_service._CODE_ALPHABET for c in code)


def test_generate_invite_code_is_random():
    codes = {company_service.generate_invite_code() for _ in range(50)}
    assert len(codes) > 45


@pytest.mark.asyncio
async def test_create_company_adds_company_and_admin_member(mock_db, sample_provider_user):
    from src.api.schemas.company import CompanyCreateIn
    from src.models.company import CompanyStatus

    payload = CompanyCreateIn(legal_name="Acme Cleaning Inc.", phone="4165551234")
    company = await company_service.create_company(mock_db, sample_provider_user, payload)

    assert company.legal_name == "Acme Cleaning Inc."
    assert company.status == CompanyStatus.DRAFT
    added = [c.args[0] for c in mock_db.add.call_args_list]
    assert any(isinstance(o, Company) for o in added)
    member = next(o for o in added if isinstance(o, CompanyMember))
    assert member.role == CompanyMemberRole.ADMIN
    assert member.user_id == sample_provider_user.id


def _make_invite(**kw):
    inv = CompanyInvite(
        company_id=uuid.uuid4(),
        email="juan@example.com",
        role=CompanyMemberRole.COLLABORATOR,
        code="ABCD2345",
        status=CompanyInviteStatus.PENDING,
        expires_at=datetime.now(timezone.utc) + timedelta(days=1),
    )
    for k, v in kw.items():
        setattr(inv, k, v)
    return inv


def test_validate_invite_ok():
    inv = _make_invite()
    company_service.assert_invite_redeemable(inv, "juan@example.com")


def test_validate_invite_expired():
    inv = _make_invite(expires_at=datetime.now(timezone.utc) - timedelta(minutes=1))
    with pytest.raises(ValueError, match="expired"):
        company_service.assert_invite_redeemable(inv, "juan@example.com")


def test_validate_invite_already_redeemed():
    inv = _make_invite(status=CompanyInviteStatus.REDEEMED)
    with pytest.raises(ValueError, match="already"):
        company_service.assert_invite_redeemable(inv, "juan@example.com")


def test_validate_invite_email_mismatch():
    inv = _make_invite()
    with pytest.raises(ValueError, match="email"):
        company_service.assert_invite_redeemable(inv, "someoneelse@example.com")
