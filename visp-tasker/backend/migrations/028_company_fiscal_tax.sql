-- ============================================================================
-- Migration 028 — Company fiscal address + tax registration
-- ============================================================================
-- VISP does NOT remit/declare the company's tax — the company is the seller and
-- declares its own earnings. We record the company's FISCAL (registered) address
-- + GST/HST registration purely to know the jurisdiction and to evidence that
-- the company is the responsible party (protection). Whether HST is charged on
-- the company's jobs is governed by tax_registered (mirror of provider).
-- Note: place-of-supply for a job's tax is still the JOB's service province;
-- the fiscal address is the company's registered address (records/protection).
-- ============================================================================

BEGIN;

ALTER TABLE companies
  ADD COLUMN fiscal_address_line1 VARCHAR(300),
  ADD COLUMN fiscal_address_line2 VARCHAR(300),
  ADD COLUMN fiscal_city          VARCHAR(120),
  ADD COLUMN fiscal_province      VARCHAR(2),   -- CA province code: ON, BC, QC ...
  ADD COLUMN fiscal_postal_code   VARCHAR(20),
  ADD COLUMN fiscal_country       VARCHAR(2) NOT NULL DEFAULT 'CA',
  ADD COLUMN tax_registered       BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN tax_number           VARCHAR(30);  -- GST/HST registration number

COMMIT;
