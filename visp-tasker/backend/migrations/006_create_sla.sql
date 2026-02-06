-- ============================================================================
-- VISP-DB-SCHEMA-001 :: Migration 006 — SLA Profiles & On-Call Shifts
-- ============================================================================
-- SLA profiles define response/arrival/completion targets per region and
-- task level. On-call shifts track Level 4 provider availability for
-- 24/7 emergency coverage.
-- ============================================================================

BEGIN;

-- ---- ENUM types ----
CREATE TYPE sla_region_type AS ENUM (
    'COUNTRY',
    'PROVINCE_STATE',
    'CITY',
    'POSTAL_PREFIX',
    'CUSTOM_ZONE'
);

CREATE TYPE on_call_status AS ENUM (
    'SCHEDULED',
    'ACTIVE',
    'COMPLETED',
    'CANCELLED',
    'NO_SHOW'
);

-- ---- SLA profiles ----
CREATE TABLE sla_profiles (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Scope
    name                    VARCHAR(200) NOT NULL,
    description             TEXT,
    -- Which level this SLA applies to
    level                   provider_level NOT NULL,
    -- Region targeting
    region_type             sla_region_type NOT NULL DEFAULT 'PROVINCE_STATE',
    region_value            VARCHAR(200) NOT NULL,  -- e.g. 'ON', 'Toronto', 'M5V'
    country                 VARCHAR(2) NOT NULL DEFAULT 'CA',
    -- Task scope (NULL = applies to all tasks at this level)
    task_id                 UUID REFERENCES service_tasks(id) ON DELETE SET NULL,
    -- SLA targets (in minutes)
    response_time_min       INTEGER NOT NULL,  -- time to accept
    arrival_time_min        INTEGER,           -- time to arrive on-site
    completion_time_min     INTEGER,           -- max time to complete
    -- Penalties
    penalty_enabled         BOOLEAN NOT NULL DEFAULT FALSE,
    penalty_per_min_cents   INTEGER,           -- penalty per minute late
    penalty_cap_cents       INTEGER,           -- max penalty
    -- Activation
    is_active               BOOLEAN NOT NULL DEFAULT TRUE,
    effective_from          DATE NOT NULL DEFAULT CURRENT_DATE,
    effective_until         DATE,
    -- Priority (higher wins when multiple SLAs match)
    priority_order          INTEGER NOT NULL DEFAULT 0,
    -- Metadata
    created_at              TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_sla_response_time CHECK (response_time_min > 0),
    CONSTRAINT chk_sla_arrival_time CHECK (arrival_time_min IS NULL OR arrival_time_min > 0),
    CONSTRAINT chk_sla_completion_time CHECK (completion_time_min IS NULL OR completion_time_min > 0),
    CONSTRAINT chk_sla_effective_dates CHECK (
        effective_until IS NULL OR effective_from <= effective_until
    )
);

-- ---- On-call shifts (Level 4 emergency providers) ----
CREATE TABLE on_call_shifts (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_id             UUID NOT NULL REFERENCES provider_profiles(id) ON DELETE CASCADE,
    -- Shift window
    shift_start             TIMESTAMP WITH TIME ZONE NOT NULL,
    shift_end               TIMESTAMP WITH TIME ZONE NOT NULL,
    -- Region coverage
    region_type             sla_region_type NOT NULL DEFAULT 'CITY',
    region_value            VARCHAR(200) NOT NULL,
    country                 VARCHAR(2) NOT NULL DEFAULT 'CA',
    -- Status
    status                  on_call_status NOT NULL DEFAULT 'SCHEDULED',
    -- Check-in tracking
    checked_in_at           TIMESTAMP WITH TIME ZONE,
    checked_out_at          TIMESTAMP WITH TIME ZONE,
    -- Compensation
    shift_rate_cents        INTEGER,  -- flat rate for the shift
    -- Metadata
    created_at              TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_shift_window CHECK (shift_start < shift_end),
    CONSTRAINT chk_shift_rate CHECK (shift_rate_cents IS NULL OR shift_rate_cents >= 0)
);

-- ---- Indexes ----
CREATE INDEX idx_sla_profiles_level ON sla_profiles (level);
CREATE INDEX idx_sla_profiles_region ON sla_profiles (region_type, region_value);
CREATE INDEX idx_sla_profiles_task ON sla_profiles (task_id) WHERE task_id IS NOT NULL;
CREATE INDEX idx_sla_profiles_active ON sla_profiles (is_active, level, priority_order DESC)
    WHERE is_active = TRUE;

CREATE INDEX idx_on_call_shifts_provider ON on_call_shifts (provider_id);
CREATE INDEX idx_on_call_shifts_active ON on_call_shifts (shift_start, shift_end)
    WHERE status IN ('SCHEDULED', 'ACTIVE');
CREATE INDEX idx_on_call_shifts_region ON on_call_shifts (region_type, region_value);
CREATE INDEX idx_on_call_shifts_status ON on_call_shifts (status);

-- ---- Triggers ----
CREATE TRIGGER trg_sla_profiles_updated_at
    BEFORE UPDATE ON sla_profiles
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_on_call_shifts_updated_at
    BEFORE UPDATE ON on_call_shifts
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

COMMIT;
