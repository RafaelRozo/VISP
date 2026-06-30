-- ============================================================================
-- Migration 025 — Customer-confirmed booking quantity (Provider-Set Pricing · PP4a)
-- ============================================================================
-- The customer picks the real quantity at booking (e.g. 3 chairs to assemble,
-- 25 m² to paint). It is the multiplier applied to the provider's rate when the
-- job is repriced on accept: subtotal = rate × quantity (floored at min_charge).
--
-- NULL = quantity not captured → the reprice falls back to the catalog estimate
-- (estimate_quantity_for). Only meaningful for tasks with allows_quantity = TRUE;
-- HOURLY/PER_VISIT/FLAT keep their estimate-derived quantity.
-- ============================================================================

BEGIN;

ALTER TABLE jobs
  ADD COLUMN quantity NUMERIC(10,2),
  ADD CONSTRAINT chk_jobs_quantity_positive CHECK (quantity IS NULL OR quantity > 0);

COMMIT;
