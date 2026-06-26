-- ============================================================================
-- Migration 020 — VISP for Business: company job assignments (SP4 Stage 1)
-- ============================================================================
-- Additive only. Adds the supervisor->collaborator job-assignment flow for
-- validated companies WITHOUT touching the existing provider matching/offer
-- tables (jobs, job_assignments are left exactly as-is).
--
-- A job is "claimed by a company" iff a company_job_assignments row exists for
-- it. The provider path never reads this table, so the two flows do not
-- interfere. Enum labels use UPPERCASE member names to match the SQLAlchemy
-- native-enum convention (see job_status / company_status).
-- ============================================================================

BEGIN;

-- Enum types -----------------------------------------------------------------
-- Lifecycle of a company job assignment:
--   CLAIMED    -> supervisor claimed the job for the company
--   ASSIGNED   -> supervisor assigned it to a specific collaborator
--   ACCEPTED   -> collaborator accepted the assignment
--   DECLINED   -> collaborator declined; supervisor may reassign
--   COMPLETED  -> work finished
--   CANCELLED  -> claim/assignment cancelled
CREATE TYPE company_job_status AS ENUM (
  'CLAIMED', 'ASSIGNED', 'ACCEPTED', 'DECLINED', 'COMPLETED', 'CANCELLED'
);

-- Where the payout for a company-claimed job is routed. Recorded explicitly so
-- the payment-success path can resolve the destination without re-deriving it.
CREATE TYPE company_payout_target AS ENUM ('COMPANY', 'INDIVIDUAL');

-- company_job_assignments ----------------------------------------------------
CREATE TABLE company_job_assignments (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id                   UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  company_id               UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  -- The supervisor (or admin) who claimed the job on behalf of the company.
  claimed_by               UUID NOT NULL REFERENCES users(id),
  -- The collaborator the job is assigned to; null until the supervisor assigns.
  assigned_collaborator_id UUID REFERENCES users(id),
  status                   company_job_status NOT NULL DEFAULT 'CLAIMED',
  -- Payout routing for this job. Company-claimed jobs pay the company account.
  payout_target            company_payout_target NOT NULL DEFAULT 'COMPANY',
  claimed_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  assigned_at              TIMESTAMPTZ,
  responded_at             TIMESTAMPTZ,
  decline_reason           TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- A job can only be claimed by one company assignment at a time.
  CONSTRAINT uq_company_job UNIQUE (job_id)
);

CREATE INDEX ix_company_job_assignments_company ON company_job_assignments (company_id);
CREATE INDEX ix_company_job_assignments_collaborator ON company_job_assignments (assigned_collaborator_id);
CREATE INDEX ix_company_job_assignments_status ON company_job_assignments (status);

COMMIT;
