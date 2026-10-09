# Android — plan para sacar VISP en Google Play

Escrito el 2026-10-09 mientras Apple revisa la 1.0 (build 35). Todavía no hay código.

## 1. Punto de partida

La app es **Expo SDK 55 + React Native 0.83** (nueva arquitectura y Hermes),
así que casi todo el código JS sirve tal cual. El trabajo está en la parte
nativa, en la configuración y en Google Play.

### Lo que ya hay en el Mac

| Herramienta | Estado |
|---|---|
| Android Studio | ✅ instalado (trae su propio JDK 21) |
| Android SDK | ✅ `~/Library/Android/sdk`: platform 36, build-tools 36.0/36.1 |
| NDK | ✅ 27.1.12297006, el que pide RN 0.83 |
| CMake | ❌ **falta**. Lo necesitan reanimated y la nueva arquitectura |
| `ANDROID_HOME` / `adb` en el PATH | ❌ sin definir (adb solo funciona con la ruta completa) |
| JDK | ✅ 17 en el PATH, el recomendado para RN 0.83 |
| Emulador | ✅ AVD `Pixel_9` |
| Teléfono Android físico | ❌ hace falta uno para probar cámara, GPS y Stripe de verdad |
| Disco | ✅ 251 GB libres en MachintoshHD |

### La carpeta `android/`

- Existe, pero es de **marzo de 2026**, anterior a casi todo el trabajo. Paquete
  `com.visp.tasker`, `versionCode 1` y firmada con la clave de debug. **No sirve:
  hay que regenerarla.**
- Está en `.gitignore`. **`ios/` tampoco está en git**: el número de build, la
  firma, `ITSAppUsesNonExemptEncryption`, los iconos y el sandboxing solo viven
  en este Mac. Ver la decisión D4.

## 2. Componentes nativos y qué pide cada uno en Android

| Librería | Uso en VISP | Qué hace falta en Android |
|---|---|---|
| `@rnmapbox/maps` 10.2 | Mapa del trabajo activo y de emergencias | **Token secreto de descargas de Mapbox** (`sk.…` con el scope `DOWNLOADS:READ`) en `~/.gradle/gradle.properties` como `MAPBOX_DOWNLOADS_TOKEN`. El repositorio Maven de Mapbox lo exige en Android. En iOS no hacía falta. |
| `expo-location` | Centrar el mapa y la llegada del proveedor | Permisos de ubicación *fine* y *coarse*. **Quitar `ACCESS_BACKGROUND_LOCATION`**: la app no la usa, y Google exige un formulario y un vídeo para justificarla, que se suelen rechazar. |
| `expo-image-picker` | Fotos de evidencia, avatar y documentos | Cámara y `READ_MEDIA_IMAGES`. **Quitar `RECORD_AUDIO`** porque no se graba vídeo, y `READ_EXTERNAL_STORAGE`, que está obsoleto en Android 13+. |
| `expo-notifications` | Notificaciones push | `google-services.json` (proyecto de Firebase con la app Android) y canal de notificación. Ver §4: **hoy las push no funcionan en ninguna plataforma**. |
| `@stripe/stripe-react-native` 0.65 | Guardar tarjeta (`CardForm` + `confirmSetupIntent`) | Funciona en Android. Hay que dejar `enableGooglePay: false` (ya está así) y probar el `CardForm` con el teclado. |
| `@stripe/stripe-identity-react-native` 0.8 | **Ninguno**: está instalado pero no se importa en ningún sitio. La verificación va por navegador (`IdentityDocStep`). | **Desinstalarlo.** En Android exige un tema `MaterialComponents` y añade peso, y es un fallo de compilación esperando a pasar. |
| `expo-secure-store` | Sesión (tokens) | Usa Android Keystore. Nada que hacer. |
| `react-native-svg` | Iconos y la **firma dibujada** del contrato | Funciona. Probar que el trazo de `SignaturePad` responde bien al dedo en Android. |
| `react-native-webview` | Contenido web | Nada especial. |
| `expo-web-browser` | Stripe Connect y documentos | Usa Custom Tabs de Chrome. Comprobar que la vuelta a la app funciona. |
| `reanimated` 4, `gesture-handler`, `screens` | Animaciones y navegación | Necesitan CMake. Nada más. |
| `socket.io-client`, `axios`, `zustand`, `i18n-js` | JS puro | Nada. |
| `firebase` (JS) | Ninguno (no se importa) | Se puede quitar. |

## 3. Código que hay que revisar para Android

1. **Teclado (lo más importante).** Android 15+ con `edgeToEdgeEnabled=true`
   hace que `adjustResize` deje de empujar el contenido. Varias pantallas ponen
   `behavior={Platform.OS === 'ios' ? 'padding' : undefined}`: en Android **el
   teclado taparía los campos**, el mismo fallo que tuvimos en Borrar cuenta.
   Hay que revisar login, registro, chat, borrar cuenta, los formularios de
   denunciar y de cancelar, `GlassInput` y el pago. Lo más robusto es
   `react-native-keyboard-controller`.
2. **`ActionSheetIOS`** (7 archivos). Todos tienen el `Alert.alert` de reserva
   para Android, pero el diálogo de Android muestra como mucho 3 botones: la
   bolsa de trabajos del proveedor puede ofrecer 4 opciones (descripción,
   fotos, persona, bloquear) y **se perdería una**. Hace falta una hoja de
   opciones propia.
3. **`Platform.OS`** aparece 36 veces. Hay que revisarlas una a una (sombras,
   tamaños de fuente, autofill).
4. **Botón "atrás" del sistema.** Los `Modal` ya tienen `onRequestClose`. Hay
   que comprobar que no se puede volver atrás a mitad del pago o de la firma.
5. **Barra de estado y zonas seguras** con edge-to-edge: comprobar las
   cabeceras y la barra de pestañas.
6. **Enlaces:** `tel:`, `mailto:` y los PDF de comprobantes funcionan igual. El
   esquema `visptasker://` lo declara prebuild a partir de `app.json`.

## 4. Las notificaciones push no funcionan hoy, tampoco en iOS

- La tabla `device_tokens` está **vacía en visp_prod**: ningún teléfono se ha
  registrado nunca.
- **Causa:** `notificationService.ts` llama a `getExpoPushTokenAsync()` sin
  `projectId`, y `app.json` no tiene `extra.eas.projectId`. En una app
  instalada desde TestFlight esa llamada falla, se queda en un
  `console.warn` y nunca se llama a `/notifications/register-device`.
- **Además, la app y el backend no hablan el mismo idioma:** aunque llegara un
  token de Expo (`ExponentPushToken[…]`), el backend envía con Firebase Admin
  (FCM), que no sabe entregar tokens de Expo.

**Decisión D3:**
- (a) *(recomendada)* **Expo Push Service.** El backend hace un POST a
  `exp.host` con los tokens de Expo. Hace falta crear un proyecto EAS gratuito
  para el `projectId`, subir a Expo la clave APNs (iOS) y la cuenta de servicio
  de FCM (Android). Un solo camino para las dos plataformas.
- (b) Tokens nativos (`getDevicePushTokenAsync`) y que el backend envíe a FCM
  para Android y a APNs para iOS. Exige la clave APNs en Firebase y es más
  trabajo en el backend.

Es un arreglo que **también necesita iOS**. Conviene hacerlo antes que Android
y sacarlo en un build 36 de iOS.

## 5. Google Play: lo que no es código

- **Cuenta de Google Play Console** (pago único de 25 USD). **Clave:** si es
  una cuenta **personal** creada después de noviembre de 2023, Google exige una
  **prueba cerrada con al menos 12 testers durante 14 días** antes de poder
  publicar. Una cuenta de **organización** (con D-U-N-S de DROZ TECHNOLOGIES,
  INC.) no tiene esa regla. Ver D2.
- **Firma.** Una *upload key* propia (un keystore que se guarda fuera del repo,
  con copia de seguridad) y **Play App Signing** activado. Si se pierde la
  upload key, Google permite cambiarla, pero lleva días.
- **Formato:** AAB (`./gradlew bundleRelease`), no APK. `targetSdk 36`.
- **Data safety**: el equivalente a la App Privacy de Apple. Se rellena con la
  misma tabla de `app-store-submission.md` §3.
- **Borrar cuenta.** Google exige, además del botón en la app que ya tenemos,
  **una URL web** donde se pueda pedir el borrado sin tener la app instalada.
  Hace falta una página en `visp.richieyanez.com`, por ejemplo
  `/delete-account`.
- **Clasificación de contenido** (cuestionario IARC), público objetivo 18+,
  política de privacidad, categoría, capturas de teléfono y gráfico de 1024×500.
- **Países:** solo Canadá, como en iOS.

## 6. Decisiones que necesito de Ricardo

- **D1 — Nombre del paquete.** Hoy es `com.visp.tasker`, y en iOS es
  `com.droz.vispapp`. **No se puede cambiar después de la primera subida a
  Play.** Recomiendo `com.droz.vispapp`, el mismo que iOS, por coherencia con
  Stripe, Firebase y Mapbox.
- **D2 — Cuenta de Play Console:** de organización (recomendada: sin la regla
  de 12 testers y 14 días, aparece "DROZ TECHNOLOGIES, INC." como
  desarrollador y hace falta el D-U-N-S) o personal.
- **D3 — Push:** Expo Push Service (recomendado) o FCM/APNs directo (§4).
- **D4 — Guardar `ios/` y `android/` en git.** Hoy no lo están, y todo lo que
  la memoria lista como "customizaciones que borra prebuild" vive solo en este
  Mac. Recomiendo que entren en git (sin secretos), o mover esas
  customizaciones a `app.json` y plugins de Expo para que prebuild las
  regenere solo.
- **D5 — Teléfono Android físico** para las pruebas. El emulador no sirve para
  cámara, GPS ni el flujo de Stripe.

## 7. Orden de trabajo

**Fase 0 — Decisiones D1 a D5** y alta en Play Console. El alta de una cuenta de
organización puede tardar días, así que conviene empezarla ya.

**Fase 1 — Entorno** (unos 30 min, lo hago yo por terminal):
- definir `ANDROID_HOME` y añadir `platform-tools` y `emulator` al PATH;
- instalar CMake con `sdkmanager` y aceptar las licencias;
- `JAVA_HOME` en JDK 17.

**Fase 2 — Proyecto Android** (de medio día a un día):
- `npx expo prebuild --platform android --clean`. **Solo Android: nunca sin
  `--platform`, porque borraría las customizaciones de `ios/`** (ver la
  memoria de build);
- `app.json`: paquete de D1, `versionCode`, limpiar permisos, quitar
  `stripe-identity-react-native` y `firebase`;
- token de descargas de Mapbox en `~/.gradle/gradle.properties`;
- `google-services.json`;
- keystore de subida y `signingConfig` de release fuera del repo;
- primera compilación en el emulador Pixel 9: `npx expo run:android --variant release`.

**Fase 3 — Que funcione bien en Android** (2 a 3 días):
- el teclado en todas las pantallas con campos de texto;
- la hoja de opciones propia en lugar de `ActionSheetIOS`;
- repaso de los 36 `Platform.OS`;
- recorrido completo en un teléfono físico: registro, firma, reserva con
  tarjeta, oferta, chat, denunciar, bloquear, pánico, completar con cobro y
  borrar cuenta.

**Fase 4 — Push en las dos plataformas** (1 día, según D3). Necesita build 36
de iOS y un despliegue del backend.

**Fase 5 — Google Play** (1 día de fichas, más la espera de Google):
- página web de borrar cuenta;
- Data safety, clasificación, ficha y capturas;
- AAB a **prueba interna**, después **prueba cerrada** (con 12 testers durante
  14 días si la cuenta es personal) y después producción.

**Total de trabajo técnico: 5 a 7 días.** Lo que más alarga el calendario es
Google: el alta de la cuenta y, si es personal, los 14 días de prueba cerrada.
