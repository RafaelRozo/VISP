-- ============================================================================
-- Migration 027 — Company-set service prices (B2B mirror of provider rates)
-- ============================================================================
-- A company sets its OWN price per enabled service, clamped (in the service
-- layer) to the task's base_price_min_cents..base_price_max_cents guardrail —
-- exactly like provider_service_rates, but on the existing company_services
-- enablement row (keyed company_id+task_id). `unit` is snapshotted from the
-- task. rate_cents NULL = service enabled but not priced yet.
-- ============================================================================

BEGIN;

ALTER TABLE company_services
  ADD COLUMN unit             pricing_unit,
  ADD COLUMN rate_cents       INTEGER,
  ADD COLUMN min_charge_cents INTEGER,
  ADD CONSTRAINT chk_company_rate_nonneg CHECK (rate_cents IS NULL OR rate_cents >= 0),
  ADD CONSTRAINT chk_company_min_charge CHECK (min_charge_cents IS NULL OR min_charge_cents >= 0);

COMMIT;
