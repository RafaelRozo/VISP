-- ============================================================================
-- Migration 018 — Stripe Connect Accounts v2 onboarding (test environment)
-- ============================================================================
--
-- Switches provider onboarding from legacy `type='express'` (Stripe-hosted) to
-- `POST /v2/core/accounts` with `controller.requirement_collection='application'`
-- so the VISP app collects identity, tax, bank, and TOS data natively and
-- pushes it to Stripe via our backend.
--
-- Since the platform is in test mode and we explicitly want to abandon all
-- existing Express accounts, this migration **clears** existing
-- `stripe_account_id` values. Any provider that previously started Express
-- onboarding will re-initialise their account through the new v2 flow.
--
-- Stripe-side prerequisites (must be enabled in the Dashboard before this
-- migration is useful in production):
--   1. Connect → Settings → "Accounts v2 API access" toggled on.
--   2. Compliance review (PLATFORM_INFO questionnaire) submitted & approved.
--   3. Stripe Identity product enabled (for KYC document upload).
-- ============================================================================

BEGIN;

-- 1. Drop any existing Express account references (test data, intentional).
UPDATE provider_profiles
SET    stripe_account_id = NULL
WHERE  stripe_account_id IS NOT NULL;

-- 2. Track the onboarding step so the mobile app can resume the flow.
--    Valid values: 'identity' | 'tax' | 'bank' | 'identity_doc' | 'tos' | 'complete'.
ALTER TABLE provider_profiles
  ADD COLUMN IF NOT EXISTS stripe_onboarding_step TEXT;

-- 3. Captures the TOS acceptance fingerprint required by Stripe Services
--    Agreement (we collect the IP + user agent + timestamp when the provider
--    taps "I accept" on the mobile TOS screen, and forward to Stripe via
--    account.update(tos_acceptance=...)).
ALTER TABLE provider_profiles
  ADD COLUMN IF NOT EXISTS stripe_tos_accepted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS stripe_tos_acceptance_ip TEXT,
  ADD COLUMN IF NOT EXISTS stripe_tos_acceptance_user_agent TEXT;

-- 4. The provider's bank account id (`ba_...`) once tokenised + attached.
ALTER TABLE provider_profiles
  ADD COLUMN IF NOT EXISTS stripe_external_account_id TEXT;

-- 5. Stripe Identity verification session id (`vs_...`) — used to look up
--    the verification result and document statuses.
ALTER TABLE provider_profiles
  ADD COLUMN IF NOT EXISTS stripe_identity_session_id TEXT;

-- 6. Cached requirements snapshot from the last `accounts.retrieve` —
--    `currently_due` lets the mobile UI compute the next step without
--    hitting Stripe on every render.
ALTER TABLE provider_profiles
  ADD COLUMN IF NOT EXISTS stripe_requirements_due JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS stripe_capabilities JSONB NOT NULL DEFAULT '{}'::jsonb;

-- 7. Convenience index for webhook lookups by account id.
CREATE INDEX IF NOT EXISTS idx_provider_stripe_account
  ON provider_profiles(stripe_account_id)
  WHERE stripe_account_id IS NOT NULL;

COMMIT;
