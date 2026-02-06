-- ============================================================================
-- VISP-DB-SCHEMA-001 :: Migration 007 — Pricing
-- ============================================================================
-- Dynamic pricing rules with multiplier ranges, and an immutable
-- pricing_events audit trail for every price calculation.
-- ============================================================================

BEGIN;

-- ---- ENUM types ----
CREATE TYPE pricing_rule_type AS ENUM (
    'BASE_RATE',
    'TIME_MULTIPLIER',
    'DEMAND_SURGE',
    'EMERGENCY_PREMIUM',
    'DISTANCE_ADJUSTMENT',
    'LEVEL_PREMIUM',
    'HOLIDAY_SURCHARGE',
    'OFF_HOURS_SURCHARGE',
    'LOYALTY_DISCOUNT',
    'PROMOTIONAL'
);

CREATE TYPE pricing_event_type AS ENUM (
    'QUOTE_GENERATED',
    'PRICE_CONFIRMED',
    'PRICE_ADJUSTED',
    'DISCOUNT_APPLIED',
    'SURCHARGE_APPLIED',
    'REFUND_CALCULATED'
);

-- ---- Pricing rules ----
CREATE TABLE pricing_rules (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Scope
    name                    VARCHAR(200) NOT NULL,
    description             TEXT,
    rule_type               pricing_rule_type NOT NULL,
    -- Targeting (all optional; NULL = applies globally)
    level                   provider_level,
    task_id                 UUID REFERENCES service_tasks(id) ON DELETE SET NULL,
    region_value            VARCHAR(200),
    country                 VARCHAR(2),
    -- Multiplier range
    multiplier_min          NUMERIC(6, 4) NOT NULL DEFAULT 1.0000,
    multiplier_max          NUMERIC(6, 4) NOT NULL DEFAULT 1.0000,
    -- Flat adjustments (in cents)
    flat_adjustment_cents   INTEGER DEFAULT 0,
    -- Conditions (JSON: time ranges, demand thresholds, etc.)
    conditions_json         JSONB DEFAULT '{}'::JSONB,
    -- Priority (higher wins on conflict)
    priority_order          INTEGER NOT NULL DEFAULT 0,
    -- Stacking
    stackable               BOOLEAN NOT NULL DEFAULT TRUE,
    -- Activation
    is_active               BOOLEAN NOT NULL DEFAULT TRUE,
    effective_from          DATE NOT NULL DEFAULT CURRENT_DATE,
    effective_until         DATE,
    -- Metadata
    created_at              TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_multiplier_range CHECK (
        multiplier_min > 0 AND multiplier_max > 0 AND multiplier_min <= multiplier_max
    ),
    CONSTRAINT chk_pricing_effective_dates CHECK (
        effective_until IS NULL OR effective_from <= effective_until
    )
);

-- ---- Pricing events (immutable audit trail) ----
CREATE TABLE pricing_events (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id                  UUID NOT NULL REFERENCES jobs(id) ON DELETE RESTRICT,
    event_type              pricing_event_type NOT NULL,
    -- Calculation breakdown
    base_price_cents        BIGINT NOT NULL,
    multiplier_applied      NUMERIC(6, 4) NOT NULL DEFAULT 1.0000,
    adjustments_cents       INTEGER NOT NULL DEFAULT 0,
    final_price_cents       BIGINT NOT NULL,
    -- Which rules were applied (array of rule IDs + their values)
    rules_applied_json      JSONB NOT NULL DEFAULT '[]'::JSONB,
    -- Commission calculated
    commission_rate         NUMERIC(5, 4),
    commission_cents        BIGINT,
    provider_payout_cents   BIGINT,
    currency                VARCHAR(3) NOT NULL DEFAULT 'CAD',
    -- Context at calculation time
    demand_factor           NUMERIC(4, 2),   -- e.g. 1.5x demand
    distance_km             NUMERIC(8, 2),
    -- Actor
    calculated_by           VARCHAR(50) NOT NULL DEFAULT 'system',  -- 'system' or admin user_id
    -- Immutable — no updated_at
    created_at              TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_base_price CHECK (base_price_cents >= 0),
    CONSTRAINT chk_final_price CHECK (final_price_cents >= 0),
    CONSTRAINT chk_multiplier CHECK (multiplier_applied > 0)
);

-- ---- Commission schedule (by level) ----
CREATE TABLE commission_schedules (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    level                   provider_level NOT NULL,
    -- Commission range
    commission_rate_min     NUMERIC(5, 4) NOT NULL,
    commission_rate_max     NUMERIC(5, 4) NOT NULL,
    commission_rate_default NUMERIC(5, 4) NOT NULL,
    -- Applicability
    country                 VARCHAR(2) NOT NULL DEFAULT 'CA',
    is_active               BOOLEAN NOT NULL DEFAULT TRUE,
    effective_from          DATE NOT NULL DEFAULT CURRENT_DATE,
    effective_until         DATE,
    -- Metadata
    created_at              TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_commission_range CHECK (
        commission_rate_min >= 0
        AND commission_rate_max <= 1
        AND commission_rate_min <= commission_rate_max
        AND commission_rate_default >= commission_rate_min
        AND commission_rate_default <= commission_rate_max
    )
);

-- ---- Indexes ----
CREATE INDEX idx_pricing_rules_type ON pricing_rules (rule_type);
CREATE INDEX idx_pricing_rules_level ON pricing_rules (level) WHERE level IS NOT NULL;
CREATE INDEX idx_pricing_rules_task ON pricing_rules (task_id) WHERE task_id IS NOT NULL;
CREATE INDEX idx_pricing_rules_active ON pricing_rules (is_active, priority_order DESC)
    WHERE is_active = TRUE;

CREATE INDEX idx_pricing_events_job ON pricing_events (job_id);
CREATE INDEX idx_pricing_events_type ON pricing_events (event_type);
CREATE INDEX idx_pricing_events_created ON pricing_events (created_at DESC);

CREATE INDEX idx_commission_schedules_level ON commission_schedules (level);
CREATE INDEX idx_commission_schedules_active ON commission_schedules (is_active, level)
    WHERE is_active = TRUE;

-- ---- Triggers (no trigger on pricing_events — immutable) ----
CREATE TRIGGER trg_pricing_rules_updated_at
    BEFORE UPDATE ON pricing_rules
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_commission_schedules_updated_at
    BEFORE UPDATE ON commission_schedules
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

COMMIT;
