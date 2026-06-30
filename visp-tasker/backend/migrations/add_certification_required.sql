-- Migration: Add certification_required column to service_tasks
-- This distinguishes services that need a certification/document upload
-- from those that need a license.

ALTER TABLE service_tasks
ADD COLUMN IF NOT EXISTS certification_required BOOLEAN NOT NULL DEFAULT FALSE;

-- Example: Update specific tasks that require certification
-- UPDATE service_tasks SET certification_required = TRUE WHERE slug IN ('electrical-wiring', 'gas-fitting');
