-- 055 · Denunciar y bloquear (Apple, guía 1.2)
--
-- Apple exige, en toda app con contenido de usuarios, poder DENUNCIAR contenido
-- y BLOQUEAR a un usuario abusivo, y que el equipo actúe en 24 h. Ver
-- `docs/plan-denunciar-bloquear.md`.
--
-- Tres tablas:
--   * content_reports    — la cola de denuncias que revisa el admin. Guarda una
--                          COPIA del contenido (`snapshot`): la prueba no puede
--                          depender de que el autor no lo borre.
--   * user_blocks        — el par bloqueado. El efecto es en las DOS direcciones
--                          (ver `moderation_service.blocked_user_ids`), así que
--                          una sola fila basta y el UNIQUE evita duplicados.
--   * moderation_actions — quién del admin hizo qué y por qué. Desbloquear
--                          BORRA la fila de user_blocks, así que la foto del
--                          bloqueo se queda aquí.
--
-- Más `chat_messages.removed_at`: el admin oculta un mensaje sin borrarlo
-- (el historial del chat es prueba en disputas).
--
-- Columnas de estado en VARCHAR + CHECK, igual que job_cancellation_reports:
-- añadir un valor es un ALTER del CHECK, no un ALTER TYPE.

BEGIN;

CREATE TABLE IF NOT EXISTS content_reports (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- NULL solo cuando la denuncia la crea el filtro automático del chat.
    reporter_id       UUID REFERENCES users(id),
    reported_user_id  UUID NOT NULL REFERENCES users(id),
    job_id            UUID REFERENCES jobs(id) ON DELETE SET NULL,

    source            VARCHAR(20) NOT NULL DEFAULT 'USER'
                      CHECK (source IN ('USER', 'AUTO_FILTER')),
    content_type      VARCHAR(20) NOT NULL
                      CHECK (content_type IN ('USER', 'CHAT_MESSAGE', 'JOB_DETAILS',
                                              'JOB_EVIDENCE', 'PROFILE')),
    -- El id del mensaje cuando content_type = CHAT_MESSAGE.
    content_id        UUID,
    reason            VARCHAR(30) NOT NULL
                      CHECK (reason IN ('HARASSMENT', 'OFFENSIVE', 'INAPPROPRIATE_PHOTO',
                                        'SCAM', 'SAFETY', 'OTHER')),
    note              TEXT,
    snapshot          JSONB NOT NULL DEFAULT '{}'::jsonb,

    status            VARCHAR(20) NOT NULL DEFAULT 'OPEN'
                      CHECK (status IN ('OPEN', 'ACTIONED', 'DISMISSED')),
    admin_action      VARCHAR(20)
                      CHECK (admin_action IN ('dismiss', 'remove_content', 'suspend', 'ban')),
    admin_note        TEXT,
    reviewed_by       UUID,
    reviewed_at       TIMESTAMPTZ,

    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

    CHECK (source = 'AUTO_FILTER' OR reporter_id IS NOT NULL)
);

-- La cola del admin: abiertas, las más viejas primero.
CREATE INDEX IF NOT EXISTS ix_content_reports_open
    ON content_reports (created_at)
    WHERE status = 'OPEN';
CREATE INDEX IF NOT EXISTS ix_content_reports_reported_user
    ON content_reports (reported_user_id);
-- Para ocultarle al denunciante el mensaje que denunció.
CREATE INDEX IF NOT EXISTS ix_content_reports_reporter_content
    ON content_reports (reporter_id, content_id)
    WHERE content_id IS NOT NULL;


CREATE TABLE IF NOT EXISTS user_blocks (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    blocker_id              UUID NOT NULL REFERENCES users(id),
    blocked_id              UUID NOT NULL REFERENCES users(id),
    job_id                  UUID REFERENCES jobs(id) ON DELETE SET NULL,
    -- PANIC: desde la cancelación con motivo (había un trabajo asignado).
    -- MENU:  desde el menú "⋯" (ofertas o trabajo ya cerrado).
    -- REPORT: la casilla "bloquear también" al denunciar.
    source                  VARCHAR(20) NOT NULL
                            CHECK (source IN ('PANIC', 'MENU', 'REPORT')),
    cancellation_report_id  UUID REFERENCES job_cancellation_reports(id) ON DELETE SET NULL,
    content_report_id       UUID REFERENCES content_reports(id) ON DELETE SET NULL,

    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

    CHECK (blocker_id <> blocked_id),
    UNIQUE (blocker_id, blocked_id)
);

CREATE INDEX IF NOT EXISTS ix_user_blocks_blocked ON user_blocks (blocked_id);


CREATE TABLE IF NOT EXISTS moderation_actions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id        UUID NOT NULL,
    action          VARCHAR(30) NOT NULL,
    report_id       UUID REFERENCES content_reports(id) ON DELETE SET NULL,
    target_user_id  UUID REFERENCES users(id),
    -- La fila de user_blocks tal como estaba antes de borrarla al desbloquear.
    block_snapshot  JSONB,
    note            TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);


ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS removed_at TIMESTAMPTZ;

COMMIT;
