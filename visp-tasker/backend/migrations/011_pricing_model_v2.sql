-- ============================================================================
-- VISP-DB-SCHEMA-001 :: Migration 011 — Pricing Model V2
-- ============================================================================
-- Adds support for:
--   L1/L2: TIME_BASED hourly pricing with running cost
--   L3: NEGOTIATED per-job pricing with proposals
--   L4: EMERGENCY_NEGOTIATED pricing with multipliers
--   Optional tips after job completion
-- ============================================================================

-- NOTE: ALTER TYPE ... ADD VALUE cannot run inside a transaction block.
-- Each ADD VALUE statement must be executed outside BEGIN/COMMIT.

-- 1. Pricing model enum
CREATE TYPE pricing_model AS ENUM ('TIME_BASED', 'NEGOTIATED', 'EMERGENCY_NEGOTIATED');

-- 2. Ensure job_status has PENDING_APPROVAL and SCHEDULED before adding new value
-- These may already exist from prior manual additions; use DO blocks for safety.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'PENDING_APPROVAL'
                   AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'job_status')) THEN
        ALTER TYPE job_status ADD VALUE 'PENDING_APPROVAL' AFTER 'MATCHED';
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'SCHEDULED'
                   AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'job_status')) THEN
        ALTER TYPE job_status ADD VALUE 'SCHEDULED' AFTER 'PENDING_APPROVAL';
    END IF;
END
$$;

-- 3. New job status for price negotiation
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'PENDING_PRICE_AGREEMENT'
                   AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'job_status')) THEN
        ALTER TYPE job_status ADD VALUE 'PENDING_PRICE_AGREEMENT' AFTER 'PENDING_APPROVAL';
    END IF;
END
$$;

-- 4. New pricing event types
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'PRICE_PROPOSED'
                   AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'pricing_event_type')) THEN
        ALTER TYPE pricing_event_type ADD VALUE 'PRICE_PROPOSED';
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'PRICE_ACCEPTED'
                   AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'pricing_event_type')) THEN
        ALTER TYPE pricing_event_type ADD VALUE 'PRICE_ACCEPTED';
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'TIP_ADDED'
                   AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'pricing_event_type')) THEN
        ALTER TYPE pricing_event_type ADD VALUE 'TIP_ADDED';
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'TIME_BASED_CALCULATED'
                   AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'pricing_event_type')) THEN
        ALTER TYPE pricing_event_type ADD VALUE 'TIME_BASED_CALCULATED';
    END IF;
END
$$;

-- 5. New columns on jobs table
BEGIN;

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS pricing_model pricing_model;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS hourly_rate_cents INTEGER;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS actual_duration_minutes INTEGER;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS proposed_price_cents BIGINT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS price_agreed_at TIMESTAMPTZ;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS tip_cents BIGINT DEFAULT 0;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS tip_paid_at TIMESTAMPTZ;

-- 6. Price proposals table (for L3/L4 negotiation)
CREATE TABLE IF NOT EXISTS price_proposals (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id              UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    proposed_by_id      UUID NOT NULL REFERENCES users(id),
    proposed_by_role    VARCHAR(20) NOT NULL CHECK (proposed_by_role IN ('provider', 'platform', 'customer')),
    proposed_price_cents BIGINT NOT NULL CHECK (proposed_price_cents > 0),
    description         TEXT,
    status              VARCHAR(20) NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'accepted', 'rejected', 'expired', 'superseded')),
    responded_at        TIMESTAMPTZ,
    response_by_id      UUID REFERENCES users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_price_proposals_job_id ON price_proposals(job_id);
CREATE INDEX IF NOT EXISTS idx_price_proposals_status ON price_proposals(status);

-- 7. Tips table
CREATE TABLE IF NOT EXISTS tips (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id                  UUID NOT NULL REFERENCES jobs(id) ON DELETE RESTRICT,
    customer_id             UUID NOT NULL REFERENCES users(id),
    provider_id             UUID NOT NULL REFERENCES provider_profiles(id),
    amount_cents            BIGINT NOT NULL CHECK (amount_cents > 0),
    stripe_payment_intent_id VARCHAR(255),
    status                  VARCHAR(20) NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'paid', 'failed', 'refunded')),
    paid_at                 TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tips_job_id ON tips(job_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tips_job_unique ON tips(job_id) WHERE status != 'failed';

-- 8. Indexes for pricing model queries
CREATE INDEX IF NOT EXISTS idx_jobs_pricing_model ON jobs(pricing_model) WHERE pricing_model IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_jobs_status_pricing ON jobs(status, pricing_model);

-- 9. Triggers for updated_at
CREATE TRIGGER trg_price_proposals_updated_at
    BEFORE UPDATE ON price_proposals
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

COMMIT;
