# Propuesta — Precios definidos por el proveedor, cobro flexible e impuestos

**Para:** Cliente del proyecto VISP / Tasker
**Preparado por:** Droz Technologies
**Fecha:** 22 de junio de 2026
**Estado:** Propuesta para autorización

---

## 1. En una frase

Que **cada proveedor o empresa defina su propio precio** por servicio (ej. "Luis López — limpieza, $10 CAD/hora + impuesto"), que el cliente pueda **pedir la cantidad que necesita** (horas, piezas, metros) y pagar **exactamente lo que correspondió al final**, y que VISP calcule de forma transparente y automática **el impuesto, la comisión de VISP y el pago al proveedor**.

---

## 2. El problema que resolvemos

Hoy la plataforma fija los precios por nosotros (rangos por nivel y región). Eso tiene tres límites:

1. **El proveedor no puede poner su precio real.** Cada negocio tiene su tarifa; un precio impuesto los aleja de la plataforma.
2. **No hay forma clara de cobrar distinto según el servicio.** Limpieza se cobra por hora, armar un mueble por pieza, pintar por metro. Hoy todo se trata igual.
3. **No manejamos impuestos.** Stripe ya cobra, pero el impuesto (GST/HST/PST) no se calcula ni se muestra. Eso es un riesgo y resta profesionalismo frente al cliente final.

---

## 3. Qué proponemos (la idea)

### 3.1 El proveedor pone su precio — pero dentro de límites sanos
Cada proveedor o empresa define su tarifa por servicio. **No es precio libre sin control:** el sistema valida que el precio quede dentro de un rango razonable según el nivel y el tipo de trabajo (evita precios irreales, demasiado bajos o demasiado altos). Así protegemos la calidad y la imagen de la plataforma, y a la vez damos libertad real al proveedor.

> **Ejemplo:** Luis López ofrece "Limpieza residencial". Elige cobrar **$10/hora**. El sistema acepta porque está dentro del rango permitido para ese servicio. Cuando un cliente lo contrata, ve "Luis López — $10/hora".

### 3.2 Cada servicio se cobra de la forma correcta
Analizamos los **218 servicios del catálogo** y a cada uno le asignamos su forma natural de cobro:

| Forma de cobro | Ejemplos de servicios |
|---|---|
| **Por hora** | Limpieza, jardinería de mantenimiento, mudanzas, mandados |
| **Por pieza** | Armado de muebles, cambio de grifo/inodoro, instalación de lámparas y enchufes |
| **Por metro cuadrado** | Pintura, instalación de pisos, lavado a presión |
| **Por metro lineal** | Cercas, molduras, canaletas |
| **Por visita / paquete fijo** | Paseo de perros, cuidado de mascotas, retiro de basura |
| **Cotización a medida** | Renovaciones grandes, plomería/eléctrico/HVAC mayor, emergencias |

La **forma de cobro la define el catálogo** (no la inventa el proveedor); el proveedor solo pone **su número**. Esto mantiene el orden y la coherencia de la plataforma.

### 3.3 El cliente pide la cantidad — y paga lo justo
El cliente indica cuánto cree que necesita (ej. "limpieza, 2 horas"). Eso es un **estimado, no el cobro final**.

- Al reservar, se **reserva en su tarjeta el estimado + un margen** (no se cobra todavía).
- El proveedor registra el tiempo o cantidad real.
- Al terminar:
  - Si tomó **lo mismo o menos**, se cobra **solo lo real**.
  - Si tomó **más** (ej. duró 3 horas en vez de 2), el cliente **aprueba el extra desde la app** antes de que se cobre.

> Nadie se lleva una sorpresa: el cliente siempre confirma, y el proveedor cobra su trabajo real.

### 3.4 Impuestos y reparto de dinero, claros y automáticos
En cada trabajo, el sistema mostrará y registrará:

```
   Subtotal del servicio        (cantidad × tarifa del proveedor)
 + Impuesto (GST/HST/PST)        (según la provincia)
 + Propina (opcional)
 ─────────────────────────────
 = Total que paga el cliente

 De ahí:
   • Comisión de VISP            (lo que gana la plataforma)
   • Pago al proveedor/empresa   (lo que recibe quien hizo el trabajo)
   • Impuesto                    (se canaliza al proveedor, que lo declara)
```

Todo queda **registrado y auditable** para cada transacción: factura clara para el cliente, pago correcto al proveedor, comisión transparente para VISP.

---

## 4. Cómo se verá (resultado final)

- **Proveedor / empresa:** una sección nueva "Mis precios" donde activa los servicios que ofrece y pone su tarifa por cada uno.
- **Cliente:** al reservar elige la cantidad y ve un estimado claro con impuesto incluido; al cierre confirma cualquier diferencia.
- **VISP (administración):** ve y controla comisión, impuesto y montos de cada trabajo, con historial auditable.

---

## 5. Cómo lo construiremos (por etapas)

Lo haremos **por fases**, cada una entregable y probada antes de seguir. Esto reduce riesgo y permite validar con usuarios reales en el camino.

| Fase | Qué incluye | Resultado visible |
|---|---|---|
| **1. Catálogo con forma de cobro** | Asignar a cada servicio su unidad (hora/pieza/metro/etc.) | Base lista (interno) |
| **2. Precios del proveedor** | Que proveedores y empresas pongan su tarifa, con validación de límites | Pantalla "Mis precios" |
| **3. Motor de impuestos y reparto** | Cálculo de GST/HST/PST + comisión + pago, todo auditable | Facturas y reparto correctos |
| **4. Cantidad flexible y pago** | Reserva con margen, cobro del real, aprobación de extras | Cliente paga lo justo |
| **5. Interfaces finales** | Pantallas en app móvil y web para los 3 roles | Experiencia completa |

> Las fases 1 y 2 son la base; las 3 y 4 pueden avanzar en paralelo una vez lista la 2.

---

## 6. Por qué conviene

- **Atrae y retiene proveedores:** cobran su precio real, como en su propio negocio.
- **Más confianza del cliente:** precios claros, impuesto visible, sin sorpresas, paga lo justo.
- **Más profesional y en regla:** manejo correcto de impuestos canadienses.
- **Escalable:** sirve igual para proveedores individuales (B2C) y para empresas (B2B), apoyándose en lo que ya construimos.

---

## 7. Lo que necesitamos que autorice

1. **El modelo de precios definidos por el proveedor** (con límites de control por nivel/servicio).
2. **El manejo de impuestos:** en esta primera fase, **el proveedor/empresa es quien declara y remite su impuesto**; VISP lo calcula, lo muestra y lo canaliza. *(Recomendamos confirmarlo con un contador antes de la Fase 3.)*
3. **El método de cobro flexible** (reservar estimado + margen, cobrar lo real, aprobar extras).

### Decisiones menores que pediríamos definir
- El **margen de reserva** sobre el estimado (proponemos **30%**).
- El **redondeo mínimo por hora** (proponemos 15 minutos, con mínimo de 1 a 2 horas según el servicio).

---

## 8. Riesgos y cómo los manejamos

| Riesgo | Mitigación |
|---|---|
| Precios irreales del proveedor | Validación automática dentro de rangos por nivel/servicio |
| Responsabilidad fiscal | Confirmación con contador antes de activar impuestos (Fase 3) |
| Cobros sorpresa al cliente | El cliente siempre confirma los extras antes del cobro |
| Impacto en lo que ya funciona | Todo es aditivo y opcional; el flujo actual de proveedores sigue intacto |

---

---

## 9. Comisiones, impuestos y ganancias reales (matrices y ejemplos)

> Esta sección reúne lo económico en matrices: comisión por nivel, el costo de Stripe, las ganancias reales y ejemplos numéricos paso a paso para revisar con el cliente.

### 9.1 Comisión de VISP por nivel (lo que gana la plataforma)

| Nivel | Tipo de proveedor | Comisión VISP (rango) | Por defecto |
|---|---|---|---|
| **Nivel 1 — Ayudante** | tareas básicas | 15 % – 20 % | **20 %** |
| **Nivel 2 — Experimentado** | técnico ligero | 12 % – 18 % | **18 %** |
| **Nivel 3 — Profesional certificado** | licenciado / regulado | 10 % – 15 % | **15 %** |
| **Nivel 4 — Emergencia** | 24/7, SLA | 5 % – 10 % | **10 %** |

> **Fuente (verificado en el código):** estos porcentajes salen del archivo de configuración del sistema `backend/seeds/commission_schedules.json` (país CA). Cada nivel tiene `commission_rate_min`, `commission_rate_max` y `commission_rate_default`; el cobro usa el `default` salvo que se ajuste dentro del rango.
> La comisión se calcula **solo sobre el servicio** (sin impuesto), y es configurable dentro del rango por nivel.
> ⚠️ *A confirmar:* el sistema actual usa **5–10 % (default 10 %) en Nivel 4**, pero el documento de diseño original (`CLAUDE.md`) mencionaba 15–25 % para emergencias. Definir cuál aplica antes de implementar.

### 9.2 Las tres "manos" que tocan el dinero (incluye Stripe)

Del total que paga el cliente, el dinero se reparte **en este orden**:

1. **Stripe** cobra su comisión de procesamiento: **2.9 % + $0.30 CAD por transacción** (sobre el total cobrado, incluido el impuesto). Sale primero, lo descuenta Stripe automáticamente.
2. **Impuesto (HST/GST/PST)** → es del gobierno; se canaliza al proveedor, que lo declara (Fase 1).
3. **Comisión VISP** → sobre el servicio (sin impuesto).
4. **Proveedor** → recibe el resto del servicio.

> **Importante:** de los $30 del servicio, VISP **no recibe $30**. Recibe **su comisión**, y de esa comisión se cubre el costo de Stripe (modelo recomendado). El proveedor recibe el servicio menos la comisión de VISP.

### 9.3 ¿Quién paga la comisión de Stripe? (decisión a tomar con el cliente)

Ejemplo: servicio **$75** (Nivel 1, comisión 20 %), Ontario HST 13 %. Total al cliente **$84.75**, comisión Stripe **$2.76**.

| Modelo | Cliente paga | **Gana VISP (neto)** | Recibe proveedor | Comentario |
|---|---|---|---|---|
| **A. VISP absorbe Stripe** *(recomendado)* | $84.75 | **$12.24** | $60.00 | Es el modo por defecto de Stripe Connect; justo y simple para el proveedor |
| B. Proveedor absorbe Stripe | $84.75 | $15.00 | $57.24 | VISP gana más; el proveedor recibe menos |
| C. Cliente paga un recargo | $87.51 | $15.00 | $60.00 | Permitido en Canadá pero impopular con el cliente |

> Recomendamos el **Modelo A**: VISP absorbe el costo de Stripe de su propia comisión. Las matrices de abajo usan este modelo.

### 9.4 Matriz de ganancias reales por nivel (Modelo A · Ontario HST 13 %)

| Nivel | Servicio | + HST 13 % | = **Cliente paga** | − Stripe (2.9%+$0.30) | Comisión VISP | **VISP neto** | **Recibe proveedor** | Impuesto (gobierno) |
|---|---|---|---|---|---|---|---|---|
| **1** | $75.00 | $9.75 | **$84.75** | $2.76 | $15.00 (20%) | **$12.24** | **$60.00** | $9.75 |
| **2** | $200.00 | $26.00 | **$226.00** | $6.85 | $36.00 (18%) | **$29.15** | **$164.00** | $26.00 |
| **3** | $1,500.00 | $195.00 | **$1,695.00** | $49.46 | $225.00 (15%) | **$175.54** | **$1,275.00** | $195.00 |
| **4** | $600.00 | $78.00 | **$678.00** | $19.96 | $60.00 (10%) | **$40.04** | **$540.00** | $78.00 |

> **Lectura clave:** en trabajos **pequeños** la comisión fija de Stripe ($0.30) + el porcentaje pesan mucho (ver §9.6 Ejemplo A: VISP neto baja a $4.72 en un trabajo de $30). Recomendamos definir una **tarifa mínima por trabajo** o un pequeño cargo de servicio para que los trabajos chicos sigan siendo rentables.

### 9.5 Precios bien y mal (guardarraíles)

> Los rangos abajo son **ilustrativos**; los finales se afinan por servicio. Si el precio del proveedor cae **dentro del rango** se acepta (✅); si queda **por debajo o por encima**, el sistema lo rechaza (❌).

**Por hora**
| Servicio | Rango permitido | ✅ Bien | ❌ Mal | Por qué se rechaza |
|---|---|---|---|---|
| Limpieza residencial (Nivel 1) | $10 – $45 /hr | $25 /hr | $5 /hr | Debajo del mínimo (precio irreal) |
| Jardinería de mantenimiento (Nivel 1) | $20 – $55 /hr | $40 /hr | $8 /hr | Debajo del mínimo |
| Mudanza local (Nivel 2) | $40 – $90 /hr | $65 /hr | $150 /hr | Encima del máximo |

**Por pieza**
| Servicio | Rango permitido | ✅ Bien | ❌ Mal | Por qué se rechaza |
|---|---|---|---|---|
| Armado de mueble (Nivel 1) | $25 – $80 /pieza | $45 | $10 | Debajo del mínimo |
| Cambio de grifo (Nivel 2) | $80 – $200 /pieza | $120 | $400 | Encima del máximo |
| Instalación de lámpara (Nivel 2) | $60 – $150 /pieza | $90 | $20 | Debajo del mínimo |

**Por metro cuadrado**
| Servicio | Rango permitido | ✅ Bien | ❌ Mal | Por qué se rechaza |
|---|---|---|---|---|
| Pintura interior (Nivel 2) | $6 – $15 /m² | $10 | $2 | Debajo del mínimo |
| Instalación de piso laminado (Nivel 2) | $12 – $30 /m² | $20 | $50 | Encima del máximo |
| Lavado a presión (Nivel 2) | $3 – $10 /m² | $6 | $0.50 | Debajo del mínimo |

**Por metro lineal**
| Servicio | Rango permitido | ✅ Bien | ❌ Mal | Por qué se rechaza |
|---|---|---|---|---|
| Instalación de cerca (Nivel 3) | $40 – $120 /m | $75 | $15 | Debajo del mínimo |
| Molduras / zócalos (Nivel 2) | $8 – $25 /m | $15 | $40 | Encima del máximo |
| Limpieza de canaletas (Nivel 2) | $5 – $15 /m | $9 | $1 | Debajo del mínimo |

**Por visita / paquete fijo**
| Servicio | Rango permitido | ✅ Bien | ❌ Mal | Por qué se rechaza |
|---|---|---|---|---|
| Paseo de perros 30 min (Nivel 1) | $15 – $35 | $22 | $5 | Debajo del mínimo |
| Retiro de basura ligera (Nivel 1) | $60 – $200 | $120 | $500 | Encima del máximo |
| Visita de alimentación de mascota (Nivel 1) | $12 – $30 | $18 | $3 | Debajo del mínimo |

> *Cotización a medida* (renovaciones, emergencias, plomería/eléctrico mayor) **no usa rango fijo**: el precio se acuerda con el cliente antes de empezar.

### 9.6 Ejemplos de cobro completo, paso a paso (Modelo A · Ontario HST 13 %)

Recordatorio del orden: **Cliente paga → Stripe → Impuesto → Comisión VISP → Proveedor.**

#### Ejemplo A — Por hora, con tiempo extra (Luis López, limpieza)
Luis cobra **$10/hr**. El cliente pide **2 horas**, pero el trabajo tomó **3 horas**.

**Paso 1 — Reserva:**
| Paso | Monto |
|---|---|
| Estimado al reservar (2 hr × $10) | $20.00 |
| **Se reserva en la tarjeta** (estimado + 30 % de margen, **no se cobra aún**) | $26.00 |
| Tiempo real: 3 hr → servicio real | $30.00 |
| Supera lo reservado → **el cliente aprueba el extra en la app** | ✔️ aprobado |

**Paso 2 — Lo que paga el cliente:**
| Concepto | Monto |
|---|---|
| Servicio (3 hr × $10) | $30.00 |
| + Impuesto HST 13 % (lo paga el cliente, es del gobierno) | $3.90 |
| **= Total que paga el cliente (un solo cobro)** | **$33.90** |

**Paso 3 — Cómo se reparte el dinero:**
| Destino | Monto | Qué es |
|---|---|---|
| **Comisión Stripe** (2.9 % × $33.90 + $0.30) | $1.28 | lo cobra Stripe (procesamiento) |
| **Comisión VISP** (20 % del servicio $30) | $6.00 | comisión bruta |
| **→ VISP neto** (comisión − Stripe) | **$4.72** | 💰 lo que realmente gana VISP |
| **Ingreso de Luis** ($30 − $6) | **$24.00** | ganancia real de Luis |
| **Impuesto HST** | $3.90 | del gobierno (lo remite Luis en Fase 1) |

> ⚠️ En un trabajo tan pequeño VISP gana solo **$4.72** después de Stripe. Esto justifica una **tarifa mínima por trabajo** (ver §9.4).

**¿Quién sostiene y remite el impuesto de $3.90?** (en ambos casos VISP neto = $4.72 y Luis = $24.00)
- **Opción A — Luis remite** *(decidida para Fase 1)*: Stripe deposita **$27.90** en la cuenta de Luis = sus $24.00 + $3.90 que él declara y paga a la CRA.
- **Opción B — VISP remite**: VISP retiene el $3.90 para pagarlo al gobierno (no es ingreso de VISP). Requiere que VISP sea el "responsable fiscal".

#### Ejemplo B — Por pieza, sin tiempo extra (armado de muebles, Nivel 2)
El proveedor cobra **$45/pieza**. El cliente arma **2 muebles**.

**Lo que paga el cliente:**
| Concepto | Monto |
|---|---|
| Servicio (2 × $45) | $90.00 |
| + Impuesto HST 13 % | $11.70 |
| **= Total que paga el cliente** | **$101.70** |

**Cómo se reparte:**
| Destino | Monto | Qué es |
|---|---|---|
| **Comisión Stripe** (2.9 % × $101.70 + $0.30) | $3.25 | procesamiento |
| **Comisión VISP** (18 % del servicio $90) | $16.20 | comisión bruta |
| **→ VISP neto** (comisión − Stripe) | **$12.95** | 💰 gana VISP |
| **Ingreso del proveedor** ($90 − $16.20) | **$73.80** | su ganancia |
| **Impuesto HST** | $11.70 | del gobierno (lo remite el proveedor en Fase 1) |

#### Resumen del flujo
```
 CLIENTE PAGA  =  Servicio  +  Impuesto
       │
       ├─► Stripe   (2.9 % + $0.30) ───────► costo de procesamiento
       ├─► Impuesto ──────────────────────► GOBIERNO (lo remite el proveedor, Fase 1)
       ├─► (Comisión VISP − Stripe) ───────► GANA VISP (neto)
       └─► Resto del servicio ─────────────► INGRESO del proveedor
```

> **Notas para presentación:**
> 1. La comisión de VISP se calcula sobre el **servicio (sin impuesto)** → el impuesto **nunca** infla ni reduce la comisión.
> 2. **Stripe Tax** puede *calcular y recaudar* el impuesto correcto por provincia de forma automática, pero **no lo declara ni lo paga al gobierno por ti**: entrega los reportes y el responsable fiscal (el proveedor en Fase 1) hace la declaración. *(No prometer que "Stripe paga los impuestos".)*
> 3. Otras provincias cambian solo el impuesto: Quebec ≈ 14.975 % (GST+QST), Alberta 5 % (GST), Columbia Británica 12 % (GST+PST). El sistema aplica el correcto según la ubicación del servicio.
> 4. La comisión de VISP es a su vez un servicio gravable → **VISP declara HST sobre su propia comisión** (como cualquier negocio); afecta el neto de VISP, no del proveedor. A confirmar con el contador en la Fase 3.

### 9.7 Cinco ejemplos completos por servicio (desglose total)

Cada fila desglosa **todo**: servicio, impuesto, lo que paga el cliente, lo que cobra Stripe, la **comisión de VISP según el nivel**, lo que gana VISP (neto, ya descontado Stripe) y lo que recibe el proveedor.
Ontario **HST 13 %** · Stripe **2.9 % + $0.30** · Modelo A (VISP absorbe Stripe).

> **La comisión SÍ cambia por nivel:** Nivel 1 = **20 %**, Nivel 2 = **18 %**, Nivel 3 = **15 %**, Nivel 4 = **10 %** (fuente: `backend/seeds/commission_schedules.json`). A mayor nivel/especialización, menor % de comisión.

| # | Servicio | Nivel | Unidad | Cantidad | Servicio | + HST 13 % | **Cliente paga** | − Stripe | Comisión VISP (%) | **VISP neto** | **Recibe proveedor** | Impuesto (gob.) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Limpieza residencial | 1 | por hora | 3 hr × $28 | $84.00 | $10.92 | **$94.92** | $3.05 | $16.80 (**20 %**) | **$13.75** | **$67.20** | $10.92 |
| 2 | Cambio de grifo | 2 | por pieza | 1 × $120 | $120.00 | $15.60 | **$135.60** | $4.23 | $21.60 (**18 %**) | **$17.37** | **$98.40** | $15.60 |
| 3 | Instalación piso laminado | 2 | por m² | 25 m² × $20 | $500.00 | $65.00 | **$565.00** | $16.69 | $90.00 (**18 %**) | **$73.31** | **$410.00** | $65.00 |
| 4 | Renovación parcial de baño | 3 | cotización | 1 trabajo | $3,000.00 | $390.00 | **$3,390.00** | $98.61 | $450.00 (**15 %**) | **$351.39** | **$2,550.00** | $390.00 |
| 5 | Emergencia tubería rota | 4 | cotización | 1 servicio | $480.00 | $62.40 | **$542.40** | $16.03 | $48.00 (**10 %**) | **$31.97** | **$432.00** | $62.40 |

**Cómo leer una fila (ejemplo 3, piso laminado):**
- El cliente pidió **25 m²** a **$20/m²** → servicio **$500.00**.
- Se suma **HST 13 % = $65.00** → el cliente paga **$565.00** (un solo cobro).
- **Stripe** se lleva **$16.69** (procesamiento).
- **VISP** cobra **18 %** del servicio = **$90.00**; menos Stripe, **gana $73.31 neto**.
- El **proveedor recibe $410.00** ($500 − $90 de comisión).
- El **impuesto $65.00** lo declara el proveedor (Fase 1).

> Verás que a mayor nivel el porcentaje baja (20 → 18 → 15 → 10 %), pero como los montos son más grandes, **la ganancia neta de VISP en dólares crece** con trabajos de mayor nivel.

---

*Este documento es una **propuesta para revisión y autorización del cliente**. Describe qué construiremos y cómo se reparte el dinero (precios definidos por el proveedor + impuestos + comisiones). El código de esta función **aún no se ha escrito**; una vez que el cliente autorice, se implementará por **fases** según la **sección 5**. (Se apoya en la base técnica de "VISP para Empresas" ya desarrollada.)*
