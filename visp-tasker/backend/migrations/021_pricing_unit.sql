-- ============================================================================
-- Migration 021 — Pricing unit per catalog task (Provider-Set Pricing · PP1)
-- ============================================================================
-- Each service_task gains a `pricing_unit` describing HOW it is charged
-- (hour / piece / m² / linear-m / visit / flat package / custom quote). The
-- unit is a property of the TASK (closed catalog rule) — the provider only
-- sets the rate, never the unit. Enum labels use UPPERCASE member names to
-- match the SQLAlchemy native-enum convention (see provider_level).
-- ============================================================================

BEGIN;

-- Enum type ------------------------------------------------------------------
CREATE TYPE pricing_unit AS ENUM (
  'HOURLY', 'PER_UNIT', 'PER_AREA', 'PER_LINEAR_M',
  'PER_VISIT', 'FLAT_PACKAGE', 'CUSTOM_QUOTE'
);

-- service_tasks columns ------------------------------------------------------
ALTER TABLE service_tasks
  ADD COLUMN pricing_unit    pricing_unit  NOT NULL DEFAULT 'HOURLY',
  ADD COLUMN allows_quantity BOOLEAN       NOT NULL DEFAULT TRUE,
  ADD COLUMN min_quantity    NUMERIC(10,2) NOT NULL DEFAULT 1;

-- Backfill by category (default unit per §4.2 of the design spec) ------------
UPDATE service_tasks st
SET pricing_unit = (
  CASE sc.slug
    WHEN 'assembly'   THEN 'PER_UNIT'
    WHEN 'plumbing'   THEN 'PER_UNIT'
    WHEN 'electrical' THEN 'PER_UNIT'
    WHEN 'hvac'       THEN 'PER_UNIT'
    WHEN 'painting'   THEN 'PER_AREA'
    WHEN 'pet-care'   THEN 'PER_VISIT'
    ELSE 'HOURLY'
  END
)::pricing_unit
FROM service_categories sc
WHERE st.category_id = sc.id;

-- L3 / L4 are licensed / regulated / emergency → negotiated quote, not a fixed
-- per-unit rate (preserves the existing NEGOTIATED / EMERGENCY_NEGOTIATED
-- behaviour). This override runs last so it wins over the category default.
UPDATE service_tasks
SET pricing_unit = 'CUSTOM_QUOTE'
WHERE level IN ('LEVEL_3', 'LEVEL_4');

-- Custom-quote tasks have no fixed booking quantity (price agreed per job).
UPDATE service_tasks
SET allows_quantity = FALSE
WHERE pricing_unit = 'CUSTOM_QUOTE';

COMMIT;
