-- 056 · La comisión de la tabla, igual que la del contrato del proveedor
--
-- El contrato del proveedor (provider_ic_agreement_v1.3, §9) fija la comisión
-- de VISP por nivel: L0 17.5 %, L1 17.5 %, L2 15 %, L3 10 %. Es un porcentaje
-- FIJO, no un rango.
--
-- El cobro al aceptar una oferta ya usaba esos valores
-- (`provider_rate_service._LEVEL_COMMISSION`), pero esta tabla seguía con los
-- del seed original (20 / 20 / 18 / 15 por defecto, con rangos). La leen
-- `pricingEngine` —estimaciones y la finalización por horas de trabajos
-- antiguos—, así que un trabajo por ese camino habría cobrado un 20 % cuando
-- el contrato firmado dice 17.5 %. Dos fuentes de verdad que no coincidían.
--
-- min = max = default porque el contrato no da rango. L4 sigue inactivo (el
-- nivel está muerto, ver CLAUDE.md) y no se toca.

BEGIN;

UPDATE commission_schedules
   SET commission_rate_min     = 0.1750,
       commission_rate_max     = 0.1750,
       commission_rate_default = 0.1750,
       updated_at              = now()
 WHERE country = 'CA' AND level IN ('LEVEL_0', 'LEVEL_1');

UPDATE commission_schedules
   SET commission_rate_min     = 0.1500,
       commission_rate_max     = 0.1500,
       commission_rate_default = 0.1500,
       updated_at              = now()
 WHERE country = 'CA' AND level = 'LEVEL_2';

UPDATE commission_schedules
   SET commission_rate_min     = 0.1000,
       commission_rate_max     = 0.1000,
       commission_rate_default = 0.1000,
       updated_at              = now()
 WHERE country = 'CA' AND level = 'LEVEL_3';

COMMIT;
