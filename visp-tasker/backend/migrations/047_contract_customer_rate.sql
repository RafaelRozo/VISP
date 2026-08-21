-- 047_contract_customer_rate.sql
-- La tarifa que pone EL CLIENTE en los servicios `per_contract`.
-- Decisión de Ricardo, 2026-08-21. Plan: docs/plan-per-contract.md
--
-- Va aparte de la 046 porque aquí ya se USA el valor 'PER_CONTRACT' del enum, y
-- Postgres no lo ve hasta que la transacción que lo creó hizo commit.
--
-- POR QUÉ UNA COLUMNA NUEVA Y NO REUSAR LAS QUE HAY: `quoted_price_cents` es el
-- subtotal ya calculado y `hourly_rate_cents` se rellena al repreciar contra la
-- tarifa del proveedor. Esto es otra cosa: el precio que el cliente PROPONE al
-- publicar, antes de que exista ningún proveedor. Mezclarlo con cualquiera de los
-- dos haría imposible saber después quién puso el precio.
--
-- Las HORAS contratadas no necesitan columna: van en `jobs.quantity`, que ya es la
-- magnitud del trabajo. Las horas realmente trabajadas tampoco: van en
-- `jobs.actual_duration_minutes`, que ya existe y es lo que usa el cobro parcial al
-- cancelar a mitad.

ALTER TABLE jobs
    ADD COLUMN IF NOT EXISTS customer_rate_cents BIGINT;

DO $$
BEGIN
    -- Un precio de cliente solo tiene sentido donde el cliente pone el precio.
    -- Sin esta guarda, un `customer_rate_cents` colado en un servicio por horas
    -- normal competiría en silencio con la tarifa del proveedor y nadie sabría cuál
    -- de los dos se cobró.
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_job_customer_rate_positive') THEN
        ALTER TABLE jobs
            ADD CONSTRAINT chk_job_customer_rate_positive
            CHECK (customer_rate_cents IS NULL OR customer_rate_cents > 0);
    END IF;
END $$;

COMMENT ON COLUMN jobs.customer_rate_cents IS
    'Tarifa por hora que puso EL CLIENTE al publicar (solo PER_CONTRACT). El '
    'proveedor no cotiza: acepta este precio. NULL en el resto del catalogo, donde '
    'la tarifa sale de provider_service_rates.';
