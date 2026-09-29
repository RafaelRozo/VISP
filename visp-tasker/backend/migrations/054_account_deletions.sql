-- 054 · Borrado de cuenta desde la app (Apple 5.1.1(v))
--
-- El borrado es LÓGICO + anonimización a los 30 días, nunca un DELETE de
-- `users`: trabajos, consentimientos, reseñas, chat y comprobantes apuntan a
-- `users` con RESTRICT, y son historial de la otra parte, contabilidad o
-- auditoría legal. Ver `docs/plan-borrar-cuenta.md`.
--
-- Esta tabla es a la vez el REGISTRO de auditoría (quién, cuándo, desde qué IP,
-- igual que un consentimiento) y la COLA de la purga: el proceso diario busca
-- las filas con `purge_after` vencido y sin `purged_at` ni `restored_at`.
--
-- Guarda los estados ANTERIORES del usuario y del perfil de proveedor: sin
-- ellos, restaurar una cuenta dentro del plazo no sabría a qué volver.

BEGIN;

CREATE TABLE IF NOT EXISTS account_deletions (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Sin ON DELETE: la fila de `users` nunca se borra, solo se anonimiza.
    user_id                  UUID NOT NULL REFERENCES users(id),

    requested_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    ip_address               VARCHAR(64),
    user_agent               VARCHAR(500),

    previous_user_status     VARCHAR(32) NOT NULL,
    previous_provider_status VARCHAR(32),

    -- Lo que el borrado hizo con los trabajos, para soporte y para restaurar:
    -- [{"job_id":…, "reference":…, "action":"cancelled"|"reopened"|"offer_withdrawn"}]
    job_actions              JSONB NOT NULL DEFAULT '[]'::jsonb,

    purge_after              TIMESTAMPTZ NOT NULL,
    purged_at                TIMESTAMPTZ,
    restored_at              TIMESTAMPTZ,
    -- Lo que la purga no pudo hacer sola (p. ej. Stripe rechazó cerrar la
    -- cuenta conectada). Se resuelve a mano; la purga no se queda atascada.
    purge_notes              TEXT,

    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_account_deletions_user
    ON account_deletions (user_id);

-- La consulta de la purga: pendientes cuyo plazo venció.
CREATE INDEX IF NOT EXISTS ix_account_deletions_pending
    ON account_deletions (purge_after)
    WHERE purged_at IS NULL AND restored_at IS NULL;

COMMIT;
