# VISP for Business — SP1 (Backend Multi-Tenant Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the backend foundation for company tenants — models, migration, and base CRUD endpoints for `companies`, `company_members`, `company_documents`, `company_services`, `company_invites` — so companies can register, upload documents, be validated by admins, enable services, and invite collaborators.

**Architecture:** Follow existing VISP backend conventions exactly. New raw-SQL migration `019` (against dev DB `Visp2026`), one new model module `company.py`, one Pydantic schema module, one service module, one user-facing router, and company-validation endpoints in the admin router. Collaborators reuse `provider_profiles`; payouts target the company's `stripe_account_id` (wiring deferred to SP4). Native PG enums store **uppercase member names** (matching `CredentialStatus`).

**Tech Stack:** Python 3.11, FastAPI, async SQLAlchemy 2.0 (`Mapped`/`mapped_column`), PostgreSQL (asyncpg), Pydantic v2, pytest (`mock_db` AsyncMock fixture).

**Dev DB:** `postgresql+asyncpg://Droz:Droz.2026@192.168.1.94:5432/Visp2026` (full clone of `visp_tasker`). Apply migration here; never touch `visp_tasker`.

**Out of scope (SP4):** supervisor→collaborator assignment flow, payout routing inside the job lifecycle, any web/mobile UI.

---

## File Structure

- **Create** `backend/migrations/019_visp_for_business.sql` — 7 enum types + 5 tables.
- **Create** `backend/src/models/company.py` — `Company`, `CompanyMember`, `CompanyDocument`, `CompanyService`, `CompanyInvite` + their enums.
- **Modify** `backend/src/models/__init__.py` — register the new models/enums.
- **Create** `backend/src/api/schemas/company.py` — Pydantic request/response models.
- **Create** `backend/src/services/company_service.py` — business logic (create, members, invites, services, documents, validation).
- **Create** `backend/src/api/routes/companies.py` — user-facing router (`/companies`).
- **Modify** `backend/src/api/routes/admin.py` — add company-validation endpoints.
- **Modify** `backend/src/main.py` — register the `companies` router.
- **Create** `backend/tests/unit/test_company_service.py` — service-layer unit tests (mock_db).

Enum member-name convention (UPPERCASE, stored as-is by SQLAlchemy):
- `company_status`: `DRAFT, PENDING_REVIEW, VALIDATED, REJECTED`
- `company_member_role`: `ADMIN, SUPERVISOR, COLLABORATOR`
- `company_member_status`: `ACTIVE, INVITED, DISABLED`
- `company_document_type`: `LEGAL_INFO, BUSINESS_REGISTRATION, BUSINESS_NUMBER_TAX, OWNER_ID, AUTHORITY_PROOF, ADDRESS_PROOF, BANKING, INSURANCE, LICENSE_CERT, OPERATIONAL_PROFILE`
- `company_document_status`: `PENDING, APPROVED, REJECTED`
- `company_invite_status`: `PENDING, REDEEMED, EXPIRED`
- (invites reuse `company_member_role` for the assigned role)

---

## Task 1: Migration 019 — enums + tables

**Files:**
- Create: `backend/migrations/019_visp_for_business.sql`

- [ ] **Step 1: Write the migration SQL**

Create `backend/migrations/019_visp_for_business.sql`:

```sql
-- ============================================================================
-- Migration 019 — VISP for Business (multi-tenant foundation, SP1)
-- ============================================================================
-- New company tenant tables. Enum labels use UPPERCASE member names to match
-- the SQLAlchemy native-enum convention (see credential_status).
-- ============================================================================

BEGIN;

-- Enum types -----------------------------------------------------------------
CREATE TYPE company_status AS ENUM ('DRAFT', 'PENDING_REVIEW', 'VALIDATED', 'REJECTED');
CREATE TYPE company_member_role AS ENUM ('ADMIN', 'SUPERVISOR', 'COLLABORATOR');
CREATE TYPE company_member_status AS ENUM ('ACTIVE', 'INVITED', 'DISABLED');
CREATE TYPE company_document_type AS ENUM (
  'LEGAL_INFO', 'BUSINESS_REGISTRATION', 'BUSINESS_NUMBER_TAX', 'OWNER_ID',
  'AUTHORITY_PROOF', 'ADDRESS_PROOF', 'BANKING', 'INSURANCE', 'LICENSE_CERT',
  'OPERATIONAL_PROFILE'
);
CREATE TYPE company_document_status AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
CREATE TYPE company_invite_status AS ENUM ('PENDING', 'REDEEMED', 'EXPIRED');

-- companies ------------------------------------------------------------------
CREATE TABLE companies (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_name        VARCHAR(300) NOT NULL,
  trade_name        VARCHAR(300),
  business_address  TEXT,
  phone             VARCHAR(40),
  email             VARCHAR(255),
  website           VARCHAR(500),
  status            company_status NOT NULL DEFAULT 'DRAFT',
  stripe_account_id VARCHAR(255),
  rejection_reason  TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_companies_status ON companies (status);

-- company_members ------------------------------------------------------------
CREATE TABLE company_members (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        company_member_role NOT NULL DEFAULT 'COLLABORATOR',
  status      company_member_status NOT NULL DEFAULT 'ACTIVE',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_company_member UNIQUE (company_id, user_id)
);
CREATE INDEX ix_company_members_user ON company_members (user_id);

-- company_documents ----------------------------------------------------------
CREATE TABLE company_documents (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  doc_type         company_document_type NOT NULL,
  document_url     TEXT,
  document_hash    VARCHAR(128),
  status           company_document_status NOT NULL DEFAULT 'PENDING',
  verified_by      UUID REFERENCES users(id),
  verified_at      TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_company_documents_company ON company_documents (company_id);

-- company_services -----------------------------------------------------------
CREATE TABLE company_services (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  task_id     UUID NOT NULL REFERENCES service_tasks(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_company_service UNIQUE (company_id, task_id)
);

-- company_invites ------------------------------------------------------------
CREATE TABLE company_invites (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  email       VARCHAR(255) NOT NULL,
  role        company_member_role NOT NULL DEFAULT 'COLLABORATOR',
  code        VARCHAR(16) NOT NULL UNIQUE,
  status      company_invite_status NOT NULL DEFAULT 'PENDING',
  expires_at  TIMESTAMPTZ NOT NULL,
  redeemed_by UUID REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_company_invites_code ON company_invites (code);

COMMIT;
```

- [ ] **Step 2: Apply the migration to Visp2026**

Run:
```bash
PGPASSWORD='Droz.2026' psql -h 192.168.1.94 -p 5432 -U Droz -d Visp2026 \
  -v ON_ERROR_STOP=1 -f backend/migrations/019_visp_for_business.sql
```
Expected: `BEGIN ... CREATE TYPE (x6) ... CREATE TABLE (x5) ... CREATE INDEX ... COMMIT` with no ERROR.

- [ ] **Step 3: Verify tables + enums exist**

Run:
```bash
PGPASSWORD='Droz.2026' psql -h 192.168.1.94 -U Droz -d Visp2026 -tA -c \
"SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE 'company%' ORDER BY 1;"
```
Expected (5 lines): `companies, company_documents, company_invites, company_members, company_services`.

- [ ] **Step 4: Commit**

```bash
git add backend/migrations/019_visp_for_business.sql
git commit -m "feat(b2b): migration 019 — company tenant tables (SP1)"
```

---

## Task 2: SQLAlchemy models

**Files:**
- Create: `backend/src/models/company.py`
- Modify: `backend/src/models/__init__.py`

- [ ] **Step 1: Write the models module**

Create `backend/src/models/company.py`:

```python
"""
SQLAlchemy models for VISP for Business (multi-tenant foundation, SP1).
Corresponds to migration 019_visp_for_business.sql.
"""

import enum
import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import Enum, ForeignKey, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class CompanyStatus(str, enum.Enum):
    DRAFT = "draft"
    PENDING_REVIEW = "pending_review"
    VALIDATED = "validated"
    REJECTED = "rejected"


class CompanyMemberRole(str, enum.Enum):
    ADMIN = "admin"
    SUPERVISOR = "supervisor"
    COLLABORATOR = "collaborator"


class CompanyMemberStatus(str, enum.Enum):
    ACTIVE = "active"
    INVITED = "invited"
    DISABLED = "disabled"


class CompanyDocumentType(str, enum.Enum):
    LEGAL_INFO = "legal_info"
    BUSINESS_REGISTRATION = "business_registration"
    BUSINESS_NUMBER_TAX = "business_number_tax"
    OWNER_ID = "owner_id"
    AUTHORITY_PROOF = "authority_proof"
    ADDRESS_PROOF = "address_proof"
    BANKING = "banking"
    INSURANCE = "insurance"
    LICENSE_CERT = "license_cert"
    OPERATIONAL_PROFILE = "operational_profile"


class CompanyDocumentStatus(str, enum.Enum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"


class CompanyInviteStatus(str, enum.Enum):
    PENDING = "pending"
    REDEEMED = "redeemed"
    EXPIRED = "expired"


class Company(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "companies"

    legal_name: Mapped[str] = mapped_column(String(300), nullable=False)
    trade_name: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    business_address: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    phone: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    email: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    website: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    status: Mapped[CompanyStatus] = mapped_column(
        Enum(CompanyStatus, name="company_status", create_type=False),
        nullable=False,
        server_default="DRAFT",
    )
    stripe_account_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    rejection_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    members: Mapped[list["CompanyMember"]] = relationship(
        "CompanyMember", back_populates="company", cascade="all, delete-orphan"
    )
    documents: Mapped[list["CompanyDocument"]] = relationship(
        "CompanyDocument", back_populates="company", cascade="all, delete-orphan"
    )
    services: Mapped[list["CompanyService"]] = relationship(
        "CompanyService", back_populates="company", cascade="all, delete-orphan"
    )


class CompanyMember(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "company_members"
    __table_args__ = (UniqueConstraint("company_id", "user_id", name="uq_company_member"),)

    company_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    role: Mapped[CompanyMemberRole] = mapped_column(
        Enum(CompanyMemberRole, name="company_member_role", create_type=False),
        nullable=False,
        server_default="COLLABORATOR",
    )
    status: Mapped[CompanyMemberStatus] = mapped_column(
        Enum(CompanyMemberStatus, name="company_member_status", create_type=False),
        nullable=False,
        server_default="ACTIVE",
    )

    company: Mapped["Company"] = relationship("Company", back_populates="members")


class CompanyDocument(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "company_documents"

    company_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    doc_type: Mapped[CompanyDocumentType] = mapped_column(
        Enum(CompanyDocumentType, name="company_document_type", create_type=False),
        nullable=False,
    )
    document_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    document_hash: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    status: Mapped[CompanyDocumentStatus] = mapped_column(
        Enum(CompanyDocumentStatus, name="company_document_status", create_type=False),
        nullable=False,
        server_default="PENDING",
    )
    verified_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    verified_at: Mapped[Optional[datetime]] = mapped_column(nullable=True)
    rejection_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    company: Mapped["Company"] = relationship("Company", back_populates="documents")


class CompanyService(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "company_services"
    __table_args__ = (UniqueConstraint("company_id", "task_id", name="uq_company_service"),)

    company_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    task_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("service_tasks.id", ondelete="CASCADE"), nullable=False
    )

    company: Mapped["Company"] = relationship("Company", back_populates="services")


class CompanyInvite(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "company_invites"

    company_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    email: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[CompanyMemberRole] = mapped_column(
        Enum(CompanyMemberRole, name="company_member_role", create_type=False),
        nullable=False,
        server_default="COLLABORATOR",
    )
    code: Mapped[str] = mapped_column(String(16), nullable=False, unique=True)
    status: Mapped[CompanyInviteStatus] = mapped_column(
        Enum(CompanyInviteStatus, name="company_invite_status", create_type=False),
        nullable=False,
        server_default="PENDING",
    )
    expires_at: Mapped[datetime] = mapped_column(nullable=False)
    redeemed_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
```

- [ ] **Step 2: Register the models in the package __init__**

In `backend/src/models/__init__.py`, after the `# -- 014: Admin access codes --` import block (around line 100), add:

```python
# -- 019: VISP for Business --
from .company import (
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
```

And in the `__all__` list, before the closing `]`, add:

```python
    # VISP for Business
    "Company",
    "CompanyStatus",
    "CompanyMember",
    "CompanyMemberRole",
    "CompanyMemberStatus",
    "CompanyDocument",
    "CompanyDocumentType",
    "CompanyDocumentStatus",
    "CompanyService",
    "CompanyInvite",
    "CompanyInviteStatus",
```

- [ ] **Step 3: Verify the models import cleanly**

Run:
```bash
cd backend && python -c "from src.models import Company, CompanyMember, CompanyInvite, CompanyDocument, CompanyService; print('ok')"
```
Expected: `ok`

- [ ] **Step 4: Commit**

```bash
git add backend/src/models/company.py backend/src/models/__init__.py
git commit -m "feat(b2b): company SQLAlchemy models (SP1)"
```

---

## Task 3: Pydantic schemas

**Files:**
- Create: `backend/src/api/schemas/company.py`

- [ ] **Step 1: Write the schemas**

Create `backend/src/api/schemas/company.py`:

```python
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
```

- [ ] **Step 2: Verify import**

Run:
```bash
cd backend && python -c "from src.api.schemas.company import CompanyCreateIn, CompanyOut, CompanyInviteIn, RedeemInviteIn; print('ok')"
```
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add backend/src/api/schemas/company.py
git commit -m "feat(b2b): company Pydantic schemas (SP1)"
```

---

## Task 4: Service layer (TDD)

**Files:**
- Create: `backend/src/services/company_service.py`
- Test: `backend/tests/unit/test_company_service.py`

This task builds the service incrementally with tests. The DB session is mocked (`mock_db`), so tests assert pure logic and ORM-object construction, not real persistence.

- [ ] **Step 1: Write failing tests for the invite-code generator**

Create `backend/tests/unit/test_company_service.py`:

```python
import uuid
from datetime import datetime, timedelta, timezone

import pytest

from src.services import company_service
from src.models.company import (
    Company,
    CompanyInvite,
    CompanyInviteStatus,
    CompanyMemberRole,
)


def test_generate_invite_code_format():
    code = company_service.generate_invite_code()
    assert isinstance(code, str)
    assert len(code) == 8
    # Unambiguous uppercase alphanumeric only (no O/0/I/1 confusion chars)
    assert all(c in company_service._CODE_ALPHABET for c in code)


def test_generate_invite_code_is_random():
    codes = {company_service.generate_invite_code() for _ in range(50)}
    assert len(codes) > 45  # overwhelmingly unique
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && pytest tests/unit/test_company_service.py -v`
Expected: FAIL with `AttributeError: module 'src.services.company_service' has no attribute ...` (module doesn't exist yet).

- [ ] **Step 3: Create the service module with the code generator**

Create `backend/src/services/company_service.py`:

```python
"""Business logic for VISP for Business (SP1)."""

from __future__ import annotations

import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

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

# Unambiguous alphabet (no 0/O/1/I) for human-typed invite codes.
_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
_INVITE_TTL_DAYS = 14


def generate_invite_code(length: int = 8) -> str:
    """Return a random, human-friendly uppercase invite code."""
    return "".join(secrets.choice(_CODE_ALPHABET) for _ in range(length))
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && pytest tests/unit/test_company_service.py -v`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/company_service.py backend/tests/unit/test_company_service.py
git commit -m "feat(b2b): company_service invite-code generator + tests (SP1)"
```

- [ ] **Step 6: Write failing tests for create_company**

Append to `backend/tests/unit/test_company_service.py`:

```python
@pytest.mark.asyncio
async def test_create_company_adds_company_and_admin_member(mock_db, sample_provider_user):
    from src.api.schemas.company import CompanyCreateIn

    payload = CompanyCreateIn(legal_name="Acme Cleaning Inc.", phone="4165551234")
    company = await company_service.create_company(mock_db, sample_provider_user, payload)

    assert company.legal_name == "Acme Cleaning Inc."
    assert company.status == CompanyStatus.DRAFT
    # One Company + one ADMIN CompanyMember were added to the session.
    added = [c.args[0] for c in mock_db.add.call_args_list]
    assert any(isinstance(o, Company) for o in added)
    member = next(o for o in added if isinstance(o, CompanyMember))
    assert member.role == CompanyMemberRole.ADMIN
    assert member.user_id == sample_provider_user.id
```

- [ ] **Step 7: Run to verify it fails**

Run: `cd backend && pytest tests/unit/test_company_service.py::test_create_company_adds_company_and_admin_member -v`
Expected: FAIL with `AttributeError: ... has no attribute 'create_company'`.

- [ ] **Step 8: Implement create_company**

Append to `backend/src/services/company_service.py`:

```python
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
    await db.flush()  # assign company.id

    member = CompanyMember(
        company_id=company.id,
        user_id=user.id,
        role=CompanyMemberRole.ADMIN,
        status=CompanyMemberStatus.ACTIVE,
    )
    db.add(member)
    await db.flush()
    return company
```

- [ ] **Step 9: Run to verify it passes**

Run: `cd backend && pytest tests/unit/test_company_service.py -v`
Expected: PASS (3 passed).

- [ ] **Step 10: Write failing tests for redeem_invite validation rules**

Append to `backend/tests/unit/test_company_service.py`:

```python
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
    company_service.assert_invite_redeemable(inv, "juan@example.com")  # no raise


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
```

- [ ] **Step 11: Run to verify they fail**

Run: `cd backend && pytest tests/unit/test_company_service.py -k invite -v`
Expected: FAIL (`assert_invite_redeemable` undefined).

- [ ] **Step 12: Implement the invite validation helper**

Append to `backend/src/services/company_service.py`:

```python
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
```

- [ ] **Step 13: Run to verify they pass**

Run: `cd backend && pytest tests/unit/test_company_service.py -k invite -v`
Expected: PASS (4 passed).

- [ ] **Step 14: Commit**

```bash
git add backend/src/services/company_service.py backend/tests/unit/test_company_service.py
git commit -m "feat(b2b): create_company + invite redeem validation + tests (SP1)"
```

- [ ] **Step 15: Implement remaining service functions (no new tests — exercised via routes/smoke test)**

Append to `backend/src/services/company_service.py`:

```python
async def get_my_company(db: AsyncSession, user) -> Optional[Company]:
    """Return the company the user belongs to (first membership), or None."""
    result = await db.execute(
        select(Company)
        .join(CompanyMember, CompanyMember.company_id == Company.id)
        .where(CompanyMember.user_id == user.id)
        .limit(1)
    )
    return result.scalar_one_or_none()


async def get_member(db: AsyncSession, company_id: uuid.UUID, user_id: uuid.UUID):
    result = await db.execute(
        select(CompanyMember).where(
            CompanyMember.company_id == company_id,
            CompanyMember.user_id == user_id,
        )
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
    # Clear existing
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


async def get_enabled_task_ids(db: AsyncSession, company_id: uuid.UUID) -> list[uuid.UUID]:
    result = await db.execute(
        select(CompanyService.task_id).where(CompanyService.company_id == company_id)
    )
    return [row[0] for row in result.all()]


# --- Admin validation helpers ---

async def list_companies_by_status(db: AsyncSession, status: Optional[str]) -> list[Company]:
    stmt = select(Company)
    if status:
        stmt = stmt.where(Company.status == CompanyStatus(status))
    result = await db.execute(stmt.order_by(Company.created_at.desc()))
    return list(result.scalars().all())


async def get_company(db: AsyncSession, company_id: uuid.UUID) -> Optional[Company]:
    result = await db.execute(select(Company).where(Company.id == company_id))
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
```

- [ ] **Step 16: Run the full service test file**

Run: `cd backend && pytest tests/unit/test_company_service.py -v`
Expected: PASS (9 passed).

- [ ] **Step 17: Commit**

```bash
git add backend/src/services/company_service.py
git commit -m "feat(b2b): company_service members/services/docs/validation logic (SP1)"
```

---

## Task 5: User-facing router

**Files:**
- Create: `backend/src/api/routes/companies.py`
- Modify: `backend/src/main.py`

- [ ] **Step 1: Write the router**

Create `backend/src/api/routes/companies.py`:

```python
"""User-facing routes for VISP for Business (SP1)."""

from __future__ import annotations

import hashlib

from fastapi import APIRouter, File, Form, HTTPException, UploadFile, status

from src.api.deps import CurrentUser, DBSession
from src.api.schemas.company import (
    CompanyCreateIn,
    CompanyInviteIn,
    CompanyInviteOut,
    CompanyServicesIn,
    RedeemInviteIn,
)
from src.services import company_service
from src.services.file_service import save_upload_file

router = APIRouter(prefix="/companies", tags=["Companies"])


def _company_to_out(company, enabled_task_ids):
    return {
        "data": {
            "id": str(company.id),
            "legal_name": company.legal_name,
            "trade_name": company.trade_name,
            "status": company.status.value,
            "stripe_account_id": company.stripe_account_id,
            "rejection_reason": company.rejection_reason,
            "members": [
                {"id": str(m.id), "user_id": str(m.user_id), "role": m.role.value, "status": m.status.value}
                for m in (company.members or [])
            ],
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
    company = await company_service.create_company(db, user, payload)
    return _company_to_out(company, [])


@router.get("/me")
async def get_my_company(db: DBSession, user: CurrentUser):
    company = await company_service.get_my_company(db, user)
    if company is None:
        raise HTTPException(status_code=404, detail="No company for this user.")
    enabled = await company_service.get_enabled_task_ids(db, company.id)
    return _company_to_out(company, enabled)


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
    enabled = await company_service.set_services(db, company, all_tasks=payload.all, task_ids=payload.task_ids)
    return {"data": {"enabled_task_ids": [str(t) for t in enabled]}}


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


@router.post("/redeem-invite")
async def redeem_invite(db: DBSession, user: CurrentUser, payload: RedeemInviteIn):
    try:
        member = await company_service.redeem_invite(db, user, payload.code)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"data": {"company_id": str(member.company_id), "role": member.role.value}}
```

- [ ] **Step 2: Register the router in main.py**

In `backend/src/main.py`, add `companies` to the route imports block (the `from src.api.routes import (...)` list, alphabetically near `chat`):

```python
    chat,
    companies,
    consents,
```

Then, after the existing `app.include_router(...)` lines, add:

```python
app.include_router(companies.router, prefix=_prefix)
```

- [ ] **Step 3: Verify the app imports and the routes are registered**

Run:
```bash
cd backend && python -c "from src.main import app; print([r.path for r in app.routes if '/companies' in getattr(r,'path','')])"
```
Expected: a list including `/api/v1/companies`, `/api/v1/companies/me`, `/api/v1/companies/me/documents`, `/api/v1/companies/me/submit`, `/api/v1/companies/me/services`, `/api/v1/companies/me/invites`, `/api/v1/companies/redeem-invite`.

- [ ] **Step 4: Commit**

```bash
git add backend/src/api/routes/companies.py backend/src/main.py
git commit -m "feat(b2b): user-facing /companies router (SP1)"
```

---

## Task 6: Admin validation endpoints

**Files:**
- Modify: `backend/src/api/routes/admin.py`

- [ ] **Step 1: Add company-validation endpoints to the admin router**

Open `backend/src/api/routes/admin.py`. At the top with the other imports, add:

```python
from src.api.schemas.company import RejectIn
from src.services import company_service
```

At the end of the file (using the existing admin `router` and `CurrentAdmin` dependency already imported in that module), append:

```python
# ---------------------------------------------------------------------------
# VISP for Business — company validation (SP3 backend)
# ---------------------------------------------------------------------------

@router.get("/companies")
async def admin_list_companies(db: DBSession, admin: CurrentAdmin, status: str | None = None):
    companies = await company_service.list_companies_by_status(db, status)
    return {"data": [
        {"id": str(c.id), "legal_name": c.legal_name, "status": c.status.value,
         "created_at": c.created_at.isoformat()}
        for c in companies
    ]}


@router.get("/companies/{company_id}")
async def admin_get_company(db: DBSession, admin: CurrentAdmin, company_id: str):
    import uuid as _uuid
    company = await company_service.get_company(db, _uuid.UUID(company_id))
    if company is None:
        raise HTTPException(status_code=404, detail="Company not found.")
    return {"data": {
        "id": str(company.id), "legal_name": company.legal_name,
        "trade_name": company.trade_name, "status": company.status.value,
        "business_address": company.business_address, "phone": company.phone,
        "email": company.email, "website": company.website,
        "rejection_reason": company.rejection_reason,
        "documents": [
            {"id": str(d.id), "doc_type": d.doc_type.value, "status": d.status.value,
             "document_url": d.document_url, "rejection_reason": d.rejection_reason}
            for d in company.documents
        ],
    }}


@router.post("/companies/documents/{doc_id}/approve")
async def admin_approve_document(db: DBSession, admin: CurrentAdmin, doc_id: str):
    import uuid as _uuid
    try:
        doc = await company_service.review_document(db, _uuid.UUID(doc_id), admin.id, approve=True, reason=None)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return {"data": {"id": str(doc.id), "status": doc.status.value}}


@router.post("/companies/documents/{doc_id}/reject")
async def admin_reject_document(db: DBSession, admin: CurrentAdmin, doc_id: str, payload: RejectIn):
    import uuid as _uuid
    try:
        doc = await company_service.review_document(db, _uuid.UUID(doc_id), admin.id, approve=False, reason=payload.reason)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return {"data": {"id": str(doc.id), "status": doc.status.value, "rejection_reason": doc.rejection_reason}}


@router.post("/companies/{company_id}/validate")
async def admin_validate_company(db: DBSession, admin: CurrentAdmin, company_id: str):
    import uuid as _uuid
    company = await company_service.get_company(db, _uuid.UUID(company_id))
    if company is None:
        raise HTTPException(status_code=404, detail="Company not found.")
    company = await company_service.set_company_validation(db, company, validated=True, reason=None)
    return {"data": {"status": company.status.value}}


@router.post("/companies/{company_id}/reject")
async def admin_reject_company(db: DBSession, admin: CurrentAdmin, company_id: str, payload: RejectIn):
    import uuid as _uuid
    company = await company_service.get_company(db, _uuid.UUID(company_id))
    if company is None:
        raise HTTPException(status_code=404, detail="Company not found.")
    company = await company_service.set_company_validation(db, company, validated=False, reason=payload.reason)
    return {"data": {"status": company.status.value, "rejection_reason": company.rejection_reason}}
```

> NOTE: If `admin.py` does not already import `DBSession`, `CurrentAdmin`, and `HTTPException`, add them: `from src.api.deps import DBSession, CurrentAdmin` and `from fastapi import HTTPException`. Verify the existing admin router variable is named `router` (it is in the other route modules); if the admin module uses a different prefix, these paths become `/admin/companies/...` once mounted.

- [ ] **Step 2: Verify import + routes**

Run:
```bash
cd backend && python -c "from src.main import app; print([r.path for r in app.routes if 'companies' in getattr(r,'path','') and 'admin' in getattr(r,'path','')])"
```
Expected: list including the admin company paths (exact prefix depends on the admin router mount, e.g. `/api/v1/admin/companies`).

- [ ] **Step 3: Commit**

```bash
git add backend/src/api/routes/admin.py
git commit -m "feat(b2b): admin company-validation endpoints (SP1/SP3 backend)"
```

---

## Task 7: End-to-end smoke test against Visp2026

**Files:** none (manual verification). The user runs the backend pointed at `Visp2026`.

- [ ] **Step 1: Point a local backend at Visp2026 and start it**

Set the dev DB and run (the user does this, or in a scratch shell):
```bash
cd backend
DATABASE_URL='postgresql+asyncpg://Droz:Droz.2026@192.168.1.94:5432/Visp2026' \
  uvicorn src.main:app --host 0.0.0.0 --port 8010
```
Expected: server starts with no import errors.

- [ ] **Step 2: Run the unit suite**

Run: `cd backend && pytest tests/unit/test_company_service.py -v`
Expected: PASS (9 passed).

- [ ] **Step 3: Manual happy-path (optional, requires a valid user JWT)**

With a user token `$JWT` from the dev DB:
```bash
curl -s -X POST localhost:8010/api/v1/companies -H "Authorization: Bearer $JWT" \
  -H 'Content-Type: application/json' -d '{"legal_name":"Acme Cleaning Inc."}' | python -m json.tool
curl -s localhost:8010/api/v1/companies/me -H "Authorization: Bearer $JWT" | python -m json.tool
```
Expected: first returns the created company (`status: "draft"`); second returns it with one ADMIN member.

- [ ] **Step 4: Final commit (if any cleanup)**

```bash
git add -A && git commit -m "chore(b2b): SP1 smoke-test cleanup" || echo "nothing to commit"
```

---

## Notes for the implementer

- **Backend deploy:** the user applies migrations and restarts the server. Do not deploy; list changed files. SP1 targets `Visp2026` only.
- **Enum values:** the PG enum labels are the UPPERCASE member *names* (e.g. `DRAFT`), set by SQLAlchemy from the member name; the Python `.value` (e.g. `"draft"`) is what the API returns to clients. Keep both in sync with the migration.
- **No UI in SP1.** `/business` web (SP2) and `/console` UI (SP3) consume these endpoints later; the admin endpoints here are the SP3 backend.
- **Payments:** `companies.stripe_account_id` exists but is unused until SP4 wires payout routing.
```
