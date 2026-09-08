-- 052_legal_consent_signatures.sql
-- La firma del contrato. Plan: docs/plan-firma-contratos.md
--
-- CONTEXTO: `legal_consents` existe desde la migración 004 y hasta hoy NO TIENE
-- NI UNA FILA. La infraestructura legal completa (tabla, servicio, endpoints, el
-- texto del contrato) se construyó en la Phase 2 y nunca se conectó: el checkbox
-- de términos del registro manda `termsVersion` en el POST, `RegisterRequest` no
-- lo declara y Pydantic lo descarta en silencio. O sea: cero rastro auditable de
-- que nadie haya aceptado nada, incumpliendo la regla no-negociable #3.
--
-- Esto añade lo que faltaba para que el consentimiento sea además un DOCUMENTO
-- FIRMADO: el trazo, el nombre legal y el PDF resultante con su hash.
--
-- POR QUÉ NO UNA TABLA APARTE: la fila de `legal_consents` YA ES el registro de
-- auditoría — guarda el texto íntegro, su SHA-256, la IP, el user-agent y el
-- device. Una tabla paralela de "firmas" obligaría a mantener dos verdades
-- sincronizadas sobre el mismo acto. Se amplía la que ya existe.

ALTER TABLE legal_consents
    -- El nombre legal TAL Y COMO EL FIRMANTE LO CONFIRMÓ. Se precarga con el del
    -- registro, pero es editable: el PDF lo llama "Legal Name" y debe coincidir
    -- con la identificación oficial, y mucha gente se registra como "Richie"
    -- cuando su ID dice "Ricardo". Se guarda lo que el firmante VIO y aceptó, no
    -- lo que había en `users` en ese instante (que puede cambiar después).
    ADD COLUMN IF NOT EXISTS signed_full_name VARCHAR(255),

    -- "Business Name (if applicable)" del bloque de aceptación del contrato.
    -- NULL para el proveedor individual, que es el caso normal en L0/L1.
    ADD COLUMN IF NOT EXISTS business_name VARCHAR(255),

    -- El trazo, en vectorial (lista de paths SVG). Es el dato ORIGINAL: se firma
    -- con el dedo sobre <Svg>, y de aquí sale el PNG. Guardar el vector y no solo
    -- el bitmap permite re-rasterizar a cualquier resolución sin pérdida el día
    -- que haga falta ampliarlo para una disputa.
    ADD COLUMN IF NOT EXISTS signature_svg TEXT,

    -- El PNG rasterizado del trazo, para incrustarlo en el PDF y mostrarlo en el
    -- admin sin tener que renderizar SVG en el navegador.
    ADD COLUMN IF NOT EXISTS signature_image_path VARCHAR(500),

    -- El PDF firmado: contrato íntegro + tabla de aceptación rellenada + página
    -- de firma con el bloque de auditoría. ESTE es el artefacto legal; la imagen
    -- de la firma por sí sola no lo es.
    ADD COLUMN IF NOT EXISTS document_path VARCHAR(500),

    -- SHA-256 del PDF. `consent_text_hash` prueba QUÉ TEXTO se mostró;
    -- `document_hash` prueba que el PDF archivado no se ha tocado desde que se
    -- generó. Son dos afirmaciones distintas y hacen falta las dos.
    ADD COLUMN IF NOT EXISTS document_hash VARCHAR(128);

-- Buscar "el consentimiento vigente de este usuario para este documento" es la
-- consulta caliente: se ejecuta en la puerta de ofertar, en cada arranque de la
-- app y en el admin. Sin índice es un seq scan sobre una tabla que solo crece
-- (append-only, nunca se borra nada).
CREATE INDEX IF NOT EXISTS idx_legal_consents_user_type_created
    ON legal_consents (user_id, consent_type, created_at DESC);

-- El PDF firmado se sirve por un endpoint autenticado, nunca por el mount
-- estático de /uploads: un UUID es inadivinable, no es privado, y aquí hay
-- nombre legal completo y firma manuscrita.
COMMENT ON COLUMN legal_consents.document_path IS
    'Ruta relativa del PDF firmado. Servir SOLO vía GET /consents/{id}/document (autenticado). Nunca por /uploads.';
