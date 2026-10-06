# Denunciar y bloquear — plan (guía 1.2 de Apple)

Escrito el 2026-10-06. Todavía no hay código.

## 1. Por qué

Apple respondió al envío 1.0.0 (build 34) con una petición "2.1 Information
Needed". El vídeo que piden tiene que enseñar *"any user-generated content,
including the required content reporting and blocking mechanisms"*. VISP tiene
contenido de usuarios y no tiene ninguno de los dos mecanismos. Si mandamos el
vídeo sin ellos, el siguiente mensaje será un rechazo por la 1.2.

La guía 1.2 pide cuatro cosas a una app con contenido de usuarios:

1. Un **filtro** de contenido ofensivo antes de publicarlo.
2. Una forma de **denunciar** contenido, y que el equipo responda a tiempo
   (Apple habla de 24 h).
3. Una forma de **bloquear** a usuarios abusivos.
4. **Datos de contacto** publicados. Ya los hay: support@droztechnologies.com.

Además, Apple espera que los Términos digan que no se tolera contenido
ofensivo ni usuarios abusivos ("zero tolerance").

## 2. Qué contenido de usuarios existe hoy

| Contenido | Lo escribe | Lo ve | Dónde se ve (app) |
|---|---|---|---|
| Mensajes de chat | ambos | el otro | `shared/ChatScreen.tsx` |
| Detalles del trabajo + fotos de evidencia | cliente | proveedor | `provider/JobOffersScreen.tsx:241-252`, `ActiveJobScreen.tsx` |
| Avatar, nombre y bio del proveedor | proveedor | cliente | `customer/OffersScreen.tsx:244-300` |
| Reseñas (`reviews.comment`) | cliente | **nadie** | no se muestran; solo se ven la media y el número de reseñas |

No hay perfiles públicos. La única vista "pública" del proveedor es su
tarjeta de oferta. Como el texto de las reseñas no se muestra en ningún sitio,
**las reseñas se quedan fuera** de este plan. Si algún día se muestran, tendrán
que llevar su propio botón de denunciar.

## 3. Qué hace bloquear (decisiones de Ricardo, 2026-10-06)

El bloqueo funciona **en las dos direcciones**: si A bloquea a B, ni A ni B
pueden contactar el uno con el otro.

**Regla principal: un bloqueo nunca deja un trabajo a medias.** Bloquear se
hace en uno de dos sitios, según el estado del trabajo:

| Estado del trabajo con esa persona | Dónde se bloquea | Qué pasa con el trabajo |
|---|---|---|
| Asignado (SCHEDULED → IN_PROGRESS) | **Botón de pánico** (`CancelWithReasonModal`), con la casilla nueva "Bloquear también a esta persona" | Se cancela por el flujo que ya existe: sin coste, con reporte en la cola del admin y cobro de las horas trabajadas si es PER_CONTRACT |
| Sin asignar (ofertas) o ya terminado | Directamente desde el menú "⋯" | No hay trabajo abierto que cancelar |

- En el **chat** de un trabajo asignado, la opción "Bloquear" **no bloquea
  directamente**: abre el botón de pánico con la casilla ya marcada. Así no
  puede quedar un trabajo vivo con el chat cerrado. Denunciar un mensaje sí
  funciona siempre, porque no corta nada.
- **Backend:** `cancel-with-reason` acepta `block: bool`. Si llega a `true`,
  en la **misma transacción** crea el `user_blocks` y enlaza el reporte de
  cancelación. O pasan las dos cosas o no pasa ninguna.

**Efectos del bloqueo:**

- **Chat:** ninguno de los dos puede enviar mensajes; el backend responde
  `403 user_blocked`. La comprobación va en **los dos caminos de envío**:
  `chatService.send_message` (REST) y `chatHandler.handle_send_message`
  (socket). El socket escribe `ChatMessage` directamente, así que con uno solo
  quedaría un agujero.
- **Emparejamiento:**
  - motivo nuevo `BID_BLOCKED` en `provider_can_bid` (`matchingEngine.py:436`),
    la única fuente de verdad;
  - exclusión también en `_evaluate_candidate` / `find_matching_providers`,
    porque **no** pasan por `provider_can_bid` y al bloqueado le seguirían
    llegando los avisos push;
  - `offerService.list_offers` oculta las ofertas previas del bloqueado y
    `accept` las rechaza.
- **Desbloquear: solo el admin.** En la app no hay lista de bloqueados. Quien
  quiera desbloquear escribe a soporte, y soporte lo quita desde el admin
  (§8).

## 4. Qué hace denunciar

**En la app**, un único componente `ReportSheet` reutilizable, con:

- motivo: Acoso o amenazas · Contenido ofensivo · Fotos inapropiadas ·
  Estafa o spam · Me siento en peligro · Otro;
- una nota opcional de 500 caracteres como máximo;
- la casilla "Bloquear también", que solo sale donde se puede bloquear
  directamente (ver §3);
- al enviar: "Gracias. Nuestro equipo revisa las denuncias en menos de 24 horas."

Si lo denunciado es un mensaje de chat, se oculta al momento para quien lo
denuncia.

**Dónde aparece:**

| Pantalla | Quién | Acceso | Qué hace |
|---|---|---|---|
| ChatScreen | ambos | "⋯" en la cabecera | Denunciar usuario · Bloquear (con trabajo asignado → abre el pánico) |
| ChatScreen | ambos | mantener pulsado un mensaje | Denunciar mensaje |
| JobOffersScreen | proveedor | "⋯" en la tarjeta del trabajo | Denunciar detalles o fotos · Bloquear al cliente |
| OffersScreen | cliente | "⋯" en la tarjeta del proveedor | Denunciar perfil · Bloquear al proveedor |
| ActiveJobScreen / JobTrackingScreen | ambos | botón de pánico que ya existe | + casilla "Bloquear también" |

`ChatScreen` hoy no sabe quién es la otra persona: sus parámetros son
`{ jobId, otherUserName }`. El servidor deduce a quién se denuncia o bloquea a
partir de `jobId`, y así la app no puede inventárselo.

## 5. Filtro automático

`chatService._check_safety` (línea 122) ya detecta palabras clave, pero solo
lo apunta en el log. El cambio: un mensaje detectado **crea una denuncia
automática** en la misma cola, con origen `AUTO_FILTER` y sin denunciante.
Así el filtro termina en algo que un humano revisa.

El mensaje no se bloquea al enviarlo, porque daría falsos positivos con
palabras como "fuego" o "gas", que son normales en servicios del hogar. Hay
que aplicar el filtro también en el camino del socket.

## 6. Datos — migración 055

```
content_reports
  id, reporter_id (NULL si AUTO_FILTER), reported_user_id, job_id NULL,
  source        AUTO_FILTER | USER
  content_type  USER | CHAT_MESSAGE | JOB_DETAILS | JOB_EVIDENCE | PROFILE
  content_id    NULL (id del mensaje si aplica)
  reason        HARASSMENT | OFFENSIVE | INAPPROPRIATE_PHOTO | SCAM | SAFETY | OTHER
  note          TEXT NULL
  snapshot      JSONB  -- copia del contenido en el momento de denunciar
  status        OPEN | ACTIONED | DISMISSED
  admin_action, admin_note, reviewed_by, reviewed_at, created_at, updated_at

user_blocks
  id, blocker_id, blocked_id, job_id NULL,
  source        PANIC | MENU | REPORT
  cancellation_report_id NULL  (si vino del botón de pánico)
  created_at, UNIQUE(blocker_id, blocked_id)

moderation_actions  -- registro de cada acción del admin (resolver, desbloquear)
  id, admin_id, action, report_id NULL, block_snapshot JSONB NULL, note, created_at

chat_messages  + removed_at TIMESTAMPTZ NULL  (lo oculta el admin)
```

El `snapshot` existe para que la prueba no desaparezca si el usuario borra el
contenido o su cuenta. El servicio de borrar cuenta (§ `account_deletion_service`)
tiene que tratar estas dos tablas: los bloqueos se borran y las denuncias se
conservan, anonimizando el nombre del denunciante.

**Regla anti-abuso:** solo se puede denunciar o bloquear a alguien con quien
**se comparte un trabajo o una oferta**. Así no se pueden mandar denuncias
masivas contra cualquier usuario.

## 7. Endpoints

**App:**
- `POST /api/v1/reports`: `{ jobId, contentType, contentId?, reason, note?, block }`
- `POST /api/v1/blocks`: `{ jobId }`. Responde **409 `job_active`** si hay un
  trabajo asignado con esa persona; en ese caso la app abre el botón de
  pánico.
- `POST /jobs/{id}/cancel-with-reason`: se añade `block: bool`.
- No hay `DELETE` de bloqueos en la app: desbloquear es solo del admin.

**Admin:**
- `GET /admin/reports?status=` y `GET /admin/reports/summary`, que devuelve el
  número de denuncias abiertas, las abiertas desde hace más de 24 h y los
  reportes del pánico pendientes.
- `POST /admin/reports/{id}/resolve` con
  `{ action: dismiss | remove_content | suspend | ban, note }`:
  - `remove_content` oculta el mensaje (`removed_at`) o vacía los detalles o
    las fotos del trabajo;
  - `suspend` y `ban` reutilizan `UserStatus`, que ya se comprueba en el
    login, al refrescar el token y en cada petición.
- `GET /admin/blocks?q=`: busca por nombre o email. Si el usuario buscado es
  quien bloquea **o** quien está bloqueado, sale el par.
- `DELETE /admin/blocks/{id}`: quita un bloqueo, con una nota obligatoria
  (por ejemplo, "lo pidió por soporte el 06-10").
- Toda acción del admin queda registrada: quién, cuándo y la nota.

## 8. Admin web — "Moderación"

Página nueva `admin/src/pages/admin/Moderation.tsx`, con entrada propia en la
barra lateral (`AdminLayout.tsx`). Tiene dos pestañas:

1. **Denuncias.** Copia el patrón de la cola de cancelaciones de
   `Documents.tsx` (`useQuery` y `useMutation`). Filtro por estado y, para
   cada denuncia, el contenido copiado, quién denuncia, a quién, el trabajo y
   las 4 acciones. Las denuncias abiertas desde hace más de 24 h salen
   **en rojo**.
2. **Bloqueos.** Buscador por nombre o email, igual que en Users. Tabla con
   quién bloqueó, a quién, la fecha, el origen (pánico, menú o admin) y un
   botón **Desbloquear**, que pide una nota.

**Monitoreo:**
- En el **Dashboard**, una tarjeta con las denuncias abiertas, las vencidas
  (más de 24 h) y los reportes de pánico pendientes.
- En la barra lateral, un **contador** junto a "Moderación".
- Las dos cosas leen `GET /admin/reports/summary`.

## 9. Términos v2.1

- Archivo nuevo `platform_tos_v2.1.md`. La v2.0 se queda intacta en disco,
  porque hay firmas contra su hash.
- `CONSENT_VERSIONS[PLATFORM_TOS] = "2.1"`.
- Dos cambios:
  1. **Cláusula nueva** de cero tolerancia: el contenido ofensivo y los
     usuarios abusivos no se toleran; se puede denunciar y bloquear; VISP
     revisa las denuncias en un máximo de 24 h y puede quitar el contenido y
     suspender o expulsar la cuenta. Se añade en §22 "User Content" y §23
     "Acceptable Use", que ya hablan de moderación y conducta.
  2. **Correos:** `support@vispapp.com` y `privacy@vispapp.com` pasan a
     `support@droztechnologies.com`, que es el que ya usan la app y la web.
- También hay que actualizar la copia web en
  `admin/src/pages/public/legalContent.ts`.
- **Nadie tiene que volver a aceptar.** Los Términos de la plataforma no son
  parte de la "puerta legal" de `/consents/pending` (solo lo son los dos
  contratos firmados), y `REQUIRE_CURRENT_CONTRACT_VERSION = False`. Quien se
  registre a partir de ahora acepta la v2.1, y quien ya estaba conserva su
  registro de la v2.0.
- Que lo revise el abogado más tarde: entonces será la v2.2.

## 10. Prueba

`scripts/smoke_report_block.py` en **visp_demo**. Comprueba que:

- denunciar crea la fila con su copia del contenido;
- denunciar a alguien sin trabajo en común devuelve 403;
- con un bloqueo, el chat devuelve 403 por REST **y** por socket;
- `provider_can_bid` devuelve `BID_BLOCKED` y `list_offers` no muestra al
  proveedor bloqueado;
- `find_matching_providers` no lo incluye;
- un mensaje con palabra clave crea una denuncia `AUTO_FILTER`;
- el admin puede banear y después el login devuelve 403;
- el admin puede ocultar un mensaje y ya no sale en el historial;
- `POST /blocks` con un trabajo asignado devuelve 409 `job_active`;
- `cancel-with-reason` con `block` cancela, crea el bloqueo y enlaza el
  reporte, y si algo falla no deja nada a medias;
- el admin desbloquea, la acción queda en `moderation_actions` y todo vuelve
  a la normalidad.

La migración se aplica en visp_demo y visp_prod, y se comprueba que no hay
deriva entre las dos.

## 11. Lo que cubre el vídeo

Tras el build 35, el recorrido completo es: abrir la app → registrarse →
iniciar sesión → reservar → chat → **denunciar un mensaje** → **bloquear**
desde una oferta → botón de pánico con "Bloquear también" → Ajustes →
**Borrar cuenta**.

## 12. Decisiones (Ricardo, 2026-10-06)

- **D1** — Con un trabajo asignado se bloquea **desde el botón de pánico**, que
  cancela el trabajo. Nunca queda un trabajo a medias.
- **D2** — Monitoreo en el admin: tarjeta en el Dashboard, contador en la barra
  lateral y denuncias vencidas en rojo. Sin email por ahora.
- **D3** — Términos v2.1 ya: cláusula de cero tolerancia y correo corregido.
- **D4** — Sin lista de bloqueados en la app. Se desbloquea desde el admin, en
  la pestaña Bloqueos, con buscador por nombre o email.

## 13. Orden de trabajo y tamaño aproximado

1. Migración 055, modelos y servicio `moderation_service.py` (denunciar,
   bloquear, `is_blocked(a, b)`).
2. Comprobación del bloqueo en el chat (los dos caminos), en
   `provider_can_bid`, en `_evaluate_candidate`, en `list_offers` y en
   `accept`. `cancel-with-reason` con `block`. Filtro automático.
3. Endpoints de la app y del admin, y la prueba `smoke` en visp_demo.
4. Términos v2.1, en el backend y en la copia web.
5. App: `ReportSheet`, los menús, la casilla en `CancelWithReasonModal` y los
   textos en/fr. Junto con el arreglo del teclado de Borrar cuenta, que ya
   está hecho.
6. Admin: página Moderación con sus dos pestañas, la tarjeta del Dashboard y
   el contador.
7. Ricardo despliega el backend. Build 35 a TestFlight. Prueba en el iPhone.

## 14. Qué se hizo (2026-10-06)

- **Backend**:
  - mig **055** (`content_reports`, `user_blocks`, `moderation_actions`, `chat_messages.removed_at`), APLICADA en visp_demo y visp_prod, sin deriva entre las dos;
  - `models/moderation.py` y `services/moderation_service.py`;
  - `api/routes/moderation.py` (app y admin);
  - bloqueo en el chat REST y en el socket (el socket ahora guarda por `chatService.send_message`);
  - `BID_BLOCKED` en `provider_can_bid` y exclusión en `find_matching_providers`;
  - `cancel-with-reason` con `block`, resuelto ANTES de cancelar porque la cancelación toca Stripe;
  - filtro automático de insultos;
  - la cola de cancelaciones marca `blocked`.
- **Fallo previo encontrado y arreglado:** el chat no había guardado NUNCA un mensaje (0 filas en prod). `MessageType` mandaba `'TEXT'` y el enum de Postgres es `'text'`. Se arregló con `values_callable` en `models/chat.py`. La pantalla del chat, además, esperaba una lista y el backend devuelve `{items, meta}`; también arreglado.
- **Términos v2.1** (`platform_tos_v2.1.md`): cláusula de cero tolerancia en §22 y correo `support@droztechnologies.com`. La copia web (`legalContent.ts`, que sigue siendo el texto v1.0) lleva la misma cláusula en §4.
- **App**:
  - `ReportSheet`, `moderationService.ts`;
  - chat con menú "⋯", pulsación larga en los mensajes, aviso de bloqueo y refresco cada 6 s;
  - "⋯" en las ofertas (cliente) y en la bolsa (proveedor);
  - casilla "Bloquear también" en `CancelWithReasonModal`;
  - `KeyboardAvoidingView` en los dos formularios;
  - textos en en/fr.
- **Admin**: página Moderación (Denuncias y Bloqueos con buscador), contador en la barra lateral y tarjeta en el Dashboard.
- **Borrar cuenta:** las denuncias y los bloqueos se CONSERVAN. Un bloqueo protege a la otra persona también si la cuenta se restaura dentro de los 30 días.
- **Smokes en visp_demo:** `smoke_report_block.py` PASS 56, `smoke_cancellation.py` 20/20 y `smoke_account_deletion.py` PASS 53.
