-- 041_cancellation_reports.sql
-- Cancelación con motivo, sin penalización (decisiones de Ricardo, 2026-08-13).
--
-- Escenario: el proveedor ya llegó (o el cliente ya lo recibió) y algo no encaja.
-- Ejemplos reales que dio el cliente: "llegó alcoholizado, no quiero que entre a
-- mi casa" / "el servicio era pasear 3 perros y querían que paseara 10".
--
-- TRES DECISIONES QUE MOLDEAN ESTA TABLA:
--
-- 1. La cancelación es GRATIS. Nadie paga, nadie cobra. Nadie debería quedarse
--    discutiendo de dinero mientras se siente inseguro.
--
-- 2. El impacto en la calificación NO es automático: pasa por revisión del admin.
--    Cancelación gratis + daño automático a la calificación del otro, a partir de
--    un texto que nadie verifica, es un arma: quien se arrepiente escribe "llegó
--    borracho" y hunde a un proveedor honesto que no tiene defensa. Con L0/L1 y
--    pocos trabajos, un golpe así pesa muchísimo.
--
-- 3. Motivo CERRADO + texto libre, no solo texto. Los códigos hacen visibles los
--    patrones: un reporte es ruido, tres iguales sobre el mismo proveedor es un
--    patrón sobre el que se puede actuar. Con texto libre no se puede contar nada.
--
-- El botón de pánico queda FUERA de esta versión por decisión de Ricardo: es otra
-- cosa (emergencia inmediata, sin formulario) y se añadirá cuando esté claro qué
-- debe hacer VISP al recibirlo.

CREATE TABLE IF NOT EXISTS job_cancellation_reports (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id        UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,

    -- Quién cancela y en qué papel. El papel importa: el mismo código de motivo
    -- significa cosas distintas según quién lo reporte.
    reported_by   UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    reporter_role VARCHAR(10) NOT NULL,

    -- VARCHAR con CHECK y no enum de PG: añadir un motivo nuevo es un ALTER del
    -- CHECK, sin la migración aislada que exige ALTER TYPE ADD VALUE (la trampa
    -- que ya costó las migraciones 031 y 035).
    reason_code   VARCHAR(40) NOT NULL,
    note          TEXT,

    -- Revisión del admin. PENDING hasta que alguien lo mire.
    status              VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    rating_impact       BOOLEAN NOT NULL DEFAULT FALSE,
    admin_note          TEXT,
    reviewed_at         TIMESTAMPTZ,

    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_cancel_report_role') THEN
        ALTER TABLE job_cancellation_reports
            ADD CONSTRAINT chk_cancel_report_role
            CHECK (reporter_role IN ('customer', 'provider'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_cancel_report_status') THEN
        ALTER TABLE job_cancellation_reports
            ADD CONSTRAINT chk_cancel_report_status
            CHECK (status IN ('PENDING', 'UPHELD', 'DISMISSED'));
    END IF;
END $$;

-- La cola del admin se ordena por antigüedad de lo pendiente.
CREATE INDEX IF NOT EXISTS idx_cancel_reports_pending
    ON job_cancellation_reports (created_at)
    WHERE status = 'PENDING';

-- Para contar reincidencia por proveedor/cliente sin escanear la tabla entera.
CREATE INDEX IF NOT EXISTS idx_cancel_reports_job
    ON job_cancellation_reports (job_id);

COMMENT ON TABLE job_cancellation_reports IS
    'Cancelaciones con motivo tras la llegada. La cancelacion es gratis; lo que '
    'se revisa aqui es si el reporte debe afectar la calificacion del otro.';
COMMENT ON COLUMN job_cancellation_reports.status IS
    'PENDING = sin revisar. UPHELD = el admin da la razon al que reporta. '
    'DISMISSED = reporte sin fundamento; NO afecta a nadie.';
COMMENT ON COLUMN job_cancellation_reports.rating_impact IS
    'Solo lo pone el admin al revisar. NUNCA se marca automaticamente: seria un '
    'arma para hundir la calificacion de alguien con un texto sin verificar.';
