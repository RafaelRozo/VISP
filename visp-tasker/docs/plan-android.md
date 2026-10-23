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

### Estado del entorno (2026-10-09, dejado listo)

- ✅ `cmdline-tools` (sdkmanager 16111833) instalado en `~/Library/Android/sdk/cmdline-tools/latest`.
- ✅ CMake 3.22.1 instalado y licencias aceptadas.
- ✅ `~/.zshrc`: `JAVA_HOME` (JDK 17 de Homebrew), `ANDROID_HOME`, `ANDROID_SDK_ROOT` y el PATH con `adb`, `emulator` y `sdkmanager`.
- ✅ Emulador `Pixel_9` probado sin ventana: Android 16, x86_64, aceleración HVF, arranca en unos 35 s.
- ✅ Mapbox: **no hace falta token secreto**. `@rnmapbox` 10.2 deja la autenticación de Maven como opcional, porque Mapbox quitó el requisito. El token público `pk.…` de iOS sirve también en Android.
- ❌ Firebase: el `FIREBASE_CREDENTIALS_JSON` del backend local no se puede leer (no da `project_id`), así que **FCM tampoco está configurado de verdad**. Hacen falta un proyecto de Firebase, su cuenta de servicio para el backend y el `google-services.json` de la app Android.

## 2. Componentes nativos y qué pide cada uno en Android

| Librería | Uso en VISP | Qué hace falta en Android |
|---|---|---|
| `@rnmapbox/maps` 10.2 | Mapa del trabajo activo y de emergencias | **No hace falta token secreto** (ver §1): rnmapbox 10.2 deja opcional la autenticación de Maven. El `pk.…` de iOS sirve. |
| `expo-location` | Centrar el mapa y la llegada del proveedor | Permisos de ubicación *fine* y *coarse*. **Quitar `ACCESS_BACKGROUND_LOCATION`**: la app no la usa, y Google exige un formulario y un vídeo para justificarla, que se suelen rechazar. |
| `expo-image-picker` | Fotos de evidencia, avatar y documentos | Cámara y `READ_MEDIA_IMAGES`. **Quitar `RECORD_AUDIO`** porque no se graba vídeo, y `READ_EXTERNAL_STORAGE`, que está obsoleto en Android 13+. |
| `expo-notifications` | Notificaciones push | `google-services.json` (proyecto de Firebase con la app Android) y canal de notificación. Ver §4: **hoy las push no funcionan en ninguna plataforma**. |
| `@stripe/stripe-react-native` 0.65 | Guardar tarjeta (`CardForm` + `confirmSetupIntent`) | Funciona en Android. Hay que dejar `enableGooglePay: false` (ya está así) y probar el `CardForm` con el teclado. |
| `@stripe/stripe-identity-react-native` 0.8 | **Ninguno**: está instalado pero no se importa en ningún sitio. La verificación va por navegador (`IdentityDocStep`). | **Desinstalado el 2026-10-12.** |
| `expo-secure-store` | Sesión (tokens) | Usa Android Keystore. Nada que hacer. |
| `react-native-svg` | Iconos y la **firma dibujada** del contrato | Funciona. Probar que el trazo de `SignaturePad` responde bien al dedo en Android. |
| `react-native-webview` | Contenido web | Nada especial. |
| `expo-web-browser` | Stripe Connect y documentos | Usa Custom Tabs de Chrome. Comprobar que la vuelta a la app funciona. |
| `reanimated` 4, `gesture-handler`, `screens` | Animaciones y navegación | Necesitan CMake. Nada más. |
| `socket.io-client`, `axios`, `zustand`, `i18n-js` | JS puro | Nada. |
| `firebase` (JS) | — | **Quitado el 2026-10-09**: era de un proyecto viejo (`task-app-58916`) y no se importaba. |

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

**Decisión D3 (Ricardo, 2026-10-09): push NATIVAS, sin Expo.** Hecho:
- La app registra el token nativo con `getDevicePushTokenAsync`: APNs en
  iPhone y FCM en Android.
- El backend envía a iPhone directo a Apple (`integrations/apns`, clave `.p8`,
  primero producción y luego sandbox) y a Android por Firebase Admin.
- Las rutas de `/notifications` ahora piden sesión.
- `smoke_push.py` 19/19.
- Falta: la clave APNs `.p8` en el `.env` del servidor (`APNS_KEY_P8` o
  `APNS_KEY_PATH` y `APNS_KEY_ID`) y, para Android, `google-services.json`.

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
- **D3 — Push:** nativas, APNs + FCM (decidido, §4).
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

## 8. Qué se hizo (2026-10-12)

Decisiones de Ricardo: **D1 = `com.droz.vispapp`**, **D4 = ios/ y android/ en git**
(sin secretos; Pods, build, archivos y keystores fuera), **D5 = sí hay teléfono
Android**, Firebase/FCM **después** (Fase 4). D2 (cuenta Play) sigue abierta.

- `ios/` versionado (commit 2e5b27d) antes de tocar nada.
- `android/` regenerado con `expo prebuild --platform android --clean`; ios/ intacto.
- `app.json` (Android): paquete, `versionCode 1`, `softwareKeyboardLayoutMode
  resize`, permisos mínimos + `blockedPermissions` (BACKGROUND_LOCATION,
  RECORD_AUDIO, SYSTEM_ALERT_WINDOW).
  **OJO:** READ/WRITE_EXTERNAL_STORAGE NO se bloquean: expo-image-picker los
  declara con `maxSdkVersion 32` y en Android ≤12 la galería los necesita. Al
  bloquearlos, Android denegaba sin diálogo y "Open settings" llevaba a un
  permiso que no existía (visto en la tablet CHUWI, Android 11, 2026-10-13).
- **Iconos:** `icon.png` y los adaptativos eran los de la plantilla de Expo. Ahora
  salen del logo real de iOS: `assets/brand/app-icon.png`,
  `assets/brand/android/{adaptive-foreground,adaptive-monochrome,notification-icon}.png`.
- Dependencias: fuera `stripe-identity-react-native`; dentro `expo-system-ui`,
  `react-native-keyboard-controller` 1.20.7 y `react-native-worklets` fijado a
  0.7.4 (sin fijarlo npm sube a 0.13, que pide RN 0.86 → ERESOLVE).
- **Teclado:** `components/KeyboardAvoidingView` y `components/KeyboardAwareScrollView`.
  En iOS son los de React Native sin cambios; en Android, keyboard-controller
  (`KeyboardProvider` en App.tsx, solo Android). Aplicado a 14 KAV existentes,
  8 ScrollView con campos, el FlatList de ofertas (`renderScrollComponent`), el
  modal del código de recuperación y el panel de dirección de emergencia.
- **Hoja de opciones:** `components/ActionSheet` (`showActionSheet` + `<ActionSheetHost />`).
  iOS = ActionSheetIOS; Android = hoja propia. Sustituye las 8 llamadas;
  avatar, bolsa de trabajos y credenciales tenían más de 3 opciones y en
  Android se perdían. Única diferencia visible en iOS: la hoja de tipo de
  credencial ahora lleva título y mensaje.
- **Edge-to-edge:** `Screen` añade el borde superior en Android. Las pantallas
  sin TopBar (registro, etc.) metían la cabecera bajo la hora.
- Compilación release en el emulador Pixel 9 (Android 16): arranca, login y
  registro con teclado correctos. La primera compilación tarda ~37 min; las
  incrementales ~4.
- Script: `./gradlew assembleRelease -PreactNativeArchitectures=x86_64,arm64-v8a`
  (release lleva el JS dentro, sin Metro).

- **2026-10-13 — prueba en físico (tablet CHUWI HiPad Air, Android 11):** login,
  permisos de ubicación, cámara y galería con su diálogo, publicar un trabajo.
  Sin errores en logcat.

**Falta:** probar en un teléfono Android 13+ con sesión (la app apunta a producción),
keystore de subida + `signingConfig`, Firebase (Fase 4), D2 y fichas de Play.
**El próximo build de iOS necesita `pod install`** (3 módulos nativos nuevos).


## 9. Firma y subida a Google Play (2026-10-14)

**Upload key** (Play App Signing activado: Google guarda la clave de la app,
nosotros solo firmamos la subida):

| Qué | Dónde |
|---|---|
| Keystore | `~/.android-keys/visp-upload.jks` (PKCS12, RSA 2048, 10 000 días) |
| Alias | `visp-upload` |
| Contraseñas | `~/.gradle/gradle.properties` → `VISP_UPLOAD_*` (store y key iguales) |
| SHA-256 | `49:1B:84:52:A5:96:06:42:89:B7:13:B6:09:4A:B4:1B:E4:08:A9:CC:72:F1:47:45:C1:D4:65:8D:C7:F7:84:95` |

Nada de esto está en git. **Copia de seguridad** del `.jks` + la contraseña en
el gestor de contraseñas de Ricardo. Si se pierde: Play Console → App integrity
→ *Request upload key reset* (tarda días).

`android/app/build.gradle` firma el release con esa clave si existen las
propiedades `VISP_UPLOAD_*`; si no, con la de debug (vale para probar, Play la
rechaza). **Ojo:** `expo prebuild --clean` regenera build.gradle y borra ese
bloque; android/ está en git, así que se recupera con `git diff`.

**AAB:** `cd android && ./gradlew bundleRelease` (todas las ABI) →
`app/build/outputs/bundle/release/app-release.aab`. Cada subida necesita un
`versionCode` mayor (app.json `android.versionCode` y `android/app/build.gradle`).
Primera subida: versionCode 1, 1.0.0, prueba interna.

## 10. Enviar a revisión en Google Play (estado 2026-10-16)

**Hecho:** cuenta de organización DROZ TECHNOLOGIES (sin la regla de 12 testers
y 14 días), app creada (`com.droz.vispapp`, idioma en-US), Play App Signing con
clave de Google, **prueba interna activa** con el AAB 1.0.0 (versionCode 1) y
la lista "Visp Tester". El enlace web de la ficha da 404 hasta producción: los
testers abren el opt-in desde el Android con la cuenta de la lista.

**Página de borrar cuenta:** `https://visp.richieyanez.com/delete-account`
(commit 6560531). **Desplegar el admin antes de rellenar Data safety.**

**Panel → Configura tu app:**

| Sección | Respuesta |
|---|---|
| Política de privacidad | `https://visp.richieyanez.com/legal/privacy` |
| Acceso a la app | Restringida → cuentas demo cliente y proveedor (las de Apple) |
| Anuncios | No |
| Clasificación de contenido | Categoría "Otros"; sí a interacción entre usuarios y contenido de usuarios |
| Público objetivo | Solo 18+ |
| Noticias / Gobierno / Salud | No |
| Funciones financieras | Ninguna (Stripe cobra servicios, no es un servicio financiero) |
| ID de publicidad | No se usa |
| Seguridad de los datos | Desde `app-store-submission.md` §3; URL de borrado arriba |
| Categoría y contacto | Estilo de vida · support@droztechnologies.com · visp.richieyanez.com |
| Ficha | Descripción corta (80), completa, icono 512×512, gráfico 1024×500, 2–8 capturas |
| Producción → países | Solo Canadá |

**Pendiente:** textos de la ficha EN/FR, gráficos, capturas, respuestas de Data
safety pregunta a pregunta; después Producción → revisión. Aparte: API de Play
(cuenta de servicio) para subir builds desde terminal, Firebase/FCM.

## 11. Pendiente obligatorio para la 1.0.4 de Android (avisos de Play, 2026-10-23)

La 1.0.1 se aprobó y la 1.0.3 (versionCode 4) está en revisión. Play marca tres
avisos sobre la 1.0.1 con plazo **febrero de 2027**. No bloquean, pero la próxima
versión de Android tiene que llevarlos resueltos:

| # | Aviso de Play | Qué hacer | Riesgo |
|---|---|---|---|
| 1 | Optimización DEX: **ofuscación 2 %** (umbral 25 %) | Activar R8 en release (`minifyEnabled true`, `shrinkResources true`) con reglas `keep` para Stripe, Mapbox, Expo y React Native | Alto: lo que rompe R8 falla en ejecución. Probar en release todo el flujo de cobro (retención, captura, comprobante), mapa y alta de cobros |
| 2 | **APIs obsoletas de borde a borde** (Android 15) | Quitar `backgroundColor`/`translucent` del `StatusBar` en Android (`App.tsx`, `components/visp/Screen.tsx`) y revisar qué librerías llaman a `setStatusBarColor`/`setNavigationBarColor` | Medio: re-probar cabeceras (`navigation/androidHeader.tsx`) y teclado |
| 3 | **Restricción de orientación** en pantallas grandes | Android 16 ignora el bloqueo vertical en tablets y plegables. Probar cada pantalla en un emulador de tablet en horizontal y arreglar los layouts | Medio: es trabajo de diseño, no de configuración |

Probar en el emulador de teléfono (`VISP_Shots`, 1080×1920) y en uno de tablet
antes de subir. Versión: 1.0.4, versionCode 5.
