-- 040_question_choices.sql
-- Preguntas con respuestas predeterminadas (cambio del cliente, 2026-08-13).
--
-- Ejemplo que pidió: "Describe condition of cleaning?" -> Light / Normal / Heavy.
--
-- POR QUÉ ESTO IMPORTA MÁS QUE LA COMODIDAD:
-- una respuesta de opción cerrada es COMPARABLE entre reservas; el texto libre no.
-- Con "Light/Normal/Heavy" el proveedor sabe de inmediato a qué atenerse, y más
-- adelante se puede filtrar o analizar. Es la misma lógica del catálogo cerrado
-- aplicada a las respuestas: cerrar lo que se pueda cerrar.

-- `answer_type` es VARCHAR con CHECK, NO un enum de Postgres, a propósito:
-- añadir un tipo nuevo (p.ej. selección múltiple) es un ALTER del CHECK, mientras
-- que con un enum haría falta un ALTER TYPE ADD VALUE en su propia migración
-- —la trampa que ya nos costó las migraciones 031 y 035—.
ALTER TABLE service_task_questions
    ADD COLUMN IF NOT EXISTS answer_type VARCHAR(20) NOT NULL DEFAULT 'TEXT',
    ADD COLUMN IF NOT EXISTS options JSONB NOT NULL DEFAULT '[]'::jsonb;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_question_answer_type'
    ) THEN
        ALTER TABLE service_task_questions
            ADD CONSTRAINT chk_question_answer_type
            CHECK (answer_type IN ('TEXT', 'SINGLE_CHOICE'));
    END IF;
END $$;

-- Una pregunta de opción sin opciones es una pregunta imposible de responder:
-- bloquearía la reserva sin que el cliente pueda hacer nada. Se impide en la BD
-- además de en el admin, porque es un callejón sin salida para el usuario final.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_question_options_present'
    ) THEN
        ALTER TABLE service_task_questions
            ADD CONSTRAINT chk_question_options_present
            CHECK (
                answer_type <> 'SINGLE_CHOICE'
                OR jsonb_array_length(options) >= 2
            );
    END IF;
END $$;

COMMENT ON COLUMN service_task_questions.answer_type IS
    'TEXT = textarea libre. SINGLE_CHOICE = el cliente elige UNA de `options`.';
COMMENT ON COLUMN service_task_questions.options IS
    'Solo para SINGLE_CHOICE. Array de {"en": "...", "fr": "..."} — los dos '
    'idiomas en el MISMO objeto para que no se puedan desincronizar, que es lo '
    'que pasaria con dos arrays paralelos indexados por posicion.';
