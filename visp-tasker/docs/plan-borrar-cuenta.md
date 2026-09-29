# Plan — Borrar cuenta desde la app

2026-09-28. Análisis hecho; **implementado el 2026-09-29** (ver §6).

**Por qué:** Apple rechaza cualquier app que permita crear cuenta y no permita
borrarla desde dentro (guía 5.1.1(v)). Y nuestra propia política de privacidad
ya lo promete: *"when you delete your account, we retain your information for
up to 30 days… After 30 days, personal information is deleted or
de-identified"*.

---

## 1. Lo que encontré en el código (y que manda el diseño)

| Hallazgo | Consecuencia |
|---|---|
| `jobs.customer_id`, `legal_consents`, `reviews`, `chat_messages`, `job_cancellation_reports`, `job_material_receipts` apuntan a `users` con **RESTRICT** | Un `DELETE FROM users` **falla**. Y no debe funcionar: esos registros son historial de la otra parte, contabilidad y auditoría legal. |
| `provider_profiles`, `device_tokens`, `notifications`, `company_members` están en **CASCADE** | Un `DELETE` borraría en cascada credenciales, documentos, tarifas y ofertas del proveedor. |
| `users.status` ya tiene `DEACTIVATED` y existe `users.deleted_at` | **El borrado es lógico + anonimización**, nunca un `DELETE`. |
| `get_current_user` y el refresh comprueban el estado **en cada petición** | Al pasar a `DEACTIVATED` todas las sesiones mueren al instante. No hay que tocar tokens. |
| `provider_can_bid` **no comprueba** si la cuenta está activa | **Bug actual:** un proveedor suspendido o borrado seguiría recibiendo trabajos. Se arregla sí o sí. |
| El cobro se **retiene** al reservar (`capture_method=manual`) y se **captura al completar** (`capture_job`) | Un cliente con un trabajo abierto puede tener dinero retenido en su tarjeta: hay que liberarlo. |
| El dinero va directo a la cuenta Stripe del proveedor (*destination charge*) y sale a su banco por el calendario automático de Stripe | "Ganancias sin cobrar" = **saldo disponible + pendiente** de su cuenta Stripe. Ya existe `get_balance(account_id)` para leerlo. |
| Comprobantes (`job_invoices`), consentimientos y contratos firmados (PDF + sha256) | Se **conservan**: obligación contable (CRA, 6 años) y la auditoría legal (regla de negocio 3). |

---

## 2. Cuándo NO se puede borrar (bloqueos)

La app hace una **comprobación previa** y enseña qué impide borrar y cómo
resolverlo. Un usuario puede ser cliente y proveedor a la vez: se evalúan los
dos papeles.

### Como cliente
| Situación | Qué pasa |
|---|---|
| Trabajo **con proveedor asignado** en curso: `SCHEDULED`, `PROVIDER_ACCEPTED`, `PROVIDER_EN_ROUTE`, `IN_PROGRESS` | **Bloquea.** "Termina o cancela el trabajo X primero." Hay otra persona comprometida. |
| Trabajo en `DISPUTED` | **Bloquea** hasta que soporte lo resuelva. |
| Solicitudes **sin proveedor todavía**: `DRAFT`, `PENDING_MATCH`, `MATCHED`, `PENDING_APPROVAL`, `PENDING_PRICE_AGREEMENT` | **No bloquea: se cancelan solas** al borrar (ver D2), liberando la retención de la tarjeta y avisando a los proveedores que habían ofertado. Se listan en la confirmación. |
| Algún cobro fallido o pendiente de pago | **Bloquea** (a confirmar el campo exacto mañana). |

### Como proveedor
| Situación | Qué pasa |
|---|---|
| Trabajo **aceptado** que no ha terminado (mismos estados de arriba) | **Bloquea.** "Termina o cancela el trabajo X." El cliente cuenta con él. |
| **Saldo en Stripe > 0** (disponible + pendiente) | **Bloquea** (ver D1): "Tienes $X pendientes de cobro; llegarán a tu banco hacia el DÍA. Podrás borrar la cuenta después." |
| Ofertas enviadas a trabajos que aún no le han asignado | **No bloquea: se retiran solas.** |
| Es **admin (dueño) de una empresa** B2B | **Bloquea:** hay que traspasar o cerrar la empresa con soporte. Si solo es colaborador, sale de la empresa automáticamente. |

---

## 3. Qué pasa al borrar

### Al momento (día 0)
1. `users.status = DEACTIVATED`, `deleted_at = now()`. Todas las sesiones mueren en la siguiente petición.
2. Se cancelan sus solicitudes sin proveedor **con el mismo camino que la cancelación normal** (`cancellation_service`), no cambiando el estado a mano: así se libera la retención (`PaymentIntent.cancel`) y se avisa a quien ofertó.
3. Se retiran sus ofertas pendientes como proveedor; `provider_profiles.status = INACTIVE`.
4. Sale de las empresas donde es colaborador.
5. Se borran sus `device_tokens`: no más notificaciones push.
6. Se registra el borrado para auditoría (quién, cuándo, IP), igual que un consentimiento.
7. El matching lo excluye (nuevo filtro en `provider_can_bid`).

### A los 30 días (proceso programado)
8. **Anonimizar** la fila de `users`: nombre → "Deleted user", email → `deleted+<id>@invalid` (libera el email para volver a registrarse), y a `NULL` teléfono, direcciones, última ubicación, contraseña, código de recuperación y avatar.
9. Perfil de proveedor: bio y dirección base a `NULL`.
10. **Borrar archivos**: avatar, expediente de experiencia, credenciales, seguros, documentos del proveedor y fotos de sus reservas.
11. **Stripe:** borrar el *Customer* (se van sus tarjetas guardadas) y **cerrar la cuenta conectada** del proveedor, volviendo a comprobar antes que el saldo sea 0.
12. **Se conserva**, porque son de otra persona o hay obligación legal:
    - Los trabajos, que son historial de la otra parte, con el nombre ya como "Deleted user".
    - Comprobantes, consentimientos, contratos firmados y pagos.
    - Reseñas y mensajes, con el autor anónimo.

**Recuperar la cuenta:** dentro de los 30 días, escribiendo a soporte. El admin
la reactiva. Pasado ese plazo ya no hay vuelta atrás.

El proceso de los 30 días tiene que **anunciarse en el log al arrancar**, y
debe poder lanzarse a mano desde un script. Motivo: el `reminderScheduler`
estuvo meses muerto sin que nadie lo notara.

---

## 4. Qué se construye

### Backend
- `GET /users/me/deletion-check` → `{ canDelete, blockers: [...], willCancel: [...], pendingBalanceCents, expectedPayoutDate }`.
- `POST /users/me/deletion` con la contraseña para confirmar → hace el día 0 en una transacción. Devuelve 409 con los bloqueos si algo cambió entre la comprobación y la confirmación.
- Filtro nuevo en `provider_can_bid`: cuenta no activa → `BID_ACCOUNT_INACTIVE`.
- Mensajes claros en login y registro para una cuenta borrada: *"This account was deleted. Contact support within 30 days to restore it."*
- Proceso diario `purge_deleted_accounts` + script manual equivalente.
- Admin: ver cuentas borradas y restaurar dentro del plazo (mínimo: un script; la pantalla puede esperar).

### App
- **Ajustes → "Delete account"** al final, en rojo, para los dos papeles.
- Pantalla con:
  1. Qué se borra y qué se conserva, en lenguaje claro.
  2. La lista de bloqueos, cada uno con su acción ("Ver trabajo", "Tu pago llega el…").
  3. Lo que se cancelará automáticamente.
  4. La contraseña para confirmar.
- Al confirmar: cerrar sesión y enseñar una pantalla de despedida con el plazo de 30 días.
- Textos en EN y FR.

### Pruebas
Un smoke (`smoke_account_deletion`) **contra `visp_demo` con claves de test de
Stripe**, nunca contra producción. Tiene que cubrir:
- Cada bloqueo.
- Que la cancelación automática libera la retención de la tarjeta.
- Que las sesiones mueren.
- Que el matching lo excluye.
- Que la purga anonimiza y conserva comprobantes y consentimientos.
- Que el email queda libre tras la purga.

### Apple
En las notas del revisor: *"Settings → Delete account"*.

---

## 5. Decisiones de Ricardo — CERRADAS 2026-09-29

- **D1 = A:** proveedor con saldo Stripe > 0 → bloquea hasta saldo 0.
- **D2 ampliada (Ricardo):** los trabajos **agendados que aún no han empezado
  NO bloquean**, ni al cliente ni al proveedor, si faltan **más de 15 min** para
  la cita (= `START_SCHEDULE_GRACE_MIN`: a partir de ahí el proveedor ya puede
  arrancar). Cancelar es gratis desde la mig 041, así que no hay penalización
  que esquivar borrando.
  - **Borra el cliente** → sus trabajos `SCHEDULED`/`PROVIDER_ACCEPTED` se
    cancelan (`CANCELLED_BY_CUSTOMER`, motivo `ACCOUNT_DELETED`), se suelta el
    hold y se avisa al proveedor: "El cliente cerró su cuenta; el trabajo del
    DÍA se canceló".
  - **Borra el proveedor** → el trabajo **vuelve al matching**, no se cancela.
    Es la pieza NUEVA: hoy `SCHEDULED` no tiene transición de vuelta. Hay que
    añadir `SCHEDULED/PROVIDER_ACCEPTED → PENDING_MATCH` (solo actor SYSTEM),
    quitar `provider_id`, **cancelar el PaymentIntent** (va `on_behalf_of` y
    `transfer_data` a la cuenta del proveedor que se va, no se puede reusar),
    limpiar el precio acordado, expirar su oferta y re-difundir. El cliente
    recibe aviso: "Tu proveedor ya no está disponible; buscamos otro". Aceptará
    una oferta nueva y se volverá a retener la tarjeta por el camino normal.
  - Siguen **bloqueando**: `PROVIDER_EN_ROUTE`, `IN_PROGRESS`, `DISPUTED`, y
    cualquier agendado con **≤ 15 min** para la cita.
  - La comprobación de los 15 min se repite dentro de la transacción del borrado
    (`SELECT … FOR UPDATE` sobre los trabajos) para no chocar con un "en ruta"
    simultáneo.
- **D3 = 30 días** para los documentos de verificación, como el resto.
- **D4 = bloquear** al dueño de empresa B2B (no contestado explícitamente; se
  toma la recomendación).
- **D5 = contraseña.**

### Decisiones originales (histórico)

- **D1 — Proveedor con dinero pendiente.**
  - **(A) Recomendada:** bloquear hasta que el saldo llegue a 0, enseñando cuánto y cuándo llega. Es lo más seguro: si el pago al banco fallara, el proveedor todavía puede entrar a arreglarlo.
  - (B) Aceptar la solicitud y cerrar la cuenta de Stripe cuando el saldo llegue a 0. Es más cómodo para el proveedor, pero si el pago falla ya no puede entrar a corregirlo.
- **D2 — Solicitudes del cliente sin proveedor.** Recomiendo **cancelarlas solas** al borrar, enseñándolas antes en la confirmación, en vez de obligarle a cancelarlas una a una.
- **D3 — Documentos de verificación del proveedor.** La política dice que se guardan "por un periodo razonable" por obligaciones legales. ¿Se borran a los 30 días como el resto, o se guardan más, por ejemplo 1 año? Conviene preguntar al abogado.
- **D4 — Dueño de empresa B2B.** Recomiendo bloquear y resolverlo con soporte, porque hoy casi no hay empresas.
- **D5 — Confirmación.** Recomiendo pedir la **contraseña**. Escribir "DELETE" es más débil.

---

## 6. Implementado (2026-09-29)

**Backend**
- `services/account_deletion_service.py` — `build_plan` (comprobación),
  `delete_account` (día 0), `restore_account`, `purge_due_accounts` (día 30).
- `GET /users/me/deletion-check` y `POST /users/me/deletion` (`routes/users.py`).
  403 `wrong_password` (no 401: la app cerraría la sesión por un error de
  tecleo), 409 `deletion_blocked` con el plan nuevo.
- Migración **054** `account_deletions`: auditoría (IP, user agent, estados
  anteriores para restaurar, qué se hizo con cada trabajo) y cola de la purga.
  Aplicada en `visp_prod` y `visp_demo`.
- `jobStateManager`: `SCHEDULED/PROVIDER_ACCEPTED → PENDING_MATCH`, solo sistema.
- `provider_can_bid` → `BID_ACCOUNT_INACTIVE` (usuario SUSPENDED/DEACTIVATED/
  BANNED o perfil SUSPENDED/INACTIVE). `find_matching_providers` filtra también
  por el estado del USUARIO (antes solo el del perfil).
- Login y registro con cuenta borrada: mensaje con el plazo y el correo de soporte.
- `jobs/accountPurge.py`: tarea cada 6 h desde el `lifespan`, anunciada en el
  log. Manual: `scripts/account_deletion.py list | purge [--user] | restore`.
- Avisos push: `notify_job_cancelled_account_deleted` (al proveedor) y
  `notify_provider_left` (al cliente). Se envían DESPUÉS del commit.

**App** — Ajustes → *Delete account* (rojo, al final) → `DeleteAccountScreen`:
qué se borra y qué se conserva, bloqueos o cambios automáticos, contraseña.
Al confirmar: alerta nativa de despedida + logout. EN/FR.
De paso, `apiClient` ya extrae `code`/`message` de un `detail` objeto (antes
`code` quedaba en NETWORK_ERROR y `payment_method_required` nunca se reconocía).

**Smoke** `scripts/smoke_account_deletion.py` — **PASS 53** contra `visp_demo`
con Stripe test y retenciones REALES liberadas (ver cabecera del script).

**Descubierto por el camino**
- `users.recovery_code` es NOT NULL en la base aunque el modelo diga Optional:
  la purga lo rota en vez de ponerlo a NULL.
- `provider_profiles.identity_license_credential_id` no está mapeado en el ORM:
  la purga lo limpia con SQL (asignarlo en Python no hacía nada, sin error).
- La cancelación normal vía `update_job_status` **no suelta la retención**
  (solo lo hacen el barrido de plantones y la cancelación con motivo). El
  borrado la suelta explícitamente; el hueco general sigue abierto — decidir.

**Pendiente**
- Cerrar la cuenta conectada v2 en live: la purga lo intenta y, si Stripe lo
  rechaza, lo deja en `purge_notes` para hacerlo a mano. No probado en live.
- D4 (dueño de empresa) solo bloquea; no hay traspaso automático.
- "Ver trabajo" desde cada bloqueo: hoy solo se muestra la referencia.
