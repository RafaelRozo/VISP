-- 050 — Cierra de una vez los trabajos que llevaban meses abiertos.
--
-- Al aplicarse eran 25 trabajos en PENDING_MATCH, el más antiguo del 18 de
-- febrero. Ninguno se iba a cerrar solo: 19 son anteriores a ofertas v2 y
-- nacieron con `offers_close_at` nulo, y el reloj de la CITA no lo miraba nadie.
--
-- La regla es la misma que aplica `offerService.expire_stale_jobs` de aquí en
-- adelante — si se cambia una, hay que cambiar la otra:
--
--   deadline = el PRIMERO de estos dos que llegue
--       1. offers_close_at            (ventana de 48 h para recibir ofertas)
--       2. la cita                    (requested_date + requested_time_start)
--   y si no existe ninguno, created_at + 48 h.
--
-- OJO CON LA ZONA HORARIA: `requested_time_start` es un TIME sin zona que
-- guarda hora LOCAL del área de servicio. La base corre en UTC, así que
-- compararlo crudo contra now() cerraría los trabajos CUATRO HORAS ANTES de
-- tiempo en verano (las 13:00 de Toronto son las 17:00 UTC). De ahí el
-- AT TIME ZONE.
--
-- LEAST ignora los NULL, así que basta con que exista uno de los dos relojes.

UPDATE jobs j
SET status       = 'EXPIRED',
    cancelled_at = COALESCE(j.cancelled_at, NOW()),
    updated_at   = NOW()
WHERE j.status = 'PENDING_MATCH'
  AND j.accepted_offer_id IS NULL
  AND COALESCE(
        LEAST(
          j.offers_close_at,
          CASE
            WHEN j.requested_date IS NOT NULL THEN
              (j.requested_date + COALESCE(j.requested_time_start, TIME '23:59:59'))
                AT TIME ZONE 'America/Toronto'
          END
        ),
        j.created_at + INTERVAL '48 hours'
      ) <= NOW();

-- Las ofertas que seguían pendientes en esos trabajos se cierran con ellos: si
-- no, sus proveedores quedan esperando respuesta de un trabajo que ya no existe.
--
-- EN MINÚSCULAS, y no es un descuido: `job_offers.status` es un VARCHAR con
-- CHECK que guarda los valores tal cual ('pending'), mientras que `jobs.status`
-- es un enum de Postgres que guarda el NOMBRE del miembro ('PENDING_MATCH').
-- Dos convenciones en la misma sentencia. Escrito en mayúsculas, este UPDATE no
-- casa ninguna fila y no da ningún error: deja las ofertas vivas colgando de
-- trabajos ya expirados.
UPDATE job_offers o
SET status       = 'expired',
    responded_at = COALESCE(o.responded_at, NOW()),
    updated_at   = NOW()
FROM jobs j
WHERE j.id = o.job_id
  AND j.status = 'EXPIRED'
  AND o.status = 'pending';
