# Envío a la App Store — qué poner en App Store Connect

Preparado el 2026-09-28 para la primera versión (1.0.0). Lo que va entre
`> ` está en inglés porque se pega tal cual en App Store Connect.

---

## 1. URLs (App Store Connect → App Information / Version)

| Campo | Valor |
|---|---|
| Privacy Policy URL (obligatoria) | `https://visp.richieyanez.com/legal/privacy` |
| Support URL (obligatoria) | `https://visp.richieyanez.com/` |
| Marketing URL (opcional) | `https://visp.richieyanez.com/` |
| Copyright | `2026 DROZ TECHNOLOGIES, INC.` |

Cuando exista `visp.com`, se cambian aquí; no hace falta un build nuevo.

---

## 2. App Review Information (el punto 6)

Apple prueba la app con una persona real. Como hay que iniciar sesión, pide
**usuario y contraseña de prueba** y unas **notas** para el revisor. Si el
revisor no puede entrar o se atasca, rechaza la app.

### Cuentas de demo (pendiente de crear)
- **Cliente:** cuenta nueva, con una dirección guardada en Toronto.
- **Proveedor:** cuenta con el alta completa (contrato, dirección, servicios,
  precios). El alta de cobros con Stripe exige identidad REAL, así que esta
  cuenta tiene que ser de alguien del equipo o dejarse sin cobros activos y
  explicarlo en las notas.

### Notas para el revisor (pegar en "Notes")

> VISP is a marketplace for everyday home services (cleaning, assembly,
> moving, yard work, painting, pet care…). Customers pick a service from a
> fixed catalog, see available providers with their price, and book.
> Providers complete identity verification and set their own prices.
>
> SERVICE AREA: VISP currently operates only in the Greater Toronto Area,
> Ontario, Canada. When the app asks for a service address, please use a
> Toronto address, for example: 100 Queen St W, Toronto, ON M5H 2N2.
> Addresses outside this area are rejected by design.
>
> DEMO ACCOUNTS:
> Customer — email: [PENDIENTE] / password: [PENDIENTE]
> Provider — email: [PENDIENTE] / password: [PENDIENTE]
>
> PAYMENTS: All services are physical services performed in person, outside
> the app, so payments are processed by Stripe (App Review Guideline
> 3.1.3(e)). Payments run in live mode; please do not complete a real
> payment. The card is only authorized at booking and charged when the job is
> completed.
>
> ACCOUNT DELETION: Profile → Settings → Delete account (last item, in red).
> The user confirms with their password; the account is closed at once and
> personal data is deleted after 30 days. Please do not delete the demo
> accounts, or other reviewers won't be able to sign in.
>
> Contact: support@droztechnologies.com

---

## 3. App Privacy (el punto 7)

No va en el código: es un **cuestionario en App Store Connect → App Privacy**.
Apple lo publica en la ficha de la tienda como la "etiqueta de privacidad".

**¿Se usan datos para tracking (publicidad entre apps)?** → **No.**

Todos los datos de abajo: **vinculados al usuario** (Linked to the user),
**propósito: App Functionality**, **no** usados para tracking.

| Categoría de Apple | Tipo | Por qué lo recogemos |
|---|---|---|
| Contact Info | Name | Perfil, contrato, comprobantes |
| Contact Info | Email Address | Cuenta e inicio de sesión |
| Contact Info | Phone Number | Contacto entre cliente y proveedor |
| Contact Info | Physical Address | Dirección del servicio y base del proveedor |
| Location | Precise Location | Proveedores cercanos y llegada durante el trabajo |
| Financial Info | Payment Info | Tarjeta del cliente (la guarda Stripe) |
| Financial Info | Other Financial Info | Cuenta bancaria del proveedor para cobrar (Stripe) |
| User Content | Photos or Videos | Fotos del trabajo, avatar, documento de identidad |
| User Content | Other User Content | Detalles del trabajo, mensajes, reseñas |
| Identifiers | User ID | Identificador de la cuenta |
| Purchases | Purchase History | Trabajos reservados y pagados |
| Other Data | Other Data Types | Documento de identidad y selfie (Stripe Identity) |

**Sin analítica ni informes de fallos:** la app no lleva SDKs de analítica ni
de crash (`firebase.ts` existe pero no se importa en ningún sitio).

**Mapbox:** su telemetría anónima está **apagada** desde el build 34
(`MapboxGL.setTelemetryEnabled(false)` en `App.tsx`), así que no hay que
declarar "Location → Analytics".

---

## 4. Pendientes que bloquean o arriesgan el envío

1. ~~**Borrar cuenta desde la app** (guía 5.1.1(v))~~ — HECHO el 2026-09-29
   (Ajustes → Delete account). Falta: desplegar backend + build nuevo.
2. **Cuentas de demo** para el revisor (arriba). También hacen falta para las
   capturas: con cuentas vacías las capturas no enseñan nada.
4. ~~Funciones de relleno~~ (guía 2.1) — quitadas en el build 34: "Rate the
   App" y "Privacy Settings" en Ajustes, y la pestaña "Calendar (coming soon)"
   de la agenda del proveedor.
5. **Solo iPhone** en la 1.0 (decisión de Ricardo, 2026-09-29):
   `supportsTablet: false` y `TARGETED_DEVICE_FAMILY = 1`. No hacen falta
   capturas de iPad.
6. **Capturas**: 6,9" = **1320×2868** (simulador iPhone 16 Pro Max). Entre 3 y
   10 por idioma; se piden en inglés y, si la ficha va en francés, también en
   francés.
3. **Términos v2.1** con el abogado: `platform_tos_v2.0.md` cita
   `support@vispapp.com` / `privacy@vispapp.com` y habla de background checks
   que no existen. No se edita la v2.0 porque ya hay firmas contra su hash.
