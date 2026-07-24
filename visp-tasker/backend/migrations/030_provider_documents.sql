-- ============================================================================
-- Migration 030 — Provider profile documents (bio-adjacent certificates)
-- ============================================================================
-- A provider can showcase free-form documents/certificates that are NOT tied to
-- any service or credential-gating (e.g. a first-aid card, a reference letter,
-- a diploma). These are purely informational — shown to customers in the radar
-- and job-status provider preview alongside the bio + years of experience.
--
-- `bio` and `years_experience` already live on provider_profiles (used here as
-- the profile summary the provider writes themselves).
--
-- Files are stored on disk under uploads/provider_documents/<provider_id>/ (same
-- plaintext scheme as credentials/avatars). Additive only, safe on existing DB.
-- ============================================================================

CREATE TABLE IF NOT EXISTS provider_documents (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_id   UUID NOT NULL REFERENCES provider_profiles(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    document_url  TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_provider_documents_provider
    ON provider_documents (provider_id);
