-- 039_service_questions.sql
-- Preguntas por servicio en la reserva (pedido del cliente, 2026-08-13).
--
-- Algunos servicios necesitan que el cliente conteste preguntas concretas además
-- de los detalles y las fotos. La pregunta la escribe el admin; el cliente
-- responde en un textarea, igual que los detalles.
--
-- Misma naturaleza que `customer_details`: es SOPORTE DE DECISIÓN para el
-- proveedor, que lo lee ANTES de aceptar para juzgar si le interesa el trabajo
-- con su rango de precio. NO define ni recotiza el trabajo — el servicio y el
-- precio siguen saliendo del catálogo cerrado (CLAUDE.md regla 1).
--
-- Por qué una TABLA y no un JSONB en `service_tasks`:
--   * cada respuesta del cliente apunta a un `question_id` estable, así que se
--     puede saber a qué pregunta respondió aunque el admin reescriba el texto
--     después. Con un array embebido, reordenar las preguntas dejaría las
--     respuestas históricas apuntando a la pregunta equivocada.
--   * permite desactivar una pregunta sin perder las respuestas ya dadas.

CREATE TABLE IF NOT EXISTS service_task_questions (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id       UUID NOT NULL REFERENCES service_tasks(id) ON DELETE CASCADE,

    question_en   TEXT    NOT NULL,
    question_fr   TEXT,

    -- Si es obligatoria, no se puede reservar sin respuesta (400 en la API).
    is_required   BOOLEAN NOT NULL DEFAULT TRUE,
    -- Desactivar en vez de borrar: las respuestas históricas siguen apuntando aquí.
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    display_order INTEGER NOT NULL DEFAULT 0,

    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_service_task_questions_task
    ON service_task_questions (task_id, display_order)
    WHERE is_active;

COMMENT ON TABLE service_task_questions IS
    'Preguntas que el admin define por servicio. El cliente las responde en texto '
    'libre al reservar y el proveedor las lee antes de aceptar.';
COMMENT ON COLUMN service_task_questions.is_active IS
    'FALSE retira la pregunta de reservas nuevas sin romper las respuestas ya '
    'guardadas en jobs.customer_answers_json.';

-- Respuestas del cliente, junto a los detalles y la evidencia de la mig. 038.
-- Se guarda el TEXTO de la pregunta además del id: si el admin la reescribe o la
-- desactiva más adelante, el job sigue siendo legible tal como se reservó — hace
-- falta para resolver una disputa meses después.
ALTER TABLE jobs
    ADD COLUMN IF NOT EXISTS customer_answers_json JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN jobs.customer_answers_json IS
    'Array de {questionId, question, answer}. Se guarda el texto de la pregunta '
    'ademas del id para que el job siga siendo legible si el admin la cambia.';
