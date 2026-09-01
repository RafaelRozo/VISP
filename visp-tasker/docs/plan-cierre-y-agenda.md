# Plan — cierre del trabajo y choques de agenda

**Fecha:** 2026-09-01 · **Rama:** `Test-version`
**Origen:** dos fallos que Ricardo reprodujo probando el 31-ago con
`richie_yanez20@outlook.com` (cliente) y `rodrigorozoa@gmail.com` (proveedor).

---

## 1. El trabajo en curso no se cierra nunca

### Lo que pasó, con los datos

```
TSK-BD00BM · General Labour — Contract · PER_CONTRACT · quantity = 8.00 h
requested_date 2026-08-29 16:00   started_at 2026-08-31 13:12 UTC (09:12 Ontario)
status IN_PROGRESS · completed_at NULL          --> 28 h después, sigue igual
authorized_amount_cents 26816 · total_charged_cents 20628
stripe_payment_intent_id pi_3U8pFy… (requires_capture desde el 26-ago 22:25 UTC)
```

### Causa raíz — es código que no existe, no código roto

1. **Solo el proveedor cierra un trabajo.** La transición `in_progress → completed`
   nace únicamente en `POST /provider/jobs/{id}/complete`
   (`routes/providers.py:601`). El barrido perezoso `offerService.expire_stale_jobs`
   solo mira `PENDING_MATCH`: un trabajo empezado no lo revisa nadie, nunca.
2. **El trabajo no sabe a qué hora termina.** `requested_time_end` está NULL en
   toda la tabla —`jobService` solo escribe fecha y hora de inicio— y la duración
   vive repartida entre `jobs.quantity` (PER_CONTRACT/HOURLY) y
   `service_tasks.estimated_duration_min` (el resto). Sin hora de fin no hay reloj
   contra el que avisar ni cerrar.
3. **No hay ningún proceso de fondo.** `services/reminderScheduler.py` parecía
   serlo, pero: el `lifespan` de `main.py` **no lo arranca**, y consulta
   `Job.scheduled_start`, **columna que no existe** — reventaría en el primer
   ciclo, dentro de su propio `try/except`. Es código muerto que aparentaba
   cobertura.

### Por qué urge — es dinero, no estética

Stripe libera las autorizaciones sin capturar **a los 7 días**. La de `TSK-BD00BM`
se creó el **26-ago 22:25 UTC**, así que muere el **2-sep 22:25 UTC**. Un trabajo
que no se cierra a tiempo no es un estado feo: es un cobro perdido y una tarjeta
que hay que volver a pedir.

### Lo que se construye (decisión de Ricardo: avisar + red de seguridad)

- **Ventana del trabajo** (`services/jobSchedule.py`, nuevo): fin efectivo =
  `started_at + duración`. La duración sale de la unidad de precio —horas en
  PER_CONTRACT/HOURLY, `estimated_duration_min` en el resto— en un solo sitio, que
  es lo que hoy no existe.
- **Aviso al vencer**: al pasar la hora de fin, push al proveedor para que cierre
  y suba las fotos. Se repite cada 6 h, máximo 3 veces.
- **Red de seguridad**: si nadie cierra, el sistema cierra y captura en
  `authorized_at + 6 días` — **un día antes** de que Stripe suelte la retención.
  Se hace con `update_job_status(actor_type="system")`, que ya dispara la captura.
- **Dónde corre**: tarea `asyncio` arrancada desde el `lifespan` (el contenedor
  levanta **un** uvicorn sin `--workers`, así que no hay duplicados), **y además**
  colgada de las lecturas perezosas del dashboard del proveedor — el mismo patrón
  que salvó al vencimiento de ofertas cuando se descubrió que no había worker.
- **Fotos de "después" opcionales** al cerrar (`photos_after_json`, columna que ya
  existe). No bloquean: un proveedor sin cobertura tiene que poder cerrar y cobrar.

### Arrastre que se arregla de paso

`_enforce_start_preconditions` (`jobService.py:622`) ancla la cita en **UTC**
mientras el resto del sistema la trata como hora local de Toronto
(`offerService.SERVICE_TIMEZONE`). Son 4 h: deja arrancar un trabajo 4 h antes de
su hora.

**Queda fuera a propósito:** poner un tope superior al arranque. Hoy un trabajo
agendado el 29 a las 16:00 se puede arrancar el 31 a las 9:12 —es exactamente lo
que pasó— pero decidir cuánto retraso es aceptable es producto, no un bug.

---

## 2. Un proveedor puede comprometerse a dos trabajos a la vez

### Lo que pasó

`TSK-5SEVZG` (Dog Walking, 31-ago 12:00) lo aceptó Rodrigo teniendo el de 8 h en
curso. Nada se lo impidió.

### Causa raíz

`matchingEngine.provider_can_bid` —el **único** predicado de elegibilidad del
producto, del que beben la bolsa, `create_offer` y el broadcast— filtra trabajo
propio, cualificación, ubicación, radio y nivel/credenciales
(`matchingEngine.py:336-421`). **La agenda no se mira en ningún sitio.**
`accept_offer` tampoco la mira.

### Lo que se construye (decisión de Ricardo: solape exacto, tarjeta bloqueada)

- `BID_SCHEDULE_CONFLICT` nuevo en `provider_can_bid`, contra los trabajos ya
  comprometidos del proveedor (assignment `ACCEPTED` y job en `SCHEDULED`,
  `PROVIDER_ACCEPTED`, `PROVIDER_EN_ROUTE` o `IN_PROGRESS`). **Solape exacto, sin
  margen de traslado.** Al vivir en `provider_can_bid`, ofertar y ver quedan
  cubiertos por el mismo cambio.
- **Revalidación en `accept_offer`**: dos ofertas pendientes pueden ser válidas por
  separado y chocar solo cuando el cliente acepta la segunda. 4xx con motivo y el
  cliente elige otra oferta.
- **En la bolsa el trabajo NO se oculta**: sale en gris con "Ya tienes un trabajo a
  esa hora". Ocultarlo sin explicación es el fallo que ya se pagó una vez con
  `own_job`.

---

## Orden de ejecución

1. Migración 051: `jobs.authorized_at`, `jobs.overdue_notified_at`,
   `jobs.overdue_notice_count`.
2. `services/jobSchedule.py` — ventana del trabajo, única fuente de la duración.
3. `matchingEngine` — `BID_SCHEDULE_CONFLICT`.
4. `offerService` — bolsa con motivo + revalidación al aceptar.
5. `jobs/jobLifecycle.py` — aviso + red de seguridad; `lifespan` + gancho perezoso.
6. `reminderScheduler.py` — se borra (muerto y roto).
7. `jobService` — zona horaria del arranque.
8. `POST /provider/jobs/{id}/complete` — acepta `photosAfter`.
9. App: motivo del bloqueo en la bolsa, fotos opcionales al cerrar, aviso de
   vencido; traducciones en **en.json y fr.json**.
10. Smokes contra `visp_prod` + `audit_layout.py` + `tsc --noEmit`.

## Acción manual, hoy

Rodrigo tiene que cerrar `TSK-BD00BM` desde la app (**Complete Job** captura los
$206.28) **antes del 2-sep 22:25 UTC**. Pasada esa hora la retención se libera
sola y hay que volver a pedir la tarjeta.
