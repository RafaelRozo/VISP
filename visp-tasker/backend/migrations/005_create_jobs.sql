-- ============================================================================
-- VISP-DB-SCHEMA-001 :: Migration 005 — Jobs
-- ============================================================================
-- Jobs are the central entity: a customer requests a predefined task,
-- the system matches a provider, and the job lifecycle is tracked.
-- SLA terms are SNAPSHOT at creation time (immutable after).
-- ============================================================================

BEGIN;

-- ---- ENUM types ----
CREATE TYPE job_status AS ENUM (
    'DRAFT',
    'PENDING_MATCH',
    'MATCHED',
    'PROVIDER_ACCEPTED',
    'PROVIDER_EN_ROUTE',
    'IN_PROGRESS',
    'COMPLETED',
    'CANCELLED_BY_CUSTOMER',
    'CANCELLED_BY_PROVIDER',
    'CANCELLED_BY_SYSTEM',
    'DISPUTED',
    'REFUNDED'
);

CREATE TYPE job_priority AS ENUM (
    'STANDARD',
    'PRIORITY',
    'URGENT',
    'EMERGENCY'
);

CREATE TYPE assignment_status AS ENUM (
    'OFFERED',
    'ACCEPTED',
    'DECLINED',
    'EXPIRED',
    'CANCELLED',
    'COMPLETED'
);

CREATE TYPE escalation_type AS ENUM (
    'KEYWORD_DETECTED',
    'MANUAL_ESCALATION',
    'SAFETY_CONCERN',
    'SLA_BREACH',
    'CUSTOMER_REQUEST',
    'SYSTEM_AUTO'
);

-- ---- Jobs ----
CREATE TABLE jobs (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Reference number (human-readable)
    reference_number        VARCHAR(20) NOT NULL,
    -- Parties
    customer_id             UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    -- Task from closed catalog (business rule: no free text)
    task_id                 UUID NOT NULL REFERENCES service_tasks(id) ON DELETE RESTRICT,
    -- Job details
    status                  job_status NOT NULL DEFAULT 'DRAFT',
    priority                job_priority NOT NULL DEFAULT 'STANDARD',
    is_emergency            BOOLEAN NOT NULL DEFAULT FALSE,
    -- Location
    service_latitude        NUMERIC(10, 7) NOT NULL,
    service_longitude       NUMERIC(10, 7) NOT NULL,
    service_address         TEXT NOT NULL,
    service_unit            VARCHAR(50),
    service_city            VARCHAR(100),
    service_province_state  VARCHAR(100),
    service_postal_zip      VARCHAR(20),
    service_country         VARCHAR(2) NOT NULL DEFAULT 'CA',
    -- Scheduling
    requested_date          DATE,
    requested_time_start    TIME,
    requested_time_end      TIME,
    flexible_schedule       BOOLEAN NOT NULL DEFAULT FALSE,
    -- SLA snapshot (immutable copy from sla_profiles at job creation)
    sla_response_time_min   INTEGER,       -- minutes
    sla_arrival_time_min    INTEGER,       -- minutes
    sla_completion_time_min INTEGER,       -- minutes
    sla_profile_id          UUID,          -- reference to source SLA (informational)
    sla_snapshot_json       JSONB,         -- full SLA terms frozen at creation
    -- Pricing snapshot
    quoted_price_cents      BIGINT,
    final_price_cents       BIGINT,
    commission_rate         NUMERIC(5, 4), -- e.g. 0.1500 = 15%
    commission_amount_cents BIGINT,
    provider_payout_cents   BIGINT,
    currency                VARCHAR(3) NOT NULL DEFAULT 'CAD',
    -- Payment
    stripe_payment_intent_id VARCHAR(255),
    paid_at                 TIMESTAMP WITH TIME ZONE,
    -- Customer notes (selected from predefined options, NOT free text)
    customer_notes_json     JSONB DEFAULT '[]'::JSONB,
    -- Photos
    photos_before_json      JSONB DEFAULT '[]'::JSONB,
    photos_after_json       JSONB DEFAULT '[]'::JSONB,
    -- Completion
    started_at              TIMESTAMP WITH TIME ZONE,
    completed_at            TIMESTAMP WITH TIME ZONE,
    cancelled_at            TIMESTAMP WITH TIME ZONE,
    cancellation_reason     TEXT,
    -- Metadata
    created_at              TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_jobs_reference UNIQUE (reference_number),
    CONSTRAINT chk_quoted_price CHECK (quoted_price_cents IS NULL OR quoted_price_cents >= 0),
    CONSTRAINT chk_final_price CHECK (final_price_cents IS NULL OR final_price_cents >= 0),
    CONSTRAINT chk_commission_rate CHECK (
        commission_rate IS NULL OR (commission_rate >= 0 AND commission_rate <= 1)
    )
);

-- ---- Job assignments (linking jobs to providers) ----
CREATE TABLE job_assignments (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id                  UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    provider_id             UUID NOT NULL REFERENCES provider_profiles(id) ON DELETE RESTRICT,
    -- Status
    status                  assignment_status NOT NULL DEFAULT 'OFFERED',
    -- Offer details
    offered_at              TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    offer_expires_at        TIMESTAMP WITH TIME ZONE,
    -- Response
    responded_at            TIMESTAMP WITH TIME ZONE,
    decline_reason          TEXT,
    -- SLA tracking
    sla_response_deadline   TIMESTAMP WITH TIME ZONE,
    sla_arrival_deadline    TIMESTAMP WITH TIME ZONE,
    sla_completion_deadline TIMESTAMP WITH TIME ZONE,
    sla_response_met        BOOLEAN,
    sla_arrival_met         BOOLEAN,
    sla_completion_met      BOOLEAN,
    -- Provider location at accept
    accept_latitude         NUMERIC(10, 7),
    accept_longitude        NUMERIC(10, 7),
    estimated_arrival_min   INTEGER,  -- minutes
    -- Actual timestamps
    en_route_at             TIMESTAMP WITH TIME ZONE,
    arrived_at              TIMESTAMP WITH TIME ZONE,
    started_work_at         TIMESTAMP WITH TIME ZONE,
    completed_at            TIMESTAMP WITH TIME ZONE,
    -- Scoring input
    match_score             NUMERIC(5, 2),  -- algorithm score at assignment time
    -- Metadata
    created_at              TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- ---- Job escalations ----
CREATE TABLE job_escalations (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id                  UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    -- Escalation details
    escalation_type         escalation_type NOT NULL,
    from_level              provider_level,
    to_level                provider_level,
    -- What triggered it
    trigger_keyword         VARCHAR(200),
    trigger_description     TEXT,
    -- Resolution
    resolved                BOOLEAN NOT NULL DEFAULT FALSE,
    resolved_at             TIMESTAMP WITH TIME ZONE,
    resolved_by             UUID REFERENCES users(id),
    resolution_notes        TEXT,
    -- Metadata
    created_at              TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- ---- Indexes ----
CREATE INDEX idx_jobs_customer ON jobs (customer_id);
CREATE INDEX idx_jobs_task ON jobs (task_id);
CREATE INDEX idx_jobs_status ON jobs (status);
CREATE INDEX idx_jobs_priority ON jobs (priority);
CREATE INDEX idx_jobs_emergency ON jobs (id) WHERE is_emergency = TRUE;
CREATE INDEX idx_jobs_location ON jobs (service_latitude, service_longitude);
CREATE INDEX idx_jobs_requested_date ON jobs (requested_date) WHERE requested_date IS NOT NULL;
CREATE INDEX idx_jobs_reference ON jobs (reference_number);
CREATE INDEX idx_jobs_created ON jobs (created_at DESC);
CREATE INDEX idx_jobs_status_created ON jobs (status, created_at DESC);

CREATE INDEX idx_assignments_job ON job_assignments (job_id);
CREATE INDEX idx_assignments_provider ON job_assignments (provider_id);
CREATE INDEX idx_assignments_status ON job_assignments (status);
CREATE INDEX idx_assignments_sla_response ON job_assignments (sla_response_deadline)
    WHERE sla_response_met IS NULL;
CREATE INDEX idx_assignments_sla_arrival ON job_assignments (sla_arrival_deadline)
    WHERE sla_arrival_met IS NULL;

CREATE INDEX idx_escalations_job ON job_escalations (job_id);
CREATE INDEX idx_escalations_type ON job_escalations (escalation_type);
CREATE INDEX idx_escalations_unresolved ON job_escalations (job_id)
    WHERE resolved = FALSE;

-- ---- Triggers ----
CREATE TRIGGER trg_jobs_updated_at
    BEFORE UPDATE ON jobs
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_assignments_updated_at
    BEFORE UPDATE ON job_assignments
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_escalations_updated_at
    BEFORE UPDATE ON job_escalations
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

COMMIT;
