-- ============================================================================
-- Migration 024 — Tax engine (Provider-Set Pricing · PP3)
-- ============================================================================
-- Canada sales-tax layer for the provider-set pricing waterfall (D3):
--   subtotal → + service_tax (province rate × subtotal) → + tip = total_charged
--
-- The provider/company is the Merchant of Record and REMITS the tax; VISP only
-- calculates, displays and stores it. Tax is charged ONLY when the provider is
-- tax-registered (tax_registered = TRUE). Default FALSE → no tax line, which is
-- the conservative resolution of accountant open-item #1 ("provider sin GST
-- registro → NO tax line") until a provider is explicitly marked registered.
--
-- Place of supply for a service = where it is performed → the rate is keyed on
-- jobs.service_province_state, NOT the provider's home province.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Province / territory tax-rate table (CA). One row per jurisdiction.
-- combined_rate is the single rate applied to the subtotal; the gst/pst/hst
-- breakdown is kept for receipts and future per-component remittance.
-- ---------------------------------------------------------------------------
CREATE TABLE province_tax_rates (
  province_code   VARCHAR(2)  PRIMARY KEY,          -- ON, BC, QC, ...
  country_code    VARCHAR(2)  NOT NULL DEFAULT 'CA',
  province_name   VARCHAR(60) NOT NULL,
  tax_type        VARCHAR(20) NOT NULL,             -- 'HST' | 'GST' | 'GST+PST' | 'GST+QST'
  gst_rate        NUMERIC(6,5) NOT NULL DEFAULT 0,  -- federal GST component
  pst_rate        NUMERIC(6,5) NOT NULL DEFAULT 0,  -- provincial PST/QST component
  hst_rate        NUMERIC(6,5) NOT NULL DEFAULT 0,  -- harmonized component (HST provinces)
  combined_rate   NUMERIC(6,5) NOT NULL,            -- the rate actually applied
  label           VARCHAR(40) NOT NULL,             -- customer-facing, e.g. 'HST (13%)'
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  effective_date  DATE NOT NULL DEFAULT '2025-01-01',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_province_combined_rate CHECK (combined_rate >= 0 AND combined_rate < 1)
);

-- Canadian rates as of 2026 (NS HST reduced to 14% on 2025-04-01).
INSERT INTO province_tax_rates
  (province_code, province_name, tax_type, gst_rate, pst_rate, hst_rate, combined_rate, label) VALUES
  ('AB', 'Alberta',                   'GST',     0.05000, 0.00000, 0.00000, 0.05000, 'GST (5%)'),
  ('BC', 'British Columbia',          'GST+PST', 0.05000, 0.07000, 0.00000, 0.12000, 'GST+PST (12%)'),
  ('MB', 'Manitoba',                  'GST+PST', 0.05000, 0.07000, 0.00000, 0.12000, 'GST+PST (12%)'),
  ('NB', 'New Brunswick',             'HST',     0.00000, 0.00000, 0.15000, 0.15000, 'HST (15%)'),
  ('NL', 'Newfoundland and Labrador', 'HST',     0.00000, 0.00000, 0.15000, 0.15000, 'HST (15%)'),
  ('NS', 'Nova Scotia',               'HST',     0.00000, 0.00000, 0.14000, 0.14000, 'HST (14%)'),
  ('NT', 'Northwest Territories',     'GST',     0.05000, 0.00000, 0.00000, 0.05000, 'GST (5%)'),
  ('NU', 'Nunavut',                   'GST',     0.05000, 0.00000, 0.00000, 0.05000, 'GST (5%)'),
  ('ON', 'Ontario',                   'HST',     0.00000, 0.00000, 0.13000, 0.13000, 'HST (13%)'),
  ('PE', 'Prince Edward Island',      'HST',     0.00000, 0.00000, 0.15000, 0.15000, 'HST (15%)'),
  ('QC', 'Quebec',                    'GST+QST', 0.05000, 0.09975, 0.00000, 0.14975, 'GST+QST (14.975%)'),
  ('SK', 'Saskatchewan',              'GST+PST', 0.05000, 0.06000, 0.00000, 0.11000, 'GST+PST (11%)'),
  ('YT', 'Yukon',                     'GST',     0.05000, 0.00000, 0.00000, 0.05000, 'GST (5%)');

-- ---------------------------------------------------------------------------
-- Provider tax-registration flags. Default FALSE → no tax charged (open-item #1).
-- ---------------------------------------------------------------------------
ALTER TABLE provider_profiles
  ADD COLUMN tax_registered BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN tax_number     VARCHAR(30);   -- GST/HST registration number (nullable)

-- ---------------------------------------------------------------------------
-- Job tax snapshot (immutable record of what the customer was charged).
-- ---------------------------------------------------------------------------
ALTER TABLE jobs
  ADD COLUMN service_tax_cents  BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN tax_rate_applied   NUMERIC(6,5),       -- NULL when no tax (not registered)
  ADD COLUMN tax_jurisdiction   VARCHAR(40),        -- e.g. 'ON' or label, NULL when no tax
  ADD COLUMN total_charged_cents BIGINT;            -- subtotal + service_tax + tip

-- ---------------------------------------------------------------------------
-- Pricing-event snapshot extensions (full receipt waterfall, immutable).
-- commission_*/provider_payout_cents already exist on this table.
-- ---------------------------------------------------------------------------
ALTER TABLE pricing_events
  ADD COLUMN subtotal_cents     BIGINT,
  ADD COLUMN service_tax_cents  BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN tax_rate           NUMERIC(6,5),
  ADD COLUMN tip_cents          BIGINT NOT NULL DEFAULT 0;

COMMIT;
