# Plan — `per_contract`: el cliente pone el precio y contrata por horas

Estado: **propuesta, pendiente de aprobación**
Fecha: 2026-08-21
Decisiones de Ricardo tomadas antes de escribirlo (ver §2).

---

## 1. Qué es y en qué se diferencia

Un contratista necesita un ayudante. El cliente **pone su precio y sus horas**:

> "Pago **$22/h**, necesito un helper **8 horas**, el martes a las 9, para descargar
> material."

Los proveedores que dan ese servicio lo leen y **aceptan**. No cotizan.

Es la **inversión** del modelo que acabamos de construir. Hasta ahora el precio salía
siempre del proveedor —su tarifa, validada contra el rango del catálogo— y él aportaba
la magnitud. Aquí las dos cosas las pone el cliente y el proveedor solo dice que sí.

| | Resto del catálogo | `per_contract` |
|---|---|---|
| Tarifa | del **proveedor** (su perfil) | del **cliente**, en el post |
| Magnitud | del proveedor (horas, m²) o del cliente (ítems) | del **cliente** (horas) |
| El proveedor… | oferta | **acepta** |
| Cancelar a mitad | gratis, se suelta el hold | **se pagan las horas trabajadas** |

**Lo que NO cambia**: rango del admin, zona de servicio, credenciales, fecha y hora,
descripción y fotos, la ejecución, las evidencias, el cierre, el cobro y la
calificación. Todo eso es el flujo que ya existe.

---

## 2. Decisiones tomadas

**Si varios proveedores aceptan, elige el cliente.** Aceptar es *postularse*. El
cliente ve a los que dijeron que sí —estrellas, bio, trabajos hechos— y escoge, en la
misma pantalla de ofertas que ya existe. Para un helper que va a estar 8 horas a tu
lado, quién va importa tanto como el precio.

**Al cancelar se pagan las horas completas empezadas.** 4 h 10 min → se cobran 5 h.
El redondeo hacia arriba protege de paso al proveedor al que cancelan a los diez
minutos de llegar: cobra 1 hora. Nunca más de las horas contratadas.

**El precio del cliente respeta el rango del admin.** Si el servicio es 20–44 y el
cliente escribe 15, no se guarda. Es el mismo guardarraíl que acota la tarifa del
proveedor; la dirección cambia, la protección no.

---

## 3. La excepción que hay que declarar en voz alta

La migración 041 fijó que **la cancelación es gratis**: nadie paga, nadie cobra, y el
hold se suelta entero. La razón era buena — nadie debería estar discutiendo de dinero
mientras se siente inseguro.

`per_contract` **rompe esa regla, y solo esa**: si el trabajo ya empezó, cancelar
cobra el tiempo trabajado. No es una vuelta atrás; es que aquí el trabajo **ya se
hizo en parte**. El helper puso 4 horas y nadie se las devuelve.

Sigue intacto todo lo demás de la 041: motivos cerrados + texto, y el **impacto en la
calificación lo decide el admin, nunca automáticamente**. Cancelar sigue sin castigar
a nadie por sí solo.

Cancelar **antes de empezar** (`scheduled`, `en_route`) sigue siendo gratis en
`per_contract` también: no hay tiempo trabajado que pagar.

---

## 4. Datos

### Migración 046 — el valor del enum, SOLO

```sql
ALTER TYPE pricing_unit ADD VALUE 'PER_CONTRACT';
```

Va **sola en su propia migración**, sin nada más. `ALTER TYPE ... ADD VALUE` no puede
usarse en la misma transacción en la que después se emplea el valor nuevo: es la
trampa que ya costó las migraciones 031 y 035.

### Migración 047 — lo que usa el valor

```
jobs.customer_rate_cents  BIGINT   -- la tarifa/hora que puso EL CLIENTE
```

Las horas contratadas van en `jobs.quantity`, que ya existe y ya es la magnitud del
trabajo — no hace falta una columna nueva para lo mismo. Las horas realmente
trabajadas van en `jobs.actual_duration_minutes`, que también existe.

Guarda: `customer_rate_cents` obligatorio si el servicio es `PER_CONTRACT`, y nulo si
no lo es — para que nadie cuele un precio de cliente en un servicio donde manda la
tarifa del proveedor.

---

## 5. Backend

**Reserva.** El cliente manda `customerRateCents` y las horas. Se valida contra
`base_price_min/max_cents` del servicio; fuera de rango → 400 con el rango en el
mensaje.

**Bolsa del proveedor.** El trabajo aparece con el precio ya puesto: "$22/h × 8 h =
$176". Dos cambios respecto al flujo normal:
- **No se le exige tener tarifa** para este servicio: el precio no es suyo. Hoy sin
  tarifa no se puede ofertar, y aquí eso bloquearía a todo el mundo.
- El formulario no pide nada. El botón es **Aceptar**, no "hacer una oferta".

**La aceptación se guarda como una oferta** (`job_offers`) con la tarifa y las horas
del cliente copiadas. Reusar la tabla no es un atajo: es que el objeto es el mismo
—un proveedor dispuesto a hacer ese trabajo por ese dinero— y así la pantalla de
ofertas del cliente, el sellado del precio al aceptar y el admin funcionan sin tocar
nada.

**Cotización.** `get_provider_quote_for_job` y `reprice_job_to_provider_rate` toman la
tarifa de `jobs.customer_rate_cents` cuando la unidad es `PER_CONTRACT`, en vez de
buscarla en `provider_service_rates`. Comisión, impuesto, fee y payout se calculan
igual que siempre sobre ese subtotal.

**Cancelación con cobro parcial** (`cancellation_service`):

```
si unidad == PER_CONTRACT y job.started_at existe:
    horas = ceil((cancelado_en - started_at) / 1h)          # completas empezadas
    horas = min(horas, horas_contratadas)                    # nunca más de lo pactado
    subtotal = customer_rate × horas
    impuesto = f(subtotal)   ·   comisión = % × subtotal
    payout   = subtotal − comisión
    → se CAPTURA ese total en el hold que ya estaba retenido
si no:
    → comportamiento actual: gratis, se suelta el hold
```

Queda registrado en `pricing_events` con `calculated_by="contract_cancellation"`, para
que la cascada del recibo explique por qué se cobró la mitad.

---

## 6. Admin

`PER_CONTRACT` aparece en el desplegable de unidad, con una nota que diga lo que hace:
**"el cliente pone el precio dentro del rango; el proveedor solo acepta"**. Sin esa
frase, quien cargue el catálogo no puede adivinar que esta unidad invierte el modelo.

El rango min–max pasa a significar **lo que el cliente puede ofrecer por hora**.

---

## 7. App

**Cliente, al reservar**: campo de tarifa (acotado al rango, con el rango a la vista) y
campo de horas. El total se calcula delante: "8 h × $22 = **$176**".

**Cliente, en ofertas**: la misma pantalla. Cambia el encabezado —todos traen el mismo
precio, así que lo que se compara es **la persona**, no el importe.

**Proveedor, en la bolsa**: la tarjeta muestra el trato cerrado y un botón **Aceptar**.
Sin campos de horas ni de material.

**Cancelar a mitad**: el modal de motivos que ya existe, más **una línea que diga qué se
va a cobrar** antes de confirmar: "Llevas 4 h 10 min. Se cobrarán 5 h = $110." Nadie
debería descubrir el importe después de cancelar.

---

## 8. Orden

| # | Bloque | Depende de |
|---|---|---|
| 1 | Migración 046 (enum, sola) | — |
| 2 | Migración 047 (`customer_rate_cents` + guarda) | 1 |
| 3 | Backend: reserva, bolsa, aceptación, cotización | 2 |
| 4 | Backend: cancelación con cobro parcial | 3 |
| 5 | Admin: unidad nueva en el desplegable | 2 |
| 6 | App: reserva, bolsa, aceptar, aviso al cancelar | 3, 4 |
| 7 | Smoke end-to-end del contrato completo y del cancelado a mitad | 4 |
