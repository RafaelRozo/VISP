-- ============================================================================
-- VISP-DB-SCHEMA-001 :: Migration 002 — Providers
-- ============================================================================
-- Provider profiles, level tracking, and background check records.
-- The level system is a core business rule: Level 1-4 determines which
-- tasks a provider may be assigned.
-- ============================================================================

BEGIN;

-- ---- ENUM types ----
CREATE TYPE provider_level AS ENUM ('LEVEL_1', 'LEVEL_2', 'LEVEL_3', 'LEVEL_4');

CREATE TYPE background_check_status AS ENUM (
    'NOT_SUBMITTED',
    'PENDING',
    'CLEARED',
    'FLAGGED',
    'EXPIRED',
    'REJECTED'
);

CREATE TYPE provider_profile_status AS ENUM (
    'ONBOARDING',
    'PENDING_REVIEW',
    'ACTIVE',
    'SUSPENDED',
    'INACTIVE'
);

-- ---- Provider profiles ----
CREATE TABLE provider_profiles (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                 UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- Status
    status                  provider_profile_status NOT NULL DEFAULT 'ONBOARDING',
    -- Current approved level
    current_level           provider_level NOT NULL DEFAULT 'LEVEL_1',
    -- Background check
    background_check_status background_check_status NOT NULL DEFAULT 'NOT_SUBMITTED',
    background_check_date   DATE,
    background_check_expiry DATE,
    background_check_ref    VARCHAR(255),
    -- Internal scoring (0-100), calculated by the scoring algorithm
    internal_score          NUMERIC(5, 2) NOT NULL DEFAULT 50.00,
    -- Service radius in kilometers
    service_radius_km       NUMERIC(6, 2) NOT NULL DEFAULT 25.00,
    -- Home base location for matching
    home_latitude           NUMERIC(10, 7),
    home_longitude          NUMERIC(10, 7),
    home_address            TEXT,
    home_city               VARCHAR(100),
    home_province_state     VARCHAR(100),
    home_postal_zip         VARCHAR(20),
    home_country            VARCHAR(2) DEFAULT 'CA',
    -- Work preferences
    max_concurrent_jobs     INTEGER NOT NULL DEFAULT 1,
    available_for_emergency BOOLEAN NOT NULL DEFAULT FALSE,
    -- Profile content
    bio                     TEXT,
    portfolio_url           TEXT,
    years_experience        INTEGER,
    -- Financial
    stripe_account_id       VARCHAR(255),
    -- Metadata
    activated_at            TIMESTAMP WITH TIME ZONE,
    created_at              TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    -- Constraints
    CONSTRAINT uq_provider_user UNIQUE (user_id),
    CONSTRAINT chk_internal_score CHECK (internal_score >= 0 AND internal_score <= 100),
    CONSTRAINT chk_service_radius CHECK (service_radius_km > 0 AND service_radius_km <= 200),
    CONSTRAINT chk_max_concurrent_jobs CHECK (max_concurrent_jobs >= 1 AND max_concurrent_jobs <= 10)
);

-- ---- Provider levels (history + qualification tracking) ----
CREATE TABLE provider_levels (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_id     UUID NOT NULL REFERENCES provider_profiles(id) ON DELETE CASCADE,
    level           provider_level NOT NULL,
    -- Qualification status
    qualified       BOOLEAN NOT NULL DEFAULT FALSE,
    qualified_at    TIMESTAMP WITH TIME ZONE,
    revoked_at      TIMESTAMP WITH TIME ZONE,
    revoked_reason  TEXT,
    -- Who approved
    approved_by     UUID REFERENCES users(id),
    -- Metadata
    created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    -- A provider can have at most one record per level
    CONSTRAINT uq_provider_level UNIQUE (provider_id, level)
);

-- ---- Provider availability windows ----
CREATE TABLE provider_availability (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_id     UUID NOT NULL REFERENCES provider_profiles(id) ON DELETE CASCADE,
    day_of_week     SMALLINT NOT NULL,  -- 0=Sunday .. 6=Saturday
    start_time      TIME NOT NULL,
    end_time        TIME NOT NULL,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_day_of_week CHECK (day_of_week >= 0 AND day_of_week <= 6),
    CONSTRAINT chk_time_range CHECK (start_time < end_time)
);

-- ---- Indexes ----
CREATE INDEX idx_provider_profiles_user ON provider_profiles (user_id);
CREATE INDEX idx_provider_profiles_status ON provider_profiles (status);
CREATE INDEX idx_provider_profiles_level ON provider_profiles (current_level);
CREATE INDEX idx_provider_profiles_location ON provider_profiles (home_latitude, home_longitude)
    WHERE home_latitude IS NOT NULL AND home_longitude IS NOT NULL;
CREATE INDEX idx_provider_profiles_score ON provider_profiles (internal_score DESC);
CREATE INDEX idx_provider_profiles_emergency ON provider_profiles (id)
    WHERE available_for_emergency = TRUE;
CREATE INDEX idx_provider_profiles_bg_expiry ON provider_profiles (background_check_expiry)
    WHERE background_check_expiry IS NOT NULL;
CREATE INDEX idx_provider_levels_provider ON provider_levels (provider_id);
CREATE INDEX idx_provider_levels_qualified ON provider_levels (provider_id, level)
    WHERE qualified = TRUE;
CREATE INDEX idx_provider_availability_provider ON provider_availability (provider_id);

-- ---- Triggers ----
CREATE TRIGGER trg_provider_profiles_updated_at
    BEFORE UPDATE ON provider_profiles
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_provider_levels_updated_at
    BEFORE UPDATE ON provider_levels
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_provider_availability_updated_at
    BEFORE UPDATE ON provider_availability
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

COMMIT;
