-- 045_offer_materials.sql
-- El proveedor cotiza el material EN SU OFERTA, con justificación.
-- Decisión de Ricardo, 2026-08-20. Plan: docs/plan-ofertas-v2.md §9
--
-- QUÉ CAMBIA RESPECTO A LA 043. Allí el cliente autorizaba un presupuesto y el
-- proveedor gastaba contra él. Ahora el presupuesto del cliente es INFORMATIVO: le
-- dice al proveedor "hay que comprar material y yo tenía pensado esto". El número que
-- cuenta es el que el proveedor pone al ofertar, junto a su tiempo:
--
--     8 h × $45 = $360  ·  material $150  ·  "la pintura mate de esa marca sale a 150"
--
-- POR QUÉ ES MEJOR ASÍ: quien sabe lo que cuesta el material es quien lo va a comprar,
-- no el cliente. Un presupuesto puesto a ojo por el cliente o dejaba al proveedor
-- corto —y comprando de su bolsillo— o le daba un cheque en blanco. Ahora el cliente
-- ve el importe y el porqué ANTES de elegir, y su aceptación ES la aprobación.
--
-- CONSECUENCIA EN EL SOBRECOSTE: el exceso deja de medirse contra el presupuesto del
-- cliente y pasa a medirse contra lo que el proveedor ofertó, que es lo que el cliente
-- aceptó pagar. `jobs.materials_estimate_cents` guarda ese número al aceptar la oferta;
-- `jobs.materials_budget_cents` se queda con lo que dijo el cliente, como referencia
-- para entender la reserva más tarde.

ALTER TABLE job_offers
    -- Lo que el proveedor calcula que costará el material. 0 en los servicios que no
    -- llevan: es un importe, no un "sin dato", y así la suma nunca necesita coalesce.
    ADD COLUMN IF NOT EXISTS materials_cents BIGINT NOT NULL DEFAULT 0,
    -- Por qué ese importe. Obligatorio cuando se cotiza material: es lo único que le
    -- permite al cliente juzgar si 150 es razonable o le están inflando la compra.
    ADD COLUMN IF NOT EXISTS materials_note TEXT;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_job_offer_materials') THEN
        ALTER TABLE job_offers
            ADD CONSTRAINT chk_job_offer_materials
            CHECK (materials_cents >= 0);
    END IF;
END $$;

COMMENT ON COLUMN job_offers.materials_cents IS
    'Material cotizado por el proveedor en esta oferta. El cliente lo ve antes de '
    'aceptar; su aceptacion es la aprobacion de ese importe.';
COMMENT ON COLUMN job_offers.materials_note IS
    'Justificacion del importe, escrita por el proveedor. Obligatoria si cotiza material.';

ALTER TABLE jobs
    -- Copia del importe de la oferta ganadora. Es contra ESTE número, y no contra el
    -- presupuesto del cliente, contra el que se mide el exceso al subir las facturas.
    ADD COLUMN IF NOT EXISTS materials_estimate_cents BIGINT;

COMMENT ON COLUMN jobs.materials_estimate_cents IS
    'Material cotizado por el proveedor en la oferta aceptada. Es el techo acordado: '
    'gastar por encima exige aprobacion del cliente.';
COMMENT ON COLUMN jobs.materials_budget_cents IS
    'Lo que el CLIENTE dijo al reservar. Informativo: le indica al proveedor que hay '
    'que comprar material y cuanto tenia pensado. No es el techo del cobro.';
