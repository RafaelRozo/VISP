# Plan — Modelo de ofertas v2 (el customer postea, los proveedores ofertan)

Estado: **backend y admin IMPLEMENTADOS y probados** (2026-08-19). Falta la app móvil.
Fecha: 2026-08-19

## Estado de ejecución

| Bloque | Estado |
|---|---|
| Migración 042 (`job_offers`) + limpieza de catálogo | ✅ aplicada a `visp_prod` |
| Migración 043 (materiales) | ✅ aplicada |
| Migración 044 (`device_tokens`, `notifications`) | ✅ aplicada — **no existían: todo push fallaba en silencio** |
| `offerService` + 6 endpoints de ofertas | ✅ |
| `materialsService` + facturas, sobrecoste y autorización | ✅ |
| Booking sin precio, con rango y materiales | ✅ |
| Admin: materiales en Services + página de trabajos y ofertas | ✅ |
| Endpoints del flujo viejo | ✅ **borrados** |
| Smokes | ✅ **21/21 en verde contra `visp_prod`** |
| App móvil | ⬜ siguiente tanda |
Alcance de esta tanda: **backend + admin**. La app móvil va después, en una tanda aparte.

---

## 1. El cambio en una frase

Hoy el customer elige proveedor de una lista con precio ya calculado. A partir de
ahora **el customer postea el trabajo y los proveedores ofertan**; el customer ve las
ofertas que llegan, con la cara y el precio de cada proveedor, y elige una.

### Cómo se cobra hoy

El catálogo tiene un rango (ej. 70–90) y el pricing engine lo convierte en un total
estimado usando la duración del catálogo (2 h → 190 + tax). El customer ve ese total
antes de reservar y elige proveedor de `GET /jobs/{id}/available-providers`.

### Cómo se cobrará

1. El customer ve **el rango del admin como tarifa por unidad**: "70–90 CAD/h". No ve
   un total, porque todavía nadie ha dicho cuánto dura.
2. Solo pone **cantidad** si el servicio es por ítem (5 sillas IKEA). En los de hora y
   m² no hay campo de cantidad.
3. Añade **descripción + fotos**, elige **fecha y hora**, y postea. Ahí termina su parte.
4. El proveedor ve el trabajo en su bolsa de trabajos abiertos, lo lee, y **oferta
   poniendo la magnitud**: "esta casa la hago en 8 horas". Su tarifa **no la elige en la
   oferta**: sale de su perfil, ya aprobada dentro del rango del admin.
5. Al customer le llega la oferta: proveedor (nombre, estrellas, bio, nº de servicios),
   *Work: 8 hours*, *Rate: 70 CAD/h*, *Total: 560 + tax*, y **Aceptar / Rechazar**.
6. Si acepta: se agenda, se ejecuta, pruebas, cierre — **igual que hoy, sin cambios**.

---

## 2. De dónde sale la magnitud (la pieza central)

Un total es siempre `tarifa del proveedor × magnitud`. Lo único que cambia por servicio
es **quién dice la magnitud**. En `visp_prod` hay 55 servicios activos y solo 23 son por
hora, así que esto no es un detalle:

| `pricing_unit` | Activos | Magnitud | La dice | Ejemplo de oferta |
|---|---|---|---|---|
| `HOURLY` | 23 | horas | **el proveedor** en la oferta | 8 h × $70/h = $560 |
| `PER_AREA` | 4 | m² | **el proveedor** en la oferta | 80 m² × $75 = $6 000 |
| `PER_LINEAR_M` | 0 | metros | **el proveedor** en la oferta | — |
| `PER_UNIT` | 14 | unidades | **el customer** al reservar | 5 × $15 = $75 |
| `PER_VISIT` | 5 | 1 | fija | $25 la visita |
| `FLAT_PACKAGE` | 7 | 1 | fija | $55 el paquete |
| `CUSTOM_QUOTE` | 2 | — | **se elimina** (ver §3) | — |

Tres comportamientos, no siete: **magnitud del proveedor**, **cantidad del customer**,
**plano**.

En los que no son por hora no manejamos duración: se agenda la **hora de inicio que dio
el customer** y el proveedor avisa cuando termina. No hay forma de saber la duración
exacta y tampoco importa, porque no se paga por tiempo.

Si en obra el trabajo resulta mayor que lo ofertado, el camino es el **reprice que ya
existe** (`reprice_job_to_provider_rate` + aprobación de sobrecoste), nunca cambiar la
oferta a mano.

---

## 3. Lo que ya está construido y no hay que tocar

Buena parte del modelo ya existe; conviene decirlo antes de listar trabajo:

- `service_tasks.pricing_unit`, `base_price_min_cents`, `base_price_max_cents`,
  `allows_quantity`, `min_quantity` — el rango por servicio ya está en el admin.
- `provider_service_rates` — la tarifa del proveedor por servicio, con unidad
  snapshoteada, y **ya rechaza guardar fuera del rango** (`PriceOutOfRangeError`, 400).
  *La "aprobación" del precio del proveedor es exactamente ese guardarraíl: si está
  dentro del rango, entra; si no, no se guarda. No habrá cola manual de aprobación.*
- El booking **ya difunde el trabajo** a todos los proveedores calificados: crea un
  `job_assignments` en estado `OFFERED` por cada uno y el trabajo se queda en
  `pending_match`. La bolsa de trabajos abiertos del proveedor sale de ahí, sin motor de
  matching nuevo.
- `reprice_job_to_provider_rate` ya calcula subtotal desde la tarifa del proveedor,
  comisión por nivel, impuesto por provincia, service fee, total y evento de auditoría.
  **El flujo de ofertas lo reutiliza tal cual**; lo único que cambia es que la magnitud
  viene de la oferta en vez de adivinarse del catálogo.

Lo que falta es: que la oferta lleve magnitud y total, que **coexistan varias ofertas**, y
que el customer elija entre ellas.

---

## 4. Bloque A — Datos (migración 042)

### A1. Tabla `job_offers`

Una fila = una puja de un proveedor sobre un trabajo. Va en tabla nueva y no en
`job_assignments` porque son cosas distintas: `job_assignments` es *"te invitamos"* y
`job_offers` es *"esto te cobro y en cuánto lo hago"*. `job_assignments` sigue igual.

```
job_offers
  id                  UUID PK
  job_id              UUID NOT NULL → jobs(id) ON DELETE CASCADE
  provider_id         UUID NOT NULL → provider_profiles(id) ON DELETE CASCADE
  unit                pricing_unit NOT NULL          -- snapshot
  rate_cents          INTEGER NOT NULL               -- snapshot de provider_service_rates
  magnitude           NUMERIC(10,2) NOT NULL         -- horas / m² / unidades / 1
  magnitude_source    VARCHAR(10) NOT NULL CHECK (IN 'PROVIDER','CUSTOMER','FLAT')
  subtotal_cents      BIGINT NOT NULL
  service_tax_cents   BIGINT NOT NULL DEFAULT 0
  tax_rate            NUMERIC(6,5)
  service_fee_cents   BIGINT NOT NULL DEFAULT 0
  total_cents         BIGINT NOT NULL
  message             TEXT                            -- nota opcional del proveedor
  status              VARCHAR(20) NOT NULL DEFAULT 'pending'
                        CHECK (IN 'pending','accepted','rejected','withdrawn','expired')
  expires_at          TIMESTAMPTZ
  responded_at        TIMESTAMPTZ
  created_at / updated_at
```

- Índice único parcial `(job_id, provider_id) WHERE status IN ('pending','accepted')`:
  un proveedor no puede tener dos ofertas vivas en el mismo trabajo, pero sí puede
  volver a ofertar si retiró la anterior.
- `VARCHAR + CHECK` para el estado y no un enum de Postgres: añadir un estado nuevo es
  un `ALTER` del CHECK, sin la migración aislada que exige `ALTER TYPE ADD VALUE`. Mismo
  criterio que `service_task_questions.answer_type`.
- Los importes de impuesto y fee que guarda la oferta son **para mostrar** ("+tax" real,
  no un asterisco). La verdad contable se vuelve a sellar sobre el job al aceptar.

### A2. Columnas nuevas en `jobs`

```
accepted_offer_id   UUID NULL → job_offers(id)
offers_close_at     TIMESTAMPTZ NULL     -- cierre de la ventana de ofertas
```

### A3. Limpieza del catálogo (datos, no esquema)

1. Los **2 servicios `CUSTOM_QUOTE` activos** (limpieza de ductos, inspección HVAC) pasan
   a `FLAT_PACKAGE` conservando su rango, que ya lo tienen (200–450 y 150–250). Decisión
   tomada: todo servicio se cotiza contra un rango. `CUSTOM_QUOTE` queda en el enum sin
   uso, igual que el nivel 4.
2. **`allows_quantity` pasa a significar solo una cosa**: "el customer declara la
   cantidad". Hoy está en `true` en todos los servicios, incluidos los de hora — bajo el
   modelo nuevo eso dejaría al customer poniendo las horas. Se pone `true` solo en
   `PER_UNIT` y `false` en todo lo demás.
3. Guarda: un servicio no puede activarse sin `base_price_min/max` y con `min ≤ max`.

---

## 5. Bloque B — Backend, flujo de ofertas

Servicio nuevo `src/services/offerService.py`. Reutiliza `provider_rate_service` para
todo el cálculo; no duplica fórmulas de precio, comisión ni impuesto.

### Lado proveedor

| Endpoint | Qué hace |
|---|---|
| `GET /api/v1/jobs/open` | Bolsa de trabajos abiertos. Sale de los `job_assignments` en `OFFERED` del proveedor cuyo job siga en `pending_match` — el filtrado duro (zona, nivel, calificación, credenciales) ya lo hizo el broadcast. Devuelve el post completo: servicio, descripción, fotos, respuestas a las preguntas, fecha/hora pedida, cantidad si es por ítem, **su propia tarifa** y qué magnitud debe aportar. |
| `POST /api/v1/jobs/{id}/offers` | Envía la oferta: `{ magnitude?, message? }`. Rechaza con 400 si: el job ya no está abierto, el proveedor no tiene tarifa activa para ese servicio ("pon tu precio primero"), falta la magnitud cuando la unidad la exige, o ya tiene una oferta viva. La magnitud se ignora cuando la unidad es de cantidad-del-customer o plana. |
| `DELETE /api/v1/jobs/{id}/offers/mine` | Retira su oferta mientras siga `pending`. |

### Lado customer

| Endpoint | Qué hace |
|---|---|
| `GET /api/v1/jobs/{id}/offers` | Las ofertas vivas, ordenadas. Cada una trae la tarjeta del proveedor (nombre, foto, estrellas, bio, nº de servicios completados, nivel) + magnitud + tarifa + subtotal + impuesto + total. |
| `POST /api/v1/jobs/{id}/offers/{offer_id}/accept` | Gana esa oferta. En una transacción: sella el precio en el job vía `reprice_job_to_provider_rate` con la magnitud de la oferta, asigna proveedor, `job.accepted_offer_id`, marca las demás ofertas `rejected` y sus assignments `DECLINED`, y pasa el job a `SCHEDULED`. De ahí en adelante, la autorización de pago y el resto del ciclo van **exactamente como hoy**. |
| `POST /api/v1/jobs/{id}/offers/{offer_id}/reject` | Descarta una oferta suelta. El trabajo sigue abierto para las demás. |

### Alrededor

- **Notificaciones** (`notificationService` + socket, ya existen): oferta nueva → al
  customer. Oferta aceptada → al ganador. Trabajo cerrado → a los que perdieron, para
  que no se queden esperando.
- **Expiración**: la ventana de ofertas dura **48 h** por defecto (`offers_close_at`). Al
  cerrarse sin ofertas se avisa al customer y el trabajo queda para reponer o cancelar.
  Va en el job de expiración que ya corre en `src/jobs/`.

### Booking (`POST /jobs/book`)

- **Deja de estampar precio.** Se retira la llamada a `pricingEngine.calculate_price` que
  hoy clava el punto medio en `quoted_price_cents`. El trabajo nace **sin precio**: no hay
  precio hasta que se acepta una oferta.
- La respuesta devuelve el **rango del catálogo con su unidad** para que la app muestre
  "70–90 CAD/h" (y `rango × cantidad` en los de ítem, que ahí sí es un total real).
- La cantidad del customer solo se acepta si `pricing_unit = PER_UNIT`; en el resto se
  ignora aunque venga en el body.

### Qué se retira

**Se borran, no se marcan como deprecated** (decisión de Ricardo, 2026-08-19: si ya no se
usan, no se deja basura):

- `GET /jobs/{id}/available-providers` — el customer eligiendo proveedor de una lista.
- `GET /jobs/{id}/pending-provider`, `POST /approve-provider`, `POST /reject-provider` —
  el "primero que llega y el customer lo aprueba", que las ofertas reemplazan.
- El estado `PENDING_APPROVAL` deja de usarse en el flujo nuevo (se pasa de
  `pending_match` a `scheduled` al aceptar una oferta). El valor del enum se queda en
  Postgres, como el nivel 4, pero ninguna transición nueva lo produce.

**Consecuencia operativa:** el build 19 que está en TestFlight usa estos endpoints, así
que en cuanto se despliegue este backend deja de poder cerrar trabajos. Backend y build
móvil tienen que salir juntos, y hay que avisar a los testers de la pausa.

---

## 6. Bloque C — Admin

1. **Services**: la unidad y el rango ya se editan. Falta
   - editar `min_quantity`;
   - que `allows_quantity` solo sea editable cuando la unidad es `PER_UNIT`, y explique
     qué significa ahora ("el cliente declara la cantidad");
   - bloquear activar un servicio sin rango o con `min > max`;
   - texto de ayuda por unidad, para que quien carga el catálogo sepa que en `HOURLY` y
     `PER_AREA` la magnitud la pone el proveedor.
2. **Trabajos y ofertas** (página nueva): trabajos abiertos, cuántas ofertas tiene cada
   uno, y el detalle de cada oferta con proveedor, magnitud y total. Sin esto no hay forma
   de dar soporte cuando un customer llame diciendo "no me llegó ninguna oferta", que
   ahora es el fallo más probable del sistema.
3. **Tarifas por servicio** (dentro del detalle del servicio): cuántos proveedores tienen
   tarifa y su min/media/max. Es lo que dirá si el rango del admin está bien puesto.
   *Opcional, pero barato y evita ajustar rangos a ciegas.*

Aprobado por Ricardo el 2026-08-19: la página de monitoreo de trabajos entra en el
alcance, no queda como opcional.

---

## 7. Bloque D — Pruebas

Smoke end-to-end nuevo contra `visp_prod`, en la línea de los que ya existen: customer
postea → 3 proveedores ofertan con magnitudes distintas → el customer ve las 3 → acepta
una → verifica que el job quedó sellado con esa tarifa, que las otras dos quedaron
`rejected`, y que subtotal + impuesto + comisión + payout cuadran. Con un caso por cada
uno de los tres comportamientos de magnitud (hora, ítem, plano).

---

## 8. Orden de ejecución

| # | Bloque | Depende de |
|---|---|---|
| 1 | A — migración 042 + limpieza de catálogo | — |
| 2 | B — `offerService`, endpoints, notificaciones, expiración | 1 |
| 3 | C — booking sin precio, rango+unidad en la respuesta | 1 |
| 4 | D — admin: Services + página de trabajos y ofertas | 1, 2 |
| 5 | E — smoke end-to-end | 2, 3 |
| — | Móvil (tanda aparte) | 2, 3 |

---

## 9. Materiales (añadido el 2026-08-19)

El proveedor compra el material y el cliente se lo reembolsa. Migración `043`.

**El caso:** servicio de pintura. El cliente quiere que el pintor compre la pintura y le
autoriza **100 CAD**. El pintor lo ve **antes de ofertar**, compra por 85.50, sube la
factura, y ese importe se suma. Mano de obra 3 h × 80 = 240, material 85.50 → **325.50**.

### Admin

Checkbox **"este servicio necesita material"** por servicio. Al marcarlo se abre una
sección con:
- **rango de presupuesto** min–max (lo que el cliente podrá autorizar);
- **mensaje para el proveedor** ("compra pintura mate, guarda la factura");
- **preguntas de material**: las mismas de siempre (texto y opción cerrada) más un tipo
  nuevo **IMAGEN** — el caso que lo pidió es el color de pintura, que descrito con
  palabras no sirve y con una foto sí. Se marcan con `materials_only` y solo aparecen si
  el cliente pide material.

### Reserva

Si el servicio lo permite, el cliente ve la pregunta **"¿necesitas que el proveedor
compre materiales?"**. Si dice que no, la reserva sigue **exactamente como hoy**. Si dice
que sí, pone su presupuesto (dentro del rango del admin) y responde las preguntas de
material.

### Proveedor

Antes de ofertar ve: que el servicio lleva material, **el presupuesto autorizado**, el
mensaje del admin y las respuestas del cliente (la foto del color incluida). Al terminar
el trabajo **sube la factura y declara cuánto pagó** (`job_material_receipts`, una fila
por compra: la pintura en una tienda y los rodillos en otra es el caso normal).

### Las tres reglas del dinero

1. **El material no lleva impuesto encima.** El impuesto se calcula solo sobre la mano de
   obra. La tienda ya cobró el HST de esa pintura y viene dentro de los 85.50: aplicarlo
   otra vez es cobrarle al cliente dos veces el impuesto del mismo bote.
2. **VISP no cobra comisión sobre el material.** Es un reembolso, no ingreso del
   proveedor. La comisión se sigue calculando solo sobre el subtotal de mano de obra.
3. **Pasarse del presupuesto exige aprobación del cliente.** Hasta el techo se cobra sin
   fricción; el exceso se aprueba aparte, reusando el mecanismo de sobrecoste que ya
   existe. Es un campo distinto del sobrecoste de mano de obra: son dos excesos y el
   cliente puede aceptar uno y rechazar el otro.

Reparto resultante:

```
subtotal         = tarifa × magnitud                 (mano de obra)
impuesto         = f(subtotal)                        ← nunca sobre el material
comisión         = % × subtotal                       ← nunca sobre el material
payout proveedor = subtotal − comisión + material     ← se le devuelve íntegro
total cliente    = subtotal + impuesto + material + propina + fee de servicio
```

**Un detalle que hay que acertar en el cobro:** la autorización de Stripe se hace al
aceptar la oferta, cuando el material todavía no se ha comprado. El techo autorizado
tiene que incluir el **presupuesto de material**, o la captura final se quedará corta y
habrá que pedir una segunda autorización con el trabajo ya hecho.

## 10. Cosas que hay que tener en la cabeza

- **Solo 2 proveedores en toda la BD tienen tarifa puesta** (`provider_service_rates`).
  Sin tarifa no se puede ofertar, así que el primer efecto visible del cambio es que casi
  nadie podrá ofertar hasta que los proveedores pongan precio. La app tendrá que
  empujarlos a hacerlo, y conviene sembrar tarifas para las pruebas.
- **El precio del proveedor es fijo por servicio**, no por trabajo: no hay subasta a la
  baja. Es lo que protege los precios; también significa que dos proveedores del mismo
  servicio compiten por **tiempo y reputación**, no por descuento.
- El backend desplegado da servicio al build 19 y lo retirado **se borra**, así que
  backend y app tienen que salir en la misma tanda.
