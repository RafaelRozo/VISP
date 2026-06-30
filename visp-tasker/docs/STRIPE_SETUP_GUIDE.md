# STRIPE SETUP GUIDE — VISP/Tasker (Test Mode)

> Guia paso a paso para que Stripe quede 100% funcional en test mode.
> Nivel: Principiante en Stripe. No se omite nada.

---

## TABLA DE CONTENIDOS

1. [Crear cuenta Stripe](#1-crear-cuenta-stripe)
2. [Obtener las API Keys (Test Mode)](#2-obtener-las-api-keys-test-mode)
3. [Configurar Stripe Connect](#3-configurar-stripe-connect)
4. [Configurar Webhooks](#4-configurar-webhooks)
5. [Configurar el Backend](#5-configurar-el-backend)
6. [Configurar la App (vispapp)](#6-configurar-la-app-vispapp)
7. [Flujo completo de pago](#7-flujo-completo-de-pago)
8. [Codigo faltante en Backend](#8-codigo-faltante-en-backend)
9. [Codigo faltante en vispapp](#9-codigo-faltante-en-vispapp)
10. [Probar pagos con tarjetas de prueba](#10-probar-pagos-con-tarjetas-de-prueba)
11. [Checklist final](#11-checklist-final)

---

## 1. CREAR CUENTA STRIPE

1. Ve a **https://dashboard.stripe.com/register**
2. Crea tu cuenta con email y password
3. **NO actives** el modo live todavia — todo sera en **Test Mode**
4. En el dashboard, arriba a la derecha veras un toggle **"Test mode"** — asegurate de que esta **ENCENDIDO** (naranja)

---

## 2. OBTENER LAS API KEYS (Test Mode)

### Donde encontrarlas:
1. Dashboard Stripe → **Developers** (menu izquierdo) → **API keys**
2. Veras 2 keys:

| Key | Prefijo | Donde va | Ejemplo |
|-----|---------|----------|---------|
| **Publishable key** | `pk_test_` | App movil (vispapp) | `pk_test_51ABC...xyz` |
| **Secret key** | `sk_test_` | Backend SOLAMENTE | `sk_test_51ABC...xyz` |

### IMPORTANTE:
- La **Secret key** NUNCA va en la app movil. Solo en el backend.
- La **Publishable key** es segura para el frontend/app.

### Valores que necesitas anotar:
```
STRIPE_PUBLISHABLE_KEY=pk_test_XXXXXXXXX
STRIPE_SECRET_KEY=sk_test_XXXXXXXXX
STRIPE_WEBHOOK_SECRET=whsec_XXXXXXXXX  (se obtiene en paso 4)
```

---

## 3. CONFIGURAR STRIPE CONNECT

Stripe Connect es lo que permite pagar a los providers (service providers). VISP usa el modelo **Express**.

### Pasos en el Dashboard:
1. Dashboard → **Connect** (menu izquierdo)
2. Click **"Get started"** o **"Enable Connect"**
3. Te pedira:
   - **Platform type**: Selecciona **"Marketplace"**
   - **Country**: Canada (o USA segun tu caso)
   - **Business type**: Platform/Marketplace
4. En **Connect Settings** → **Branding**:
   - Sube el logo de Tasker
   - Nombre del negocio: "Tasker by VISP"
   - Color de marca: `#4A90E2`
5. En **Connect Settings** → **Account types**:
   - Habilita **Express accounts** (ya esta seleccionado por defecto)
   - Express es el mas simple: Stripe maneja la verificacion de identidad del provider
6. En **Connect Settings** → **Payouts**:
   - **Payout schedule**: Daily (automatico)
   - Moneda: CAD (o USD)

### Que hace Connect:
```
Customer paga $100
  → Stripe cobra $100 al customer
  → VISP se queda con $20 (comision 20% para Level 1)
  → Stripe transfiere $80 a la cuenta Connect del provider
  → Stripe hace payout automatico a la cuenta bancaria del provider
```

---

## 4. CONFIGURAR WEBHOOKS

Los webhooks son notificaciones que Stripe envia a tu backend cuando algo pasa (pago exitoso, fallo, reembolso, etc).

### Opcion A: Para desarrollo local (con Stripe CLI)

1. Instala Stripe CLI:
   ```bash
   # macOS
   brew install stripe/stripe-cli/stripe

   # o descarga de https://stripe.com/docs/stripe-cli
   ```

2. Login:
   ```bash
   stripe login
   ```

3. Escucha eventos y reenvialos a tu backend local:
   ```bash
   stripe listen --forward-to http://localhost:8000/api/v1/payments/webhook
   ```

4. Te dara un **webhook signing secret**:
   ```
   > Ready! Your webhook signing secret is whsec_1234567890abcdef...
   ```
   **COPIA ESTE VALOR** → es tu `STRIPE_WEBHOOK_SECRET`

### Opcion B: Para servidor (staging/produccion)

1. Dashboard → **Developers** → **Webhooks**
2. Click **"Add endpoint"**
3. URL: `https://tu-dominio.com/api/v1/payments/webhook`
4. Selecciona estos eventos:

| Evento | Para que sirve |
|--------|---------------|
| `payment_intent.succeeded` | Pago exitoso → transferir al provider |
| `payment_intent.payment_failed` | Pago fallo → notificar al customer |
| `charge.refunded` | Reembolso procesado → revertir transfer |
| `account.updated` | Provider completo verificacion Connect |
| `transfer.created` | Confirmacion de transfer al provider |
| `payout.paid` | Dinero llego al banco del provider |
| `payout.failed` | Fallo el deposito al provider |
| `customer.subscription.created` | (futuro) Suscripciones |
| `customer.subscription.deleted` | (futuro) Cancelaciones |

5. Click **"Add endpoint"**
6. En la pagina del endpoint, copia el **Signing secret** (`whsec_...`)

---

## 5. CONFIGURAR EL BACKEND

### 5.1 Variables de entorno

Crea o edita el archivo `.env` en `visp-tasker/backend/`:

```env
# ===== STRIPE (TEST MODE) =====
STRIPE_SECRET_KEY=sk_test_TU_SECRET_KEY_AQUI
STRIPE_PUBLISHABLE_KEY=pk_test_TU_PUBLISHABLE_KEY_AQUI
STRIPE_WEBHOOK_SECRET=whsec_TU_WEBHOOK_SECRET_AQUI
```

### 5.2 Verificar que el backend lee estas variables

El archivo `backend/src/core/config.py` ya tiene definidos:
```python
stripe_secret_key: str = ""
stripe_publishable_key: str = ""
stripe_webhook_secret: str = ""
```

### 5.3 Verificar dependencias

En `backend/requirements.txt` debe existir:
```
stripe>=7.0.0
```

Si no esta, agregalo y ejecuta:
```bash
cd visp-tasker/backend
pip install -r requirements.txt
```

### 5.4 Estado actual del backend

| Componente | Estado | Archivo |
|-----------|--------|---------|
| Crear PaymentIntent | LISTO | `src/integrations/stripe/paymentService.py` |
| Confirmar pago | LISTO | `src/integrations/stripe/paymentService.py` |
| Cancelar pago | LISTO | `src/integrations/stripe/paymentService.py` |
| Reembolsar | LISTO | `src/integrations/stripe/paymentService.py` |
| Crear cuenta Connect | LISTO | `src/integrations/stripe/payoutService.py` |
| Link de onboarding | LISTO | `src/integrations/stripe/payoutService.py` |
| Verificar status Connect | LISTO | `src/integrations/stripe/payoutService.py` |
| Webhook: recibir eventos | LISTO | `src/integrations/stripe/webhookHandler.py` |
| **Transfer al provider** | **FALTA** | Webhook no ejecuta `create_transfer()` |
| **Actualizar job al pagar** | **FALTA** | No cambia status del job |
| **Revertir transfer en refund** | **FALTA** | Webhook solo loguea |
| **Notificar pago exitoso** | **FALTA** | No envia push/email |

---

## 6. CONFIGURAR LA APP (vispapp)

### 6.1 Instalar Stripe SDK

```bash
cd visp-tasker/vispapp
npx expo install @stripe/stripe-react-native
```

> **Nota**: `@stripe/stripe-react-native` es compatible con Expo (managed workflow) desde la version 0.35+.

### 6.2 Configurar `app.json`

Agrega el plugin de Stripe en `app.json`:

```json
{
  "expo": {
    "plugins": [
      [
        "@stripe/stripe-react-native",
        {
          "merchantIdentifier": "merchant.com.visp.tasker",
          "enableGooglePay": false
        }
      ]
    ]
  }
}
```

### 6.3 Configurar la Publishable Key

Editar `vispapp/src/services/config.ts`:

```typescript
const ENV = {
  DEV: {
    apiBaseUrl: 'http://localhost:8000/api/v1',
    stripePublishableKey: 'pk_test_TU_PUBLISHABLE_KEY_AQUI',
  },
  STAGING: {
    apiBaseUrl: 'https://staging-api.visp.com/api/v1',
    stripePublishableKey: 'pk_test_TU_PUBLISHABLE_KEY_AQUI',
  },
  PROD: {
    apiBaseUrl: 'https://api.visp.com/api/v1',
    stripePublishableKey: 'pk_live_TU_LIVE_KEY_CUANDO_ESTES_LISTO',
  },
};
```

### 6.4 Inicializar Stripe en App.tsx

Envolver la app con `StripeProvider`:

```tsx
import { StripeProvider } from '@stripe/stripe-react-native';
import { getConfig } from './src/services/config';

export default function App() {
  const config = getConfig();

  return (
    <StripeProvider
      publishableKey={config.stripePublishableKey}
      merchantIdentifier="merchant.com.visp.tasker"
    >
      {/* ...resto de la app (NavigationContainer, etc.) */}
    </StripeProvider>
  );
}
```

### 6.5 Estado actual de la app

| Componente | Estado | Archivo |
|-----------|--------|---------|
| API service (llamadas al backend) | LISTO | `src/services/paymentService.ts` |
| Tipos TypeScript | LISTO | `src/types/index.ts` |
| PaymentMethodsScreen (UI) | PARCIAL | `src/screens/profile/PaymentMethodsScreen.tsx` |
| BookingScreen (logica pago) | PARCIAL | `src/screens/customer/BookingScreen.tsx` |
| TipScreen | PARCIAL | `src/screens/customer/TipScreen.tsx` |
| EarningsScreen | PARCIAL | `src/screens/provider/EarningsScreen.tsx` |
| **Stripe SDK instalado** | **FALTA** | No esta en package.json |
| **StripeProvider en App.tsx** | **FALTA** | No inicializado |
| **CardField para agregar tarjeta** | **FALTA** | Solo hay un Alert placeholder |
| **Confirmar pago con SDK** | **FALTA** | No hay `confirmPayment()` del SDK |
| **Connect onboarding (WebView)** | **FALTA** | No abre link de Stripe |
| **Publishable key configurada** | **FALTA** | String vacio en config.ts |

---

## 7. FLUJO COMPLETO DE PAGO

Asi debe funcionar el flujo end-to-end:

```
┌─────────────────────────────────────────────────────────────┐
│                    FLUJO DE PAGO COMPLETO                    │
└─────────────────────────────────────────────────────────────┘

1. CUSTOMER abre la app y agenda un servicio
   App: BookingScreen → selecciona tarea, fecha, hora

2. BACKEND calcula el precio
   Backend: pricingEngine.py → calcula precio + comision
   Ejemplo: $100 total, 20% comision = $80 provider, $20 VISP

3. CUSTOMER confirma y paga
   App: BookingScreen → llama POST /payments/create-intent
   Backend: Stripe.PaymentIntent.create(amount=10000, currency="cad")
   Backend: Devuelve client_secret al app

4. APP confirma el pago con Stripe SDK
   App: confirmPayment(clientSecret) ← ESTO FALTA
   Stripe SDK: Muestra formulario de tarjeta o usa tarjeta guardada
   Stripe SDK: Maneja 3D Secure si es necesario
   Stripe: Cobra al customer

5. STRIPE notifica al backend via webhook
   Stripe → POST /payments/webhook
   Evento: payment_intent.succeeded
   Backend: webhookHandler.py recibe el evento

6. BACKEND ejecuta la logica de negocio ← ESTO FALTA
   a) Actualiza job.paid_at = now()
   b) Actualiza job status = "PAID"
   c) Calcula comision: $100 * 0.20 = $20
   d) Crea transfer: stripe.Transfer.create(
        amount=8000,  # $80 en cents
        destination=provider.stripe_account_id
      )
   e) Guarda transfer_id en job
   f) Envia notificacion push al customer y provider

7. STRIPE deposita al provider
   Stripe: Automaticamente hace payout diario
   Provider recibe $80 en su cuenta bancaria
   Webhook: payout.paid confirma el deposito

┌─────────────────────────────────────────────────────────────┐
│                 FLUJO DE ONBOARDING PROVIDER                 │
└─────────────────────────────────────────────────────────────┘

1. Provider se registra en la app
2. App llama POST /payments/connect/create
3. Backend crea cuenta Express en Stripe
4. App llama POST /payments/connect/onboard-link
5. Backend devuelve URL de Stripe
6. App abre URL en WebView o browser ← FALTA EN APP
7. Provider completa verificacion de identidad en Stripe
8. Stripe notifica via webhook: account.updated
9. Backend verifica charges_enabled=true, payouts_enabled=true
10. Provider puede recibir pagos
```

---

## 8. CODIGO FALTANTE EN BACKEND

### 8.1 Completar webhook handler para payment_intent.succeeded

**Archivo**: `backend/src/integrations/stripe/webhookHandler.py`

Actualmente el handler solo loguea. Debe:

```python
async def _handle_payment_intent_succeeded(event: stripe.Event, db: AsyncSession) -> str:
    payment_intent = event.data.object
    job_id = payment_intent.metadata.get("job_id")

    if not job_id:
        return "No job_id in metadata"

    # 1. Buscar el job
    job = await db.get(Job, uuid.UUID(job_id))
    if not job:
        return f"Job {job_id} not found"

    # 2. Actualizar job
    job.paid_at = datetime.utcnow()
    job.stripe_payment_intent_id = payment_intent.id
    job.status = "PAID"  # o el enum que uses

    # 3. Obtener provider y su cuenta Connect
    provider = await db.get(ProviderProfile, job.provider_id)
    if not provider or not provider.stripe_account_id:
        return f"Provider not found or no Stripe account"

    # 4. Calcular comision
    commission_amount = job.commission_amount_cents or int(job.final_price_cents * float(job.commission_rate))
    provider_amount = job.final_price_cents - commission_amount

    # 5. Crear transfer al provider
    transfer = stripe.Transfer.create(
        amount=provider_amount,
        currency=job.currency.lower(),
        destination=provider.stripe_account_id,
        transfer_group=f"job_{job_id}",
        metadata={
            "job_id": str(job_id),
            "commission_cents": str(commission_amount),
            "provider_id": str(job.provider_id),
        },
    )

    # 6. Guardar transfer info en job
    job.provider_payout_cents = provider_amount
    job.commission_amount_cents = commission_amount

    # 7. Commit
    await db.commit()

    # 8. Notificar (push notification)
    # await notification_service.send_payment_confirmation(job)

    return f"Transfer {transfer.id} created for job {job_id}"
```

### 8.2 Completar refund handler

```python
async def _handle_charge_refunded(event: stripe.Event, db: AsyncSession) -> str:
    charge = event.data.object
    payment_intent_id = charge.payment_intent

    # Buscar job por payment_intent_id
    job = await db.execute(
        select(Job).where(Job.stripe_payment_intent_id == payment_intent_id)
    )
    job = job.scalar_one_or_none()
    if not job:
        return "Job not found for refund"

    # Revertir transfer (crear transfer reversal)
    if job.provider_payout_cents and job.provider_id:
        provider = await db.get(ProviderProfile, job.provider_id)
        if provider and provider.stripe_account_id:
            # Buscar el transfer original
            transfers = stripe.Transfer.list(
                transfer_group=f"job_{job.id}",
                limit=1,
            )
            if transfers.data:
                stripe.Transfer.create_reversal(
                    transfers.data[0].id,
                    amount=job.provider_payout_cents,
                )

    job.status = "REFUNDED"
    await db.commit()
    return f"Refund processed for job {job.id}"
```

### 8.3 Asegurar metadata en PaymentIntent

**Archivo**: `backend/src/integrations/stripe/paymentService.py`

Verificar que al crear el PaymentIntent se incluya el `job_id` en metadata:

```python
intent = stripe.PaymentIntent.create(
    amount=amount_cents,
    currency=currency,
    metadata={
        "job_id": str(job_id),       # CRITICO: sin esto el webhook no sabe que job es
        "customer_id": str(customer_id),
    },
    customer=customer_stripe_id,     # Si existe
)
```

### 8.4 Endpoint para obtener publishable key

Agregar un endpoint para que la app obtenga la key de forma segura:

```python
# En backend/src/api/routes/payments.py
@router.get("/config")
async def get_stripe_config():
    return {"publishable_key": settings.stripe_publishable_key}
```

---

## 9. CODIGO FALTANTE EN VISPAPP

### 9.1 Instalar dependencia

```bash
cd visp-tasker/vispapp
npx expo install @stripe/stripe-react-native
```

### 9.2 Agregar StripeProvider en App.tsx

```tsx
import { StripeProvider } from '@stripe/stripe-react-native';

// Dentro del return de App:
<StripeProvider
  publishableKey="pk_test_TU_KEY"
  merchantIdentifier="merchant.com.visp.tasker"
>
  <NavigationContainer>
    {/* ... tu app */}
  </NavigationContainer>
</StripeProvider>
```

### 9.3 Agregar tarjeta de pago (PaymentMethodsScreen)

Reemplazar el Alert placeholder con CardField real:

```tsx
import { CardField, useStripe } from '@stripe/stripe-react-native';

function AddCardModal() {
  const { createPaymentMethod } = useStripe();
  const [cardComplete, setCardComplete] = useState(false);

  const handleAddCard = async () => {
    // 1. Pedir setup intent al backend
    const { client_secret } = await paymentService.ensureStripeCustomer();

    // 2. Crear payment method con la tarjeta ingresada
    const { paymentMethod, error } = await createPaymentMethod({
      paymentMethodType: 'Card',
    });

    if (error) {
      Alert.alert('Error', error.message);
      return;
    }

    // 3. Adjuntar al customer en el backend
    await paymentService.attachPaymentMethod(
      user.stripeCustomerId,
      paymentMethod.id
    );

    Alert.alert('Exito', 'Tarjeta agregada correctamente');
  };

  return (
    <View>
      <CardField
        postalCodeEnabled={false}
        placeholders={{ number: '4242 4242 4242 4242' }}
        cardStyle={{
          backgroundColor: '#1A1A2E',
          textColor: '#FFFFFF',
          borderColor: '#4A90E2',
          borderWidth: 1,
          borderRadius: 8,
        }}
        style={{ width: '100%', height: 50, marginVertical: 20 }}
        onCardChange={(details) => setCardComplete(details.complete)}
      />
      <TouchableOpacity
        onPress={handleAddCard}
        disabled={!cardComplete}
      >
        <Text>Guardar Tarjeta</Text>
      </TouchableOpacity>
    </View>
  );
}
```

### 9.4 Confirmar pago en BookingScreen

```tsx
import { useStripe } from '@stripe/stripe-react-native';

// Dentro del componente:
const { confirmPayment } = useStripe();

const handlePayment = async (jobId: string, amountCents: number) => {
  try {
    // 1. Crear PaymentIntent en el backend
    const { client_secret, payment_intent_id } =
      await paymentService.createPaymentIntent(amountCents, 'cad', {
        job_id: jobId,
      });

    // 2. Confirmar con Stripe SDK (muestra 3D Secure si necesario)
    const { error, paymentIntent } = await confirmPayment(client_secret, {
      paymentMethodType: 'Card',
      // Si el customer ya tiene tarjeta guardada:
      // paymentMethodData: { paymentMethodId: savedCardId }
    });

    if (error) {
      Alert.alert('Pago fallido', error.message);
      return;
    }

    if (paymentIntent.status === 'Succeeded') {
      Alert.alert('Pago exitoso', 'Tu servicio ha sido confirmado');
      // Navegar a pantalla de confirmacion
    }
  } catch (err) {
    Alert.alert('Error', 'No se pudo procesar el pago');
  }
};
```

### 9.5 Onboarding de Provider (Connect)

```tsx
import { Linking } from 'react-native';

const handleConnectOnboarding = async () => {
  try {
    // 1. Crear cuenta Connect si no existe
    let accountId = providerProfile.stripeAccountId;
    if (!accountId) {
      const account = await paymentService.createConnectAccount(providerId);
      accountId = account.account_id;
    }

    // 2. Obtener link de onboarding
    const { url } = await paymentService.getOnboardingLink(
      accountId,
      'tasker://connect/return',    // Deep link de retorno
      'tasker://connect/refresh',   // Deep link si expira
    );

    // 3. Abrir en browser
    await Linking.openURL(url);
  } catch (err) {
    Alert.alert('Error', 'No se pudo iniciar la verificacion');
  }
};
```

---

## 10. PROBAR PAGOS CON TARJETAS DE PRUEBA

### Tarjetas de prueba de Stripe:

| Numero | Resultado | Usar para |
|--------|-----------|-----------|
| `4242 4242 4242 4242` | Pago exitoso | Happy path |
| `4000 0025 0000 3155` | Requiere 3D Secure | Probar autenticacion |
| `4000 0000 0000 9995` | Pago rechazado | Probar errores |
| `4000 0000 0000 0077` | Pago exitoso, luego disputa | Probar chargebacks |
| `4000 0000 0000 3220` | 3D Secure 2 | Probar SCA |

Para TODAS las tarjetas de prueba:
- **Fecha de expiracion**: Cualquier fecha futura (ej: `12/34`)
- **CVC**: Cualquier 3 digitos (ej: `123`)
- **ZIP/Postal**: Cualquier valor (ej: `12345`)

### Probar con Stripe CLI:

```bash
# Disparar un evento manualmente para probar webhooks
stripe trigger payment_intent.succeeded

# Ver eventos en tiempo real
stripe events list --limit 5

# Ver logs de webhook
stripe logs tail
```

### Probar cuenta Connect de provider:

En test mode, Stripe te deja completar onboarding con datos falsos:
- Nombre: `Test Provider`
- SSN: `000-00-0000` (o cualquier dato)
- Cuenta bancaria de prueba: `000123456789` routing `110000000`

---

## 11. CHECKLIST FINAL

### En Stripe Dashboard:
- [ ] Cuenta creada en stripe.com
- [ ] Test mode activado (toggle naranja arriba a la derecha)
- [ ] Copiar `pk_test_...` (Publishable key)
- [ ] Copiar `sk_test_...` (Secret key)
- [ ] Connect habilitado (tipo Express)
- [ ] Branding configurado (logo, nombre, color)
- [ ] Webhook endpoint creado con los eventos listados
- [ ] Copiar `whsec_...` (Webhook signing secret)

### En el Backend:
- [ ] `.env` tiene `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`
- [ ] `stripe>=7.0.0` en requirements.txt
- [ ] `pip install -r requirements.txt` ejecutado
- [ ] Webhook handler completo (ejecuta transfer al provider)
- [ ] PaymentIntent incluye `job_id` en metadata
- [ ] Endpoint `/payments/config` devuelve publishable key
- [ ] Refund handler revierte transfers

### En la App (vispapp):
- [ ] `@stripe/stripe-react-native` instalado
- [ ] Plugin agregado en `app.json`
- [ ] `StripeProvider` envuelve la app en `App.tsx`
- [ ] `stripePublishableKey` configurado en `config.ts`
- [ ] `CardField` implementado en PaymentMethodsScreen
- [ ] `confirmPayment()` implementado en BookingScreen
- [ ] Connect onboarding abre URL de Stripe
- [ ] Deep links configurados para retorno de Connect

### Pruebas:
- [ ] Customer puede agregar tarjeta (4242...)
- [ ] Customer puede pagar un servicio
- [ ] Webhook recibe `payment_intent.succeeded`
- [ ] Backend crea transfer al provider
- [ ] Provider completa onboarding de Connect
- [ ] Provider ve sus earnings en la app
- [ ] Refund funciona y revierte transfer
- [ ] 3D Secure funciona con tarjeta de prueba

---

## RESUMEN RAPIDO

| Que | Donde | Valor |
|-----|-------|-------|
| Secret Key | Backend `.env` | `sk_test_...` |
| Publishable Key | App `config.ts` + Backend `.env` | `pk_test_...` |
| Webhook Secret | Backend `.env` | `whsec_...` |
| Stripe SDK | App `package.json` | `@stripe/stripe-react-native` |
| Connect tipo | Dashboard Stripe | Express |
| Moneda | Backend config | `CAD` |
| API Version | Backend `paymentService.py` | `2024-06-20` |

### Lo que YA funciona (no tocar):
- Backend: crear/confirmar/cancelar PaymentIntents
- Backend: crear cuentas Connect, links de onboarding
- Backend: webhook infrastructure (recibir y verificar eventos)
- App: paymentService.ts (todas las llamadas API)
- App: tipos TypeScript completos
- App: pantallas de UI (parciales)

### Lo que FALTA implementar:
1. **Backend**: Webhook ejecute `create_transfer()` cuando pago exitoso
2. **Backend**: Webhook revierta transfer en refund
3. **App**: Instalar `@stripe/stripe-react-native`
4. **App**: `StripeProvider` en App.tsx
5. **App**: `CardField` para capturar tarjetas
6. **App**: `confirmPayment()` con el client_secret
7. **App**: Abrir URL de Connect onboarding para providers
8. **App**: `stripePublishableKey` en config.ts

---

> **Siguiente paso**: Crea tu cuenta en Stripe, copia las keys, y dime cuando estes listo para implementar el codigo faltante.
