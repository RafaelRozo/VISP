-- 038_global_experience_and_booking_details.sql
-- v1 L0/L1 — dos cambios pedidos por el cliente el 2026-08-11.
--
-- (A) La evidencia de experiencia L1 deja de ser POR CATEGORÍA y pasa a ser un
--     expediente ÚNICO del proveedor: sube su CV, fotos de trabajos y cartas de
--     recomendación, y con eso valida experiencia para subir a L1.
--     Revierte la decisión del 2026-08-04 (que era por clasificación).
--
-- (B) La reserva gana una pantalla de "Details / More info": texto de detalles,
--     evidencia fotográfica del cliente y notas libres. Con dos flags por
--     servicio para decidir si detalles y evidencia son obligatorios.

-- ---------------------------------------------------------------------------
-- (A) Expediente de experiencia global
-- ---------------------------------------------------------------------------
-- `category_id` pasa a NULLABLE. NULL = evidencia del expediente global (el
-- modelo de la v1). Se conserva la columna, y no se borra, porque cuando se
-- abra L2 la evidencia por clasificación vuelve a hacer falta: con NULL para lo
-- global y un id para lo específico, las dos conviven sin migrar de nuevo.
ALTER TABLE provider_experience_records
    ALTER COLUMN category_id DROP NOT NULL;

COMMENT ON COLUMN provider_experience_records.category_id IS
    'NULL = evidencia del expediente GLOBAL del proveedor (modelo v1: CV, fotos, '
    'cartas -> L1). Con valor = evidencia atada a una clasificación concreta '
    '(reservado para cuando se abra L2).';

-- El enum `experience_record_kind` ya cubre lo que pidió el cliente
-- (RESUME, WORK_PHOTOS, RECOMMENDATION_LETTER, REFERENCE, PREVIOUS_JOBS,
-- TRAINING_RECORD, OTHER), así que no se toca.

-- Un proveedor no debería poder subir dos veces el mismo tipo de documento en su
-- expediente global y dejar al validador sin saber cuál mira. Se permite
-- reemplazar, no acumular duplicados del mismo tipo.
CREATE UNIQUE INDEX IF NOT EXISTS uq_experience_global_kind
    ON provider_experience_records (provider_id, kind)
    WHERE category_id IS NULL;

-- ---------------------------------------------------------------------------
-- (B) Detalles y evidencia de la reserva
-- ---------------------------------------------------------------------------
-- OJO: la evidencia del CLIENTE es distinta de `photos_before_json` /
-- `photos_after_json`, que son las fotos que toma el PROVEEDOR al empezar y
-- terminar el trabajo. Mezclarlas haría imposible distinguir quién aportó qué
-- en una disputa, así que va en su propia columna.
ALTER TABLE jobs
    ADD COLUMN IF NOT EXISTS customer_details      TEXT,
    ADD COLUMN IF NOT EXISTS customer_evidence_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS customer_extra_note   TEXT;

COMMENT ON COLUMN jobs.customer_details IS
    'Detalles que el cliente escribe sobre el servicio YA SELECCIONADO (p.ej. '
    '"2 habitaciones, 2 banos"). Es CONTEXTO DE EJECUCION, no un cambio de '
    'alcance: no altera precio, nivel ni SLA, que salen del catalogo. Si el '
    'trabajo resulta mayor, el camino correcto es accept+reprice del proveedor.';
COMMENT ON COLUMN jobs.customer_evidence_json IS
    'Fotos que sube el CLIENTE al reservar. Distinto de photos_before_json, que '
    'son las del PROVEEDOR al iniciar. Maximo 5, validado en la API.';
COMMENT ON COLUMN jobs.customer_extra_note IS
    'Nota libre para lo que no encaja en los detalles (p.ej. el caracter del '
    'perro en un paseo).';

-- Flags por servicio. DOS y no uno a propósito: son independientes — en pasear
-- perros los detalles no aportan pero la nota sí, y en un daño la foto vale más
-- que la prosa.
--
-- Estos flags NO van en `service_credential_requirements`: esa tabla es para
-- requisitos de CREDENCIALES DEL PROVEEDOR. Esto es un requisito de ENTRADA DE
-- LA RESERVA, y su sitio es el servicio.
ALTER TABLE service_tasks
    ADD COLUMN IF NOT EXISTS requires_details  BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS requires_evidence BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS details_prompt_en TEXT,
    ADD COLUMN IF NOT EXISTS details_prompt_fr TEXT;

COMMENT ON COLUMN service_tasks.requires_details IS
    'Si TRUE, no se puede reservar sin texto de detalles. La API devuelve 400.';
COMMENT ON COLUMN service_tasks.requires_evidence IS
    'Si TRUE, no se puede reservar sin al menos una foto de evidencia. 400.';
COMMENT ON COLUMN service_tasks.details_prompt_en IS
    'Placeholder del campo de detalles PARA ESTE SERVICIO, editable desde el '
    'admin. Es la pieza que mantiene el campo dentro de la regla del catalogo '
    'cerrado: guia al cliente a describir ESCALA Y ACCESO del servicio ya '
    'elegido, no a agregar tareas nuevas. Un placeholder genérico invita a '
    'pedir cosas que no estan cotizadas.';

-- Arranque conservador: nada obligatorio. El cliente enciende servicio por
-- servicio desde el admin, que es justo lo que pidió ("aún están definiendo").
