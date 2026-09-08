# Plan — Contratos firmados en la app (proveedor y cliente)

Fecha: 2026-09-08 · Rama: `Test-version` · Estado: **plan, sin código**

Fuentes: `docs/VISP_Service_Provider.pdf` (v1.3, 3-sep-2026) y
`docs/VISP_Customer_Platform_and_Service_Booking.pdf` (v1.2, 4-sep-2026).

---

## 0. Lo ya hecho en este plan: la conversión a markdown

| Salida | Origen | Contenido |
|---|---|---|
| `content/legal/provider_ic_agreement_v1.3.md` | PDF proveedor, 11 págs | 25 secciones + Acceptance, 8 cajas de aviso, tabla de comisiones (L0–L3), **matriz de suministros de 30 filas** |
| `content/legal/customer_service_agreement_v1.2.md` | PDF cliente, 7 págs | 28 secciones + Acceptance, 10 cajas de aviso |

Ambos llevan front-matter YAML (`consent_type`, `version`, `effective_date`,
`jurisdiction`, `source`) para que el backend lea la versión del propio archivo
y no de una constante suelta.

**Verificación de fidelidad**: se comparó palabra por palabra el texto del PDF
contra el markdown. Lo único ausente son los encabezados/pies repetidos de
página y los encabezados repetidos de la tabla. **Cero texto legal perdido.**

Un detalle que costó y conviene no repetir: `pdftotext -layout` **fusiona las
columnas 2 y 3** en las filas cuya celda central es ancha (p. ej. *Carpet Steam
Cleaning* salía como «…normal cleaning **and ele**» / «**ctricity** and must
disclose…»). La matriz se reconstruyó desde las coordenadas de cada palabra
(`pdftotext -bbox-layout`), no desde el texto plano. El script queda en
`scratchpad/matrix_bbox.py` por si hay que repetirlo al subir de versión.

---

## 1. El hallazgo que cambia el plan: son DOS piezas distintas, no dos copias

Los dos documentos se parecen, pero no juegan el mismo papel:

- **Contrato del proveedor** — se firma **una vez por persona**. Define la
  relación (contratista independiente, comisión, prohibiciones). No cambia de
  un trabajo a otro.
- **Acuerdo del cliente** — también se acepta **una vez por cuenta**, pero su
  cláusula 1 dice que se acepta *también* «al confirmar una reserva». Ahí está
  la pregunta que hiciste.

Lo que **sí** cambia en cada servicio no es el acuerdo: es el **alcance
aprobado** (servicio del catálogo, precio, duración, dirección, detalles y
evidencias). Por eso la recomendación de §5.

---

## 2. Dónde va la firma dentro del documento

No hay que inventarlo: **el redactor ya dejó el hueco**. La última página de
cada contrato tiene esta tabla vacía:

| Campo del PDF | De dónde sale el dato |
|---|---|
| Service Provider / Customer Legal Name | **tecleado por el usuario al firmar** (debe coincidir con su ID) |
| Business Name (if applicable) | empresa B2B si la hay; vacío si es individual |
| VISP Account Email | `users.email` |
| Acceptance Date | hora del **servidor**, no del dispositivo (America/Toronto) |
| Electronic Acceptance Record / Account ID | `legal_consents.id` + `user_id` + hash del texto |

**La firma dibujada va inmediatamente debajo de esa tabla**, en una página de
firma añadida al final, con: trazo, nombre legal tecleado, fecha/hora, y un
bloque de auditoría (IP, user-agent, device_id, versión y hash del contrato).

Nota jurídica que importa para el diseño: el propio contrato dice *«By clicking
"I Agree"… the Service Provider confirms»* — es un **clickwrap**, y bajo la
*Electronic Commerce Act, 2000* de Ontario eso ya basta. El dibujo **no es
obligatorio legalmente**; lo que pesa es la intención, la atribución y la
fiabilidad del registro. Añadirlo no estorba y suma, pero por eso mi
recomendación es **los tres a la vez**: checkbox + nombre tecleado + trazo. El
trazo solo, sin nombre ni checkbox, sería *más débil* que el clickwrap que ya
contempla el documento.

---

## 3. Librería de firma: ninguna nueva

Ya están instaladas en `vispapp`:

- `react-native-svg` **15.15.3**
- `react-native-webview` ^13.16.1

| Opción | Dependencia | Veredicto |
|---|---|---|
| **A. `<Svg><Path>` + `PanResponder`** (~120 líneas) | **ninguna** | **Recomendada** |
| B. `react-native-signature-canvas` | JS puro sobre WebView | alternativa válida |
| C. `@shopify/react-native-skia` | módulo nativo → `pod install` | descartada |

Manda la restricción de Expo 55 con prebuild: **cada módulo nativo nuevo es
riesgo en cada prebuild** (ver `feedback_build_process`). La opción A no añade
ninguno, controla el tema claro/oscuro sin inyectar CSS, y produce **dato
vectorial** — se guarda el `path` tal cual y el servidor lo rasteriza. B mete
un WebView dentro de un ScrollView (fricción de gestos conocida) y se estiliza
inyectando CSS, lo que complica el modo claro/oscuro.

Componente: `vispapp/src/components/visp/SignaturePad.tsx`
→ `onChange(paths: string[], svg: string)`, botones *Clear* / *Done*, alto fijo,
línea base y leyenda «Sign above», bloqueo del scroll del contenedor mientras el
dedo está abajo.

---

## 4. El artefacto firmado: qué se genera y qué se guarda

**Orden obligatorio** — `legal_consents` es append-only y **no tiene
`updated_at`** (así está diseñada, y de ahí viene su valor probatorio):

```
1. usuario firma en la app
2. POST /api/v1/consents/sign   (user_id SALE DEL TOKEN, nunca del body)
3. servidor: renderiza el PDF  =  markdown del contrato
                                + tabla de aceptación rellenada
                                + página de firma (trazo + nombre + auditoría)
4. servidor: sha256(PDF)
5. servidor: INSERT en legal_consents con las rutas y los dos hashes
6. respuesta: { consent_id, document_url }
```

Insertar primero y actualizar después con la ruta rompería la inmutabilidad.

**Migración 052** — columnas *nullable* sobre `legal_consents` (no una tabla
paralela: la fila ya es el registro de auditoría y ya guarda el texto completo
y su hash):

| Columna | Para qué |
|---|---|
| `signed_full_name` | nombre legal tecleado |
| `signature_svg` | el trazo vectorial |
| `signature_image_path` | PNG rasterizado (para el PDF y el admin) |
| `document_path` | el PDF firmado |
| `document_hash` | SHA-256 del PDF |
| `business_name` | «Business Name (if applicable)» |

**PDF**: `fpdf2` — Python puro, sin dependencias de sistema, **no toca el
Dockerfile**. `reportlab` es más potente pero más aparatoso; WeasyPrint queda
descartada porque exige pango/cairo en la imagen.

Un detalle real de `fpdf2`: sus fuentes básicas son latin-1 y **el contrato
tiene em-dash (—) y comillas tipográficas**, que no están en latin-1. Hay que
embarcar una TTF Unicode (`DejaVuSans`, licencia Bitstream Vera, ~700 KB) en
`backend/assets/fonts/`. La alternativa —normalizar la tipografía a ASCII— toca
el texto de un documento legal; no se hace.

---

## 5. Tu pregunta: ¿un documento por cada servicio?

**Mi opinión: no regenerar las 7 páginas del acuerdo en cada reserva.** Dos
artefactos distintos, y cada uno resuelve un problema distinto:

**(a) Acuerdo del Cliente v1.2 — una vez por cuenta.** Firmado como el del
proveedor. Es el mismo texto para todas las reservas de esa persona.

**(b) Registro de Reserva — uno por trabajo.** 1-2 páginas con lo que de verdad
cambia: partes, servicio del catálogo, alcance aprobado, precio o tarifa,
duración, dirección, sellos de tiempo, detalles y evidencias del cliente, y la
línea que lo cose todo:

> *This booking is governed by the VISP Customer Platform and Service Booking
> Agreement v1.2, accepted by the Customer on 2026-09-08 (record `<uuid>`,
> hash `<sha256>`), and by the VISP Independent Service Provider Platform
> Agreement v1.3, accepted by the Provider on … (record `<uuid>`).*

Eso es **incorporación por referencia**, y es la práctica normal. Tres razones
concretas por las que es mejor que reimprimir el acuerdo entero:

1. **No aporta nada legalmente.** El acuerdo ya está aceptado y sellado con
   hash. Repetirlo 1.000 veces no lo hace más vinculante; solo hace 1.000
   copias del mismo texto.
2. **Coste real.** Un PDF de 7 páginas pesa 150–300 KB. A 1.000 trabajos/mes
   son ~300 MB/mes en el disco del servidor (`uploads/` es un bind-mount, ver
   `docker-compose.yml:37`). El registro de reserva pesa ~30 KB.
3. **Versionado.** Cuando salga la v1.3 del acuerdo del cliente, ¿regeneras los
   PDF de los trabajos viejos? Con referencia + hash, cada trabajo apunta para
   siempre a la versión que su cliente aceptó de verdad. Y encaja con la regla
   #4 del proyecto: *los términos se copian al trabajo en el momento de crearlo
   y son inmutables*. El registro de reserva **es** ese snapshot, hecho
   presentable.

**Cómo lo generaría, en concreto:** al confirmar la reserva se congela y se
hashea un **snapshot JSON canónico** (eso es la prueba, y es barato); el PDF se
**renderiza a demanda** desde ese snapshot cuando alguien lo pide — cliente,
proveedor, admin o un juzgado. El PDF es una *vista* del registro; el registro
es la fila. Si prefieres el PDF creado y guardado en el acto, es un cambio de
una línea, pero paga el coste de arriba.

---

## 6. Cuatro agujeros que hay que cerrar sí o sí en este trabajo

Ninguno se buscaba; salieron al investigar. Los tres primeros ya los reporté el
6-sep, el cuarto es nuevo.

1. **El checkbox de términos del registro es decorativo.** `authService.ts:107`
   manda `termsVersion` y `privacyVersion`; `RegisterRequest`
   (`schemas/auth.py:33`) no los declara y **Pydantic los descarta en
   silencio**. Hoy **no existe ni una fila** en `legal_consents`: nadie ha
   dejado rastro auditable de haber aceptado nada. Es la regla no-negociable #3
   del CLAUDE.md incumplida, y el patrón de `feedback_silent_failures`: nada
   falla, el dato se evapora.
2. **`POST /consents/record` no tiene autenticación** y el `user_id` **viene en
   el body** (`consents.py:48`). Cualquiera puede fabricar un consentimiento a
   nombre de cualquiera. Para un contrato firmado eso es fatal: el valor de la
   fila es probatorio, y una fila que cualquiera puede escribir no prueba nada.
   El `user_id` tiene que salir del token.
3. **`/uploads` se sirve sin autenticación** (`main.py:202`, `StaticFiles`). Un
   UUID es inadivinable, no privado. Un PDF con nombre legal completo y firma
   manuscrita en una URL pública es exposición real. Los contratos firmados
   necesitan un endpoint de descarga autenticado, no el mount estático.
4. **Hay tres textos legales distintos compitiendo, y dos están obsoletos.**
   `vispapp/src/screens/profile/TermsScreen.tsx` y
   `admin/src/pages/public/legalContent.ts` traen el texto **hardcodeado en
   TypeScript**, y describen un sistema de **«Tier 1–4»** que ya no existe —
   contradicen tanto los contratos nuevos como el modelo L0–L3. Al usuario que
   firme se le tiene que mostrar **exactamente** el texto que se hashea, y el
   texto tiene que venir del servidor. Si no, se firma una cosa y se archiva
   otra.

---

## 7. Fases

Empezamos por la firma, como pediste.

**Estado a 2026-09-08: F1 y F2 (parte de puerta) HECHAS y probadas** —
`smoke_contract_signature.py` **44/44**. Falta: admin (F4), Registro de Reserva
(F5) y servir `TermsScreen` desde el backend.

**F1 — Firma del proveedor (el núcleo)**
- `SignaturePad.tsx` (SVG + PanResponder).
- `ContractSignScreen.tsx`: contrato scrolleable desde el servidor → checkbox
  «he leído y acepto» (se habilita al llegar al final) → nombre legal → firma →
  Enviar.
- Backend: `GET /consents/document/{type}` (texto + versión + hash),
  `POST /consents/sign` **autenticado**, `GET /consents/{id}/document` (PDF,
  autenticado).
- `legalPdfService.py` (fpdf2 + DejaVu), migración 052.
- `load_consent_text` acepta `.md` y cae a `.txt`; `CONSENT_VERSIONS` sube a
  `provider_ic_agreement: 1.3`.
- Puerta: sin contrato vigente firmado, no se puede ofertar. Se implementa
  como un motivo nuevo en `provider_can_bid` — que es **el único predicado de
  elegibilidad**, así que cubre bolsa, oferta y broadcast de una vez
  (`feedback_live_eligibility_not_frozen`). El trabajo se ve **en gris con su
  motivo**, no se oculta.

**F2 — Registro del consentimiento en el alta** (cierra el agujero #1) y
`TermsScreen` servido desde el backend (cierra el #4).

**F3 — Firma del cliente**, mismo componente y mismo servicio, con
`customer_service_agreement` v1.2.

**F4 — Admin.** Pestaña «Contratos» en
`admin/src/pages/admin/Documents.tsx`, que ya tiene 4 pestañas y ya previsualiza
PDF e imagen con `resolveDocUrl()` / `inferMimeKind()`. Es incremental, no una
pantalla nueva. Falta el endpoint admin: hoy **no existe ninguna vista de
consentimientos** en el backend.

**F5 — Registro de Reserva por trabajo** (§5b).

---

## 8. Decisiones tomadas (Ricardo, 2026-09-08)

**1 · Se firma en el registro.** No en el onboarding. El `user_id` sí existe si
se encadena: `POST /auth/register` devuelve usuario y token → **acto seguido**,
sin pasar por Home, la pantalla de contrato. Es «al registrarse» de verdad.

Qué firma cada rol:

| Rol elegido | Documento con **trazo** | Documento por **checkbox** (fila de consentimiento igual) |
|---|---|---|
| `customer` | — | Customer Agreement v1.2 |
| `provider` | Provider IC Agreement v1.3 | — |
| `both` | Provider IC Agreement v1.3 | Customer Agreement v1.2 |

`both` firma el de proveedor porque **es** proveedor, y acepta además el del
cliente porque también reserva: son dos relaciones distintas con VISP y cada
una necesita su fila. Una sola pantalla, dos filas en `legal_consents`.

Y la puerta se mantiene: **sin contrato firmado, un proveedor no publica
precios ni oferta.** Motivo nuevo en `provider_can_bid`.

**2 · Solo el trazo; el nombre se toma del registro.** De acuerdo, con un
matiz que no cuesta nada: el campo del PDF dice *Legal Name* y debe coincidir
con la identificación oficial. Así que va **precargado** con
`first_name + last_name` y editable, con la línea «must match your
government-issued ID». Si está bien, el usuario no toca nada — cero fricción —
pero si se registró como «Richie» y su ID dice «Ricardo», puede corregirlo. Un
nombre tomado a escondidas es más débil que uno que el firmante vio y confirmó.

**3 · Solo inglés por ahora.** El francés está en revisión legal. El código
queda preparado (`_fr` en el nombre de archivo); mientras no exista, la
pantalla de contrato muestra el inglés **aunque la app esté en francés**, con
un aviso de una línea. No se traduce a medias un contrato.

**4 · Contrato de adhesión. VISP no contrafirma.** El PDF no lleva bloque de
contrafirma; lleva «Accepted by the Service Provider» y el registro electrónico
de VISP.

**5 · Se firma una vez, sin re-firma — con un matiz que sí implemento.** De
acuerdo en no obligar a re-firmar. Pero la §24 del propio contrato dice que
VISP *«may require renewed acceptance»* ante un cambio material, y el PDF viene
con **«COUNSEL REVIEW REQUIRED»**: la v1.4 va a existir. Así que la fila guarda
siempre la versión firmada y el backend **sabe** quién firmó qué, con el bloqueo
por versión **apagado** (`REQUIRE_CURRENT_CONTRACT_VERSION = False`). Hoy no
molesta a nadie; el día que el abogado cambie el texto, es cambiar un booleano
en vez de una migración y un rescate de datos.

**6 · PDF por reserva, generado al confirmarse.** Tu instinto es el correcto y
además sale barato, porque lo que se genera es el **Registro de Reserva** de 1-2
páginas (~40 KB), no el acuerdo de 7. El disparador es exactamente el que
dijiste: **oferta aceptada + agendada**. Números: 1.000 trabajos/mes ≈ 40
MB/mes. No hace falta diferirlo, y generarlo en el acto significa que cliente y
proveedor lo abren al instante y que el hash cubre un archivo real.

Lo que **no** se genera: nada para trabajos que se publican y nunca se reservan
(`posted`, `expired`) — ahí no hay contrato que documentar. Y el snapshot JSON
se congela igual al confirmar, para poder **re-renderizar** el PDF si se borra o
se corrompe. El PDF es la vista; el snapshot es el registro.

---

## 9. Aviso que no es técnico

El PDF del proveedor lleva impreso en cada página: **«FINAL LEGAL DRAFT —
COUNSEL REVIEW REQUIRED … must be reviewed and approved by qualified Ontario
counsel before production use or acceptance by Service Providers.»**

El del cliente ya dice «FINAL», sin esa advertencia. Podemos construir todo el
mecanismo con la v1.3, pero **antes de recoger firmas reales en producción** el
texto del proveedor tiene que pasar por el abogado. Si el abogado lo cambia,
sube la versión y se re-firma — que es exactamente para lo que sirve el registro
de versiones.
