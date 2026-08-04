-- 033_catalog_relevel_l0_l3.sql
-- Reestructuración de niveles L0..L3 — PASO 3: DATOS DEL CATÁLOGO.
--
-- Generado desde docs/revision-niveles-l0-l3.csv (no editar a mano: regenerar).
-- SOLO cambia el NIVEL de los servicios, más los renombres explícitos.
-- Precios, duraciones, descripciones, unidades y flags NO se tocan.
--
--   116 servicios cambian de nivel
--   22 servicios L4 se DESACTIVAN (is_active=false; no se borran, hay FK desde jobs)
--   7 servicios se renombran
--   2 servicios se crean
--
-- Requiere 031 y 032 aplicadas.

BEGIN;

-- ==========================================================================
-- 1. Renombres
--    3 por estrechamiento de scope pedido por el cliente,
--    3 al retirar el prefijo 'Emergency' (L4 se elimina del producto),
--    1 al partir Events en 3 servicios.
-- ==========================================================================
UPDATE service_tasks SET name = 'Door / Lock Repair', updated_at = NOW() WHERE name = 'Emergency Door / Lock Repair';
UPDATE service_tasks SET name = 'Roof Leak Repair', updated_at = NOW() WHERE name = 'Emergency Roof Leak / Tarping';
UPDATE service_tasks SET name = 'Power Loss Diagnosis', updated_at = NOW() WHERE name = 'Emergency Total Power Loss';
UPDATE service_tasks SET name = 'Event Service (No Food)', updated_at = NOW() WHERE name = 'Event Serving Assistance';
UPDATE service_tasks SET name = 'Exterior Waterproofing — Coating Only', updated_at = NOW() WHERE name = 'Exterior Waterproofing (Foundation)';
UPDATE service_tasks SET name = 'Hot Tub Moving — Transportation Only', updated_at = NOW() WHERE name = 'Hot Tub / Spa Moving';
UPDATE service_tasks SET name = 'Popcorn Ceiling Removal — Asbestos-Free Only', updated_at = NOW() WHERE name = 'Popcorn Ceiling Removal (Single Room)';

-- ==========================================================================
-- 2. Cambio de nivel
-- ==========================================================================
-- -> LEVEL_0  (36 servicios)
UPDATE service_tasks SET level = 'LEVEL_0', updated_at = NOW() WHERE name IN (
    'Balloon & Decoration Setup',
    'Dog Bathing (Small/Medium)',
    'Dog Walking (30 min)',
    'Dog Walking (60 min)',
    'Donation Drop-Off',
    'Driveway Snow Shoveling',
    'Dry Cleaning Pickup & Drop-Off',
    'Event Service (No Food)',
    'Event Teardown & Cleanup',
    'Furniture Rearrangement',
    'Garage Cleanup & Organization',
    'Grocery Shopping',
    'Hedge Trimming (Under 6ft)',
    'Junk Removal (Light)',
    'Leaf Raking & Yard Cleanup',
    'Litter Box & Pet Area Cleaning',
    'Local Apartment Move (Studio/1BR)',
    'Move-Out Cleaning',
    'Mulching',
    'Oven & Stovetop Cleaning',
    'Package Pickup & Delivery',
    'Party Setup (Tables & Chairs)',
    'Pet Feeding Visit',
    'Pet Sitting (Half Day)',
    'Prescription Pickup',
    'Pressure Washing (Driveway & Patio)',
    'Pressure Washing (House Exterior)',
    'Refrigerator Deep Cleaning',
    'Return Item to Store',
    'Small Item Moving (Same Building)',
    'Standard Residential Cleaning',
    'Storage Unit Organization',
    'Tent & Canopy Setup',
    'Waiting in Line',
    'Watering Plants & Gardens',
    'Window Cleaning (Interior & Ground Level Exterior)');

-- -> LEVEL_1  (50 servicios)
UPDATE service_tasks SET level = 'LEVEL_1', updated_at = NOW() WHERE name IN (
    'Attic Insulation Upgrade',
    'Baby-Proofing & Safety Installation',
    'Backsplash Tile Installation',
    'Baseboard & Crown Moulding Installation',
    'Blinds & Curtain Rod Installation',
    'Caulking & Grout Refresh (Bathroom)',
    'Ceramic / Porcelain Tile Floor Installation',
    'Concrete Patio / Walkway Pouring',
    'Countertop Installation (Granite/Quartz)',
    'Custom Shower Tile Installation',
    'Deck Staining & Sealing',
    'Door Adjustment & Hardware Replacement',
    'Driveway Paving (Asphalt)',
    'Drywall Patching & Repair',
    'Exterior Door Replacement (Entry)',
    'Exterior Painting (Single Storey)',
    'Exterior Waterproofing — Coating Only',
    'Fence Board Replacement',
    'Fence Installation (Full)',
    'Floating Shelf Installation',
    'Garage Door Replacement',
    'Garage Shelving Installation',
    'Garden Bed Edging & Border Install',
    'HVAC Filter Replacement & Cleaning',
    'Hardwood Floor Installation',
    'Hardwood Floor Refinishing',
    'Heavy Furniture Moving (Stairs)',
    'Hot Tub Moving — Transportation Only',
    'Interior Door Installation (Pre-Hung)',
    'Kitchen Cabinet Installation',
    'Laminate Flooring Installation',
    'Multi-Room Interior Painting',
    'Outdoor Hose Bib Winterization',
    'Paver Patio Installation (Small)',
    'Popcorn Ceiling Removal — Asbestos-Free Only',
    'Portable Heater / Space Heater Setup',
    'Showerhead & Fixture Upgrade',
    'Smart Home Hub Setup & Configuration',
    'Snow Blower Service',
    'Sod Laying',
    'Soffit & Fascia Replacement',
    'Sprinkler Head Replacement',
    'TV Wall Mount with Concealed Wiring',
    'Tree Pruning (Small Trees)',
    'Under-Cabinet LED Lighting',
    'Vinyl Plank Flooring Installation',
    'Wallpaper Removal',
    'Weatherstripping & Caulking (Doors/Windows)',
    'Window AC Unit Installation',
    'Window Replacement');

-- -> LEVEL_2  (25 servicios)
UPDATE service_tasks SET level = 'LEVEL_2', updated_at = NOW() WHERE name IN (
    'Door / Lock Repair',
    'Duct Cleaning (Professional NADCA Standard)',
    'EV Charger Installation (Level 2)',
    'Exterior Siding Replacement',
    'Foundation Crack Repair (Interior Injection)',
    'French Drain Installation',
    'Gutter Guard Installation',
    'HVAC System Annual Inspection & Tune-Up',
    'Home Security System Hardwired Installation',
    'Irrigation System Installation',
    'Knob-and-Tube Wiring Replacement',
    'Large Tree Removal',
    'Load-Bearing Wall Modification',
    'Retaining Wall Construction',
    'Roof Repair (Shingles)',
    'Roof Snow Removal',
    'Room Addition Framing',
    'Skylight Installation',
    'Staircase Construction / Renovation',
    'Structural Beam Installation',
    'Stucco Application / Repair',
    'Sump Pump Installation (New)',
    'Tankless Water Heater Installation',
    'Water Heater Replacement (Tank)',
    'Water Softener Installation');

-- -> LEVEL_3  (5 servicios)
UPDATE service_tasks SET level = 'LEVEL_3', updated_at = NOW() WHERE name IN (
    'GFCI Outlet Installation',
    'Lead Paint Remediation',
    'Power Loss Diagnosis',
    'Roof Leak Repair',
    'Sump Pump Testing & Maintenance');

-- ==========================================================================
-- 3. Desactivar los servicios L4 sin equivalente en el nuevo modelo.
--    No se borran: hay jobs históricos que los referencian.
-- ==========================================================================
UPDATE service_tasks SET is_active = FALSE, updated_at = NOW() WHERE name IN (
    'Emergency AC Failure (Extreme Heat)',
    'Emergency Boiler Failure',
    'Emergency Burst Pipe Repair',
    'Emergency Carbon Monoxide Detection Response',
    'Emergency Electrical Fire Damage Assessment',
    'Emergency Electrical Hazard Make-Safe',
    'Emergency Fire Damage Board-Up',
    'Emergency Flood Water Extraction',
    'Emergency Frozen Pipe Thawing',
    'Emergency Gas Furnace Relight / Repair',
    'Emergency Gas Leak Response',
    'Emergency Generator Hookup (Portable)',
    'Emergency Ice Dam Removal',
    'Emergency Main Water Shut-Off & Repair',
    'Emergency No Heat (Furnace Failure)',
    'Emergency Sewer Backup',
    'Emergency Storm Damage Response',
    'Emergency Structural Assessment',
    'Emergency Sump Pump Failure',
    'Emergency Tree on House',
    'Emergency Water Heater Failure',
    'Emergency Window Board-Up');

-- Retirar las cualificaciones que apuntaban a esos servicios.
UPDATE provider_task_qualifications q SET qualified = FALSE, updated_at = NOW()
  FROM service_tasks t WHERE t.id = q.task_id AND t.is_active = FALSE AND q.qualified = TRUE;

-- ==========================================================================
-- 4. Servicios nuevos (Events se parte en 3 por nivel de manejo).
--    Precio y duración se copian del servicio original para no inventar datos.
-- ==========================================================================
INSERT INTO service_tasks (
    id, category_id, slug, name, description, level,
    base_price_min_cents, base_price_max_cents, estimated_duration_min,
    pricing_unit, allows_quantity, min_quantity,
    regulated, license_required, certification_required, hazardous, structural,
    emergency_eligible, display_order, is_active, created_at, updated_at)
SELECT gen_random_uuid(), t.category_id, 'event-service-assistance-alcohol-handling',
       'Event Service Assistance (Alcohol Handling)', t.description, 'LEVEL_2',
       t.base_price_min_cents, t.base_price_max_cents, t.estimated_duration_min,
       t.pricing_unit, t.allows_quantity, t.min_quantity,
       FALSE, FALSE, TRUE, FALSE, FALSE,
       FALSE, t.display_order + 1, TRUE, NOW(), NOW()
  FROM service_tasks t WHERE t.name = 'Event Service (No Food)'
  AND NOT EXISTS (SELECT 1 FROM service_tasks x WHERE x.name = 'Event Service Assistance (Alcohol Handling)');

INSERT INTO service_tasks (
    id, category_id, slug, name, description, level,
    base_price_min_cents, base_price_max_cents, estimated_duration_min,
    pricing_unit, allows_quantity, min_quantity,
    regulated, license_required, certification_required, hazardous, structural,
    emergency_eligible, display_order, is_active, created_at, updated_at)
SELECT gen_random_uuid(), t.category_id, 'event-serving-assistance-food-handling',
       'Event Serving Assistance (Food Handling)', t.description, 'LEVEL_2',
       t.base_price_min_cents, t.base_price_max_cents, t.estimated_duration_min,
       t.pricing_unit, t.allows_quantity, t.min_quantity,
       FALSE, FALSE, TRUE, FALSE, FALSE,
       FALSE, t.display_order + 1, TRUE, NOW(), NOW()
  FROM service_tasks t WHERE t.name = 'Event Service (No Food)'
  AND NOT EXISTS (SELECT 1 FROM service_tasks x WHERE x.name = 'Event Serving Assistance (Food Handling)');

-- ==========================================================================
-- 5. Servicios que exigen licencia de conducir (el PDF marca G2/G).
-- ==========================================================================
UPDATE service_tasks SET requires_driver_license = TRUE, updated_at = NOW()
  WHERE name = 'Local Apartment Move (Studio/1BR)';

-- ==========================================================================
-- 6. Requisitos de credencial por SERVICIO (columna de cert del PDF).
--    mandatory=TRUE  -> obligatorio siempre.
--    mandatory=FALSE -> condicional o alternativo. Regla del motor: si un
--                       servicio no tiene NINGÚN requisito TRUE, se exige
--                       al menos UNO de los marcados FALSE.
-- ==========================================================================
INSERT INTO service_credential_requirements (task_id, code, mandatory)
SELECT t.id, v.code, v.mandatory
  FROM (VALUES
    ('Accessibility Renovation (Barrier-Free)', '306A', FALSE),
    ('Accessibility Renovation (Barrier-Free)', 'ESA_LEC', FALSE),
    ('Accessibility Renovation (Barrier-Free)', '309A', FALSE),
    ('Accessibility Renovation (Barrier-Free)', '309C', FALSE),
    ('Accessibility Renovation (Barrier-Free)', 'TSSA_EDM_E', FALSE),
    ('Accessibility Renovation (Barrier-Free)', 'BCIN', FALSE),
    ('Accessibility Renovation (Barrier-Free)', 'P_ENG', FALSE),
    ('Accessibility Renovation (Barrier-Free)', 'WAH_CPO', FALSE),
    ('Accessibility Renovation (Barrier-Free)', 'ASBESTOS_ON', FALSE),
    ('Aluminum Wiring Remediation', 'ESA_LEC', TRUE),
    ('Aluminum Wiring Remediation', '309A', FALSE),
    ('Aluminum Wiring Remediation', '309C', FALSE),
    ('Appliance Installation (Non-Gas)', '306A', FALSE),
    ('Appliance Installation (Non-Gas)', 'ESA_LEC', FALSE),
    ('Appliance Installation (Non-Gas)', '309A', FALSE),
    ('Appliance Installation (Non-Gas)', '309C', FALSE),
    ('Asbestos Testing & Abatement', 'ASBESTOS_ON', TRUE),
    ('Backflow Preventer Installation', '306A', TRUE),
    ('Backflow Preventer Installation', 'BACKFLOW', TRUE),
    ('Basement Finishing / Renovation', '306A', FALSE),
    ('Basement Finishing / Renovation', 'ESA_LEC', FALSE),
    ('Basement Finishing / Renovation', '309A', FALSE),
    ('Basement Finishing / Renovation', '309C', FALSE),
    ('Basement Finishing / Renovation', 'TSSA_FUELS', FALSE),
    ('Basement Finishing / Renovation', 'TSSA_G1', FALSE),
    ('Basement Finishing / Renovation', 'TSSA_G2', FALSE),
    ('Basement Finishing / Renovation', '313A', FALSE),
    ('Basement Finishing / Renovation', '313D', FALSE),
    ('Basement Finishing / Renovation', '308A', FALSE),
    ('Basement Finishing / Renovation', '308R', FALSE),
    ('Basement Finishing / Renovation', 'BCIN', FALSE),
    ('Basement Finishing / Renovation', 'P_ENG', FALSE),
    ('Bathroom Rough-In Plumbing', '306A', TRUE),
    ('Bathtub Replacement', '306A', TRUE),
    ('Biohazard Cleanup', 'WHMIS', TRUE),
    ('Biohazard Cleanup', 'BIOHAZARD', TRUE),
    ('Boiler Installation / Replacement', 'TSSA_FUELS', TRUE),
    ('Boiler Installation / Replacement', 'TSSA_G1', FALSE),
    ('Boiler Installation / Replacement', 'TSSA_G2', FALSE),
    ('Ceiling Fan Installation (Existing Box)', 'ESA_LEC', TRUE),
    ('Ceiling Fan Installation (Existing Box)', '309A', FALSE),
    ('Ceiling Fan Installation (Existing Box)', '309C', FALSE),
    ('Central Air Conditioner Installation', 'ODP', TRUE),
    ('Central Air Conditioner Installation', '313A', FALSE),
    ('Central Air Conditioner Installation', '313D', FALSE),
    ('Central Air Conditioner Installation', 'ESA_LEC', FALSE),
    ('Central Air Conditioner Installation', '309A', FALSE),
    ('Central Air Conditioner Installation', '308A', FALSE),
    ('Central Air Conditioner Installation', '308R', FALSE),
    ('Chimney Liner Installation', 'TSSA_FUELS', FALSE),
    ('Deck Construction (New Build)', 'WAH_CPO', TRUE),
    ('Deck Construction (New Build)', 'BUILDING_PERMIT', FALSE),
    ('Door / Lock Repair', '259L', TRUE),
    ('Drain Snaking (Sink/Tub)', '306A', TRUE),
    ('Ductwork Installation / Replacement', '308A', FALSE),
    ('Ductwork Installation / Replacement', '308R', FALSE),
    ('EV Charger Installation (Level 2)', 'ESA_LEC', TRUE),
    ('EV Charger Installation (Level 2)', '309A', FALSE),
    ('EV Charger Installation (Level 2)', '309C', FALSE),
    ('Electrical Panel Upgrade (100A to 200A)', 'ESA_LEC', TRUE),
    ('Electrical Panel Upgrade (100A to 200A)', '309A', FALSE),
    ('Electrical Panel Upgrade (100A to 200A)', '309C', FALSE),
    ('Electrical Permit & ESA Inspection Coordination', 'ESA_LEC', TRUE),
    ('Event Service Assistance (Alcohol Handling)', 'SMART_SERVE', TRUE),
    ('Event Serving Assistance (Food Handling)', 'FOOD_HANDLER', TRUE),
    ('Exterior Siding Replacement', 'WAH_CPO', TRUE),
    ('Faucet Replacement', '306A', TRUE),
    ('Foundation Crack Repair (Interior Injection)', 'BUILDING_PERMIT', FALSE),
    ('Foundation Crack Repair (Interior Injection)', 'P_ENG', FALSE),
    ('Foundation Crack Repair (Interior Injection)', '306A', FALSE),
    ('Full Bathroom Renovation', '306A', FALSE),
    ('Full Bathroom Renovation', 'ESA_LEC', FALSE),
    ('Full Bathroom Renovation', '309A', FALSE),
    ('Full Bathroom Renovation', '309C', FALSE),
    ('Full Bathroom Renovation', '308A', FALSE),
    ('Full Bathroom Renovation', '308R', FALSE),
    ('Full Bathroom Renovation', 'BCIN', FALSE),
    ('Full Bathroom Renovation', 'P_ENG', FALSE),
    ('Full Bathroom Renovation', 'ASBESTOS_ON', FALSE),
    ('Full Kitchen Renovation', '306A', FALSE),
    ('Full Kitchen Renovation', 'ESA_LEC', FALSE),
    ('Full Kitchen Renovation', '309A', FALSE),
    ('Full Kitchen Renovation', '309C', FALSE),
    ('Full Kitchen Renovation', 'TSSA_FUELS', FALSE),
    ('Full Kitchen Renovation', 'TSSA_G1', FALSE),
    ('Full Kitchen Renovation', 'TSSA_G2', FALSE),
    ('Full Kitchen Renovation', '308A', FALSE),
    ('Full Kitchen Renovation', '308R', FALSE),
    ('Full Kitchen Renovation', 'BCIN', FALSE),
    ('Full Kitchen Renovation', 'P_ENG', FALSE),
    ('Full Roof Replacement', 'WAH_CPO', TRUE),
    ('Full Roof Replacement', '449A', FALSE),
    ('Furnace Replacement', 'TSSA_FUELS', TRUE),
    ('Furnace Replacement', 'TSSA_G1', FALSE),
    ('Furnace Replacement', 'TSSA_G2', FALSE),
    ('Furnace Replacement', '308A', FALSE),
    ('Furnace Replacement', '308R', FALSE),
    ('Furnace Replacement', 'ESA_LEC', FALSE),
    ('Furnace Replacement', '309A', FALSE),
    ('GFCI Outlet Installation', 'ESA_LEC', TRUE),
    ('GFCI Outlet Installation', '309A', FALSE),
    ('GFCI Outlet Installation', '309C', FALSE),
    ('Garbage Disposal Installation', '306A', TRUE),
    ('Gas Appliance Installation (Range/Dryer)', 'TSSA_FUELS', TRUE),
    ('Gas Appliance Installation (Range/Dryer)', 'TSSA_G1', FALSE),
    ('Gas Appliance Installation (Range/Dryer)', 'TSSA_G2', FALSE),
    ('Gas Fireplace Installation', 'TSSA_FUELS', TRUE),
    ('Gas Fireplace Installation', 'TSSA_G1', FALSE),
    ('Gas Fireplace Installation', 'TSSA_G2', FALSE),
    ('Gas Fireplace Installation', 'ESA_LEC', FALSE),
    ('Gas Fireplace Installation', '309A', FALSE),
    ('Gas Line Installation / Extension', 'TSSA_FUELS', TRUE),
    ('Gas Line Installation / Extension', 'TSSA_G1', FALSE),
    ('Gas Line Installation / Extension', 'TSSA_G2', FALSE),
    ('Generator Installation (Standby)', 'ESA_LEC', TRUE),
    ('Generator Installation (Standby)', '309A', FALSE),
    ('Generator Installation (Standby)', '309C', FALSE),
    ('Geothermal Heat Pump Installation', 'ODP', TRUE),
    ('Geothermal Heat Pump Installation', '313A', FALSE),
    ('Geothermal Heat Pump Installation', '313D', FALSE),
    ('Geothermal Heat Pump Installation', 'ESA_LEC', FALSE),
    ('Geothermal Heat Pump Installation', '309A', FALSE),
    ('Gutter Cleaning (Single Storey)', 'WAH_CPO', TRUE),
    ('Gutter Guard Installation', 'WAH_CPO', TRUE),
    ('HRV / ERV Installation', '308A', FALSE),
    ('HRV / ERV Installation', '308R', FALSE),
    ('Heat Pump Installation (Mini-Split)', 'ODP', TRUE),
    ('Heat Pump Installation (Mini-Split)', '313A', FALSE),
    ('Heat Pump Installation (Mini-Split)', '313D', FALSE),
    ('Heat Pump Installation (Mini-Split)', 'ESA_LEC', FALSE),
    ('Heat Pump Installation (Mini-Split)', '309A', FALSE),
    ('Holiday Light Installation (Roofline)', 'WAH_CPO', TRUE),
    ('Home Security System Hardwired Installation', 'ESA_LEC', FALSE),
    ('Home Security System Hardwired Installation', '309A', FALSE),
    ('Home Security System Hardwired Installation', '309C', FALSE),
    ('Hot Tub / Pool Electrical Hookup', 'ESA_LEC', TRUE),
    ('Hot Tub / Pool Electrical Hookup', '309A', FALSE),
    ('Hot Tub / Pool Electrical Hookup', '309C', FALSE),
    ('Hydronic Heating Pipe Repair', '306A', FALSE),
    ('Hydronic Heating Pipe Repair', '307A', FALSE),
    ('Hydronic Heating Pipe Repair', 'TSSA_G1', FALSE),
    ('Hydronic Heating Pipe Repair', 'TSSA_G2', FALSE),
    ('Hydronic Heating Pipe Repair', 'ESA_LEC', FALSE),
    ('Irrigation System Installation', '306A', FALSE),
    ('Irrigation System Installation', 'ESA_LEC', FALSE),
    ('Irrigation System Installation', '309A', FALSE),
    ('Irrigation System Installation', '309C', FALSE),
    ('Knob-and-Tube Wiring Replacement', 'ESA_LEC', TRUE),
    ('Knob-and-Tube Wiring Replacement', '309A', FALSE),
    ('Knob-and-Tube Wiring Replacement', '309C', FALSE),
    ('Large Tree Removal', 'ISA_ARBORIST', FALSE),
    ('Large Tree Removal', '444B', FALSE),
    ('Lead Paint Remediation', 'LEAD_SAFE', TRUE),
    ('Light Fixture Replacement', 'ESA_LEC', TRUE),
    ('Light Fixture Replacement', '309A', FALSE),
    ('Light Fixture Replacement', '309C', FALSE),
    ('Load-Bearing Wall Modification', 'BUILDING_PERMIT', TRUE),
    ('Load-Bearing Wall Modification', 'BCIN', FALSE),
    ('Load-Bearing Wall Modification', 'P_ENG', FALSE),
    ('Load-Bearing Wall Modification', '403A', FALSE),
    ('Main Water Line Repair', '306A', TRUE),
    ('Mold Remediation', 'WHMIS', TRUE),
    ('Mold Remediation', 'IICRC_AMRT', TRUE),
    ('Outdoor Electrical Panel / Disconnect', 'ESA_LEC', TRUE),
    ('Outdoor Electrical Panel / Disconnect', '309A', FALSE),
    ('Outdoor Electrical Panel / Disconnect', '309C', FALSE),
    ('Outlet & Switch Replacement', 'ESA_LEC', TRUE),
    ('Outlet & Switch Replacement', '309A', FALSE),
    ('Outlet & Switch Replacement', '309C', FALSE),
    ('Pool Installation (Above-Ground)', '306A', FALSE),
    ('Power Loss Diagnosis', 'ESA_LEC', TRUE),
    ('Power Loss Diagnosis', '309A', FALSE),
    ('Power Loss Diagnosis', '309C', FALSE),
    ('Radiant Floor Heating Installation', 'ESA_LEC', FALSE),
    ('Radiant Floor Heating Installation', '309A', FALSE),
    ('Radiant Floor Heating Installation', '306A', FALSE),
    ('Radiant Floor Heating Installation', '307A', FALSE),
    ('Radiant Floor Heating Installation', 'TSSA_G1', FALSE),
    ('Radiant Floor Heating Installation', 'TSSA_G2', FALSE),
    ('Recessed Lighting Installation (New Circuits)', 'ESA_LEC', TRUE),
    ('Recessed Lighting Installation (New Circuits)', '309A', FALSE),
    ('Recessed Lighting Installation (New Circuits)', '309C', FALSE),
    ('Refrigerant Recharge & Leak Repair', 'ODP', TRUE),
    ('Refrigerant Recharge & Leak Repair', '313A', FALSE),
    ('Refrigerant Recharge & Leak Repair', '313D', FALSE),
    ('Retaining Wall Construction', 'BCIN', FALSE),
    ('Retaining Wall Construction', 'P_ENG', FALSE),
    ('Roof Leak Repair', 'WAH_CPO', TRUE),
    ('Roof Leak Repair', '449A', FALSE),
    ('Roof Repair (Shingles)', 'WAH_CPO', TRUE),
    ('Roof Snow Removal', 'WAH_CPO', TRUE),
    ('Room Addition Framing', 'BUILDING_PERMIT', TRUE),
    ('Room Addition Framing', 'BCIN', FALSE),
    ('Room Addition Framing', 'P_ENG', FALSE),
    ('Room Addition Framing', 'WAH_CPO', FALSE),
    ('Septic System Inspection & Pump-Out', 'OBC_P8', TRUE),
    ('Septic System Inspection & Pump-Out', 'SEWAGE_HAUL', FALSE),
    ('Sewer Line Repair / Replacement', '306A', TRUE),
    ('Skylight Installation', 'BUILDING_PERMIT', TRUE),
    ('Skylight Installation', 'WAH_CPO', TRUE),
    ('Skylight Installation', 'BCIN', FALSE),
    ('Skylight Installation', 'P_ENG', FALSE),
    ('Smart Doorbell & Camera Installation', 'ESA_LEC', FALSE),
    ('Smart Doorbell & Camera Installation', '309A', FALSE),
    ('Smart Doorbell & Camera Installation', '309C', FALSE),
    ('Smart Thermostat Installation', 'ESA_LEC', FALSE),
    ('Smart Thermostat Installation', '309A', FALSE),
    ('Smart Thermostat Installation', '309C', FALSE),
    ('Smoke & Carbon Monoxide Detector Installation', 'ESA_LEC', FALSE),
    ('Smoke & Carbon Monoxide Detector Installation', '309A', FALSE),
    ('Smoke & Carbon Monoxide Detector Installation', '309C', FALSE),
    ('Solar Panel Electrical Integration', 'ESA_LEC', TRUE),
    ('Solar Panel Electrical Integration', '309A', FALSE),
    ('Solar Panel Electrical Integration', '309C', FALSE),
    ('Spray Foam Insulation', 'SPRAY_FOAM', TRUE),
    ('Staircase Construction / Renovation', 'BUILDING_PERMIT', TRUE),
    ('Staircase Construction / Renovation', 'BCIN', FALSE),
    ('Staircase Construction / Renovation', 'P_ENG', FALSE),
    ('Structural Beam Installation', 'BUILDING_PERMIT', TRUE),
    ('Structural Beam Installation', 'BCIN', FALSE),
    ('Structural Beam Installation', 'P_ENG', FALSE),
    ('Stucco Application / Repair', 'WAH_CPO', TRUE),
    ('Sub-Panel Installation', 'ESA_LEC', TRUE),
    ('Sub-Panel Installation', '309A', FALSE),
    ('Sub-Panel Installation', '309C', FALSE),
    ('Sump Pump Installation (New)', '306A', TRUE),
    ('Sump Pump Testing & Maintenance', '306A', TRUE),
    ('Tankless Water Heater Installation', '306A', TRUE),
    ('Tankless Water Heater Installation', 'TSSA_G1', FALSE),
    ('Tankless Water Heater Installation', 'TSSA_G2', FALSE),
    ('Tankless Water Heater Installation', 'ESA_LEC', FALSE),
    ('Tankless Water Heater Installation', '309A', FALSE),
    ('Toilet Replacement', '306A', TRUE),
    ('Water Heater Replacement (Tank)', '306A', TRUE),
    ('Water Heater Replacement (Tank)', 'TSSA_G1', FALSE),
    ('Water Heater Replacement (Tank)', 'TSSA_G2', FALSE),
    ('Water Heater Replacement (Tank)', 'ESA_LEC', FALSE),
    ('Water Heater Replacement (Tank)', '309A', FALSE),
    ('Water Softener Installation', '306A', TRUE),
    ('Whole-House Re-Pipe (Copper/PEX)', '306A', TRUE),
    ('Whole-House Rewiring', 'ESA_LEC', TRUE),
    ('Whole-House Rewiring', '309A', FALSE),
    ('Whole-House Rewiring', '309C', FALSE),
    ('Window Cleaning (Exterior, Single Storey)', 'WAH_CPO', TRUE)
  ) AS v(task_name, code, mandatory)
  JOIN service_tasks t ON t.name = v.task_name
ON CONFLICT (task_id, code) DO NOTHING;

-- ==========================================================================
-- 7. Precios, comisiones y SLA.
--    Decisión de negocio: los valores NO cambian. L0 hereda los de L1,
--    L1/L2/L3 se quedan como están, L4 se desactiva.
-- ==========================================================================
INSERT INTO commission_schedules (id, level, commission_rate_min, commission_rate_max,
                                  commission_rate_default, country, is_active,
                                  effective_from, effective_until, created_at, updated_at)
SELECT gen_random_uuid(), 'LEVEL_0', commission_rate_min, commission_rate_max,
       commission_rate_default, country, is_active, effective_from, effective_until, NOW(), NOW()
  FROM commission_schedules WHERE level = 'LEVEL_1'
  AND NOT EXISTS (SELECT 1 FROM commission_schedules WHERE level = 'LEVEL_0');

INSERT INTO pricing_rules (id, name, description, rule_type, level, task_id, region_value, country,
                           multiplier_min, multiplier_max, flat_adjustment_cents, conditions_json,
                           priority_order, stackable, is_active, effective_from, effective_until,
                           created_at, updated_at)
SELECT gen_random_uuid(), replace(name, 'Level 1', 'Level 0'), replace(description, 'Level 1', 'Level 0'),
       rule_type, 'LEVEL_0', task_id, region_value, country, multiplier_min, multiplier_max,
       flat_adjustment_cents, conditions_json, priority_order, stackable, is_active,
       effective_from, effective_until, NOW(), NOW()
  FROM pricing_rules WHERE level = 'LEVEL_1'
  AND NOT EXISTS (SELECT 1 FROM pricing_rules WHERE level = 'LEVEL_0');

INSERT INTO sla_profiles (id, name, description, level, region_type, region_value, country, task_id,
                          response_time_min, arrival_time_min, completion_time_min, penalty_enabled,
                          penalty_per_min_cents, penalty_cap_cents, is_active, effective_from,
                          effective_until, priority_order, created_at, updated_at)
SELECT gen_random_uuid(), replace(name, 'Level 1', 'Level 0'), replace(description, 'Level 1', 'Level 0'),
       'LEVEL_0', region_type, region_value, country, task_id, response_time_min, arrival_time_min,
       completion_time_min, penalty_enabled, penalty_per_min_cents, penalty_cap_cents, is_active,
       effective_from, effective_until, priority_order, NOW(), NOW()
  FROM sla_profiles WHERE level = 'LEVEL_1'
  AND NOT EXISTS (SELECT 1 FROM sla_profiles WHERE level = 'LEVEL_0');

-- L4 fuera del producto.
UPDATE commission_schedules SET is_active = FALSE, updated_at = NOW() WHERE level = 'LEVEL_4';
UPDATE pricing_rules        SET is_active = FALSE, updated_at = NOW() WHERE level = 'LEVEL_4';
UPDATE sla_profiles         SET is_active = FALSE, updated_at = NOW() WHERE level = 'LEVEL_4';

-- El multiplicador de emergencia deja de aplicarse.
UPDATE pricing_rules SET is_active = FALSE, updated_at = NOW() WHERE rule_type = 'EMERGENCY_PREMIUM';

-- ==========================================================================
-- 8. Proveedores que estaban en LEVEL_4.
--    Se bajan a LEVEL_3 (no a L1) para NO quitarles acceso: el motor de
--    niveles de la fase 4 recalculará el valor real. current_level pasa a ser
--    un campo DERIVADO de display; la autorización vive en
--    provider_classification_levels.
-- ==========================================================================
UPDATE provider_profiles SET current_level = 'LEVEL_3', updated_at = NOW() WHERE current_level = 'LEVEL_4';
UPDATE provider_levels   SET level = 'LEVEL_3', updated_at = NOW() WHERE level = 'LEVEL_4';

-- ==========================================================================
-- 9. El gate por SECCIÓN de la migración 029 queda obsoleto: el gate pasa a
--    ser por servicio. requires_credential se apaga; los help_message se
--    CONSERVAN y se reinterpretan como texto de ayuda de la evidencia L1.
-- ==========================================================================
UPDATE service_categories SET requires_credential = FALSE, updated_at = NOW() WHERE requires_credential = TRUE;

COMMIT;
