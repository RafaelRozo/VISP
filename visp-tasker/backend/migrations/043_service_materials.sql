-- 043_service_materials.sql
-- Materiales por servicio: el proveedor los compra y el cliente se los reembolsa.
-- Decisiones de Ricardo, 2026-08-19. Plan: docs/plan-ofertas-v2.md §9
--
-- EL CASO: un servicio de pintura. El cliente quiere que el pintor compre la pintura y
-- le autoriza 100 CAD de presupuesto. El pintor lo ve ANTES de ofertar, va, compra por
-- 85.50, sube la factura y ese importe se suma al trabajo. Mano de obra 3 h × 80 = 240,
-- material 85.50 → el cliente paga 325.50.
--
-- TRES DECISIONES QUE MOLDEAN ESTO (Ricardo, 2026-08-19):
--
-- 1. EL MATERIAL NO LLEVA IMPUESTO ENCIMA. El impuesto se calcula solo sobre la mano de
--    obra; el material se reembolsa tal como viene en la factura. La tienda ya cobró el
--    HST de esa pintura y viene dentro de los 85.50: volver a aplicarlo sería cobrarle
--    al cliente dos veces el impuesto del mismo bote. (Un contratista registrado sí
--    revende con HST y recupera el de su compra, pero la mayoría de proveedores L0/L1
--    no están registrados y ahí es doble cobro puro.)
--
-- 2. VISP NO COBRA COMISIÓN SOBRE EL MATERIAL. Es un reembolso, no ingreso del
--    proveedor. Cobrarle comisión por comprar pintura le haría perder dinero por hacer
--    el favor, y el incentivo pasaría a ser que el cliente compre su propio material.
--    La comisión se sigue calculando SOLO sobre el subtotal de mano de obra.
--
-- 3. LA FACTURA POR ENCIMA DEL PRESUPUESTO NECESITA APROBACIÓN DEL CLIENTE. Hasta el
--    presupuesto se cobra sin fricción; el exceso lo aprueba el cliente, reusando el
--    mecanismo de sobrecoste que ya existe. Sin ese tope, el proveedor gasta dinero
--    ajeno sin límite real.
--
-- Consecuencia en el reparto:
--   subtotal        = tarifa × magnitud              (mano de obra)
--   impuesto        = f(subtotal)                     ← NUNCA sobre el material
--   comisión        = % × subtotal                    ← NUNCA sobre el material
--   payout proveedor = subtotal − comisión + material  ← se le devuelve íntegro
--   total cliente   = subtotal + impuesto + material + propina + fee de servicio

-- ---------------------------------------------------------------------------
-- 1. El servicio declara que lleva material (checkbox del admin)
-- ---------------------------------------------------------------------------

ALTER TABLE service_tasks
    ADD COLUMN IF NOT EXISTS materials_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    -- Rango del presupuesto que puede autorizar el cliente. Mismo criterio que el rango
    -- de precio: acota lo que se puede pedir en vez de dejarlo a texto libre.
    ADD COLUMN IF NOT EXISTS materials_budget_min_cents INTEGER,
    ADD COLUMN IF NOT EXISTS materials_budget_max_cents INTEGER,
    -- Mensaje del admin PARA EL PROVEEDOR ("compra pintura mate, marca a tu criterio,
    -- guarda la factura"). Lo lee antes de ofertar.
    ADD COLUMN IF NOT EXISTS materials_note_en TEXT,
    ADD COLUMN IF NOT EXISTS materials_note_fr TEXT;

DO $$
BEGIN
    -- Un servicio con material activado pero sin rango no se puede reservar: el cliente
    -- no sabría cuánto autorizar ni habría contra qué validar lo que escriba.
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_task_materials_range') THEN
        ALTER TABLE service_tasks
            ADD CONSTRAINT chk_task_materials_range
            CHECK (
                NOT materials_enabled
                OR (materials_budget_min_cents IS NOT NULL
                    AND materials_budget_max_cents IS NOT NULL
                    AND materials_budget_min_cents >= 0
                    AND materials_budget_min_cents <= materials_budget_max_cents)
            );
    END IF;
END $$;

COMMENT ON COLUMN service_tasks.materials_enabled IS
    'El proveedor compra material para este servicio. Lo activa el admin; el cliente '
    'decide en cada reserva si lo quiere o no.';
COMMENT ON COLUMN service_tasks.materials_note_en IS
    'Mensaje del admin para el PROVEEDOR sobre que comprar. Lo ve antes de ofertar.';

-- ---------------------------------------------------------------------------
-- 2. Preguntas de material + tipo IMAGEN
-- ---------------------------------------------------------------------------

-- Preguntas que solo aparecen si el cliente pide material ("¿qué color de pintura?").
-- Se reusa la tabla de preguntas en vez de crear una paralela: mismo admin, mismas
-- validaciones, mismo sitio donde se guardan las respuestas (jobs.customer_answers_json).
ALTER TABLE service_task_questions
    ADD COLUMN IF NOT EXISTS materials_only BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN service_task_questions.materials_only IS
    'La pregunta solo se muestra (y solo se exige) cuando el cliente pidio material.';

-- Tipo IMAGE: la respuesta es una foto, no texto. El caso que lo pidió es el color de
-- pintura — describirlo con palabras no sirve, la foto de la pared sí. Se guarda igual
-- que las demás en customer_answers_json; lo que cambia es que `answer` lleva la URL.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_question_answer_type') THEN
        ALTER TABLE service_task_questions DROP CONSTRAINT chk_question_answer_type;
    END IF;
    ALTER TABLE service_task_questions
        ADD CONSTRAINT chk_question_answer_type
        CHECK (answer_type IN ('TEXT', 'SINGLE_CHOICE', 'IMAGE'));
END $$;

-- ---------------------------------------------------------------------------
-- 3. El trabajo: qué autorizó el cliente y qué gastó el proveedor
-- ---------------------------------------------------------------------------

ALTER TABLE jobs
    -- Lo decide el CLIENTE al reservar, aunque el servicio permita material. Si no lo
    -- pide, la reserva se comporta exactamente como hasta ahora.
    ADD COLUMN IF NOT EXISTS materials_requested BOOLEAN NOT NULL DEFAULT FALSE,
    -- Techo autorizado por el cliente. Es lo que el proveedor ve antes de ofertar.
    ADD COLUMN IF NOT EXISTS materials_budget_cents BIGINT,
    -- Suma de las facturas subidas por el proveedor. Se recalcula desde
    -- job_material_receipts; vive aquí para no sumar la tabla en cada lectura del job.
    ADD COLUMN IF NOT EXISTS materials_spent_cents BIGINT NOT NULL DEFAULT 0,
    -- Aprobación del cliente cuando la factura pasa del presupuesto. Separada de
    -- overage_approved_at (que es el exceso de la MANO DE OBRA): son dos excesos
    -- distintos y el cliente puede aceptar uno y rechazar el otro.
    ADD COLUMN IF NOT EXISTS materials_overage_approved_at TIMESTAMPTZ;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_job_materials_budget') THEN
        ALTER TABLE jobs
            ADD CONSTRAINT chk_job_materials_budget
            CHECK (
                NOT materials_requested
                OR (materials_budget_cents IS NOT NULL AND materials_budget_cents > 0)
            );
    END IF;
END $$;

COMMENT ON COLUMN jobs.materials_budget_cents IS
    'Techo que autorizo el cliente. Gastar por encima exige su aprobacion explicita.';
COMMENT ON COLUMN jobs.materials_spent_cents IS
    'Suma de job_material_receipts. Se reembolsa integro al proveedor: no paga comision '
    'ni se le aplica impuesto encima.';

-- ---------------------------------------------------------------------------
-- 4. Las facturas
-- ---------------------------------------------------------------------------

-- Tabla y no un par de columnas en `jobs` porque una compra real son varias tiendas:
-- la pintura en un sitio, los rodillos en otro. Con una sola columna, el proveedor
-- tendría que sumar de cabeza y subir una única foto, y se pierde justo lo que hace
-- auditable el reembolso: qué se compró, dónde y por cuánto.
CREATE TABLE IF NOT EXISTS job_material_receipts (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id       UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    -- Quién la subió. Siempre el proveedor asignado, pero se guarda para la auditoría.
    uploaded_by  UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,

    amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
    -- La factura en sí. Sin foto no hay reembolso: es lo único que separa un gasto real
    -- de un número escrito a mano.
    file_url     TEXT NOT NULL,
    merchant     VARCHAR(120),
    note         TEXT,

    -- Anulación por el admin en una disputa. No se borra la fila: el importe ya pudo
    -- haber entrado en un cobro y el rastro tiene que quedar.
    voided_at    TIMESTAMPTZ,
    void_reason  TEXT,

    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_material_receipts_job
    ON job_material_receipts (job_id)
    WHERE voided_at IS NULL;

COMMENT ON TABLE job_material_receipts IS
    'Facturas de material que sube el proveedor. La suma de las no anuladas es '
    'jobs.materials_spent_cents y se le reembolsa integra.';

DROP TRIGGER IF EXISTS trg_material_receipts_updated_at ON job_material_receipts;
CREATE TRIGGER trg_material_receipts_updated_at
    BEFORE UPDATE ON job_material_receipts
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
