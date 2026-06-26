-- ============================================================================
-- Migration 022 — Provider-set service rates (Provider-Set Pricing · PP2)
-- ============================================================================
-- A provider sets THEIR OWN rate for a service they are qualified for. The
-- rate is clamped (in the service layer) to the task's
-- base_price_min_cents..base_price_max_cents guardrail (level stays the
-- guardrail; closed catalog preserved). `unit` is snapshotted from the task
-- at the moment the rate is set, so an audit always shows what the provider
-- priced against even if the catalog unit later changes.
--
-- The B2B mirror (company_service_rates) is a fast-follow with the same shape
-- keyed by company_id; see CompanyService in migration 019.
-- ============================================================================

BEGIN;

CREATE TABLE provider_service_rates (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id      UUID NOT NULL REFERENCES provider_profiles(id) ON DELETE CASCADE,
  task_id          UUID NOT NULL REFERENCES service_tasks(id) ON DELETE CASCADE,
  unit             pricing_unit NOT NULL,
  rate_cents       INTEGER NOT NULL,
  min_charge_cents INTEGER,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_provider_service_rate UNIQUE (provider_id, task_id),
  CONSTRAINT chk_provider_rate_positive CHECK (rate_cents >= 0),
  CONSTRAINT chk_provider_min_charge CHECK (
    min_charge_cents IS NULL OR min_charge_cents >= 0
  )
);
CREATE INDEX ix_provider_service_rates_provider ON provider_service_rates (provider_id);
CREATE INDEX ix_provider_service_rates_task ON provider_service_rates (task_id);

COMMIT;
