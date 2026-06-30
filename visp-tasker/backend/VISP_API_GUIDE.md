# VISP API - Guía Completa de Testing

## 📋 Resumen del Backend

El backend FastAPI de VISP expone **~60 endpoints** organizados en **14 módulos** bajo el prefijo `/api/v1`.

---

## 🔧 Configuración del Entorno

### 1. Actualizar `.env` con tus credenciales

```env
# -- Database (PostgreSQL) --
DATABASE_URL=postgresql+asyncpg://Droz:Droz.2026@192.168.1.94:5432/visp_tasker
SQL_ECHO=false

# -- Redis --
REDIS_URL=redis://192.168.1.94:6379/0

# -- Auth / JWT --
JWT_SECRET=visp-dev-secret-change-me-in-production

# -- Application --
DEBUG=true

# -- Stripe (test mode) --
# -- Stripe (test mode) --
STRIPE_SECRET_KEY=sk_test_placeholder_key_for_documentation
STRIPE_PUBLISHABLE_KEY=pk_test_placeholder_key_for_documentation
STRIPE_WEBHOOK_SECRET=whsec_placeholder

# -- Google Maps --
GOOGLE_MAPS_API_KEY=placeholder

# -- Firebase Cloud Messaging --
FIREBASE_CREDENTIALS_JSON={"apiKey":"placeholder","authDomain":"projectId.firebaseapp.com","projectId":"projectId","storageBucket":"projectId.firebasestorage.app","messagingSenderId":"123456789","appId":"1:123456789:web:placeholder"}


# -- WebSocket --
WS_CORS_ALLOWED_ORIGINS=*
```

### 2. Iniciar el servidor

```bash
cd /home/richie/ssd/VISP/visp-tasker/backend
uvicorn src.main:app --host 0.0.0.0 --port 8000 --reload
```

### 3. Acceder a la documentación automática

- **Swagger UI**: http://192.168.1.94:8000/docs
- **ReDoc**: http://192.168.1.94:8000/redoc
- **OpenAPI JSON**: http://192.168.1.94:8000/openapi.json

---

## 🔐 Authentication (`/api/v1/auth`)

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| POST | `/auth/register` | Registrar nuevo usuario |
| POST | `/auth/login` | Iniciar sesión |
| POST | `/auth/refresh` | Renovar token JWT |
| GET | `/auth/me` | Obtener perfil actual (requiere token) |
| POST | `/auth/logout` | Cerrar sesión |
| POST | `/auth/forgot-password` | Iniciar reset de contraseña |

### Ejemplos de prueba:

```bash
# 1. Registrar usuario
curl -X POST http://192.168.1.94:8000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "SecurePass123!",
    "role": "customer"
  }'

# 2. Login
curl -X POST http://192.168.1.94:8000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "SecurePass123!"
  }'
# Respuesta incluye: access_token, refresh_token

# 3. Obtener perfil (usa el access_token del paso anterior)
curl -X GET http://192.168.1.94:8000/api/v1/auth/me \
  -H "Authorization: Bearer <ACCESS_TOKEN>"

# 4. Refresh token
curl -X POST http://192.168.1.94:8000/api/v1/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{"refresh_token": "<REFRESH_TOKEN>"}'
```

---

## 📂 Categories (`/api/v1/categories`)

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/categories` | Lista paginada de categorías |
| GET | `/categories/{category_id}/tasks` | Tareas de una categoría |

```bash
# Listar categorías
curl "http://192.168.1.94:8000/api/v1/categories?page=1&page_size=20"

# Tareas de una categoría (reemplaza UUID)
curl "http://192.168.1.94:8000/api/v1/categories/<CATEGORY_UUID>/tasks?level=1"
```

---

## 📋 Tasks (`/api/v1/tasks`)

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/tasks/search` | Buscar tareas por keyword |
| GET | `/tasks/{task_id}` | Detalle de una tarea |

```bash
# Buscar tareas
curl "http://192.168.1.94:8000/api/v1/tasks/search?q=cleaning&page=1"

# Detalle de tarea
curl "http://192.168.1.94:8000/api/v1/tasks/<TASK_UUID>"
```

---

## 💼 Jobs (`/api/v1/jobs`)

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| POST | `/jobs` | Crear job (interno) |
| POST | `/jobs/book` | Reservar job (mobile) |
| GET | `/jobs/active` | Jobs activos del usuario |
| GET | `/jobs/customer/{customer_id}` | Jobs por cliente |
| GET | `/jobs/provider/{provider_id}` | Jobs por proveedor |
| GET | `/jobs/{job_id}` | Detalle del job |
| PATCH | `/jobs/{job_id}/status` | Actualizar estado (interno) |
| POST | `/jobs/{job_id}/cancel` | Cancelar job |
| PATCH | `/jobs/{job_id}/update-status` | Actualizar estado (mobile) |
| GET | `/jobs/{job_id}/tracking` | Tracking en tiempo real |

```bash
# Crear job (requiere auth)
curl -X POST http://192.168.1.94:8000/api/v1/jobs/book \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "task_id": "<TASK_UUID>",
    "scheduled_at": "2026-02-15T10:00:00Z",
    "address": {
      "street": "123 Main St",
      "city": "Toronto",
      "province": "ON",
      "postal_code": "M5V 1A1",
      "country": "CA",
      "latitude": 43.6532,
      "longitude": -79.3832
    },
    "notes": "Please bring supplies"
  }'

# Jobs activos
curl -X GET http://192.168.1.94:8000/api/v1/jobs/active \
  -H "Authorization: Bearer <ACCESS_TOKEN>"

# Detalle job
curl "http://192.168.1.94:8000/api/v1/jobs/<JOB_UUID>"

# Cancelar job
curl -X POST http://192.168.1.94:8000/api/v1/jobs/<JOB_UUID>/cancel \
  -H "Content-Type: application/json" \
  -d '{"reason": "Changed plans"}'
```

---

## 👷 Providers (`/api/v1/provider`)

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/provider/dashboard` | Dashboard del proveedor |
| GET | `/provider/offers` | Ofertas de trabajo |
| POST | `/provider/offers/{job_id}/accept` | Aceptar oferta |
| POST | `/provider/offers/{job_id}/reject` | Rechazar oferta |
| PATCH | `/provider/status` | Actualizar estado |
| GET | `/provider/earnings` | Ganancias |
| GET | `/provider/schedule` | Agenda |
| GET | `/provider/credentials` | Credenciales |

```bash
# Dashboard (requiere auth de proveedor)
curl -X GET http://192.168.1.94:8000/api/v1/provider/dashboard \
  -H "Authorization: Bearer <PROVIDER_TOKEN>"

# Ganancias
curl "http://192.168.1.94:8000/api/v1/provider/earnings?period=week" \
  -H "Authorization: Bearer <PROVIDER_TOKEN>"

# Aceptar oferta
curl -X POST http://192.168.1.94:8000/api/v1/provider/offers/<JOB_UUID>/accept \
  -H "Authorization: Bearer <PROVIDER_TOKEN>"
```

---

## 🎯 Matching (`/api/v1/matching`)

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| POST | `/matching/find` | Buscar proveedores para job |
| POST | `/matching/assign` | Asignar proveedor |
| POST | `/matching/reassign` | Reasignar proveedor |

```bash
# Buscar matching
curl -X POST http://192.168.1.94:8000/api/v1/matching/find \
  -H "Content-Type: application/json" \
  -d '{
    "job_id": "<JOB_UUID>",
    "radius_km": 25,
    "max_results": 10
  }'

# Asignar
curl -X POST http://192.168.1.94:8000/api/v1/matching/assign \
  -H "Content-Type: application/json" \
  -d '{
    "job_id": "<JOB_UUID>",
    "provider_id": "<PROVIDER_UUID>",
    "match_score": 0.95
  }'
```

---

## 💳 Payments (`/api/v1/payments`)

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| POST | `/payments/create-intent` | Crear PaymentIntent |
| POST | `/payments/confirm/{id}` | Confirmar pago |
| POST | `/payments/cancel/{id}` | Cancelar pago |
| POST | `/payments/refund/{id}` | Reembolsar |
| GET | `/payments/methods/{customer_id}` | Métodos de pago |
| POST | `/payments/methods/attach` | Agregar método |
| POST | `/payments/webhook` | Webhook de Stripe |
| POST | `/payments/connect/create` | Crear cuenta Connect |
| POST | `/payments/connect/onboard-link` | Link de onboarding |
| GET | `/payments/connect/status/{id}` | Estado de cuenta |
| GET | `/payments/balance/{id}` | Balance |
| GET | `/payments/payouts/{id}` | Lista de payouts |

```bash
# Crear payment intent
curl -X POST http://192.168.1.94:8000/api/v1/payments/create-intent \
  -H "Content-Type: application/json" \
  -d '{
    "job_id": "<JOB_UUID>",
    "amount_cents": 5000,
    "currency": "cad",
    "customer_id": "cus_xxxxx"
  }'

# Listar métodos de pago
curl "http://192.168.1.94:8000/api/v1/payments/methods/cus_xxxxx"

# Crear cuenta Connect para proveedor
curl -X POST http://192.168.1.94:8000/api/v1/payments/connect/create \
  -H "Content-Type: application/json" \
  -d '{
    "email": "provider@example.com",
    "country": "CA"
  }'
```

---

## 💬 Chat (`/api/v1/jobs/{job_id}/messages`)

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/jobs/{job_id}/messages` | Historial de chat |
| POST | `/jobs/{job_id}/messages` | Enviar mensaje |
| PATCH | `/jobs/{job_id}/messages/read` | Marcar como leído |
| GET | `/jobs/{job_id}/messages/unread-count` | Contador de no leídos |

```bash
# Historial
curl "http://192.168.1.94:8000/api/v1/jobs/<JOB_UUID>/messages?page=1" \
  -H "Authorization: Bearer <ACCESS_TOKEN>"

# Enviar mensaje
curl -X POST http://192.168.1.94:8000/api/v1/jobs/<JOB_UUID>/messages \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"content": "Hello, I am on my way!"}'
```

---

## 🔔 Notifications (`/api/v1/notifications`)

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| POST | `/notifications/register-device` | Registrar dispositivo FCM |
| DELETE | `/notifications/unregister-device` | Desregistrar dispositivo |
| GET | `/notifications/history/{user_id}` | Historial |
| PATCH | `/notifications/read/{notification_id}` | Marcar como leída |
| PATCH | `/notifications/read-all/{user_id}` | Marcar todas como leídas |
| GET | `/notifications/unread-count/{user_id}` | Contador no leídas |
| POST | `/notifications/preferences/{user_id}` | Actualizar preferencias |
| GET | `/notifications/preferences/{user_id}` | Obtener preferencias |

```bash
# Registrar dispositivo para push
curl -X POST http://192.168.1.94:8000/api/v1/notifications/register-device \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "<USER_UUID>",
    "device_token": "<FCM_TOKEN>",
    "platform": "android"
  }'

# Historial
curl "http://192.168.1.94:8000/api/v1/notifications/history/<USER_UUID>?unread_only=true"
```

---

## ✅ Verification (`/api/v1/verification`)

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| POST | `/verification/background-check` | Enviar background check |
| POST | `/verification/license` | Enviar licencia |
| POST | `/verification/insurance` | Enviar seguro |
| GET | `/verification/provider/{id}/status` | Estado de verificación |
| POST | `/verification/admin/approve/{id}` | Admin aprueba |
| POST | `/verification/admin/reject/{id}` | Admin rechaza |

```bash
# Estado de verificación de proveedor
curl "http://192.168.1.94:8000/api/v1/verification/provider/<PROVIDER_UUID>/status"

# Enviar licencia
curl -X POST http://192.168.1.94:8000/api/v1/verification/license \
  -H "Content-Type: application/json" \
  -d '{
    "provider_id": "<PROVIDER_UUID>",
    "license_number": "LIC123456",
    "license_type": "electrician",
    "issuing_authority": "Province of Ontario",
    "expiry_date": "2027-12-31"
  }'
```

---

## 💰 Pricing (`/api/v1/pricing`)

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/pricing/estimate` | Estimación de precio |
| GET | `/pricing/breakdown/{job_id}` | Desglose de precio |

```bash
# Estimación
curl "http://192.168.1.94:8000/api/v1/pricing/estimate?task_id=<TASK_UUID>&latitude=43.65&longitude=-79.38&is_emergency=false"

# Desglose de un job
curl "http://192.168.1.94:8000/api/v1/pricing/breakdown/<JOB_UUID>"
```

---

## ⭐ Scoring (`/api/v1/scoring`)

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/scoring/provider/{id}` | Score del proveedor |
| POST | `/scoring/adjust` | Ajustar score (admin) |

```bash
# Ver score
curl "http://192.168.1.94:8000/api/v1/scoring/provider/<PROVIDER_UUID>"

# Ajuste manual (admin)
curl -X POST http://192.168.1.94:8000/api/v1/scoring/adjust \
  -H "Content-Type: application/json" \
  -d '{
    "provider_id": "<PROVIDER_UUID>",
    "adjustment": 10,
    "admin_user_id": "<ADMIN_UUID>",
    "reason": "Bonus for excellent feedback"
  }'
```

---

## 📜 Consents (`/api/v1/consents`)

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| POST | `/consents/record` | Registrar consentimiento |
| GET | `/consents/user/{user_id}` | Lista de consentimientos |
| GET | `/consents/check/{user_id}/{type}` | Verificar consentimiento |

```bash
# Registrar consentimiento
curl -X POST http://192.168.1.94:8000/api/v1/consents/record \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "<USER_UUID>",
    "consent_type": "terms_of_service",
    "consent_text": "I agree to the Terms of Service v2.0",
    "granted": true
  }'

# Verificar
curl "http://192.168.1.94:8000/api/v1/consents/check/<USER_UUID>/terms_of_service"
```

---

## 🚨 Escalations (`/api/v1/escalations`)

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/escalations/pending` | Escalaciones pendientes |
| POST | `/escalations/check` | Verificar texto por keywords |
| POST | `/escalations/approve/{id}` | Aprobar escalación |
| POST | `/escalations/reject/{id}` | Rechazar escalación |

```bash
# Escalaciones pendientes
curl "http://192.168.1.94:8000/api/v1/escalations/pending?limit=20"

# Verificar texto
curl -X POST http://192.168.1.94:8000/api/v1/escalations/check \
  -H "Content-Type: application/json" \
  -d '{
    "job_id": "<JOB_UUID>",
    "text_to_check": "There is a gas leak emergency!"
  }'
```

---

## 🏥 Health Check

```bash
curl http://192.168.1.94:8000/health
# Respuesta: {"status": "ok", "version": "0.1.0"}
```

---

## 🌍 Geolocation (`/api/v1/geo`)

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| POST | `/geo/geocode` | Dirección → Coordenadas |
| POST | `/geo/reverse` | Coordenadas → Dirección |
| POST | `/geo/directions` | Ruta y polilínea |
| POST | `/geo/distance` | Distancia y estimación de tiempo |
| GET | `/geo/track/{job_id}` | Tracking en tiempo real |
| GET | `/geo/track/{job_id}/history` | Historial de ubicación |

```bash
# Geocodificación (Forward)
curl -X POST http://192.168.1.94:8000/api/v1/geo/geocode \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "address": "123 Main St",
    "city": "Toronto",
    "province": "ON",
    "postal": "M5V 1A1",
    "country": "CA"
  }'

# Geocodificación Inversa (Reverse)
curl -X POST http://192.168.1.94:8000/api/v1/geo/reverse \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "lat": 43.6532,
    "lng": -79.3832
  }'

# Distancia y Tiempo
curl -X POST http://192.168.1.94:8000/api/v1/geo/distance \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "origin_lat": 43.6532,
    "origin_lng": -79.3832,
    "dest_lat": 45.4215,
    "dest_lng": -75.6972
  }'
```

---

## 🔌 WebSocket (Socket.IO)

El servidor monta Socket.IO en `/ws` para comunicación en tiempo real:

```javascript
// Cliente JavaScript
import { io } from "socket.io-client";

const socket = io("http://192.168.1.94:8000", {
  path: "/ws/socket.io",
  auth: { token: "<ACCESS_TOKEN>" }
});

socket.on("connect", () => console.log("Connected"));
socket.on("job_update", (data) => console.log("Job update:", data));
socket.on("new_message", (data) => console.log("New chat message:", data));
```

---

## 📝 Notas Importantes

1. **Base de datos**: Asegúrate que PostgreSQL está corriendo en `192.168.1.94:5432` con la BD `visp_tasker`
2. **Redis**: Necesario para WebSockets y caching - debe estar en `192.168.1.94:6379`
3. **Migraciones**: Ejecuta las migraciones antes de iniciar:
   ```bash
   cd backend
   alembic upgrade head
   ```
4. **Seeds**: Para datos de prueba:
   ```bash
   python -m seeds.run_all
   ```

## 🎯 Flujo de Prueba Recomendado

1. ✅ Verificar health check
2. ✅ Registrar usuario customer
3. ✅ Login y obtener tokens
4. ✅ Listar categorías
5. ✅ Buscar tareas
6. ✅ Crear un job
7. ✅ Ejecutar matching
8. ✅ Crear payment intent
9. ✅ Probar chat
