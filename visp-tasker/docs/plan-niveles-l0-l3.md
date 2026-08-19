# Plan de reestructuración de niveles L0 → L3

**Fuentes:** `docs/VISP STRUCTURING.pdf` (matriz categoría × nivel) + `docs/VISP_Worker_Progression_Requirements_Revised (1).docx` (requisitos de acceso por nivel).
**Estado del análisis:** completo. **Estado de implementación:** no iniciado — este documento es el plan.
**DB de trabajo:** `visp_prod` @ 192.168.1.94 (clon de visp_prod). Última migración: `030_provider_documents.sql`.

---

## 1. Qué cambia, en una frase

Hoy el nivel del proveedor es **global** (L1..L4) y el desbloqueo es **por sección**. El nuevo modelo hace el nivel **por clasificación (categoría)** para L1 y **por servicio individual** para L2/L3, elimina L4, e introduce L0 como acceso base de todo proveedor onboardeado.

| | Hoy | Nuevo |
|---|---|---|
| Escala | L1..L4 | **L0..L3** (L4 eliminado) |
| Granularidad del nivel | Global por proveedor | **Por categoría** (L1) y **por servicio** (L2/L3) |
| Título de perfil | "L2 Worker" | **"L2: Plumbing"**, "L1: Assembly" |
| Desbloqueo L1 | Doc aprobado por admin (juicio de competencia) | Evidencia de experiencia → **VISP valida la documentación** (no aprueba competencia) → acceso |
| Desbloqueo L2 | — | Credencial que **coincide con el servicio exacto**, verificada contra el registro oficial, + seguro CGL |
| Desbloqueo L3 | Licencia + seguro $2M | Credencial + **cuenta de empresa registrada (BIN/OCN Ontario verificado)** + CGL |
| Menores | — | **Prohibido. 18+ estricto.** |

---

## 2. Nueva matriz de catálogo (del PDF)

180 servicios repartidos: **L0=35, L1=72, L2=35, L3=38**.

| Categoría | L0 | L1 | L2 | L3 |
|---|---|---|---|---|
| Cleaning | 6 | 6 | 0 | 3 |
| Assembly | 0 | 21 | 3 | 0 |
| Gardening & Landscaping | 6 | 12 | 3 | 1 |
| Moving & Hauling | 5 | 2 | 0 | 0 |
| Seasonal | 1 | 9 | 6 | 2 |
| Pet Care | 6 | 0 | 0 | 0 |
| Painting & Renovation | 0 | 16 | 6 | 4 |
| Errands & Delivery | 6 | 0 | 0 | 0 |
| Events | 5 | 0 | 2 | 0 |
| Plumbing | 0 | 2 | 7 | 10 |
| Electrical | 0 | 1 | 8 | 10 |
| HVAC | 0 | 3 | 0 | 8 |

### Impacto sobre la DB actual (218 servicios)
- **~120 servicios cambian de nivel.** La mayoría **baja** un nivel (el antiguo L1 ≈ nuevo L0, antiguo L2 ≈ nuevo L1, etc.), pero no es un simple corrimiento: hay que aplicar el PDF servicio por servicio.
- **25 servicios L4 desaparecen.** Algunos tienen equivalente en el nuevo esquema (`Emergency Door/Lock Repair` → Assembly L2; `Emergency Total Power Loss` → Electrical L3 "Emergency Power Loss Diagnosis"; `Emergency Roof Leak/Tarping` → Seasonal L3 "Roof Leak Repair"). El resto (22) queda sin destino.
- **18 servicios de la DB no aparecen en el PDF** → requieren decisión (mantener con nivel asignado, o `is_active=false`):
  `Standard Residential Cleaning`, `Floating Shelf Installation`, `French Drain Installation`, `Donation Drop-Off`, `Window Cleaning (Exterior, Single Storey)`, `Attic Insulation Upgrade`, `Laminate Flooring Installation`, `Garbage Disposal Installation`, `Outdoor Hose Bib Winterization`, `Smart Home Hub Setup & Configuration`, `Electrical Permit & ESA Inspection Coordination`, `Home Security System Hardwired Installation`, `Hot Tub / Pool Electrical Hookup`, `Boiler Installation / Replacement`, `Chimney Liner Installation`, `Duct Cleaning (NADCA)`, `HVAC System Annual Inspection & Tune-Up`, `Refrigerant Recharge & Leak Repair`.
- **Servicios nuevos o renombrados** en el PDF: `Event Service (no food)` (Events se parte en 3: sin comida / alcohol / comida), `Roof Leak Repair`, `Pressure Washing (Driveway & Patio)` separado de `(House Exterior)`.
- **Renombrar categorías** para alinear con el PDF: `Moving & Hauling` → *Moving & Handling*; `Painting` → *Painting & Renovation*.

---

## 3. Requisitos de acceso por nivel (del DOCX) → traducción a sistema

### L0 — Base Access
- 18+ (**dato que hoy no existe**), orientación de seguridad VISP completada, licencia de conducir **G1/G2/G** subida como verificación de identidad, ToS de proveedor aceptado, acuerdo de seguridad y responsabilidad aceptado **antes de cada trabajo**.
- Acceso inmediato solo a los servicios L0 seleccionados en *My Services*.
- Completar trabajos L0 **no** es requisito para pedir L1.

### L1 — Skilled, Non-Regulated (por clasificación)
- El proveedor sube **evidencia de experiencia** por categoría: trabajos previos, CV, cartas de recomendación, referencias, fotos, registros de formación.
- **VISP valida que los documentos y la información estén completos y sean legítimos** antes de abrir el acceso (⚠️ esto se aparta del DOCX, que decía acceso inmediato — decisión de Ricardo 2026-08-04). **Es validación de documentación, NO aprobación de competencia**: VISP no certifica que el proveedor sepa hacer el trabajo.
- Flujo: sube evidencia → `PENDING` → admin valida → `VALIDATED` → el perfil muestra "L1: <categoría>" y se abren los L1 seleccionados de esa categoría. `REJECTED` = documentación incompleta o ilegible.
- La evidencia se **muestra al cliente** para que decida, con el descargo de que VISP no certifica ni garantiza la competencia.
- El perfil muestra la clasificación exacta ("L1: Assembly"), no "L1 Worker".

### L2 — Credentialed or Supervised (por clasificación **y** por servicio)
- Credencial (licencia / registro / certificación) que **coincida con el trabajo exacto**. Aprobar un L2 no habilita todos los L2 de la categoría.
- VISP **verifica contra el regulador/registro oficial** cuando exista, y **suspende el acceso al vencer**.
- Aprendices: documentación de la empresa patrocinadora identificando trabajador, empresa, oficio, supervisor, servicios permitidos y periodo de autorización.
- **Seguro CGL válido** que cubra los servicios ofrecidos; nombre asegurado, operaciones, monto y vigencia deben coincidir con la cuenta.
- Ejemplo del PDF: *Appliance Installation* debe dividirse por tipo de conexión (agua / gas / eléctrico fijo) porque cada una exige credencial distinta.

### L3 — Advanced Business-Based (por clasificación **y** por servicio)
- Credencial que coincida con el servicio exacto.
- **Obligatorio estar ligado a una cuenta de empresa registrada en VISP.** Un proveedor individual no puede tomar L3.
- Empresa debe aportar **BIN u OCN de Ontario**, verificado en el Ontario Business Registry. El BN de CRA **no** sustituye.
- **CGL obligatorio** cubriendo empresa + proveedor + los servicios.
- **Gate de historial: ≥5 trabajos L2 completados en la misma clasificación y rating promedio ≥4.4.**

### Transversal
- Ambas partes aceptan el **scope exacto + divulgación de riesgo** en cada reserva.
- Si el proveedor **no tiene CGL verificado**, el cliente acepta explícitamente el **riesgo de recuperación financiera** de contratar a un proveedor sin seguro.

---

## 4. Modelo de datos propuesto

### 4.1 Enum de niveles
`provider_level` (LEVEL_1..LEVEL_4) lo usan 8 columnas: `service_tasks`, `provider_profiles.current_level`, `provider_levels`, `pricing_rules`, `commission_schedules`, `sla_profiles`, `job_escalations.from_level/to_level`.

- `ALTER TYPE provider_level ADD VALUE 'LEVEL_0' BEFORE 'LEVEL_1';`
- `LEVEL_4` **se conserva en el enum** (Postgres no permite borrar valores sin recrear el tipo) pero queda **muerto**: ningún servicio ni proveedor lo usa.
- ⚠️ El `ADD VALUE` debe ir en su **propia migración** (`031_level_zero_enum.sql`); no se puede usar el valor nuevo en la misma transacción que lo crea.

### 4.2 Tablas nuevas

| Tabla | Para qué |
|---|---|
| `credential_requirements` | Catálogo de códigos de credencial: `306A`, `307A`, `309A`, `309C`, `ESA_LEC`, `TSSA_G1`, `TSSA_G2`, `313A`, `313D`, `308A`, `308R`, `403A`, `449A`, `444B`, `BCIN`, `P_ENG`, `259L`, `SMART_SERVE`, `FOOD_HANDLER`, `WHMIS`, `IICRC_AMRT`, `ASBESTOS_ON`, `WAH_CPO`, `BACKFLOW`, `OBC_P8`… con label EN/FR, autoridad, URL de registro y método de verificación. |
| `service_credential_requirements` | `(task_id, requirement_code, mandatory, notes)` — **codifica la columna de certificación del PDF por servicio**. Hoy no existe nada equivalente; sin esto el gate L2/L3 no puede ser por servicio. |
| `provider_classification_levels` | `(provider_id, category_id, level, granted_at, source, waiver_by, waiver_reason)` UNIQUE(provider_id, category_id) — el nivel alcanzado **por clasificación**. Es lo que rinde "L2: Plumbing". |
| `provider_experience_records` | Evidencia L1: `(provider_id, category_id, kind[previous_jobs\|resume\|recommendation\|reference\|photos\|training\|other], title, description, document_url, submitted_at, status[PENDING\|VALIDATED\|REJECTED], validated_at, validated_by, rejection_reason)`. El estado es de **validación documental**, no de aprobación de competencia. |
| `provider_credential_codes` | `(credential_id, requirement_code)` — qué código acredita una credencial verificada. El motor hace: servicio exige {codes} ⊆ codes verificados y vigentes del proveedor. |

### 4.3 Columnas nuevas sobre tablas existentes

- `provider_credentials` += `requirement_code`, `registry_name`, `registry_reference`, `registry_checked_at`, `registry_checked_by`, `suspended_at`, `sponsor_company_name`, `sponsor_supervisor`, `authorization_start/end` (aprendices).
- `provider_insurance_policies` += `insured_name`, `covered_operations`, `matches_account_verified` (ya tiene `coverage_amount_cents`, `expiry_date`, `status`).
- `companies` += `ontario_bin`, `ontario_ocn`, `registry_status`, `registry_verified_at`, `registry_verified_by`.
- `users` (o `provider_profiles`) += `date_of_birth` → gate 18+.
- `provider_profiles` += `safety_orientation_completed_at`, `identity_license_credential_id`, `identity_license_class` (G1/G2/G — el enum `license_class` ya existe).
- `service_tasks` += `requires_driver_license` (el PDF marca *Local Apartment Move* como "requires G2/G"), `min_age` (opcional).
- `legal_consents` += tipos `JOB_SCOPE_ACCEPTANCE`, `SAFETY_LIABILITY_AGREEMENT`, `UNINSURED_PROVIDER_RISK_DISCLOSURE` (por reserva, ambas partes).

### 4.4 Qué se retira
- `service_categories.requires_credential` + `help_message_en/fr` (migración 029): el gate deja de ser **por sección** y pasa a ser por servicio. Los `help_message` se pueden **reciclar** como texto de ayuda de la evidencia L1 por categoría — recomendado conservarlos y reinterpretarlos.
- `provider_credentials.task_id` (BC de antes de 029) → sustituido por `provider_credential_codes`.
- L4: `on_call_shifts`, la rama L4 de matching, SLA/pricing/commission de LEVEL_4 y la pantalla Emergency de la app quedan **inactivos** (no borrar tablas; desactivar).

---

## 5. Motor de niveles (reescritura de `provider_level_service.py`)

Reemplazar `compute_level` global por:

```
qualifies(provider, task) =
    task.is_active
AND task en My Services del proveedor
AND provider.l0_ok                                   # 18+, orientación, licencia ID, ToS
AND (task.requires_driver_license → licencia G2/G válida)
AND según task.level:
      L0 → True
      L1 → existe evidencia de experiencia VALIDATED en task.category
      L2 → codes_requeridos(task) ⊆ codes_verificados_vigentes(provider)
           AND CGL vigente que cubra las operaciones
      L3 → lo de L2
           AND provider ligado a company con registry_status=VERIFIED   # BIN/OCN Ontario
           AND CGL de la empresa vigente
           # gate de historial DESACTIVADO por decisión de negocio:
           # min_l2_jobs=0, min_avg_rating=0 — columnas existen para poder encenderlo después
```

- `provider_classification_levels` se recalcula tras cada cambio de evidencia/credencial/seguro/empresa/job completado.
- `provider_profiles.current_level` pasa a ser **derivado** = max(nivel por clasificación), solo para display/orden. No debe usarse para autorizar.
- Job nocturno: suspender credenciales/pólizas vencidas → recalcular → revocar cualificaciones afectadas + notificar.

---

## 6. Fases de ejecución

Orden acordado con Ricardo: **BD completa → admin (el cliente revisa y corrige el catálogo) → motor/API → mobile.**

| # | Fase | Entregable | Estado |
|---|---|---|---|
| **0** | Decisiones | §7 | ✅ **cerrada** |
| **1** | `031_level_zero_enum.sql` | `LEVEL_0` en `provider_level` + 4 tipos de consentimiento nuevos | ✅ **aplicada a `visp_prod`** |
| **2** | `032_level_model.sql` | 5 tablas nuevas + columnas de §4.3 + `level_policy` + seed de 34 códigos de credencial | ✅ **aplicada a `visp_prod`** |
| **3** | `033_catalog_relevel_l0_l3.sql` | 116 cambios de nivel, 22 bajas L4, 7 renombres, 2 altas, 244 requisitos de credencial, L0 en precios/comisiones/SLA | ✅ **aplicada a `visp_prod`** |
| **4** | **Admin-catálogo** | CRUD de servicios con nivel L0–L3 + editor de `service_credential_requirements` + precios en dólares. **Aquí entra el cliente a revisar.** | ✅ **hecho** |
| **5** | Motor de niveles | `provider_level_service.py` reescrito + backfill de `provider_classification_levels` + smoke | ⬜ |
| **6** | Backend API | `/provider/service-catalog` con gate por servicio; evidencia L1; credenciales con `requirement_code`; gate de empresa L3; consentimientos por reserva | ⬜ |
| **7** | Matching | Matching por servicio en vez de por nivel global | ⬜ |
| **8** | Admin-validación | Colas de evidencia L1 y credenciales L2/L3, verificación en registro oficial, BIN/OCN de empresa | ⬜ |
| **9** | App | Onboarding L0 (18+, orientación, licencia); "My Services" por servicio; evidencia L1; credencial por servicio; badge "L2: Plumbing"; divulgación de riesgo | ⬜ |
| **10** | Cutover | Aplicar 031–033 a `visp_prod`, backfill, smoke de producción | ⬜ |

### Fase 4 — Admin-catálogo (hecho)

**Backend** (`src/api/routes/admin.py`, `src/models/`)
- `ProviderLevel` += `LEVEL_0`. `_parse_level` acepta 0–3 y **rechaza el 4** con mensaje explícito; los patrones Pydantic pasan a `^[0-3]$` (un intento de guardar L4 devuelve 422).
- Modelos nuevos `CredentialRequirement` y `ServiceCredentialRequirement`.
- `GET /admin/taxonomy/credential-requirements` — catálogo de los 34 códigos.
- `GET /admin/taxonomy/full` devuelve `credentialRequirements` por servicio (una sola query para todos) y **ordena los servicios por nivel L0→L3** dentro de cada categoría.
- `POST`/`PATCH` de servicio aceptan `credentialRequirements`, que **reemplaza** el conjunto completo. Códigos desconocidos → 400.
- **Guardarraíl:** guardar un servicio en L2 o L3 sin al menos un requisito → **400**. Se evalúa sobre el nivel resultante, así que también bloquea *subir* un L1 a L2 sin requisitos.

**Frontend** (`admin/src/`)
- `lib/money.ts` — conversión dólares ↔ centavos en un solo sitio. La API sigue hablando **siempre en centavos**; el admin muestra dólares sin ceros de más (`2500` → `$25`, `2550` → `$25.50`).
- Modal de servicio: inputs de precio en **dólares** con prefijo `$`, selector de nivel L0–L3 con las etiquetas nuevas, y **editor de requisitos de credencial** (añadir del catálogo, marcar obligatorio/condicional, quitar). El botón Guardar se deshabilita y avisa si un L2/L3 se queda sin requisitos.
- Lista: **separadores de nivel** L0→L3 dentro de cada categoría, chips de los códigos de credencial (con `?` = condicional), aviso `⚠ NO CREDENTIAL` en los L2/L3 sin requisitos, y **filtro por nivel** con el conteo de cada uno.
- Modal de categoría: se retira el checkbox del gate por sección (obsoleto) y los `help_message` EN/FR se reetiquetan como **ayuda para la evidencia de experiencia L1**.
- i18n EN/FR completo. `tsc` 0 errores, `vite build` OK.

**Verificado en vivo** contra `visp_prod` (backend local :8000): catálogo 36/74/41/47, orden por nivel correcto en las 12 categorías, 85 servicios con requisitos, guardarraíl devuelve 400 en los 2 casos, código inexistente 400, L4 rechazado 422, ida y vuelta de precio $125.50 ↔ 12550 correcta. **Base restaurada a su estado exacto tras las pruebas** (244 requisitos, mismos niveles).

### Backup / rollback
`visp-tasker/backend/backups/visp_prod_backup_20260804.dump` — `pg_dump -Fc` de `visp_prod` tomado **antes** de la 031 (carpeta en `.gitignore`).
Restaurar: `pg_restore -h 192.168.1.94 -U Droz -d <db> --clean --no-owner <dump>`.
⚠️ El `ALTER TYPE ... ADD VALUE` de la 031 **no se puede deshacer** sin recrear el tipo; el rollback real es restaurar el dump.

### Resultado verificado tras la 033
- Catálogo activo: **L0=36, L1=74, L2=41, L3=47** (198 activos) + **22 desactivados** (L4). Cero servicios activos en `LEVEL_4`.
- **244 requisitos de credencial** sobre **85 servicios**. Solo **3 servicios L2 sin requisitos** (`Duct Cleaning`, `French Drain Installation`, `HVAC System Annual Inspection`) — se completan en el admin. Ningún L0/L1 tiene requisitos.
- **Diff contra el backup: 0 diferencias** en precio, duración, unidad, cantidad, descripción, slug y categoría de los 218 servicios. Solo cambió `level`.
- Comisiones: `LEVEL_0` creado copiando `LEVEL_1` (15–20 %); L1/L2/L3 intactos; `LEVEL_4` desactivado. Igual en `pricing_rules` (7 reglas L0) y `sla_profiles` (6 perfiles L0). `EMERGENCY_PREMIUM` desactivado.
- Proveedores: los 5 que estaban en `LEVEL_4` pasaron a `LEVEL_3` (no se les quitó acceso; el motor de la fase 5 recalculará).
- `service_categories.requires_credential` apagado en las 12 categorías (el gate por sección de la 029 queda obsoleto); los `help_message_en/fr` se conservan para reutilizarlos como ayuda de la evidencia L1.

---

## 7. Decisiones tomadas (Ricardo, 2026-08-04)

1. **L3 = credencial + validación → acceso.** **Se elimina el gate de historial** del DOCX (≥5 trabajos L2 + rating ≥4.4). Se implementan igualmente las columnas `min_l2_jobs` / `min_avg_rating` en la política de nivel pero **desactivadas por defecto (0 / 0)**, para poder encenderlas más adelante sin migrar de nuevo.
2. **L4 = desactivado por completo.** Los 22 servicios L4 sin equivalente pasan a `is_active=false` (no se borran: hay FK desde `jobs`). Los 3 con equivalente se recuperan renombrados: `Emergency Door / Lock Repair` → Assembly L2, `Emergency Total Power Loss` → Electrical L3 "Power Loss Diagnosis", `Emergency Roof Leak / Tarping` → Seasonal L3 "Roof Leak Repair".
3. **Emergency deshabilitado como producto**: `on_call_shifts`, escalación automática por keywords, `EMERGENCY_PREMIUM` y los `pricing_rules`/`commission_schedules`/`sla_profiles` de LEVEL_4 quedan inactivos. La pantalla Emergency de la app **se retira más adelante** (no en este bloque).
4. **Precios y comisiones — se conservan los valores actuales, remapeados así:**

| Nivel nuevo | Tarifa base | Comisión (`commission_schedules`) | Comisión (`pricing_rules` LEVEL_PREMIUM) |
|---|---|---|---|
| **L0** | la de L1 hoy ($25–45/h GTA) | 15–20 % (def. 20 %) | 15–20 % (def. 17.5 %) |
| **L1** | la de L1 hoy ($25–45/h GTA) | 15–20 % (def. 20 %) | 15–20 % (def. 17.5 %) |
| **L2** | sin cambio ($55–90/h GTA) | 12–18 % (def. 18 %) | 12–18 % (def. 15 %) |
| **L3** | sin cambio ($80–150/h GTA) | 10–15 % (def. 15 %) | 8–12 % (def. 10 %) |
| L4 | — | eliminado | eliminado |

> ⚠️ **Inconsistencia preexistente detectada:** `commission_schedules` dice L3 = 10–15 % mientras `pricing_rules` (LEVEL_PREMIUM) dice L3 = 8–12 %. Las dos tablas no coinciden hoy. Hay que unificar antes de migrar — pendiente de decidir cuál manda.

5. **L3 exige cuenta de empresa. CONFIRMADO** — *"solo providers que pertenezcan a un business"*, tal como lo pidió el cliente. Un proveedor individual no puede tomar ninguno de los 46 servicios L3. Requiere empresa con **BIN/OCN de Ontario verificado**.

6. **L1 NO es acceso inmediato. VISP valida los documentos primero.** Corrección importante sobre el DOCX (que decía acceso inmediato):
   - El proveedor sube su evidencia de experiencia → queda **PENDIENTE DE VALIDACIÓN**.
   - VISP **confirma que los documentos y la información están completos y son legítimos** → recién entonces el perfil muestra "L1: <categoría>" y se abren los servicios.
   - **Es validación de documentos e información, NO aprobación de competencia como antes.** VISP no certifica que el proveedor sepa hacer el trabajo; certifica que la evidencia que declaró existe y fue revisada.
   - Consecuencia de modelo: `provider_experience_records` **sí lleva estado** (`PENDING` / `VALIDATED` / `REJECTED`, donde REJECTED = documentación incompleta o ilegible, no "no eres competente"), y el admin tiene una cola de validación L1.

7. **Descripciones de servicio: NO se tocan.** El cambio es solo de **nivel**, salvo los renombrados explícitos del punto 8.

8. **Correcciones del cliente al catálogo (6 servicios)** — ya aplicadas en el CSV con `fuente=CLIENTE`:

| Servicio | Cambio |
|---|---|
| `Deck Construction (New Build)` | **Se queda en L3** (el PDF lo bajaba a L1): riesgo elevado + trabajo de construcción. Requiere **Working at Heights** aprobado; pueden aplicar requisitos de permiso de construcción. |
| `Lead Paint Remediation` | **Sube a L3.** Requiere formación reconocida de *lead-safe painting / lead remediation* y procedimientos de contención y seguridad. |
| `Spray Foam Insulation` | **Se queda en L3** (el PDF lo bajaba a L1). Requiere la **certificación de instalador de spray-foam específica del producto** bajo el programa de aseguramiento de calidad reconocido. |
| `Exterior Waterproofing (Foundation)` | **Renombrar** → *Exterior Waterproofing — Coating Only*. Scope limitado a aplicar recubrimientos impermeables; **no** incluye excavación, reparación estructural de cimentación, conexiones de drenaje ni plomería. |
| `Popcorn Ceiling Removal (Single Room)` | **Renombrar** → *Popcorn Ceiling Removal — Asbestos-Free Only*. Solo puede ejecutarse cuando se ha confirmado que el material **no** contiene asbesto. |
| `Hot Tub / Spa Moving` | **Renombrar** → *Hot Tub Moving — Transportation Only*. **No** incluye desconexión ni reconexión eléctrica, de plomería, gas ni mecánica. |

> Efecto de estos cambios: estrechan el scope de cada trabajo, mueven el trabajo de mayor riesgo a L3 y dejan más claras las cualificaciones exigidas tanto para el proveedor como para quien revisa en VISP.

## 7b. Decisiones que siguen abiertas

1. **`Sump Pump Testing & Maintenance`** — el PDF lo pone en **L3** y a la vez pone `Sump Pump Installation` en **L2**. Está invertido (instalar es más complejo que probar). **Lo dejé en L1** en el CSV; es el único punto donde me aparté del PDF sin instrucción tuya. ¿Lo confirmas?
2. **10 servicios marcados `REVISAR`** en el CSV — **aceptados por defecto** con el nivel del PDF salvo que digas lo contrario: `Exterior Door Replacement`, `Garage Door Replacement`, `Kitchen Cabinet Installation`, `Window Replacement`, `Concrete Patio / Walkway Pouring`, `Driveway Paving (Asphalt)`, `Fence Installation (Full)`, `Knob-and-Tube Wiring Replacement`, `Soffit & Fascia Replacement`.
3. **19 servicios marcados `PROPUESTA`** (no están en el PDF) — nivel propuesto por mí, aceptados por defecto.
4. **`Window Cleaning (Interior & Ground Level Exterior)`**: el PDF lo parte en dos (ground floor / interior). Por defecto **lo dejo como un solo servicio**.
5. **Verificación oficial** (Skilled Trades Ontario, ESA, TSSA, Ontario Business Registry): sin API. Fase 1 = **manual por admin** con campos de auditoría (registro, referencia, quién y cuándo). Asumido salvo objeción.
6. **Unificar la inconsistencia de comisión L3** (10–15 % vs 8–12 %, ver aviso arriba).

---

## 8. Mi opinión

**Lo bueno.** El modelo nuevo es sustancialmente más defendible legalmente que el actual. Tres aciertos:
- Pasar el gate de **sección → servicio individual** elimina el agujero de que un doc de "Plumbing" habilitara *todo* Plumbing. El PDF es explícito: "aprobar un L2 no autoriza todos los L2 de la clasificación". Es más trabajo de datos, pero es lo correcto.
- **L1 como declaración no verificada** transfiere el riesgo de forma honesta: VISP recoge y muestra, el cliente decide. Reduce muchísimo la exposición de VISP frente a "ustedes lo certificaron".
- **L0 explícito** separa "cualquiera puede hacer esto" de "esto requiere oficio", que hoy está mezclado en el L1 actual.

**Lo que me preocupa.**
1. **Exigir empresa registrada para L3 (confirmado)** es correcto legalmente pero es una barrera de entrada fuerte: los 46 servicios L3 son los de mayor ticket y ningún proveedor individual puede tomarlos. **Acción recomendada antes del cutover:** medir cuántos proveedores reales tienen BIN/OCN y, si son pocos, planear el empuje de onboarding B2B en paralelo — si no, el catálogo L3 queda sin oferta.
2. **Las 6 correcciones del cliente resolvieron lo más grave** (Lead Paint y Spray Foam a L3, Deck Construction se queda en L3, y 3 servicios con el scope estrechado en el propio nombre). Quedan 10 bajadas a L1 aceptadas por defecto — sobre todo `Window Replacement`, `Garage Door Replacement` y `Soffit & Fascia Replacement` — que siguen siendo trabajo en altura o de envolvente en un nivel donde VISP solo valida papeles, no competencia. Las dejo como están pero vale la pena una segunda pasada con criterio de **riesgo**.
3. **`service_credential_requirements` es la pieza crítica.** El PDF ya trae los códigos por servicio (306A, 309A, ESA LEC, TSSA G1/G2, 308A/308R, 449A, 444B, BCIN, Smart Serve…). Si no se modela como tabla, el gate por servicio se vuelve un `if` gigante imposible de mantener. Vale la pena hacerlo bien de una vez.
4. **Volumen del cambio.** 116 servicios cambian de nivel, 22 se desactivan, 7 se renombran, 2 se crean; todos los proveedores existentes hay que recalcularlos; matching, pricing, comisiones, SLA, admin y app se tocan. Esto no es un parche: son 3 migraciones y ~2 semanas de trabajo bien hecho. Recomiendo **congelar features nuevas** hasta cerrar la fase 4, y trabajar en `visp_prod` (no en `visp_prod`) hasta que el smoke pase completo.

---

## 9. Anexo: CSV de revisión del catálogo

`docs/revision-niveles-l0-l3.csv` — 220 filas (los 218 servicios actuales + 2 nuevos), columnas:
`categoria, servicio, nombre_nuevo, nivel_actual, nivel_nuevo, accion, fuente, nota`.

**Resumen:** L0=36, L1=75, L2=41, L3=46, desactivados=22.
**Acciones:** 116 cambian de nivel · 80 sin cambio · 22 desactivados (L4) · 2 creados.
**Columna `fuente`:** `PDF` (asignación literal del diagrama) · `CLIENTE` (6 correcciones explícitas, §7.8) · `REVISAR` (10 — el PDF lo dice, lo discuto, **aceptado por defecto**) · `PROPUESTA` (19 — no está en el PDF, nivel propuesto por mí) · `NUEVO` (2 servicios a crear en Events).
**Columna `nombre_nuevo`:** 7 servicios se renombran (3 por scope del cliente, 3 al quitarles el prefijo "Emergency", 1 al partir Events).
**Las descripciones NO se tocan** — salvo los 3 renombrados por scope, donde el nombre lleva el límite del alcance.

**Este CSV es la entrada de la fase 3, que es la irreversible.** No se ejecuta hasta que esté revisado.
