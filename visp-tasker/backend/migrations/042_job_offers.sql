-- 042_job_offers.sql
-- Modelo de ofertas v2: el customer postea, los proveedores ofertan.
-- Decisiones de Ricardo, 2026-08-19. Plan: docs/plan-ofertas-v2.md
--
-- QUÉ CAMBIA. Hasta hoy el customer elegía proveedor de una lista con el precio ya
-- calculado (rango del catálogo × duración del catálogo). Ahora postea el trabajo con
-- descripción y fotos, y los proveedores ofertan. El customer ve las ofertas que
-- llegan —cara, calificación y precio de cada uno— y elige una.
--
-- LA PIEZA CENTRAL: DE DÓNDE SALE LA MAGNITUD.
-- Un total es siempre `tarifa del proveedor × magnitud`. Lo único que cambia por
-- servicio es quién dice la magnitud, y son tres comportamientos, no siete unidades:
--
--   HOURLY, PER_AREA, PER_LINEAR_M  → la dice el PROVEEDOR en la oferta
--                                     ("esta casa la hago en 8 horas", "son 80 m²")
--   PER_UNIT                        → la dice el CUSTOMER al reservar (5 sillas IKEA)
--   PER_VISIT, FLAT_PACKAGE         → FIJA en 1; el total es la tarifa
--
-- En los que no son por hora no se maneja duración: se agenda la hora de inicio que dio
-- el customer y el proveedor avisa cuando termina. No hay forma de saber la duración
-- exacta y tampoco importa, porque no se paga por tiempo.
--
-- POR QUÉ TABLA NUEVA Y NO REUSAR job_assignments: son cosas distintas.
-- `job_assignments` es "te invitamos a este trabajo" (lo crea el broadcast del booking
-- para todos los calificados). `job_offers` es "esto te cobro y en cuánto lo hago".
-- Mezclarlas obligaría a partir el enum assignment_status y a que una misma fila
-- signifique dos cosas según el estado.

-- ---------------------------------------------------------------------------
-- 1. La oferta
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS job_offers (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id       UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    provider_id  UUID NOT NULL REFERENCES provider_profiles(id) ON DELETE CASCADE,

    -- Snapshot de la tarifa del proveedor EN EL MOMENTO DE OFERTAR. No se lee de
    -- provider_service_rates al mostrarla: si el proveedor sube su tarifa mañana, la
    -- oferta que el customer está mirando no puede cambiar de precio bajo sus pies.
    unit         pricing_unit NOT NULL,
    rate_cents   INTEGER NOT NULL CHECK (rate_cents >= 0),

    -- Horas, m², unidades o 1. Numeric y no entero: media hora existe.
    magnitude    NUMERIC(10,2) NOT NULL CHECK (magnitude > 0),

    -- Quién puso la magnitud. Derivable de `unit`, pero guardarlo hace la oferta
    -- autoexplicativa en una auditoría y sobrevive a que un servicio cambie de unidad.
    magnitude_source VARCHAR(10) NOT NULL,

    subtotal_cents    BIGINT NOT NULL CHECK (subtotal_cents >= 0),

    -- Impuesto y fee son PARA MOSTRAR: que el customer vea el "+tax" real y no un
    -- asterisco. La verdad contable se vuelve a sellar sobre el job al aceptar, vía
    -- reprice_job_to_provider_rate, que es la única fuente de comisión, payout e
    -- impuesto definitivos.
    service_tax_cents BIGINT NOT NULL DEFAULT 0,
    tax_rate          NUMERIC(6,5),
    service_fee_cents BIGINT NOT NULL DEFAULT 0,
    total_cents       BIGINT NOT NULL CHECK (total_cents >= 0),

    -- Nota opcional del proveedor ("llevo mi propia escalera"). Contexto para decidir,
    -- no redefine el trabajo: la regla del catálogo cerrado sigue en pie.
    message      TEXT,

    -- VARCHAR con CHECK y no enum de PG: añadir un estado es un ALTER del CHECK, sin la
    -- migración aislada que exige ALTER TYPE ADD VALUE (la trampa que ya costó las
    -- migraciones 031 y 035).
    status       VARCHAR(20) NOT NULL DEFAULT 'pending',

    expires_at   TIMESTAMPTZ,
    responded_at TIMESTAMPTZ,

    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_job_offer_status') THEN
        ALTER TABLE job_offers
            ADD CONSTRAINT chk_job_offer_status
            CHECK (status IN ('pending', 'accepted', 'rejected', 'withdrawn', 'expired'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_job_offer_magnitude_source') THEN
        ALTER TABLE job_offers
            ADD CONSTRAINT chk_job_offer_magnitude_source
            CHECK (magnitude_source IN ('PROVIDER', 'CUSTOMER', 'FLAT'));
    END IF;
END $$;

-- Un proveedor no puede tener dos ofertas VIVAS en el mismo trabajo, pero sí puede
-- volver a ofertar si retiró la anterior. De ahí el índice parcial y no un UNIQUE seco.
CREATE UNIQUE INDEX IF NOT EXISTS uq_job_offer_live
    ON job_offers (job_id, provider_id)
    WHERE status IN ('pending', 'accepted');

-- La lista que ve el customer.
CREATE INDEX IF NOT EXISTS idx_job_offers_job_pending
    ON job_offers (job_id, created_at)
    WHERE status = 'pending';

-- "Mis ofertas" del proveedor.
CREATE INDEX IF NOT EXISTS idx_job_offers_provider
    ON job_offers (provider_id, status);

-- Barrido de expiración (job periódico).
CREATE INDEX IF NOT EXISTS idx_job_offers_expiring
    ON job_offers (expires_at)
    WHERE status = 'pending';

COMMENT ON TABLE job_offers IS
    'Puja de un proveedor sobre un trabajo posteado: su tarifa aprobada x la magnitud '
    'que aporta. El customer elige entre las que reciba.';
COMMENT ON COLUMN job_offers.magnitude IS
    'Horas (HOURLY), m2 (PER_AREA), metros (PER_LINEAR_M), unidades (PER_UNIT) o 1 '
    '(PER_VISIT, FLAT_PACKAGE).';
COMMENT ON COLUMN job_offers.magnitude_source IS
    'PROVIDER = la estima el proveedor al ofertar. CUSTOMER = la declaro el cliente al '
    'reservar. FLAT = unidad plana, siempre 1.';
COMMENT ON COLUMN job_offers.rate_cents IS
    'Snapshot de provider_service_rates. El proveedor NO negocia precio por trabajo: su '
    'tarifa sale del perfil, ya validada contra el rango del catalogo.';
COMMENT ON COLUMN job_offers.service_tax_cents IS
    'Estimacion para mostrar. El importe definitivo lo sella el job al aceptar.';

-- ---------------------------------------------------------------------------
-- 2. El trabajo apunta a la oferta que ganó
-- ---------------------------------------------------------------------------

ALTER TABLE jobs
    ADD COLUMN IF NOT EXISTS accepted_offer_id UUID REFERENCES job_offers(id) ON DELETE SET NULL,
    -- Ventana de ofertas: 48 h por defecto (decision de Ricardo). Al cerrarse sin
    -- ofertas se avisa al customer para reponer o cancelar.
    ADD COLUMN IF NOT EXISTS offers_close_at TIMESTAMPTZ;

COMMENT ON COLUMN jobs.accepted_offer_id IS
    'Oferta que el customer acepto. NULL mientras el trabajo sigue abierto.';
COMMENT ON COLUMN jobs.offers_close_at IS
    'Cierre de la ventana de ofertas (48h por defecto desde el posteo).';

-- ---------------------------------------------------------------------------
-- 3. Limpieza del catálogo
-- ---------------------------------------------------------------------------

-- 3a. CUSTOM_QUOTE queda sin uso. Todo servicio se cotiza contra un rango; un precio
--     libre sin rango es justo la fuga que el guardarraíl de tarifas existe para tapar.
--     Los 108 servicios que lo usaban YA tienen rango (verificado antes de migrar), así
--     que pasan a FLAT_PACKAGE conservándolo. El valor del enum se queda en Postgres
--     porque no se puede quitar, igual que el nivel 4, pero nadie más lo usa.
UPDATE service_tasks
   SET pricing_unit = 'FLAT_PACKAGE'::pricing_unit,
       updated_at   = NOW()
 WHERE pricing_unit = 'CUSTOM_QUOTE'::pricing_unit;

-- 3b. `allows_quantity` pasa a significar UNA sola cosa: "el cliente declara la
--     cantidad". Estaba en TRUE en 110 servicios, incluidos los de hora — bajo el modelo
--     nuevo eso dejaría al customer poniendo sus propias horas, que es precisamente lo
--     que ahora estima el proveedor. Queda en TRUE solo en PER_UNIT.
UPDATE service_tasks
   SET allows_quantity = (pricing_unit = 'PER_UNIT'::pricing_unit),
       updated_at      = NOW()
 WHERE allows_quantity <> (pricing_unit = 'PER_UNIT'::pricing_unit);

COMMENT ON COLUMN service_tasks.allows_quantity IS
    'El CLIENTE declara la cantidad al reservar. Solo tiene sentido en PER_UNIT: en '
    'HOURLY y PER_AREA la magnitud la estima el proveedor en su oferta, y en PER_VISIT '
    'y FLAT_PACKAGE es siempre 1.';

-- 3c. Guardas de integridad. Los datos ya cumplen las tres (verificado antes de migrar);
--     se añaden para que el admin no pueda volver a romperlas.
DO $$
BEGIN
    -- Un servicio activo sin rango no se puede mostrar al cliente ni acotar la tarifa
    -- del proveedor: no habria nada contra que validar.
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_task_active_needs_range') THEN
        ALTER TABLE service_tasks
            ADD CONSTRAINT chk_task_active_needs_range
            CHECK (
                NOT is_active
                OR (base_price_min_cents IS NOT NULL
                    AND base_price_max_cents IS NOT NULL
                    AND base_price_min_cents <= base_price_max_cents)
            );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_task_price_range_order') THEN
        ALTER TABLE service_tasks
            ADD CONSTRAINT chk_task_price_range_order
            CHECK (
                base_price_min_cents IS NULL
                OR base_price_max_cents IS NULL
                OR base_price_min_cents <= base_price_max_cents
            );
    END IF;

END $$;

-- 3d. `allows_quantity` se NORMALIZA con trigger, no con CHECK.
--
-- Un CHECK sería lo natural, pero rompería el admin desplegado antes de que le llegue
-- el cambio: su formulario manda `allows_quantity = true` por defecto, así que crear
-- cualquier servicio que no sea PER_UNIT reventaría con un error de integridad → 500, y
-- Cloudflare envuelve los 5xx en su propia página, o sea que quien está cargando el
-- catálogo vería un fallo sin explicación.
--
-- El trigger mantiene el invariante sin poder fallar nunca. Se puede hacer porque el
-- dato es REDUNDANTE: quién declara la cantidad se deduce de la unidad, no es
-- información independiente. No es corrección silenciosa de un dato del usuario; es
-- derivar un campo de su fuente.
CREATE OR REPLACE FUNCTION service_tasks_normalize_quantity()
RETURNS TRIGGER AS $$
BEGIN
    NEW.allows_quantity := (NEW.pricing_unit = 'PER_UNIT'::pricing_unit);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_service_tasks_quantity_rule ON service_tasks;
CREATE TRIGGER trg_service_tasks_quantity_rule
    BEFORE INSERT OR UPDATE ON service_tasks
    FOR EACH ROW EXECUTE FUNCTION service_tasks_normalize_quantity();

COMMENT ON FUNCTION service_tasks_normalize_quantity() IS
    'allows_quantity se deriva de pricing_unit: solo PER_UNIT deja que el cliente '
    'declare la cantidad. Trigger y no CHECK para no romper al admin ya desplegado.';
