-- ============================================================================
-- Migration 023 — Task search aliases (smarter "What needs doing?" search)
-- ============================================================================
-- Adds a small curated synonym/alias list per task so natural-language phrases
-- ("clean my AC", "mow the grass") map to the right CLOSED-CATALOG task. The
-- matcher (taxonomy_service.search_tasks) also auto-tokenizes name/description/
-- escalation_keywords; aliases just boost common phrasings. Keep the seed small
-- and grow it from real queries.
-- ============================================================================

BEGIN;

ALTER TABLE service_tasks
  ADD COLUMN search_aliases JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Curated aliases for the most commonly-typed requests --------------------
UPDATE service_tasks SET search_aliases = '["ac","a/c","air conditioner","air conditioning","ac cleaning","clean ac","clean my ac","hvac","furnace filter","ac filter","cooling"]'::jsonb WHERE slug = 'hvac-filter-replacement-cleaning';
UPDATE service_tasks SET search_aliases = '["ac","window ac","air conditioner","ac unit","install ac","ac install"]'::jsonb WHERE slug = 'window-ac-installation';
UPDATE service_tasks SET search_aliases = '["garage","clean garage","clean my garage","garage cleanup","declutter garage","organize garage","junk","clutter","mess"]'::jsonb WHERE slug = 'garage-cleanup-organization';
UPDATE service_tasks SET search_aliases = '["mow","mow lawn","mow the lawn","cut grass","cut the grass","grass cutting","lawn","grass"]'::jsonb WHERE slug = 'lawn-mowing';
UPDATE service_tasks SET search_aliases = '["clean house","house cleaning","home cleaning","clean my house","maid","cleaner","cleaning","tidy","tidy up"]'::jsonb WHERE slug = 'standard-residential-cleaning';
UPDATE service_tasks SET search_aliases = '["mount tv","hang tv","tv mount","wall mount tv","put up tv","tv on wall"]'::jsonb WHERE slug = 'tv-wall-mount-no-wiring';
UPDATE service_tasks SET search_aliases = '["ikea","assemble furniture","build furniture","furniture assembly","put together furniture"]'::jsonb WHERE slug = 'ikea-furniture-assembly';
UPDATE service_tasks SET search_aliases = '["light","change light","replace light","light fixture","ceiling light","change a lightbulb","light bulb"]'::jsonb WHERE slug = 'light-fixture-replacement';
UPDATE service_tasks SET search_aliases = '["groceries","grocery","grocery shopping","buy groceries","shopping","food shopping"]'::jsonb WHERE slug = 'grocery-shopping';
UPDATE service_tasks SET search_aliases = '["rake leaves","rake the leaves","leaves","yard cleanup","rake","fall cleanup"]'::jsonb WHERE slug = 'leaf-raking-yard-cleanup';
UPDATE service_tasks SET search_aliases = '["pressure wash","power wash","power washing","driveway clean","wash driveway"]'::jsonb WHERE slug = 'pressure-washing-driveway-patio';
UPDATE service_tasks SET search_aliases = '["move out","moveout","move out clean","end of lease cleaning","moving out clean"]'::jsonb WHERE slug = 'move-out-cleaning';
UPDATE service_tasks SET search_aliases = '["clean bathroom","clean the bathroom","bathroom","scrub bathroom"]'::jsonb WHERE slug = 'bathroom-deep-cleaning';
UPDATE service_tasks SET search_aliases = '["clean kitchen","clean the kitchen","kitchen","scrub kitchen"]'::jsonb WHERE slug = 'kitchen-deep-cleaning';
UPDATE service_tasks SET search_aliases = '["clean windows","clean the windows","window cleaning","windows","wash windows"]'::jsonb WHERE slug = 'window-cleaning-interior';
UPDATE service_tasks SET search_aliases = '["dog walk","walk my dog","walk the dog","dog walking","pet walk"]'::jsonb WHERE slug IN (SELECT slug FROM service_tasks WHERE slug LIKE 'dog-walk%' LIMIT 1);
UPDATE service_tasks SET search_aliases = '["junk","haul away","junk removal","remove junk","get rid of stuff","trash removal","throw away"]'::jsonb WHERE slug IN (SELECT slug FROM service_tasks WHERE slug LIKE '%junk%' OR slug LIKE '%hauling%' OR slug LIKE '%removal%' LIMIT 1);

COMMIT;
