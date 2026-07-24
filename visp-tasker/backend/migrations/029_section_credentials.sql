-- ============================================================================
-- Migration 029 — Section-based credentials + level gating + help messages
-- ============================================================================
-- Rework: documentation is no longer requested per SERVICE (task). It moves up
-- to the SECTION (service_categories). A section can declare that it REQUIRES a
-- credential; when it does, the whole section is gated: only providers who have
-- uploaded + had a section document approved (i.e. LEVEL_2+) can offer/be matched
-- to its services. Services themselves become plain "I offer this" checkboxes.
--
-- Decisions (Ricardo, 2026-07-23):
--   * Gating is per SECTION (whole section), not per service.
--   * Unlock is a GLOBAL flip L1 -> L2 (first approved credential of ANY section).
--   * License class stored on the credential (full Ontario list; G2/G are the
--     ones actually used — no truck/bus classes in practice).
--   * Each section carries a bilingual (EN/FR) help_message shown as an in-app
--     pop-up before the provider uploads that section's document.
--   * LEVEL_4 / emergency is being shelved for now (handled in code, not here).
--
-- Additive + backfill only. Safe on an existing DB. Applied to visp_prod (clone).
-- ============================================================================

BEGIN;

-- 1. Ontario driver's licence classes (only G2 and G are relevant in practice,
--    but we store the full official list for completeness / future use).
CREATE TYPE license_class AS ENUM (
    'G1', 'G2', 'G', 'A', 'AR', 'D', 'B', 'C', 'E', 'F'
);

-- 2. Section-level gating + bilingual help pop-up.
ALTER TABLE service_categories
    ADD COLUMN requires_credential BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN help_message_en     TEXT,
    ADD COLUMN help_message_fr     TEXT;

-- 3. Credentials move from task -> section, and can record a licence class.
--    task_id is KEPT for backward compatibility but is no longer used for gating.
ALTER TABLE provider_credentials
    ADD COLUMN category_id   UUID REFERENCES service_categories(id) ON DELETE SET NULL,
    ADD COLUMN license_class license_class;

-- ----------------------------------------------------------------------------
-- Backfills (make the clone coherent with the new model without hand-recapture)
-- ----------------------------------------------------------------------------

-- 3a. A section requires a credential if ANY of its tasks currently carries a
--     regulatory flag or a level above LEVEL_1. Sections with only free LEVEL_1
--     tasks stay open (visible to L1 providers).
UPDATE service_categories c
SET requires_credential = TRUE
WHERE EXISTS (
    SELECT 1 FROM service_tasks t
    WHERE t.category_id = c.id
      AND (
            t.certification_required
         OR t.license_required
         OR t.regulated
         OR t.level <> 'LEVEL_1'
      )
);

-- 3b. Map existing per-task credentials to their task's section.
UPDATE provider_credentials pc
SET category_id = t.category_id
FROM service_tasks t
WHERE pc.task_id = t.id
  AND pc.category_id IS NULL;

-- 4. Helpful index for the matching / catalog gate (section lookup on tasks).
CREATE INDEX IF NOT EXISTS idx_service_tasks_category_id
    ON service_tasks (category_id);
CREATE INDEX IF NOT EXISTS idx_provider_credentials_category_id
    ON provider_credentials (category_id);

COMMIT;
