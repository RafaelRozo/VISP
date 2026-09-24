# Plan — Paso a paso del usuario nuevo · Checklist guiado en el Home

Estado: **propuesta, sin código**. 2026-09-22.

Objetivo: que un usuario recién registrado —proveedor o cliente— sepa en todo
momento **qué le falta, por qué le hace falta y dónde se hace**, sin tener que
preguntar. Una sola tarjeta bajo su nombre en el Home, que se enciende paso a
paso y desaparece cuando termina.

---

## 1. El principio: cada paso ENCIENDE algo

Un checklist donde todo grita a la vez no guía, abruma. La regla de este diseño
es que **solo un paso está destacado: el siguiente**. Los anteriores están en
gris con su ✓, los posteriores en gris apagado y no se pueden tocar.

Y cada paso tiene que devolver algo **visible** al completarse, no un ✓ y nada
más. Esa es la diferencia entre un formulario troceado y una guía.

---

## 2. PROVEEDOR — los 5 pasos, en orden

Antes del paso 1, dos cosas que ya existen y no se tocan: el **registro** y la
**firma del contrato IC** (pantalla completa, sin atrás, ya implementada). El
checklist arranca cuando el proveedor cae en su Home por primera vez.

### Paso 1 · Tu dirección base y tu radio

- **Qué pide**: la dirección desde la que sale a trabajar + hasta dónde se mueve.
- **Por qué va primero**: sin ella la bolsa está vacía —`provider_can_bid`
  devuelve `no_location`— y es el paso más barato de todos, 30 segundos.
- **Qué enciende**: al guardar, la app dice **«12 trabajos cerca de ti»**. Es el
  primer momento en que VISP demuestra que hay trabajo. Antes de pedirle nada
  serio, le enseñamos que merece la pena.
- **Copy**: *«¿Desde dónde trabajas?»* · hint: *«No la compartimos con nadie.
  Sirve para enseñarte solo los trabajos que te pillan cerca.»*
- **Dónde**: `AddressEditScreen`.
- **Ojo**: es la dirección DECLARADA, nunca el GPS del teléfono.

### Paso 2 · Tus servicios

- **Qué pide**: qué sabe hacer, del catálogo cerrado.
- **Qué enciende**: la bolsa pasa de «12 trabajos cerca» a **«4 trabajos que tú
  puedes hacer»**. El número baja, y eso es bueno: ahora son suyos.
- **Copy**: *«¿Qué sabes hacer?»* · hint: *«Elige todo lo que hagas. Puedes
  añadir más cuando quieras.»*
- **Dónde**: `ProviderOnboardingScreen` → `ServiceCatalogScreen`.

### Paso 3 · Tu precio por servicio

- **Qué pide**: la tarifa de cada servicio elegido, dentro de la horquilla.
- **Por qué separado del 2**: son dos decisiones distintas —qué hago / cuánto
  cobro— y juntarlas es lo que hace que la gente abandone. Además el estado
  parcial es normal y hay que contarlo: *«3 de 5 servicios sin precio»*.
- **Qué enciende**: el botón **«Enviar oferta»** deja de estar apagado.
- **Copy**: *«¿Cuánto cobras?»* · hint: *«Tú pones el precio. El cliente ve tu
  oferta junto a las demás y elige.»*
- **Dónde**: `MyPricesScreen`.

### Paso 4 · Tu cuenta bancaria

- **Qué pide**: el alta de cobros (identidad → impuestos → banco → identidad
  documental → condiciones). Ya existe entera en `payouts/`.
- **Por qué aquí y no antes**: pedir SIN y cuenta bancaria a alguien que todavía
  no ha visto un solo trabajo es la forma más rápida de perderlo. A estas alturas
  ya ha visto trabajos suyos y ya ha puesto precio.
- **Qué enciende**: **puede cobrar**. Y hasta que no esté, no debería poder
  enviar ofertas — si no, el cliente le elige y se come un error al pagar.
- **Copy**: *«¿Dónde te pagamos?»* · hint: *«El dinero entra aquí 1-2 días
  después de cada trabajo. Tarda unos 2 minutos.»*
- **Dónde**: `PayoutsOnboardingScreen` (5 sub-pasos con su propio progreso).
- **Sub-progreso**: la fila del checklist enseña *«Cobros · 3 de 5»* y entra por
  donde lo dejó, no por el principio.

### Paso 5 · Tu perfil: bio y 3 fotos de tu trabajo

- **Qué pide**: lo que el cliente lee antes de elegirle.
- **Por qué el último**: no bloquea nada. Es el que sube la conversión, no el que
  abre la puerta.
- **Qué enciende**: al enviarlo, pasa a **revisión** y de ahí a **verificado
  (L1)**.
- **Copy**: *«Que te elijan a ti»* · hint: *«El cliente compara varias ofertas.
  Con foto de tu trabajo te eligen más.»*
- **Dónde**: `ProviderProfile` + `CredentialsScreen`.

### El final

Al completar los 5, **la tarjeta no se queda en verde: desaparece**. Una sola vez
sale una confirmación —*«Listo. Ya puedes recibir y ganar trabajos.»*— con el
botón que lleva a la bolsa, y no se vuelve a ver nunca.

---

## 3. CLIENTE — los 2 pasos

El cliente **no ve el checklist al abrir la app**. Quien entra a mirar y lo
primero que recibe es «añade tu tarjeta» está pagando un peaje antes de que le
hayan vendido nada. El checklist aparece **cuando publica su primer trabajo**.

### Paso 1 · Tu dirección

- **Cuándo**: en la propia reserva, que ya la pide. El checklist solo la marca.
- **Por qué importa**: sin coordenadas dentro de una zona activa, el trabajo se
  rechaza con un 400.
- **Copy**: *«¿Dónde es el trabajo?»*

### Paso 2 · Tu tarjeta

- **Cuándo**: al publicar el trabajo, no al aceptar la oferta. Si se deja para el
  final, el cliente ya eligió proveedor y se topa con un formulario de pago
  cuando lo que quería era confirmar.
- **Qué enciende**: puede aceptar ofertas en cuanto lleguen, de un toque.
- **Copy**: *«Añade tu tarjeta»* · hint: *«No se cobra nada ahora. Solo cuando
  aceptes una oferta, y solo se retiene hasta que el trabajo termine.»* — esta
  frase es la que quita el miedo: explica la retención antes de que la vea en su
  banco.

Opcionales, debajo de la línea: teléfono y foto.

---

## 4. Cómo se ve

### Plegado (estado normal)

Una barra bajo el nombre, en la tarjeta de bienvenida que ya existe:

```
  ┌──────────────────────────────────────────────┐
  │  ●●●○○   Configura tu cuenta · 2 de 5    ›   │
  │  Siguiente: tu precio por servicio           │
  └──────────────────────────────────────────────┘
```

Puntos, no porcentaje: un 40 % no dice cuál es el que falta.

### Desplegado

```
  ✓  Tu dirección base                    Toronto · 25 km
  ✓  Tus servicios                        4 servicios
  ▸  TU PRECIO POR SERVICIO                      [Poner precios]
     3 de 5 servicios sin precio. Sin precio no puedes ofertar.
  ○  Tu cuenta bancaria
  ○  Tu perfil: bio y fotos
  ─────────────────────────────────────────────────
  ⏱  Verificación de documentos       En revisión
     Lo estamos mirando. Normalmente menos de 24 h.
```

### Los cinco estados de una fila

| Estado | Se ve | ¿Se puede tocar? |
|--------|-------|------------------|
| `done` | ✓ gris + el dato conseguido | no |
| `next` | destacado, con botón | **sí** |
| `pending` | ○ apagado | no |
| `in_review` | ⏱ + «menos de 24 h» | **no** — si se puede, vuelve a subir el documento y nos inunda el admin |
| `blocked` | ✕ rojo + el motivo del rechazo | sí, a rehacerlo |

`in_review` es el estado que más ahorra: una casilla sin marcar mientras VISP
revisa parece culpa del proveedor, y es la pregunta número uno de soporte.

---

## 5. La guía no vive solo en el Home

Un checklist en el Home no sirve de nada si el proveedor entra a la bolsa y lee
**«No hay trabajos disponibles»**. Ese mensaje es mentira y es el momento exacto
en que abandona. Cada pantalla vacía tiene que decir cuál de los 5 pasos falta:

| Pantalla | Hoy dice | Tiene que decir |
|----------|----------|-----------------|
| Bolsa de ofertas, sin dirección | «No hay trabajos disponibles» | «Todavía no sabemos dónde trabajas» + [Poner mi dirección] |
| Bolsa, sin servicios | «No hay trabajos disponibles» | «Elige qué sabes hacer y te enseñamos los trabajos» + [Elegir servicios] |
| Bolsa, con todo hecho | «No hay trabajos disponibles» | «Nada por ahora. Te avisamos en cuanto entre uno.» (este sí es verdad) |
| Un trabajo sin tarifa | «Pon tu precio» | ya está bien |
| Un trabajo sin banco | (nada, deja ofertar) | botón apagado: «Configura tus cobros para poder ofertar» |
| Ganancias, sin banco | €0 | «Sin cuenta bancaria no podemos pagarte» + [Configurar] |

Misma frase, mismo botón, mismo destino que la fila del checklist. Un solo texto
por paso, reutilizado en los dos sitios.

---

## 6. Dos cosas que hoy mienten y hay que arreglar con esto

1. En cuanto `level > 0`, el checklist del proveedor **desaparece entero** y lo
   sustituye un banner verde: *«Verified — You can offer on jobs»*. Para un L1
   sin cuenta bancaria eso no es incompleto: es lo contrario de lo que va a
   pasar.
2. `stripeConnectStatus` se calcula como `"active" if stripe_account_id else
   "not_connected"` (`providers.py:273`). Quien abandonó el alta de cobros a
   mitad **lee «active»**. La fila del checklist tiene que leer las capabilities
   reales, no la existencia de la cuenta.

Y el orden de las puertas, que es lo que hace falta decidir: hoy **la cuenta
bancaria no se exige para ofertar, solo en el momento en que el cliente ya
aceptó**. El proveedor sin banco compite, gana, y el cliente —que ya comparó, ya
eligió y ya puso su tarjeta— recibe un error que le manda a elegir a otro. Con el
paso 4 del checklist y el botón apagado, eso se acaba.

---

## 7. Lo que hace falta por detrás (resumen)

- **Un endpoint `GET /users/me/readiness`** que devuelva los pasos con su estado,
  calculado con **los mismos predicados que bloquean** (`provider_can_bid`,
  `account_can_accept_charges`), nunca reimplementados. Ninguna columna
  `profile_complete`: es un valor derivado y se desincroniza.
- **Un componente `SetupChecklist`** compartido por los dos roles, plegado por
  defecto, que no se pinta cuando no falta nada.
- **Un solo diccionario de textos por paso**, consumido por el checklist y por
  los estados vacíos de §5.

---

# IMPLEMENTADO — 2026-09-22

## Lo que se construyó

**Backend**
- `src/services/readiness_service.py` — los pasos, calculados con los mismos
  predicados que bloquean. Devuelve HECHOS (clave, estado, conteos); los textos
  viven en la app para que sigan traducidos.
- `GET /users/me/readiness?role=provider|customer` en `users.py`. `role` explícito
  porque una cuenta `both` son dos relaciones distintas; 403 si pide la que no
  es suya.
- `scripts/smoke_readiness.py` — **61 comprobaciones, PASS**. La que importa es
  la L: el checklist y `provider_can_bid` cambian **a la vez**, con control
  (quito las coordenadas → la puerta cierra Y el paso vuelve a pendiente).

**App**
- `services/readinessService.ts`, `components/visp/SetupChecklist.tsx`,
  `components/visp/SetupEmptyState.tsx`.
- Textos `setup.*` en EN y FR. 47 claves verificadas una a una: las dinámicas
  (`setup.step.${key}`) no las ve `audit_layout`, y son justo las que llegaron
  al dispositivo como `[missing ... translation]` el 21-08.
- Panel del proveedor: el checklist sustituye a la tarjeta «Complete Your
  Profile» Y a la lista de pasos L0. Se borró el estado `hasServices` y su
  llamada: ese dato ahora llega del backend, y tenerlo dos veces es la receta
  de que digan cosas distintas.
- Home del cliente: solo después de publicar su primer trabajo.
- Bolsa de ofertas: el vacío dice cuál de los tres pasos falta y lleva allí.
- Ganancias: **no se tocó**. Ya tenía su CTA de cobros con 4 estados leídos en
  vivo, mejor que lo que iba a añadir.

## Tres bugs que solo aparecieron al probar con datos reales

**1. `_extract_capabilities` devolvía `{}` SIEMPRE.** El SDK de Stripe entrega
un objeto tipado `Capabilities` que no es dict y no tiene `.keys()`, así que la
rama buena era el `except`. En visp_prod: las 7 cuentas con
`stripe_capabilities = {}` mientras Stripe decía `card_payments=active` en 6 de
ellas. Arreglado con `to_dict()`.

Lo que ese bug apagaba:
- `matchingEngine._payments_capability_blocks` veía "desconocido" y **no
  bloqueaba nunca**. O sea que la puerta de «sin cobros no se te ofrecen
  trabajos» llevaba existiendo en el código y sin funcionar.
- `EarningsScreen.transfersCapability` era siempre `'unknown'`.
- Y mi paso de cobros habría dicho que NADIE puede cobrar.

*Radio de impacto al arreglarlo, medido:* de 45 proveedores no suspendidos, 7
tienen cuenta de Stripe y **0 quedan bloqueados hoy**. La columna se refresca
cuando el proveedor abre su Home; el único con capabilities inactivas es una
cuenta de prueba.

**2. `home_city` no lo escribía nadie.** Al guardar la dirección solo se
copiaban `home_latitude/longitude` al perfil del proveedor. Ahora se copian
también calle, ciudad, provincia y código postal, y el checklist se cae a la
ciudad del usuario para que las filas viejas lean bien sin backfill.

**3. `smoke_offers_v2` llevaba roto desde el 8 de septiembre.** No era un bug de
producto: escogía dos proveedores reales por `id` y ninguno había firmado el
contrato, así que la bolsa los rechazaba con `no_contract` y el smoke moría en
B1 con «el trabajo no aparece». Verificado con control (falla igual en HEAD sin
mis cambios). Ahora siembra la firma como precondición y la borra al limpiar:
**97/97 PASS**.

## Lo que NO se hizo, y por qué

**No se apagó el botón de ofertar sin cuenta bancaria.** Era el §B del plan y
sigue siendo lo correcto, pero la medición manda: al arreglar el bug 1 la puerta
que ya existe en `_evaluate_candidate` se enciende sola y hace ese trabajo, sin
regla nueva. Añadir además un candado en el botón antes de ver cómo se comporta
esa puerta con datos reales sería apilar dos gates sobre el mismo hecho.

## Al desplegar

**El backend va PRIMERO.** La app quita la tarjeta «Complete Your Profile» y la
lista de pasos, y pone el checklist en su lugar. Si el backend viejo no responde
`/users/me/readiness`, el checklist no se pinta —falla cerrado a propósito— y un
proveedor nuevo se quedaría sin ninguna guía. Con el backend desplegado antes,
no hay ventana.

## Estado de los smokes

| | |
|---|---|
| `smoke_readiness` | 61/61 PASS |
| `smoke_offers_v2` | 97/97 PASS (recuperado) |
| `smoke_contract_signature` | 54/54 PASS |
| `smoke_job_payment` | PASS |
| `smoke_money_loop` | 15/15 PASS |
| `tsc --noEmit` | limpio |
| `audit_layout` | 3 LOW previos, ninguno mío |

---

# RONDA 2 — 2026-09-24 · lo que encontró Ricardo probando

## 1. El cliente no veía el checklist hasta publicar un trabajo

Era deliberado (§3 arriba: «no un peaje antes de la venta») y **estaba mal**. Con
la tarjeta ahora obligatoria para reservar, esconder la lista hasta que hay un
trabajo significa que el cliente **se entera de que le falta la tarjeta al final
del embudo**. Enterarse al reservar es peor que enterarse al entrar. Ahora se
enseña desde el arranque.

## 2. Se podía reservar sin tarjeta — y el agujero no acababa ahí

El encadenado completo, que es lo que lo hacía grave: sin tarjeta al reservar →
al aceptar la oferta `OffersScreen` intenta retener, no encuentra tarjeta,
**avisa con un Alert y sigue adelante** → el trabajo queda **AGENDADO sin
autorización** → el proveedor va a trabajar → el cobro falla al cerrar. Tres
pantallas más tarde y con el trabajo hecho.

Tapado por delante, donde el cliente aún no le ha prometido nada a nadie:

- `POST /jobs/book` → **400 `payment_method_required`**. Mismo sitio y mismo
  código de estado que la puerta de zona; 400 y no 5xx porque Cloudflare envuelve
  los 5xx y el cliente no leería el motivo. El `code` existe para que la app sepa
  llevarle a la tarjeta en vez de enseñar un error genérico.
- **Un solo predicado**: `readiness_service.customer_has_payment_method`, usado
  por la reserva Y por el paso del checklist. El smoke lo comprueba con control:
  si divergieran, el checklist diría «tarjeta lista» mientras la reserva rechaza.
- App: comprobación **antes** de pulsar Confirmar, con botón que lleva a la
  pantalla de tarjetas, y el 400 manejado como respaldo. El cliente de Stripe se
  crea ahora **antes** de reservar — crearlo después no servía para nada.
- Falla **abierto** si Stripe no contesta: perder un trabajo por una caída de red
  es peor que cobrar más tarde, y la retención al aceptar sigue comprobándolo.

### La puerta tumbó cuatro smokes, y eso es la prueba de que es real
`smoke_offers_v2`, `smoke_booking_details`, `smoke_service_questions`,
`smoke_per_contract`, `smoke_full_journey_custom`, `smoke_provider_quantity`
reservan por `/jobs/book`. Ahora siembran la tarjeta como precondición con
`scripts/_smoke_card.py`, que **guarda y repone el `stripe_customer_id` previo**:
pisarle el suyo a un usuario real de visp_prod le borraría de la app las tarjetas
que tiene guardadas.

## 3. El checklist salía más ancho que el resto (solo en proveedor)

Todas las tarjetas del panel llevan `marginHorizontal: 16` y el checklist no. En
el Home del cliente se veía bien porque allí va dentro de su `sectionGutter`. El
margen lo pone **la pantalla**, no el componente: cada Home lo coloca a su manera.

## Un smoke que rompí, y por qué importa el mecanismo

`smoke_booking_details` iba 20/20 y pasó a 11/13 **por mi culpa, indirectamente**.
Escogía el servicio con `LIMIT 1` **sin `ORDER BY`**; como el propio smoke
ACTUALIZA los flags del servicio, Postgres reescribe la fila, cambia el orden
físico del heap y el `LIMIT 1` empieza a devolver otro servicio. Cayó en «Window
Cleaning», que tiene 3 preguntas obligatorias, y falló con «needs an answer
to...» sin que nadie tocara esa lógica.

Arreglado eligiendo **determinista y sin preguntas obligatorias** (solo 4 de los
LEVEL_0 activos cumplen). **20/20, estable.**

*Lección:* un `LIMIT 1` sin `ORDER BY` sobre una tabla que el propio test modifica
es una bomba de relojería — no falla al escribirlo, falla semanas después y parece
un bug de producto.

## Smokes que YA estaban rojos antes de hoy (verificado con control en HEAD)

| | |
|---|---|
| `smoke_service_questions` | 15/16 — «hubo matching para inspeccionar la oferta» |
| `smoke_per_contract` | crash: `RuntimeError: coroutine raised StopIteration` |
| `smoke_full_journey_custom` | SMOKE FAIL |
| `smoke_provider_quantity` | SMOKE FAIL |

Error idéntico con y sin mis cambios. Sin arreglar, pendientes de decisión.

## Estado tras la ronda 2

| | |
|---|---|
| `smoke_readiness` | **65/65** (incluye la puerta de la tarjeta + control de coherencia) |
| `smoke_offers_v2` | 97/97 |
| `smoke_booking_details` | 20/20 (recuperado) |
| `smoke_contract_signature` | 54/54 |
| `smoke_money_loop` | 15/15 |
| `tsc --noEmit` | limpio · 108 usos de clave i18n verificados en EN y FR |


---

# EL CRITERIO, fijado por Ricardo el 2026-09-24

> «El checklist es para que los usuarios nuevos tengan todo listo para usar la
> app.»

Esa frase decide qué entra y qué no, y evita que la lista se convierta en un
cajón de sastre:

**ENTRA** lo que impide operar. Contrato, dirección y radio, servicios, precio
por servicio, cuenta de cobros. Si falta, el usuario no puede trabajar o no
puede cobrar.

**NO ENTRA** la progresión de nivel. El expediente de experiencia (CV, fotos de
trabajos, cartas) es lo que sube a un proveedor de L0 a L1 — y queda FUERA a
propósito, aunque sea importante, porque un L0 puede usar la app perfectamente.
Vive en `VerificationScreen` y ahí se queda.

**Excepción, y solo una:** la bio entra como paso **no bloqueante**. No impide
operar, pero es lo que el cliente lee al comparar ofertas.

## El fallo que obligó a fijar el criterio

El paso decía «Your bio and work photos» y pedía **3 fotos**. Las tres capas
estaban mal:

1. **El número 3 no existe en ninguna regla del backend.** Lo copié del panel
   viejo del proveedor sin comprobar si seguía vivo.
2. **Contaba la tabla equivocada**: `provider_credentials` de tipo `PORTFOLIO`,
   el modelo ANTERIOR. La evidencia se movió al expediente único
   `provider_experience_records` el 2026-08-11. Resultado: contaba 0 siempre, y
   el paso era **imposible de completar**.
3. **Llevaba a `Credentials`**, que es donde están las licencias. El expediente
   ni siquiera vive ahí, sino en `Verification`.

Es el mismo fallo que el «Tier 1-4» de los Terms: **una regla muerta que sigue
escrita**. La diferencia es que aquí la copié yo, hoy, de un fichero que no
cuestioné. Antes de reutilizar una regla del código existente hay que
preguntarse si sigue siendo verdad — el repositorio tiene reglas muertas.

También explica el 0 de la medición inicial («bio + 3 fotos: 0/45»): no era que
nadie hubiera subido nada, era que estaba mirando la tabla que ya no se usa.
