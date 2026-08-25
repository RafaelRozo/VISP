-- 049 — Nuevo estado de trabajo: EXPIRED.
--
-- Un trabajo dejaba de tener sentido pero nunca dejaba de estar abierto: no
-- existía ningún estado para "se le pasó el plazo". El más viejo llevaba abierto
-- desde febrero.
--
-- No se reusa CANCELLED_BY_SYSTEM porque al cliente le importa la diferencia:
-- una cancelación es algo que alguien decidió; esto es que nadie ofertó a tiempo
-- o que llegó la hora del servicio sin que él eligiera.
--
-- VA SOLO EN SU PROPIO ARCHIVO. Postgres no deja USAR un valor de enum recién
-- añadido dentro de la misma transacción que lo añade, y `scripts/migrate.py`
-- ejecuta cada archivo en una. El backfill que lo usa va en la 050.

ALTER TYPE job_status ADD VALUE IF NOT EXISTS 'EXPIRED';
