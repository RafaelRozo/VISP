-- 051_job_overdue_and_authorized_at.sql
-- El reloj del trabajo en curso. Plan: docs/plan-cierre-y-agenda.md
--
-- CONTEXTO: hasta hoy nada cerraba un trabajo salvo que el proveedor pulsara
-- "Complete Job". TSK-BD00BM llevaba 28 h en IN_PROGRESS con $268.16 retenidos en
-- Stripe. Como Stripe suelta las autorizaciones sin capturar a los 7 días, un
-- trabajo que no se cierra no es un estado feo: es un cobro perdido.
--
-- Se añaden las tres columnas que faltaban para poder avisar y, en último
-- término, cerrar solo.

ALTER TABLE jobs
    -- Cuándo se creó la RETENCIÓN en Stripe. Es el único reloj que importa para la
    -- red de seguridad: los 7 días de Stripe se cuentan desde aquí, no desde que
    -- el trabajo empezó ni desde que se agendó.
    --
    -- POR QUÉ NO REUSAR `price_agreed_at`: hoy coinciden porque la autorización se
    -- lanza dentro de `accept_offer`, pero son cosas distintas —uno es el acuerdo,
    -- el otro es el dinero bloqueado— y en cuanto exista una re-autorización
    -- (overage, material por encima del techo) dejarían de coincidir sin avisar.
    ADD COLUMN IF NOT EXISTS authorized_at TIMESTAMPTZ,

    -- Último aviso "tu trabajo debería haber terminado" enviado al proveedor.
    -- Sin esto el aviso se repetiría en cada ciclo del scheduler, o sea cada
    -- minuto.
    ADD COLUMN IF NOT EXISTS overdue_notified_at TIMESTAMPTZ,

    -- Cuántos avisos se han mandado ya. Se corta en 3: a partir de ahí el push
    -- deja de ser un recordatorio y pasa a ser spam, y quien tiene que actuar es
    -- la red de seguridad, no el proveedor.
    ADD COLUMN IF NOT EXISTS overdue_notice_count SMALLINT NOT NULL DEFAULT 0;

-- Los trabajos que YA tienen una retención viva nacieron sin `authorized_at`. Sin
-- este relleno la red de seguridad no sabría cuándo caduca su autorización y los
-- dejaría abiertos justo a los que hay que rescatar —TSK-BD00BM entre ellos.
-- `price_agreed_at` es el instante exacto en que se autorizó en el flujo actual.
UPDATE jobs
   SET authorized_at = COALESCE(price_agreed_at, updated_at)
 WHERE authorized_at IS NULL
   AND stripe_payment_intent_id IS NOT NULL
   AND authorized_amount_cents IS NOT NULL;

-- El barrido busca trabajos en curso y ordena por el vencimiento de la
-- autorización. Son pocos por definición (un trabajo en curso es un trabajo que
-- alguien está haciendo ahora mismo), así que el índice es parcial: indexar la
-- tabla entera para leer un puñado de filas sale más caro que la lectura.
CREATE INDEX IF NOT EXISTS idx_jobs_in_progress_authorized
    ON jobs (authorized_at)
 WHERE status = 'IN_PROGRESS';
