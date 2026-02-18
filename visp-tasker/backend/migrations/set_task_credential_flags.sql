-- ============================================================================
-- Set certification_required and license_required flags on service_tasks
-- based on the nature of each task and its level requirements.
--
-- Classification:
--   - No docs needed: Cleaning (L1-L2), Mounting (L1-L2)
--   - Certification required: Plumbing L2, Electrical L2
--   - License required: Plumbing L3, Electrical L3 (also regulated)
-- ============================================================================

BEGIN;

-- ==== CERTIFICATION REQUIRED ====
-- Plumbing Level 2 tasks: needs trade certification
UPDATE service_tasks
SET certification_required = TRUE, regulated = TRUE
WHERE slug IN ('leak-repair');

-- Electrical Level 2 tasks: needs electrician certification
UPDATE service_tasks
SET certification_required = TRUE, regulated = TRUE
WHERE slug IN ('light-install');


-- ==== LICENSE REQUIRED ====
-- Plumbing Level 3 tasks: needs full plumbing license
UPDATE service_tasks
SET license_required = TRUE, regulated = TRUE, structural = TRUE
WHERE slug IN ('toilet-install');

-- Electrical Level 3 tasks: needs full electrician license
UPDATE service_tasks
SET license_required = TRUE, regulated = TRUE, hazardous = TRUE
WHERE slug IN ('outlet-replace');

COMMIT;
