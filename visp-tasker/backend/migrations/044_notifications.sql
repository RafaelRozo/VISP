-- 044_notifications.sql
-- Las tablas de notificaciones, que el código usa desde siempre y NINGUNA migración
-- creaba. Detectado el 2026-08-19 al probar el modelo de ofertas.
--
-- QUÉ ESTABA PASANDO: `src/models/notification.py` define DeviceToken y Notification,
-- y notificationService las consulta en cada aviso. En la base no existían — ni en
-- visp_prod ni en la vieja Visp2026 — así que TODA notificación fallaba con
-- UndefinedTableError. Como las llamadas van envueltas en try/except para que un push
-- caído no tumbe una reserva, el fallo no aparecía por ningún lado: nadie recibía nada
-- y nadie se enteraba. `notification_preferences` sí existía, lo que hacía la ausencia
-- todavía menos visible.
--
-- Por qué se arregla ahora y no "cuando toque": el modelo de ofertas depende de avisar.
-- El cliente tiene que saber que le llegó una oferta, el ganador que ganó, y los que
-- pierden que el trabajo ya tiene dueño. Sin esto hay que abrir la app y mirar a ver.
--
-- Los tipos son enums de Postgres porque así los declara el modelo
-- (`create_type=False` = "el tipo ya existe, no lo crees tú"). Ampliarlos más adelante
-- exige la migración aislada de ALTER TYPE ADD VALUE, así que se crean completos.

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'device_platform') THEN
        CREATE TYPE device_platform AS ENUM ('IOS', 'ANDROID');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notification_type') THEN
        CREATE TYPE notification_type AS ENUM (
            'JOB_OFFERED',
            'JOB_ACCEPTED',
            'JOB_STARTED',
            'JOB_COMPLETED',
            'JOB_CANCELLED',
            'JOB_REMINDER',
            'PROVIDER_EN_ROUTE',
            'PROVIDER_ARRIVED',
            'SLA_WARNING',
            'EMERGENCY_ALERT',
            'CREDENTIAL_EXPIRY',
            'PAYMENT_RECEIVED',
            'PAYOUT_SENT',
            'CHAT_MESSAGE',
            'SYSTEM'
        );
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- device_tokens — a qué aparatos se empuja
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS device_tokens (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_token VARCHAR(512) NOT NULL,
    platform     device_platform NOT NULL,
    app_version  VARCHAR(50),
    -- Se desactiva en vez de borrarse cuando FCM lo declara inválido: el histórico de
    -- a qué aparato se envió cada cosa es lo que permite investigar un "no me llegó".
    is_active    BOOLEAN NOT NULL DEFAULT TRUE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_device_tokens_user_id ON device_tokens (user_id);
-- Un mismo token no puede repetirse para un usuario: al reinstalar la app FCM devuelve
-- el mismo y sin esto se acumularían filas que multiplican los envíos.
CREATE UNIQUE INDEX IF NOT EXISTS uq_device_tokens_user_token
    ON device_tokens (user_id, device_token);
CREATE INDEX IF NOT EXISTS ix_device_tokens_active ON device_tokens (user_id, is_active);

-- ---------------------------------------------------------------------------
-- notifications — el centro de notificaciones dentro de la app
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS notifications (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title             VARCHAR(255) NOT NULL,
    body              TEXT NOT NULL,
    notification_type notification_type NOT NULL,
    data_json         JSONB,
    read              BOOLEAN NOT NULL DEFAULT FALSE,
    read_at           TIMESTAMPTZ,
    -- NULL = se guardó pero no se llegó a enviar (sin aparatos, o el usuario lo tiene
    -- desactivado en sus preferencias). Distinguirlo importa: "no lo mandamos" y "lo
    -- mandamos y no llegó" se investigan de forma distinta.
    sent_at           TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_notifications_user_id ON notifications (user_id);
CREATE INDEX IF NOT EXISTS ix_notifications_user_unread ON notifications (user_id, read);
CREATE INDEX IF NOT EXISTS ix_notifications_user_created ON notifications (user_id, created_at);
CREATE INDEX IF NOT EXISTS ix_notifications_type ON notifications (notification_type);

DROP TRIGGER IF EXISTS trg_device_tokens_updated_at ON device_tokens;
CREATE TRIGGER trg_device_tokens_updated_at
    BEFORE UPDATE ON device_tokens
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_notifications_updated_at ON notifications;
CREATE TRIGGER trg_notifications_updated_at
    BEFORE UPDATE ON notifications
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE device_tokens IS
    'Tokens FCM por usuario y aparato. Un usuario puede tener varios (iPhone + iPad).';
COMMENT ON TABLE notifications IS
    'Historial de avisos. Se guarda SIEMPRE, se haya podido empujar o no, para que el '
    'usuario lo vea al abrir la app aunque se perdiera el push.';
