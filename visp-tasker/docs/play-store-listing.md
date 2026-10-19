# Google Play — qué poner en cada pantalla de Play Console

Preparado el 2026-10-19 para la versión 1.0.1 (versionCode 2). Lo que va entre
`> ` o en bloques de código está en inglés o francés porque se pega tal cual.
Complementa `plan-android.md` §10 y `app-store-submission.md`.

Archivos gráficos: `~/Desktop/VISP-Android/play-store/` (icono 512, gráfico de
funciones 1024×500 y capturas 1080×1920).

---

## 1. Ficha principal de Play Store (Crecer → Presencia en Play Store → Ficha principal)

**Nombre de la app** (máx. 30): `VISP`

**Descripción breve** (máx. 80):

```
Book trusted local pros for cleaning, assembly, moving and yard work.
```

**Descripción completa** (máx. 4000):

```
VISP is the simple way to get everyday home services done in the Greater Toronto Area.

Pick a service from a clear catalog, see the price range up front, and choose from verified local providers near you. No guessing, no endless quotes.

FOR CUSTOMERS
• Browse services by category: cleaning, furniture assembly, moving and hauling, gardening and landscaping, seasonal work, pet care, painting and more.
• See the price range before you book, then compare available providers with their own price.
• Add details and photos so your provider knows exactly what to expect.
• Pick a date and time that works for you.
• Track the job, chat with your provider and pay securely in the app.
• Your card is only authorized at booking and charged when the job is completed.

FOR PROVIDERS
• Choose the services you offer and set your own price within each service's range.
• Start with Top Jobs: the most requested services, highlighted so you can add them first.
• Receive job offers near your base address and accept the ones that fit you.
• Manage your schedule, track your earnings and get paid to your bank account.
• Build your profile with ratings and reviews.

TRUST AND SAFETY
• Providers verify their identity before they can get paid.
• Every service comes from a fixed catalog with clear scope and pricing.
• Payments are processed by Stripe.

VISP currently serves the Greater Toronto Area, Ontario, Canada.

Questions? support@droztechnologies.com
```

**Francés (fr-CA)** — Ficha principal → Gérer les traductions → Ajouter
`French (Canada) – fr-CA`:

Descripción breve:

```
Réservez des pros locaux pour ménage, montage, déménagement et jardinage.
```

Descripción completa:

```
VISP est la façon simple de faire réaliser vos services à domicile dans la région du Grand Toronto.

Choisissez un service dans un catalogue clair, voyez la fourchette de prix dès le départ et choisissez parmi des fournisseurs locaux vérifiés près de chez vous. Pas de devinettes, pas de devis à n'en plus finir.

POUR LES CLIENTS
• Parcourez les services par catégorie : ménage, montage de meubles, déménagement, jardinage et aménagement paysager, travaux saisonniers, soins des animaux, peinture et plus.
• Voyez la fourchette de prix avant de réserver, puis comparez les fournisseurs disponibles avec leur propre tarif.
• Ajoutez des détails et des photos pour que votre fournisseur sache exactement à quoi s'attendre.
• Choisissez la date et l'heure qui vous conviennent.
• Suivez le travail, discutez avec votre fournisseur et payez en toute sécurité dans l'app.
• Votre carte est seulement autorisée à la réservation et débitée une fois le travail terminé.

POUR LES FOURNISSEURS
• Choisissez les services que vous offrez et fixez votre propre tarif dans la fourchette de chaque service.
• Commencez par les Top Jobs : les services les plus demandés, mis en avant pour que vous les ajoutiez en premier.
• Recevez des offres de travail près de votre adresse de base et acceptez celles qui vous conviennent.
• Gérez votre horaire, suivez vos revenus et soyez payé dans votre compte bancaire.
• Bâtissez votre profil grâce aux notes et aux avis.

CONFIANCE ET SÉCURITÉ
• Les fournisseurs vérifient leur identité avant de pouvoir être payés.
• Chaque service provient d'un catalogue fermé avec une portée et des prix clairs.
• Les paiements sont traités par Stripe.

VISP dessert actuellement la région du Grand Toronto, en Ontario, au Canada.

Des questions? support@droztechnologies.com
```

**Gráficos:**

| Campo | Archivo |
|---|---|
| Icono de la app (512×512) | `icon-512.png` |
| Gráfico de funciones (1024×500) | `feature-graphic-1024x500.png` |
| Capturas de teléfono (2–8, 9:16) | `phone-01…08.png` (1080×1920) |
| Tablet 7" / 10" | Se dejan vacías: son opcionales |

Las capturas sirven para las dos traducciones; Play usa las de en-US si fr-CA no
tiene propias.

---

## 2. Configuración de la tienda (Presencia en Play Store → Configuración de la tienda)

| Campo | Valor |
|---|---|
| Categoría | Aplicación · **Estilo de vida** |
| Etiquetas | Home services / Servicios para el hogar (las que ofrezca) |
| Correo | `support@droztechnologies.com` |
| Sitio web | `https://visp.richieyanez.com` |
| Teléfono | Opcional, se puede dejar vacío |

---

## 3. Contenido de la app (Política → Contenido de la app)

### Política de privacidad
`https://visp.richieyanez.com/legal/privacy`

### Acceso a la app
"Toda la funcionalidad o parte de ella está restringida" → **Añadir
instrucciones**. Dos entradas:

- **Customer account** — usuario `appreview.customer@droztechnologies.com`,
  la contraseña que tienes de Apple.
- **Provider account** — usuario `appreview.provider@droztechnologies.com`,
  la contraseña que tienes de Apple.

Otras instrucciones (pegar):

```
VISP only operates in the Greater Toronto Area, Ontario, Canada. When the app asks for a service address, please use a Toronto address, for example: 100 Queen St W, Toronto, ON M5H 2N2. Addresses outside this area are rejected by design.
Payments run in live mode through Stripe; please do not complete a real payment.
Account deletion: Profile → Settings → Delete account. Please do not delete the demo accounts.
```

### Anuncios
**No**, la app no contiene anuncios.

### Clasificación de contenido
Cuestionario IARC. Correo: `support@droztechnologies.com`. Categoría:
**"Todos los demás tipos de apps"** (no es juego, ni red social, ni noticias).
- Violencia, miedo, sexualidad, lenguaje, drogas, apuestas: **No** a todo.
- ¿Los usuarios pueden interactuar o intercambiar contenido? **Sí** (chat
  entre cliente y proveedor, reseñas).
- ¿Comparte la ubicación del usuario con otros usuarios? **Sí** (el proveedor
  ve la dirección del servicio y el cliente la llegada del proveedor).
- ¿Permite compras digitales? **No** (se pagan servicios físicos).
- ¿Es un navegador web o buscador? **No**.

### Público objetivo
Solo **18 años o más**. ¿Atrae a niños? **No**.

### Apps de noticias / Gobierno / Salud / COVID
**No** en todas.

### Funciones financieras
**Mi app no proporciona ninguna función financiera** (Stripe cobra servicios
físicos; VISP no es un servicio financiero).

### ID de publicidad
**No** usa el ID de publicidad.

### Seguridad de los datos (Data safety)

**Recogida y uso compartido:**
- ¿Recoge o comparte alguno de los tipos de datos obligatorios? **Sí**.
- ¿Todos los datos se encriptan en tránsito? **Sí** (todo va por HTTPS).
- ¿Ofreces una forma de solicitar que se eliminen los datos? **Sí**.
  URL de eliminación de cuenta: `https://visp.richieyanez.com/delete-account`
- ¿Se puede eliminar parte de los datos sin borrar la cuenta? **No** (dejarlo
  en No salvo que se quiera añadir una URL aparte).

**Compartido = No en todos.** Stripe y Mapbox procesan datos *en nombre de*
VISP (proveedores de servicios), y Google no cuenta eso como "compartir".

**Tipos de datos — todos "Recogidos", no compartidos, procesados de forma no
efímera:**

| Categoría de Play | Tipo | ¿Obligatorio? | Finalidades |
|---|---|---|---|
| Ubicación | Ubicación aproximada | Opcional | Funcionalidad de la app |
| Ubicación | Ubicación precisa | Opcional | Funcionalidad de la app |
| Información personal | Nombre | Obligatorio | Funcionalidad, Gestión de la cuenta |
| Información personal | Dirección de correo | Obligatorio | Funcionalidad, Gestión de la cuenta, Comunicaciones del desarrollador |
| Información personal | IDs de usuario | Obligatorio | Funcionalidad, Gestión de la cuenta |
| Información personal | Dirección | Obligatorio | Funcionalidad de la app |
| Información personal | Número de teléfono | Obligatorio | Funcionalidad, Gestión de la cuenta |
| Información personal | Otra información (documento de identidad, solo proveedores) | Opcional | Prevención de fraudes, seguridad y cumplimiento |
| Información financiera | Información de pago del usuario | Opcional | Funcionalidad de la app |
| Información financiera | Historial de compras | Obligatorio | Funcionalidad de la app |
| Información financiera | Otra información financiera (cuenta bancaria del proveedor) | Opcional | Funcionalidad de la app |
| Mensajes | Otros mensajes en la app | Opcional | Funcionalidad de la app |
| Fotos y vídeos | Fotos | Opcional | Funcionalidad de la app |
| Actividad en la app | Otro contenido generado por el usuario (detalles del trabajo, reseñas) | Opcional | Funcionalidad de la app |
| ID de dispositivo u otros IDs | ID de dispositivo (token de notificaciones) | Opcional | Funcionalidad de la app |

**No declarar:** analítica, informes de fallos ni diagnósticos (la app no los
tiene; la telemetría de Mapbox está apagada), contactos, calendario, audio,
archivos, salud, navegación web, apps instaladas.

---

## 4. Producción

1. **Prueba y publica → Producción → Países/regiones** → Añadir países →
   **solo Canadá**.
2. **Crear nueva versión** → subir `VISP-1.0.1-versionCode2.aab`.
3. **Nombre de la versión:** `1.0.1 (2)`.
4. **Notas de la versión:**

```
<en-US>
New: Top Jobs — the most requested services are highlighted at the top of My Services so providers can add them faster.
</en-US>
<fr-CA>
Nouveau : Top Jobs — les services les plus demandés sont mis en avant en haut de Mes services pour que les fournisseurs les ajoutent plus vite.
</fr-CA>
```

5. **Siguiente → Guardar → Enviar cambios a revisión** (en "Resumen de la
   publicación"). La primera revisión de Google suele tardar entre unos días y
   una semana.
