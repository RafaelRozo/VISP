-- ============================================================================
-- Migration 026 — Service fee + overage approval (Provider-Set Pricing · PP4c)
-- ============================================================================
-- Model C: the customer covers the Stripe processing fee as a visible
-- "Tarifa de servicio" line (gross-up of 2.9% + $0.30, CA). VISP keeps the full
-- commission; the provider receives their full payout.
--   total_charged = subtotal + service_tax + tip + service_fee
--
-- Overage (D4): the authorization holds total_charged × (1 + capture_buffer).
-- At completion the actual amount is captured; if it exceeds the held ceiling
-- the customer must approve the overage (overage_approved_at) before the extra
-- is charged — otherwise we capture up to the ceiling and the remainder goes to
-- support/dispute.
-- ============================================================================

BEGIN;

ALTER TABLE jobs
  ADD COLUMN service_fee_cents      BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN authorized_amount_cents BIGINT,                 -- the held ceiling
  ADD COLUMN capture_buffer_pct     NUMERIC(4,3) NOT NULL DEFAULT 0.300,
  ADD COLUMN actual_total_cents     BIGINT,                  -- reconciled at close
  ADD COLUMN overage_approved_at    TIMESTAMPTZ,
  ADD CONSTRAINT chk_jobs_service_fee_nonneg CHECK (service_fee_cents >= 0),
  ADD CONSTRAINT chk_jobs_capture_buffer CHECK (capture_buffer_pct >= 0 AND capture_buffer_pct < 5);

ALTER TABLE pricing_events
  ADD COLUMN service_fee_cents BIGINT NOT NULL DEFAULT 0;

COMMIT;
