/**
 * VISP — Booking details ("More info").
 *
 * Va ENTRE "Book Service" (TaskSelectionScreen) y "Confirm Booking"
 * (BookingScreen). Decisión del cliente, 2026-08-11.
 *
 * PARA QUÉ SIRVE — importante no confundirlo:
 * lo que se escribe aquí es SOPORTE DE DECISIÓN PARA EL PROVEEDOR. Lo ve antes
 * de aceptar, para juzgar si le interesa el trabajo con su rango de precio: si
 * esa casa vale la pena limpiar, si el césped a cortar entra en la categoría.
 * NO define ni recotiza el trabajo — el servicio y el precio salen del catálogo
 * cerrado (ver CLAUDE.md regla 1). Si el trabajo resulta mayor de lo descrito,
 * el camino correcto es que el proveedor re-cotice, no este texto.
 *
 * Tres secciones, en este orden:
 *   1. Detalles del servicio (con el prompt del propio servicio).
 *   2. Evidencia fotográfica (máximo 5).
 *   3. Nota extra, para lo que no encaja en los detalles (p.ej. el carácter del
 *      perro en un paseo, donde los detalles no aportan pero la nota sí).
 *
 * Obligatorios o no según `requiresDetails` / `requiresEvidence` del servicio,
 * que el admin enciende por servicio. Se validan aquí Y en el backend: aquí para
 * no dejar al usuario avanzar y chocar al final, allí porque es la única
 * validación en la que se puede confiar.
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { CustomerFlowParamList, ServiceQuestion } from '../../types';

import { Screen, ScreenTitle, Eyebrow } from '../../components/visp';
import { useVispTheme, VispText, VispSpace, VispRadius, FontSansSemiBold } from '../../theme/visp';
import { useTranslation } from '../../i18n';
import { useTaskStore } from '../../stores/taskStore';
import { taskService } from '../../services/taskService';
import { resolveUploadUrl } from '../../services/userService';

/** Debe coincidir con MAX_CUSTOMER_EVIDENCE_PHOTOS del backend. */
const MAX_PHOTOS = 5;

/**
 * expo-image-picker comprime por calidad pero NO redimensiona: para eso haría
 * falta expo-image-manipulator, que es un módulo nativo. 0.6 deja una foto de
 * iPhone en ~1-2 MB, muy por debajo del tope de 8 MB del backend.
 */
const PICKER_QUALITY = 0.6;

type Nav = NativeStackNavigationProp<CustomerFlowParamList, 'BookingDetails'>;
type Rt = RouteProp<CustomerFlowParamList, 'BookingDetails'>;

export default function BookingDetailsScreen(): React.JSX.Element {
  const t = useVispTheme();
  const { t: tr } = useTranslation();
  const navigation = useNavigation<Nav>();
  // El resumen del servicio se recibe y se REENVÍA tal cual: esta pantalla no
  // lo modifica, solo se intercala en el camino a la confirmación.
  const route = useRoute<Rt>();

  const {
    taskDetail,
    details,
    evidence,
    extraNote,
    setDetails,
    setExtraNote,
    answers,
    setAnswer,
    addEvidence,
    removeEvidence,
    materialsRequested,
    materialsBudget,
    setMaterialsRequested,
    setMaterialsBudget,
    contractRate,
    setContractRate,
    contractHours,
    setContractHours,
  } = useTaskStore();

  const [uploading, setUploading] = useState(false);

  const requiresDetails = taskDetail?.requiresDetails ?? false;
  const requiresEvidence = taskDetail?.requiresEvidence ?? false;

  // ── Contrato por horas (migración 046) ──────────────────────────────────
  // La inversión del modelo: aquí el precio lo pone EL CLIENTE. El rango del admin
  // sigue mandando, solo que ahora acota lo que él puede ofrecer.
  const isContract = (taskDetail?.pricingUnit ?? '').toUpperCase() === 'PER_CONTRACT';
  const rateMin = (taskDetail?.priceRangeMin ?? 0);
  const rateMax = (taskDetail?.priceRangeMax ?? 0);
  const rateValue = parseFloat(contractRate || '');
  const rateOutOfRange =
    isContract &&
    (!Number.isFinite(rateValue) || rateValue < rateMin || rateValue > rateMax);

  // Las HORAS las pone el cliente, no el proveedor. Es la otra mitad del trato:
  // "pago 25/h" no es una oferta hasta que dice por cuántas horas. Sin este
  // campo el proveedor solo podía aceptar un trabajo de duración desconocida.
  const hoursValue = parseFloat(contractHours || '');
  const hoursInvalid = isContract && (!Number.isFinite(hoursValue) || hoursValue <= 0);

  // ── Materiales (migración 043) ──────────────────────────────────────────
  // El servicio los permite, pero quien decide es el cliente en CADA reserva. Si
  // dice que no, la reserva se comporta exactamente como siempre.
  const materialsEnabled = taskDetail?.materialsEnabled ?? false;
  const budgetMin = (taskDetail?.materialsBudgetMinCents ?? 0) / 100;
  const budgetMax = (taskDetail?.materialsBudgetMaxCents ?? 0) / 100;
  const budgetValue = parseFloat(materialsBudget || '');
  const budgetOutOfRange =
    materialsRequested &&
    (!Number.isFinite(budgetValue) || budgetValue < budgetMin || budgetValue > budgetMax);

  // El prompt del propio servicio es lo que orienta al cliente a describir
  // ESCALA Y ACCESO en vez de pedir tareas nuevas. Si el admin no puso uno, se
  // cae a un genérico que sigue anclado al servicio elegido.
  const prompt = useMemo(() => {
    const fromAdmin = taskDetail?.detailsPromptEn?.trim();
    if (fromAdmin) return fromAdmin;
    return tr('bookingDetails.promptFallback') ||
      'Describe the size and access for this service — rooms, area, floor, pets, how we get in.';
  }, [taskDetail?.detailsPromptEn, tr]);

  // Las preguntas de material solo aparecen —y solo se exigen— si el cliente pidió
  // material: "¿de qué color pinto?" no tiene sentido si compra su propia pintura,
  // y exigirla bloquearía la reserva por algo que no aplica.
  const questions = useMemo(
    () =>
      [...(taskDetail?.questions ?? [])]
        .filter((q) => !q.materialsOnly || materialsRequested)
        .sort((a, b) => a.displayOrder - b.displayOrder),
    [taskDetail?.questions, materialsRequested],
  );

  // Cuántas van contestadas. Con ocho preguntas seguidas —Deck Staining tiene
  // ocho— saber que quedan tres es la diferencia entre seguir y abandonar.
  const answeredCount = questions.filter((q) => (answers[q.id] ?? '').trim() !== '').length;

  const detailsMissing = requiresDetails && details.trim() === '';
  const evidenceMissing = requiresEvidence && evidence.length === 0;
  // Una obligatoria sin responder bloquea igual que los detalles: el backend la
  // rechaza con 400, así que es mejor no dejar avanzar y perder el recorrido.
  const unansweredRequired = questions.filter(
    (q) => q.isRequired && (answers[q.id] ?? '').trim() === '',
  );
  const canContinue =
    !rateOutOfRange &&
    !hoursInvalid &&
    !detailsMissing &&
    !evidenceMissing &&
    unansweredRequired.length === 0 &&
    !budgetOutOfRange &&
    !uploading;

  const handleAddPhotos = useCallback(async () => {
    const remaining = MAX_PHOTOS - evidence.length;
    if (remaining <= 0) {
      Alert.alert(
        tr('bookingDetails.maxPhotosTitle') || 'Photo limit reached',
        (tr('bookingDetails.maxPhotosBody') ||
          'You can attach up to {n} photos.').replace('{n}', String(MAX_PHOTOS)),
      );
      return;
    }

    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(
        tr('bookingDetails.permTitle') || 'Photo access needed',
        tr('bookingDetails.permBody') ||
          'Allow photo access to attach pictures of the job.',
      );
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: remaining,
      quality: PICKER_QUALITY,
    });
    if (result.canceled || result.assets.length === 0) return;

    setUploading(true);
    try {
      const urls = await taskService.uploadBookingEvidence(
        result.assets.map((a) => a.uri),
      );
      addEvidence(urls);
    } catch {
      // Sin detalle técnico al usuario: lo único que puede hacer es reintentar.
      Alert.alert(
        tr('bookingDetails.uploadFailedTitle') || 'Upload failed',
        tr('bookingDetails.uploadFailedBody') ||
          'The photos could not be uploaded. Check your connection and try again.',
      );
    } finally {
      setUploading(false);
    }
  }, [evidence.length, addEvidence, tr]);

  /**
   * Foto como respuesta a una pregunta de tipo IMAGE.
   *
   * Reusa la subida de evidencia en vez de tener su propio endpoint: es el mismo
   * archivo, la misma validación de tamaño y la misma carpeta. Lo único distinto
   * es dónde se guarda la URL — aquí, como respuesta a la pregunta.
   */
  const handleAnswerPhoto = useCallback(
    async (questionId: string) => {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(
          tr('bookingDetails.permTitle') || 'Photo access needed',
          tr('bookingDetails.permBody') ||
            'Allow photo access to attach pictures of the job.',
        );
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: false,
        quality: PICKER_QUALITY,
      });
      if (result.canceled || result.assets.length === 0) return;

      setUploading(true);
      try {
        const [url] = await taskService.uploadBookingEvidence([result.assets[0].uri]);
        if (url) setAnswer(questionId, url);
      } catch {
        Alert.alert(
          tr('bookingDetails.uploadFailedTitle') || 'Upload failed',
          tr('bookingDetails.uploadFailedBody') ||
            'The photos could not be uploaded. Check your connection and try again.',
        );
      } finally {
        setUploading(false);
      }
    },
    [setAnswer, tr],
  );

  const handleContinue = useCallback(() => {
    if (!canContinue) return;
    navigation.navigate('Booking', { task: route.params.task });
  }, [canContinue, navigation, route.params.task]);

  return (
    <Screen>
      <ScreenTitle
        title={tr('bookingDetails.title') || 'More info'}
        sub={tr('bookingDetails.eyebrow') || '§ Help the provider decide'}
        onBack={navigation.canGoBack() ? () => navigation.goBack() : undefined}
      />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={[VispText.body, { color: t.text2, marginBottom: 18 }]}>
          {tr('bookingDetails.intro') ||
            'The provider reads this before accepting, to decide whether the job suits them. It does not change the service or the price.'}
        </Text>

        {/* ── 1. Detalles ───────────────────────────────────────────── */}
        <Eyebrow>
          {(tr('bookingDetails.detailsLabel') || 'Service details').toUpperCase()}
          {requiresDetails ? ' *' : ''}
        </Eyebrow>
        {/* El prompt del servicio va FUERA del campo, no como placeholder.
            Dentro desaparecía al escribir la primera letra — y es justo la guía
            que mantiene al cliente describiendo escala y acceso en vez de pedir
            tareas nuevas (CLAUDE.md, regla 1). Quien más lo necesita es quien ya
            está escribiendo, que es exactamente cuando se borraba. */}
        <Text style={[VispText.body, { color: t.text2, marginTop: 4 }]}>{prompt}</Text>
        <TextInput
          style={[
            styles.input,
            styles.inputMultiline,
            {
              color: t.text,
              backgroundColor: t.surface,
              borderColor: detailsMissing ? t.danger : t.border,
            },
          ]}
          value={details}
          onChangeText={setDetails}
          placeholder={tr('bookingDetails.detailsPlaceholder') ||
            'e.g. 3 bedrooms on the second floor, side gate, one small dog.'}
          placeholderTextColor={t.text3}
          multiline
          maxLength={4000}
          textAlignVertical="top"
        />
        <View style={styles.metaRow}>
          {detailsMissing ? (
            <Text style={[VispText.eyebrow, { color: t.danger }]}>
              {tr('bookingDetails.detailsRequired') ||
                'This service needs a description before booking.'}
            </Text>
          ) : (
            <View />
          )}
          <Text style={[VispText.eyebrow, { color: t.text3 }]}>
            {details.length}/4000
          </Text>
        </View>

        {/* ── Contrato por horas (migración 046) ──────────────────────
            La INVERSIÓN del modelo: aquí el precio lo pone el cliente y el
            proveedor solo acepta. Va lo primero porque es lo que define el trato:
            todo lo demás —detalles, fotos— es contexto de algo ya acordado. */}
        {isContract ? (
          <>
            <Eyebrow>
              {(tr('bookingDetails.contractRate') || 'Your hourly rate').toUpperCase()}
              {`  ·  $${rateMin} – $${rateMax}`}
            </Eyebrow>
            <TextInput
              style={[
                styles.input,
                {
                  color: t.text,
                  backgroundColor: t.surface,
                  borderColor: rateOutOfRange ? t.danger : t.border,
                  marginTop: 6,
                },
              ]}
              value={contractRate}
              onChangeText={setContractRate}
              placeholder={`${rateMin}`}
              placeholderTextColor={t.text3}
              keyboardType="decimal-pad"
              maxLength={8}
            />
            <Eyebrow style={{ marginTop: 18 }}>
              {(tr('bookingDetails.contractHours') || 'Hours you need').toUpperCase()}
            </Eyebrow>
            <TextInput
              style={[
                styles.input,
                {
                  color: t.text,
                  backgroundColor: t.surface,
                  borderColor: hoursInvalid ? t.danger : t.border,
                  marginTop: 6,
                },
              ]}
              value={contractHours}
              onChangeText={setContractHours}
              placeholder="8"
              placeholderTextColor={t.text3}
              keyboardType="decimal-pad"
              maxLength={5}
            />
            <Text style={[VispText.body, { color: hoursInvalid ? t.danger : t.text2, marginTop: 8 }]}>
              {hoursInvalid
                ? tr('bookingDetails.contractHoursRequired') || 'Say how many hours you need.'
                : (tr('bookingDetails.contractHoursHelp') ||
                    'Total: {total}. Cancel partway and you only pay the hours worked.')
                    .replace(
                      '{total}',
                      Number.isFinite(rateValue) && Number.isFinite(hoursValue)
                        ? `$${(rateValue * hoursValue).toFixed(2)}`
                        : '—',
                    )}
            </Text>

            <Text style={[VispText.eyebrow, { color: rateOutOfRange ? t.danger : t.text2, marginTop: 8 }]}>
              {rateOutOfRange
                ? (tr('bookingDetails.contractRateRange') ||
                    'Offer between ${min} and ${max} per hour.')
                    .replace('${min}', `$${rateMin}`)
                    .replace('${max}', `$${rateMax}`)
                : tr('bookingDetails.contractRateHelp') ||
                  'You set the price for this one. Providers who work at that rate will accept — you choose who.'}
            </Text>
            <View style={styles.sectionGap} />
          </>
        ) : null}

        {/* ── Materiales (migración 043) ─────────────────────────────
            Va ANTES de las preguntas a propósito: activarlo hace aparecer las
            preguntas de material (el color de la pintura), y al revés no tendría
            sentido. Si el cliente dice que no, la reserva sigue como siempre. */}
        {materialsEnabled ? (
          <>
            <View style={styles.sectionGap} />
            <Eyebrow>
              {(tr('bookingDetails.materialsLabel') || 'Materials').toUpperCase()}
            </Eyebrow>

            <Pressable
              onPress={() => setMaterialsRequested(!materialsRequested)}
              style={[
                styles.materialsToggle,
                {
                  borderColor: materialsRequested ? t.violet : t.border,
                  backgroundColor: materialsRequested ? t.violetDim : t.surface,
                },
              ]}
              accessibilityRole="switch"
              accessibilityState={{ checked: materialsRequested }}
            >
              <View
                style={[
                  styles.checkbox,
                  {
                    borderColor: materialsRequested ? t.violet : t.border,
                    backgroundColor: materialsRequested ? t.violet : 'transparent',
                  },
                ]}
              >
                {materialsRequested ? (
                  <Text style={styles.checkboxMark}>✓</Text>
                ) : null}
              </View>
              <View style={styles.materialsToggleText}>
                <Text style={[VispText.body, { color: t.text }]}>
                  {tr('bookingDetails.materialsAsk') ||
                    'I need the provider to buy the materials'}
                </Text>
                <Text style={[VispText.body, { color: t.text2, marginTop: 4 }]}>
                  {tr('bookingDetails.materialsHelp') ||
                    'They buy them, keep the receipt, and you reimburse what they paid.'}
                </Text>
              </View>
            </Pressable>

            {materialsRequested ? (
              <>
                {/* El mensaje que escribió el admin para ESTE servicio. */}
                {taskDetail?.materialsNoteEn ? (
                  <Text style={[VispText.body, { color: t.text2, marginTop: 10 }]}>
                    {taskDetail.materialsNoteEn}
                  </Text>
                ) : null}

                <Text style={[VispText.eyebrow, { color: t.text2, marginTop: 14 }]}>
                  {(tr('bookingDetails.materialsBudget') || 'Your budget').toUpperCase()}
                  {`  ·  $${budgetMin} – $${budgetMax}`}
                </Text>
                <TextInput
                  style={[
                    styles.input,
                    {
                      color: t.text,
                      backgroundColor: t.surface,
                      borderColor: budgetOutOfRange ? t.danger : t.border,
                      marginTop: 6,
                    },
                  ]}
                  value={materialsBudget}
                  onChangeText={setMaterialsBudget}
                  placeholder={`${budgetMin}`}
                  placeholderTextColor={t.text3}
                  keyboardType="decimal-pad"
                  maxLength={8}
                />
                {/* Que quede claro que esto NO es el precio: el proveedor cotizará
                    el material en su oferta, con su justificación, y el cliente
                    decidirá entonces. Sin esta línea, un cliente que ponga 100 y
                    reciba una oferta de 150 pensará que le cambiaron el trato. */}
                <Text style={[VispText.body, { color: t.text2, marginTop: 8 }]}>
                  {budgetOutOfRange
                    ? (tr('bookingDetails.materialsBudgetRange') ||
                        'Enter an amount between ${min} and ${max}.')
                        .replace('${min}', `$${budgetMin}`)
                        .replace('${max}', `$${budgetMax}`)
                    : tr('bookingDetails.materialsBudgetNote') ||
                      'This tells providers what you had in mind. Each one will quote the real materials cost in their offer, with a reason — you decide then.'}
                </Text>
              </>
            ) : null}
          </>
        ) : null}

        {/* ── Preguntas del servicio (migraciones 039/040) ───────────
            Rediseñadas el 2026-08-21. Antes cada pregunta se pintaba con
            `Eyebrow`: mono, MAYÚSCULAS, 10px y tracking ancho. Ese componente es
            para etiquetas de dos palabras ("SERVICE DETAILS"), y las preguntas
            reales son frases enteras — "Is there any heavy equipment that needs
            to be moved in order to clean?". En micro-mayúsculas espaciadas eso no
            se lee, se descifra.

            Ahora cada pregunta es una FICHA: numerada, con la frase en sans de
            16px, y la respuesta dentro. Con servicios que traen 8 preguntas
            (Deck Staining), la numeración y el contador de arriba son lo que
            evita la sensación de formulario sin fondo. */}
        {questions.length > 0 ? (
          <>
            <View style={styles.sectionGap} />
            <View style={styles.sectionHead}>
              <Eyebrow>
                {(tr('bookingDetails.questionsLabel') || 'About the job').toUpperCase()}
              </Eyebrow>
              <Eyebrow color={answeredCount === questions.length ? t.ok : t.text3}>
                {`${answeredCount}/${questions.length}`}
              </Eyebrow>
            </View>
            <Text style={[VispText.body, { color: t.text2, marginBottom: 14 }]}>
              {tr('bookingDetails.questionsHelp') ||
                'The provider needs these to size the job. Short answers are fine.'}
            </Text>

            {questions.map((q, i) => (
              <QuestionCard
                key={q.id}
                q={q}
                index={i}
                value={answers[q.id] ?? ''}
                uploading={uploading}
                onAnswer={(txt) => setAnswer(q.id, txt)}
                onPickPhoto={() => handleAnswerPhoto(q.id)}
              />
            ))}
          </>
        ) : null}

        {/* ── 2. Evidencia ──────────────────────────────────────────── */}
        <View style={styles.sectionGap} />
        <Eyebrow>
          {(tr('bookingDetails.evidenceLabel') || 'Photos').toUpperCase()}
          {requiresEvidence ? ' *' : ''}
          {`  ·  ${evidence.length}/${MAX_PHOTOS}`}
        </Eyebrow>
        <Text style={[VispText.body, { color: t.text2, marginBottom: 10 }]}>
          {tr('bookingDetails.evidenceHelp') ||
            'A photo of the space or the problem saves questions later.'}
        </Text>

        <View style={styles.thumbRow}>
          {evidence.map((url) => (
            <View key={url} style={[styles.thumbWrap, { borderColor: t.border }]}>
              <Image
                source={{ uri: resolveUploadUrl(url) ?? undefined }}
                style={styles.thumb}
                resizeMode="cover"
              />
              <Pressable
                onPress={() => removeEvidence(url)}
                style={[styles.thumbRemove, { backgroundColor: t.bg }]}
                accessibilityRole="button"
                accessibilityLabel={tr('bookingDetails.removePhoto') || 'Remove photo'}
                hitSlop={8}
              >
                <Text style={{ color: t.text, fontSize: 13, fontWeight: '700' }}>×</Text>
              </Pressable>
            </View>
          ))}

          {evidence.length < MAX_PHOTOS ? (
            <Pressable
              onPress={handleAddPhotos}
              disabled={uploading}
              style={[
                styles.addTile,
                {
                  borderColor: evidenceMissing ? t.danger : t.border,
                  backgroundColor: t.surface,
                },
              ]}
              accessibilityRole="button"
              accessibilityLabel={tr('bookingDetails.addPhoto') || 'Add photo'}
            >
              {uploading ? (
                <ActivityIndicator color={t.text2} />
              ) : (
                <Text style={{ color: t.text2, fontSize: 24, fontWeight: '300' }}>+</Text>
              )}
            </Pressable>
          ) : null}
        </View>

        {evidenceMissing ? (
          <Text style={[VispText.eyebrow, { color: t.danger, marginTop: 8 }]}>
            {tr('bookingDetails.evidenceRequired') ||
              'This service needs at least one photo before booking.'}
          </Text>
        ) : null}

        {/* ── 3. Nota extra ─────────────────────────────────────────── */}
        <View style={styles.sectionGap} />
        <Eyebrow>{(tr('bookingDetails.noteLabel') || 'Anything else').toUpperCase()}</Eyebrow>
        <Text style={[VispText.body, { color: t.text2, marginBottom: 10 }]}>
          {tr('bookingDetails.noteHelp') ||
            'Optional. Anything that does not fit above — a nervous dog, a tricky gate.'}
        </Text>
        <TextInput
          style={[
            styles.input,
            styles.inputNote,
            { color: t.text, backgroundColor: t.surface, borderColor: t.border },
          ]}
          value={extraNote}
          onChangeText={setExtraNote}
          placeholder={tr('bookingDetails.notePlaceholder') || 'Optional note'}
          placeholderTextColor={t.text3}
          multiline
          maxLength={2000}
          textAlignVertical="top"
        />
      </ScrollView>

      {/* Barra de acción fija */}
      <View style={[styles.footer, { borderTopColor: t.border, backgroundColor: t.bg }]}>
        <Pressable
          onPress={handleContinue}
          disabled={!canContinue}
          style={[
            styles.cta,
            { backgroundColor: canContinue ? t.violet : t.surface },
          ]}
          accessibilityRole="button"
          accessibilityState={{ disabled: !canContinue }}
        >
          <Text
            style={[
              VispText.bodyStrong,
              { color: canContinue ? '#FFFFFF' : t.text3 },
            ]}
          >
            {tr('common.continue') || 'Continue'}
          </Text>
        </Pressable>
      </View>
    </Screen>
  );
}

/**
 * Mayúscula inicial, solo para pintar.
 *
 * El catálogo lo escriben personas distintas y se nota: conviven "yes" y "Yes",
 * "no" y "No", "what is the bed sizing?" con "Approximate size of garage?". No
 * tocamos la base de datos por esto —el admin debe poder escribir lo que quiera—
 * pero tampoco hace falta enseñar la inconsistencia.
 */
function mayus(s: string): string {
  return s.length > 0 ? s[0].toUpperCase() + s.slice(1) : s;
}

interface QuestionCardProps {
  q: ServiceQuestion;
  index: number;
  value: string;
  uploading: boolean;
  onAnswer: (txt: string) => void;
  onPickPhoto: () => void;
}

/**
 * Una pregunta del servicio, con su respuesta dentro.
 *
 * La ficha existe para AGRUPAR: pregunta y respuesta comparten fondo y borde, y
 * así ocho preguntas seguidas se leen como ocho bloques y no como una columna de
 * texto suelto sobre negro.
 *
 * El borde es además el estado: gris sin contestar, lavanda al contestar, rojo si
 * falta y es obligatoria. Es la única señal de progreso que se ve sin leer.
 */
function QuestionCard({
  q,
  index,
  value,
  uploading,
  onAnswer,
  onPickPhoto,
}: QuestionCardProps): React.JSX.Element {
  const t = useVispTheme();
  const { t: tr } = useTranslation();

  const contestada = value.trim() !== '';
  const falta = q.isRequired && !contestada;
  const opciones = q.options ?? [];

  // Opciones largas, o muchas, van en lista vertical. En fila de píldoras, una
  // opción como "Some boards appear rotten or structurally damaged" se parte en
  // dos líneas y deja de parecer un botón; con siete de esas, la fila es un muro.
  const comoLista =
    opciones.some((o) => (o.en ?? '').length > 14) || opciones.length > 4;

  const borde = falta ? t.danger : contestada ? t.violetLine : t.border;

  return (
    <View style={[styles.qCard, { backgroundColor: t.surface, borderColor: borde }]}>
      <View style={styles.qHead}>
        <Text style={[VispText.caption, { color: contestada ? t.violet : t.text3 }]}>
          {String(index + 1).padStart(2, '0')}
        </Text>
        {/* Solo se marca lo OPCIONAL. Casi todas las preguntas del catálogo son
            obligatorias, y un asterisco en cada una es ruido que no informa. */}
        {!q.isRequired ? (
          <Text style={[VispText.chip, { color: t.text3 }]}>
            {tr('bookingDetails.optional') || 'Optional'}
          </Text>
        ) : null}
      </View>

      <Text style={[styles.qText, { color: t.text }]}>{mayus(q.questionEn)}</Text>

      {q.answerType === 'SINGLE_CHOICE' ? (
        <View
          style={comoLista ? styles.optCol : styles.optRow}
          accessibilityRole="radiogroup"
        >
          {opciones.map((opt) => {
            const activo = value === opt.en;
            return (
              <Pressable
                key={opt.en}
                onPress={() => onAnswer(activo ? '' : opt.en)}
                style={[
                  comoLista ? styles.optListItem : styles.optChip,
                  {
                    borderColor: activo ? t.violet : t.border,
                    backgroundColor: activo ? t.violetDim : t.bg,
                  },
                ]}
                accessibilityRole="radio"
                accessibilityState={{ selected: activo }}
                accessibilityLabel={mayus(opt.en)}
              >
                {comoLista ? (
                  <View
                    style={[
                      styles.radio,
                      { borderColor: activo ? t.violet : t.borderStrong },
                    ]}
                  >
                    {activo ? (
                      <View style={[styles.radioDot, { backgroundColor: t.violet }]} />
                    ) : null}
                  </View>
                ) : null}
                <Text
                  style={[
                    VispText.body,
                    { color: activo ? t.text : t.text2, flexShrink: 1 },
                  ]}
                >
                  {mayus(opt.en)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : q.answerType === 'IMAGE' ? (
        /* Pregunta de FOTO. El caso que la pidió es el color de pintura: descrito
           con palabras no sirve, la foto de la pared sí. Se sube igual que la
           evidencia y se guarda la URL como respuesta. */
        <Pressable
          onPress={onPickPhoto}
          disabled={uploading}
          style={[styles.photoAnswer, { borderColor: t.border, backgroundColor: t.bg }]}
          accessibilityRole="button"
          accessibilityLabel={tr('bookingDetails.answerPhoto') || 'Add a photo'}
        >
          {value ? (
            <Image
              source={{ uri: resolveUploadUrl(value) ?? value }}
              style={styles.photoAnswerImg}
            />
          ) : (
            <Text style={[VispText.body, { color: t.text2 }]}>
              {uploading
                ? tr('common.loading') || 'Uploading…'
                : tr('bookingDetails.answerPhoto') || '+ Add a photo'}
            </Text>
          )}
        </Pressable>
      ) : (
        /* Las respuestas de texto del catálogo son casi siempre cortas ("3",
           "2-car", "front and back"). Una caja de 80px para eso pide un ensayo
           que nadie escribe y deja la ficha medio vacía. */
        <TextInput
          style={[
            styles.input,
            styles.inputAnswer,
            { color: t.text, backgroundColor: t.bg, borderColor: t.border },
          ]}
          value={value}
          onChangeText={onAnswer}
          placeholder={tr('bookingDetails.answerPlaceholder') || 'Your answer'}
          placeholderTextColor={t.text3}
          multiline
          maxLength={2000}
          textAlignVertical="top"
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: {
    paddingHorizontal: VispSpace.gutter,
    // Sin esto el último campo queda bajo la barra de acción.
    paddingBottom: 32,
  },
  sectionGap: { height: 26 },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  // ── Ficha de pregunta ──────────────────────────────────────
  qCard: {
    borderWidth: 1,
    borderRadius: VispRadius.cardLg,
    padding: 16,
    marginBottom: 10,
  },
  qHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  // 16px con interlineado 22: la pregunta es el contenido de la ficha, no una
  // etiqueta. A 10px en mayúsculas espaciadas —como estaba— una frase larga
  // obliga a leer letra a letra.
  qText: {
    fontFamily: FontSansSemiBold,
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 22,
  },
  optRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  // 44px de alto mínimo: por debajo de eso el dedo falla (regla de toque iOS).
  optChip: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderRadius: VispRadius.pill,
    borderWidth: 1,
  },
  optCol: { gap: 8, marginTop: 12 },
  optListItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 48,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: VispRadius.card,
    borderWidth: 1,
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
  // Materiales
  materialsToggle: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 14,
    borderRadius: VispRadius.card,
    borderWidth: 1,
    marginTop: 8,
  },
  materialsToggleText: { flex: 1 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  checkboxMark: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  // Respuesta de tipo foto
  photoAnswer: {
    height: 96,
    borderRadius: VispRadius.card,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    overflow: 'hidden',
  },
  photoAnswerImg: { width: '100%', height: '100%' },
  input: {
    borderWidth: 1,
    borderRadius: VispRadius.card,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 12,
    fontSize: 15,
    marginTop: 8,
  },
  inputMultiline: { minHeight: 120 },
  inputNote: { minHeight: 80 },
  inputAnswer: { minHeight: 52 },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 6,
    gap: 12,
  },
  thumbRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  thumbWrap: {
    width: 82,
    height: 82,
    borderRadius: VispRadius.card,
    borderWidth: 1,
    overflow: 'hidden',
  },
  thumb: { width: '100%', height: '100%' },
  thumbRemove: {
    position: 'absolute',
    top: 2,
    right: 2,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addTile: {
    width: 82,
    height: 82,
    borderRadius: VispRadius.card,
    borderWidth: 1,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: VispSpace.gutter,
    paddingTop: 12,
    paddingBottom: Platform.OS === 'ios' ? 8 : 12,
  },
  cta: {
    height: 52,
    borderRadius: VispRadius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
