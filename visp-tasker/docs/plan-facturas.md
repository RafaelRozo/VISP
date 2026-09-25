# Plan — Facturas al cerrar un trabajo

Estado: **análisis, sin código**. 2026-09-25.

Encargo: al terminar un trabajo, generar un documento desglosado —qué se hizo,
por qué y cuánto se cobró— visible en la app y guardable en el dispositivo,
para cliente y proveedor.

---

## 1. PDF, no imagen

| | PDF | Imagen |
|---|---|---|
| Peso (1-2 páginas) | **~40 KB** | 300-800 KB legible en móvil |
| Texto | seleccionable, buscable, imprimible | pixeles |
| Contabilidad | el gestor lo procesa | inservible |
| Maquinaria | **ya la tenemos** | habría que montarla |

`legalPdfService.py` ya genera PDF con `fpdf2` y la DejaVu embarcada (se hizo
para los contratos). Cero dependencias nuevas. **La imagen no tiene ninguna
ventaja aquí**: pesa diez veces más para decir lo mismo peor.

---

## 2. LO IMPORTANTE: son DOS documentos, no uno

El encargo dice «el invoice de VISP». Pero nuestro propio cobro dice otra cosa.
De `paymentService.py`:

> *destination charge con `on_behalf_of` — **so tax is theirs to remit** — y los
> fondos liquidan en la cuenta del proveedor; VISP retiene `application_fee`.*

Es decir: **el comercio que vende el servicio es EL PROVEEDOR**, no VISP. VISP
cobra una comisión por la intermediación. Son dos operaciones distintas y
necesitan dos documentos distintos:

### A) Para el cliente — factura del SERVICIO
Emisor: **el proveedor**. VISP la genera y la entrega en su nombre.

```
Servicio            (del catálogo cerrado)
Cantidad / horas    quantity · hourly_rate_cents / customer_rate_cents
Materiales          materials_spent_cents   (reembolso, no ingreso del proveedor)
Propina             tip_cents
Impuesto            service_tax_cents · tax_rate_applied · tax_jurisdiction
Tarifa de servicio  service_fee_cents       (esto SÍ es de VISP)
TOTAL               total_charged_cents
```

### B) Para el proveedor — liquidación
Emisor: **VISP**. Es la factura de la comisión + el desglose de lo que cobra.

```
Cobrado al cliente      total_charged_cents
- comisión VISP         commission_amount_cents  (commission_rate %)
- tarifa de servicio    service_fee_cents
+ materiales            materials_spent_cents
+ propina               tip_cents
= NETO                  provider_payout_cents
```

**Llamar «factura de VISP» a la del cliente sería declarar que vendimos algo que
no vendimos.** Con impuesto de por medio eso no es un matiz de estilo.

---

## 3. El impuesto es la parte que hay que hacer bien

`tax_service.compute_tax` solo aplica impuesto **si el proveedor está registrado**
(`provider_profiles.tax_registered`). De ahí se deriva:

- **Con impuesto**: la factura del cliente DEBE mostrar el **número fiscal del
  proveedor** (`tax_number`). La CRA lo exige para que el cliente pueda
  reclamar el crédito de impuesto soportado. Sin ese número, el documento no le
  sirve a un cliente que sea empresa.
- **Sin registro**: no se cobra impuesto y la factura **no debe llevar ninguna
  línea de impuesto** — insinuar uno que no se cobró es peor que omitirlo.

También obligatorio en el documento: **nombre legal y dirección del emisor**
(el proveedor), fecha, y **número de factura único**.

---

## 4. La numeración no es cosmética

Una factura necesita **numeración correlativa por emisor**. Como el emisor es el
proveedor, la serie es **por proveedor**, no global. Eso es una decisión de
esquema: columna o tabla propia, con unicidad garantizada por la base y no por
código —dos trabajos que cierran a la vez no pueden compartir número.

---

## 5. Generar y guardar, o generar al vuelo

**Guardar**, como los contratos. Una factura **no puede cambiar después de
emitida**, y si se regenera al vuelo cambia el día que toquemos una plantilla o
una tarifa. Mismo razonamiento que `legal_consents`: documento inmutable, con su
hash.

Coste: ~40 KB × 2 por trabajo. Mil trabajos = 80 MB. Irrelevante.

Se genera **al capturar el cobro**, que es el instante en que las cifras quedan
congeladas.

---

## 6. Guardarlo en el dispositivo

La app **no tiene ninguna librería de compartir** (ni `react-native-share` ni
`expo-sharing`). Dos caminos:

1. **URL firmada de vida corta abierta en Safari** — cero dependencias. Es
   exactamente el patrón que acabamos de montar para el alta de cobros
   embebida. iOS enseña el PDF y ofrece «Guardar en Archivos» y compartir.
   **Recomendado.**
2. `expo-file-system` + `expo-sharing` — hoja de compartir nativa, más fina,
   pero son dependencias nativas nuevas y `pod install`.

Empezar por la 1 y subir a la 2 solo si el gesto molesta.

---

## 7. Encaja con algo ya planeado

§5b de `plan-firma-contratos.md` dejó pendiente el **Registro de Reserva**: un
PDF de 1-2 páginas generado al confirmarse la reserva. Es el hermano de esto en
el otro extremo del trabajo, y comparte toda la maquinaria: plantilla, fuentes,
almacenamiento, hash, endpoint autenticado y visor en la app.

**Conviene hacerlos juntos.** Hacer solo uno significa montar la mitad de la
infraestructura dos veces.

---

## 8. Lo que falta por decidir (de Ricardo)

1. **¿Se emite factura cuando el proveedor NO está registrado fiscalmente?**
   Sin impuesto no hay obligación formal, pero el cliente quiere su comprobante.
   Mi propuesta: emitir igual, titulado **«Recibo»** y no «Factura», sin línea
   de impuesto. La palabra importa.
2. **¿Numeración por proveedor o una serie de VISP?** Legalmente, por emisor.
3. **¿Bilingüe?** Los contratos están solo en inglés porque el francés está en
   revisión. Una factura es más corta y más fácil de traducir bien.
4. **¿Qué pasa con las cancelaciones y los reembolsos parciales?** Una factura
   emitida no se borra: se emite una nota de crédito. Hoy existe
   `charge.refunded` y `cancellation_service`, así que el caso ya ocurre.

---

## 9. Lo que NO hay que hacer

- **No usar las facturas de Stripe.** Stripe Invoicing es otro producto, con su
  propio ciclo, y nuestro cobro no pasa por él. Mezclarlos crea dos verdades
  sobre el mismo dinero.
- **No generar la factura antes de capturar.** Hasta la captura el importe puede
  cambiar (materiales, sobrecoste aprobado), y una factura que cambia no es
  una factura.
