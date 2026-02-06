-- ============================================================================
-- VISP-DB-SCHEMA-001 :: Migration 004 — Verification & Legal
-- ============================================================================
-- Provider credentials (licenses), insurance policies, and auditable
-- legal consent records with consent_text_hash for tamper detection.
-- ============================================================================

BEGIN;

-- ---- ENUM types ----
CREATE TYPE credential_status AS ENUM (
    'PENDING_REVIEW',
    'VERIFIED',
    'REJECTED',
    'EXPIRED',
    'REVOKED'
);

CREATE TYPE credential_type AS ENUM (
    'LICENSE',
    'CERTIFICATION',
    'PERMIT',
    'TRAINING',
    'BACKGROUND_CHECK',
    'PORTFOLIO'
);

CREATE TYPE insurance_status AS ENUM (
    'PENDING_REVIEW',
    'VERIFIED',
    'EXPIRED',
    'CANCELLED',
    'REJECTED'
);

CREATE TYPE consent_type AS ENUM (
    'PLATFORM_TOS',
    'PROVIDER_IC_AGREEMENT',
    'LEVEL_1_TERMS',
    'LEVEL_2_TERMS',
    'LEVEL_3_TERMS',
    'LEVEL_4_EMERGENCY_SLA',
    'CUSTOMER_SERVICE_AGREEMENT',
    'EMERGENCY_PRICING_CONSENT'
);

-- ---- Provider credentials (licenses, certifications, etc.) ----
CREATE TABLE provider_credentials (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_id         UUID NOT NULL REFERENCES provider_profiles(id) ON DELETE CASCADE,
    credential_type     credential_type NOT NULL,
    -- Credential details
    name                VARCHAR(300) NOT NULL,
    issuing_authority   VARCHAR(300),
    credential_number   VARCHAR(200),
    -- Jurisdiction
    jurisdiction_country VARCHAR(2),
    jurisdiction_province_state VARCHAR(100),
    -- Validity
    issued_date         DATE,
    expiry_date         DATE,
    -- Verification
    status              credential_status NOT NULL DEFAULT 'PENDING_REVIEW',
    verified_at         TIMESTAMP WITH TIME ZONE,
    verified_by         UUID REFERENCES users(id),
    rejection_reason    TEXT,
    -- Document storage
    document_url        TEXT,
    document_hash       VARCHAR(128),
    -- Metadata
    created_at          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_credential_dates CHECK (
        issued_date IS NULL OR expiry_date IS NULL OR issued_date <= expiry_date
    )
);

-- ---- Provider insurance policies ----
CREATE TABLE provider_insurance_policies (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_id         UUID NOT NULL REFERENCES provider_profiles(id) ON DELETE CASCADE,
    -- Policy details
    policy_number       VARCHAR(200) NOT NULL,
    insurer_name        VARCHAR(300) NOT NULL,
    policy_type         VARCHAR(100) NOT NULL,   -- e.g. 'general_liability', 'professional_liability'
    -- Coverage
    coverage_amount_cents BIGINT NOT NULL,        -- stored in cents
    deductible_cents    BIGINT,
    -- Validity
    effective_date      DATE NOT NULL,
    expiry_date         DATE NOT NULL,
    -- Verification
    status              insurance_status NOT NULL DEFAULT 'PENDING_REVIEW',
    verified_at         TIMESTAMP WITH TIME ZONE,
    verified_by         UUID REFERENCES users(id),
    -- Document
    document_url        TEXT,
    document_hash       VARCHAR(128),
    -- Metadata
    created_at          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_insurance_dates CHECK (effective_date <= expiry_date),
    CONSTRAINT chk_coverage_amount CHECK (coverage_amount_cents > 0)
);

-- ---- Legal consents audit table ----
-- Every consent action is an immutable row. Never UPDATE or DELETE.
CREATE TABLE legal_consents (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    consent_type        consent_type NOT NULL,
    -- Consent version tracking
    consent_version     VARCHAR(50) NOT NULL,
    consent_text_hash   VARCHAR(128) NOT NULL,  -- SHA-512 of the consent text
    -- The full consent text at the moment of signing (immutable snapshot)
    consent_text        TEXT NOT NULL,
    -- Consent action
    granted             BOOLEAN NOT NULL,
    -- Audit fields
    ip_address          INET,
    user_agent          TEXT,
    device_id           VARCHAR(255),
    -- Timestamp — use created_at only, never updated
    created_at          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    -- NOTE: no updated_at — consent records are immutable
);

-- ---- Indexes ----
CREATE INDEX idx_credentials_provider ON provider_credentials (provider_id);
CREATE INDEX idx_credentials_status ON provider_credentials (status);
CREATE INDEX idx_credentials_expiry ON provider_credentials (expiry_date)
    WHERE expiry_date IS NOT NULL;
CREATE INDEX idx_credentials_type_provider ON provider_credentials (provider_id, credential_type);

CREATE INDEX idx_insurance_provider ON provider_insurance_policies (provider_id);
CREATE INDEX idx_insurance_status ON provider_insurance_policies (status);
CREATE INDEX idx_insurance_expiry ON provider_insurance_policies (expiry_date);

CREATE INDEX idx_consents_user ON legal_consents (user_id);
CREATE INDEX idx_consents_type_user ON legal_consents (user_id, consent_type);
CREATE INDEX idx_consents_version ON legal_consents (consent_type, consent_version);
CREATE INDEX idx_consents_created ON legal_consents (created_at DESC);

-- ---- Triggers (no trigger on legal_consents — immutable) ----
CREATE TRIGGER trg_credentials_updated_at
    BEFORE UPDATE ON provider_credentials
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_insurance_updated_at
    BEFORE UPDATE ON provider_insurance_policies
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

COMMIT;
