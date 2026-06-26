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
  verified_by      UUID REFERENCES superusers(id),
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

COMMIT;
