# Plan v1 — lanzamiento L0/L1 en zona controlada (Ontario/GTA)

> Decisiones del cliente + Ricardo, 2026-08-10. Supersede parcialmente
> `plan-niveles-l0-l3.md`: las fases 5–9 de ese plan quedan en **stand-by** salvo
> la rebanada de motor que se describe abajo.

## 1. Qué cambia

| # | Cambio | Estado |
|---|---|---|
| 1 | **La v1 se lanza solo con L0 y L1.** L2/L3 en stand-by, se habilitan por servicio cuando el cliente lo decida | pendiente |
| 2 | **50 servicios activos** en la 1ª fase. El equipo los está recortando con `is_active` directamente en `visp_prod` | lo hace el equipo |
| 3 | **Los providers actuales se limpian** antes de publicar. Se arranca de cero con beta testers en Ontario | script, lo dispara Ricardo |
| 4 | **El customer solo ve servicios que tenga alguien que los ofrezca.** Arranca en 0 y crece según se registran providers/negocios y agregan sus servicios | pendiente |
| 5 | **Zona de servicio delimitada** (modelo Uber: centro + radio, se amplía al crecer) | pendiente |
| 6 | **Seguro sin candado de nivel** — check "requiere seguro" por servicio en el admin, a cualquier nivel | pendiente |
| 7 | **Portfolio + bio → L1**, por categoría | pendiente |
| 8 | Verification: se comentan **Trade License** y **Professional Certification**; se agrega **licencia de conducir** sin nivel | pendiente |

## 2. Estado real de `visp_prod` al 2026-08-10

- Catálogo activo: **L0=35, L1=47, L2=27, L3=38** = 147 (venían de 198; el equipo va bajando a 50).
- **43 providers** (28 L1, 5 L2, 10 L3) — **se van a limpiar**.
- **13 servicios** tienen provider cualificado hoy (7 L0 + 6 L1), 8 de ellos con un solo provider. Irrelevante tras la limpieza: el catálogo del customer **arranca vacío**.
- `provider_insurance_policies` = **0 filas**. `provider_experience_records` = **0 filas**.
- Ningún servicio L0/L1 exige ningún requisito hoy → el check de seguro es configuración nueva del cliente.
- Requisitos existentes: CREDENTIAL 58 reqs/25 servicios en L2, 143/38 en L3; PERMIT 4/4 en L2.
- `jobs.service_province_state` está **sucio**: `Ontario`=12, `ON`=1, `Chihuahua`=11, null=4.
- Enums vivos: `credential_type` (LICENSE, CERTIFICATION, PERMIT, TRAINING, BACKGROUND_CHECK, PORTFOLIO),
  `experience_record_status` (PENDING/VALIDATED/REJECTED), `credential_requirement_kind` (CREDENTIAL/INSURANCE/PERMIT).
- `service_zones` **no existe**.

## 3. Zona de servicio — por qué NO es "provincia = Ontario"

Ontario mide más de 1.000 km: Toronto–Thunder Bay son 1.400 km. Un filtro por
provincia **deja pasar exactamente el problema que el cliente quiere evitar** (un
registro aislado lejísimos del resto). Y el GPS del dispositivo tampoco sirve
como control: bloquea el testeo propio y se falsea en dos toques.

**Modelo elegido (Uber):** tabla `service_zones` con centro (lat/lng) + radio en km
+ `is_active`. Se valida contra:
- la **dirección donde ocurre el trabajo** (creación de job) → gate duro, 4xx;
- la **dirección base del provider** (registro/onboarding) → gate duro, 4xx.

El GPS **solo** centra el mapa y muestra un aviso no bloqueante. Consecuencia
buscada: Ricardo puede seguir probando desde México, porque lo que se valida es
la dirección del servicio, no dónde está el teléfono. Ampliar a Ottawa = una fila
nueva, sin deploy.

Zona semilla: **GTA**, centro Toronto (43.6532, -79.3832), radio 60 km.
**Verificado** contra la BD: dentro quedan Toronto, Mississauga, Brampton, Markham,
Vaughan, Richmond Hill, Oakville, Pickering y Hamilton (59,2 km, entra justo).
Barrie queda 25 km fuera, Ottawa 292 km.

Prueba que zanja el argumento: **Thunder Bay está en Ontario y queda 864 km fuera
de la zona.** Un gate por `province = 'ON'` lo habría aceptado.

## 4. Migraciones

| # | Contenido | Por qué |
|---|---|---|
| **035** | `ALTER TYPE credential_type ADD VALUE 'DRIVERS_LICENSE'` — **sola** | Postgres no deja usar un valor de enum en la misma transacción que lo crea (misma trampa que la 031) |
| **036** | `service_zones` + seed GTA; normalizar `jobs.service_province_state` a código de 2 letras; `provider_profiles.base_*` si falta | El resto |

## 5. Los dos agujeros que hay que cerrar de paso

**5.1 — El seguro no llega a donde el motor lo busca.**
`_MOBILE_CRED_TYPE_MAP` (`providers.py:892`) mapea `insurance_certificate` →
`CredentialType.CERTIFICATION`: se guarda como un archivo suelto en
`provider_credentials`, sin número de póliza, sin aseguradora, sin monto y **sin
vencimiento**. El motor (`_has_verified_insurance`) lee
`provider_insurance_policies`, que tiene 0 filas y su propio endpoint
`POST /verification/insurance`. Si solo se quita el candado de nivel, el provider
sube el certificado, el admin lo aprueba, y el gate sigue diciendo "no tiene
seguro". → Cablear a la tabla real con **póliza completa** (nº, aseguradora,
cobertura, vigencia desde/hasta), decisión de Ricardo.

*Efecto lateral del mismo mapa:* `insurance_certificate` y `certification`
apuntan LOS DOS a `CERTIFICATION`, así que los renglones #4 y #5 de Verification
comparten estado. Comentar el #5 lo tapa; la colisión de datos queda anotada.

**5.2 — La licencia de conducir, tal cual, sube a un provider a L3.**
`"drivers_license"` mapea hoy a `CredentialType.LICENSE`, el MISMO tipo que la
licencia de oficio, y `_has_verified_license()` cuenta cualquier `LICENSE`
verificada. El provider sube su G2, el admin la aprueba de buena fe, y el sistema
la cuenta como licencia de oficio. → Tipo propio `DRIVERS_LICENSE` (mig 035),
`license_class` (G1/G2/G, enum ya existente de la 029) y **excluirla
explícitamente** de `_has_verified_license`.

## 6. El check de "requiere seguro" — sin migración

La 034 ya dejó el código `CGL` con `kind=INSURANCE`, y
`service_credential_requirements` acepta servicios de **cualquier** nivel. El
checkbox del admin escribe/borra esa fila por debajo. Así el motor tiene **un
solo sitio** donde buscar requisitos, en vez de dos fuentes que se pueden
contradecir (`service_tasks.requires_insurance` booleano + la tabla de
requisitos).

Flujo en la app: el provider marca un servicio en "My Services" → si ese servicio
exige CGL y no tiene póliza VERIFIED vigente → popup de subida (se reutiliza el
patrón de section-credentials de julio) y el servicio queda inactivo hasta que la
póliza se verifique.

## 7. Paquetes de trabajo y orden

1. **WP1 — Verification screen + backend** (lo que pidió el cliente hoy):
   portfolio→L1 por categoría, comentar #3 y #5, seguro sin candado con póliza
   completa, licencia de conducir nueva y separada. Incluye 5.1 y 5.2.
2. **WP2 — Check de seguro por servicio**: admin (checkbox), backend
   (`requiresInsurance` + cumplimiento en `/provider/service-catalog`), app (popup).
3. **WP3 — Zona de servicio**: migraciones 035/036, gate en job + provider, aviso en app.
4. **WP4 — Catálogo del customer solo con oferta**: filtro por oferta real en zona,
   **empty state en la app** (arranca en 0, no puede verse como un error), contador
   de cobertura en el admin.
5. **WP5 — L2/L3 en stand-by**: verificar el corte del equipo + rebanada mínima de
   motor (L0/L1 + requisito CGL). La Fase 5 completa del plan anterior sigue en pausa.
6. **WP6 — Limpieza de providers**: script idempotente con reporte previo. Lo
   dispara Ricardo, no se corre solo.

## 7b. Decisiones de Ricardo del 2026-08-11

1. **El gate de zona aplica a TODOS**, clientes incluidos. `PATCH /users/me` devuelve
   400 si la dirección guardada cae fuera de zona ("deberán ser de Ontario igual").
   Verificado: Vancouver 400, Chihuahua 400, Toronto 200.
2. **`POST /verification/insurance` cerrado.** Ahora exige token y deriva el
   proveedor de él; el `providerId` del body se ignora (no se rechaza, para no
   romper clientes que aún lo manden). Nadie lo llamaba, así que no rompe nada.
   El flujo de la app es `POST /api/v1/provider/insurance`, con archivo.
3. **El ping de GPS sigue sobreescribiendo `provider.home_*`** — RIESGO ACEPTADO.
   Razonamiento de Ricardo: un proveedor real usando GPS estará dentro de la zona.
   Lo que queda vivo y conviene recordar: si un proveedor abre la app fuera de la
   zona (viaje), su base de operación se mueve sola y el matching calcula
   distancias desde el sitio equivocado hasta que vuelva. El gate de reserva
   contiene el daño (ningún job puede crearse fuera de zona), así que es un
   problema de calidad de matching, no de acceso. Arreglo si algún día se quiere:
   la posición del dispositivo se queda en `users.last_latitude/last_longitude`
   —que ese endpoint ya escribe— y `provider.home_*` solo cambia cuando el
   proveedor edita su dirección.
4. **Detalles y evidencia de la reserva = soporte de decisión para el proveedor.**
   El servicio y el precio siguen saliendo del catálogo. El proveedor los ve
   ANTES de aceptar para decidir si le interesa el trabajo con su rango de precio.
   Requisito duro: viajan en el payload de la oferta, no solo en la fila del job.
5. **Portfolio L1 = expediente único global** (CV, fotos, cartas), NO por
   categoría. Revierte la decisión del 2026-08-04.
6. **Priority fuera de la v1.** Todo `standard`. Se comenta la UI; el enum
   `job_priority` y las reglas de pricing se quedan intactos.

## 8. Riesgos anotados

- **El catálogo arranca vacío.** Con la regla #4 y providers en cero, el customer
  abre la app y no ve nada. El empty state no es cosmético: es la primera
  impresión de los beta testers. Hay que decir "todavía no hay proveedores en tu
  zona", no mostrar una lista vacía.
- **Portfolio por categoría multiplica la cola de validación** del admin (hasta 12
  por provider). Decisión tomada a sabiendas.
- La rebanada de motor de WP5 debe leer `kind` y rutear: CREDENTIAL →
  `provider_credentials`, INSURANCE → `provider_insurance_policies`, PERMIT → no
  bloquea al provider (se exige por reserva).
