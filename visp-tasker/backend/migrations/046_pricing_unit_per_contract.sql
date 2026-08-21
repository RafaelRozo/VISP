-- 046_pricing_unit_per_contract.sql
-- Añade PER_CONTRACT al enum `pricing_unit`. Decisión de Ricardo, 2026-08-21.
--
-- ESTA MIGRACIÓN NO HACE NADA MÁS, Y ES A PROPÓSITO.
--
-- `ALTER TYPE ... ADD VALUE` no puede usarse en la misma transacción en la que
-- después se emplea el valor nuevo: Postgres no lo ve hasta que la transacción que
-- lo creó ha hecho commit. Meter aquí cualquier otra cosa que mencione
-- 'PER_CONTRACT' —una columna con default, un CHECK, un UPDATE— hace que la
-- migración falle con "unsafe use of new value of enum type". Es la trampa que ya
-- costó las migraciones 031 y 035; lo que use el valor va en la 047.
--
-- QUÉ ES PER_CONTRACT: la inversión del modelo de precios. En el resto del catálogo
-- la tarifa la pone el PROVEEDOR (su perfil, acotado por el rango del admin) y él
-- aporta la magnitud. Aquí el CLIENTE pone las dos cosas en su publicación —"pago
-- $22/h, necesito un helper 8 horas"— y el proveedor solo acepta. El rango del admin
-- pasa a acotar lo que el cliente puede ofrecer.

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM pg_enum e
          JOIN pg_type t ON t.oid = e.enumtypid
         WHERE t.typname = 'pricing_unit'
           AND e.enumlabel = 'PER_CONTRACT'
    ) THEN
        ALTER TYPE pricing_unit ADD VALUE 'PER_CONTRACT';
    END IF;
END $$;
