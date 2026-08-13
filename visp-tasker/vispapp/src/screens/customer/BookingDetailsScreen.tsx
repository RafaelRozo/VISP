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
import type { CustomerFlowParamList } from '../../types';

import { Screen, ScreenTitle, Eyebrow } from '../../components/visp';
import { useVispTheme, VispText, VispSpace, VispRadius } from '../../theme/visp';
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
  } = useTaskStore();

  const [uploading, setUploading] = useState(false);

  const requiresDetails = taskDetail?.requiresDetails ?? false;
  const requiresEvidence = taskDetail?.requiresEvidence ?? false;

  // El prompt del propio servicio es lo que orienta al cliente a describir
  // ESCALA Y ACCESO en vez de pedir tareas nuevas. Si el admin no puso uno, se
  // cae a un genérico que sigue anclado al servicio elegido.
  const prompt = useMemo(() => {
    const fromAdmin = taskDetail?.detailsPromptEn?.trim();
    if (fromAdmin) return fromAdmin;
    return tr('bookingDetails.promptFallback') ||
      'Describe the size and access for this service — rooms, area, floor, pets, how we get in.';
  }, [taskDetail?.detailsPromptEn, tr]);

  const questions = useMemo(
    () => [...(taskDetail?.questions ?? [])].sort((a, b) => a.displayOrder - b.displayOrder),
    [taskDetail?.questions],
  );

  const detailsMissing = requiresDetails && details.trim() === '';
  const evidenceMissing = requiresEvidence && evidence.length === 0;
  // Una obligatoria sin responder bloquea igual que los detalles: el backend la
  // rechaza con 400, así que es mejor no dejar avanzar y perder el recorrido.
  const unansweredRequired = questions.filter(
    (q) => q.isRequired && (answers[q.id] ?? '').trim() === '',
  );
  const canContinue =
    !detailsMissing && !evidenceMissing && unansweredRequired.length === 0 && !uploading;

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
          placeholder={prompt}
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

        {/* ── Preguntas del servicio (migraciones 039/040) ───────────
            Texto libre -> textarea. Opción cerrada -> botones de una sola
            selección: en un móvil, tocar una opción es más rápido y menos
            propenso a error que escribir, y la respuesta queda comparable. */}
        {questions.length > 0 ? (
          <>
            <View style={styles.sectionGap} />
            {questions.map((q) => {
              const valor = answers[q.id] ?? '';
              const falta = q.isRequired && valor.trim() === '';
              return (
                <View key={q.id} style={styles.questionBlock}>
                  <Eyebrow>
                    {q.questionEn.toUpperCase()}
                    {q.isRequired ? ' *' : ''}
                  </Eyebrow>

                  {q.answerType === 'SINGLE_CHOICE' ? (
                    <View style={styles.choiceRow}>
                      {(q.options ?? []).map((opt) => {
                        const activo = valor === opt.en;
                        return (
                          <Pressable
                            key={opt.en}
                            onPress={() => setAnswer(q.id, activo ? '' : opt.en)}
                            style={[
                              styles.choice,
                              {
                                borderColor: activo
                                  ? t.violet
                                  : falta
                                    ? t.danger
                                    : t.border,
                                backgroundColor: activo ? t.violetDim : t.surface,
                              },
                            ]}
                            accessibilityRole="radio"
                            accessibilityState={{ selected: activo }}
                          >
                            <Text
                              style={[
                                VispText.body,
                                { color: activo ? t.text : t.text2 },
                              ]}
                            >
                              {opt.en}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  ) : (
                    <TextInput
                      style={[
                        styles.input,
                        styles.inputNote,
                        {
                          color: t.text,
                          backgroundColor: t.surface,
                          borderColor: falta ? t.danger : t.border,
                        },
                      ]}
                      value={valor}
                      onChangeText={(txt) => setAnswer(q.id, txt)}
                      placeholder={tr('bookingDetails.answerPlaceholder') || 'Your answer'}
                      placeholderTextColor={t.text3}
                      multiline
                      maxLength={2000}
                      textAlignVertical="top"
                    />
                  )}

                  {falta ? (
                    <Text style={[VispText.eyebrow, { color: t.danger, marginTop: 6 }]}>
                      {tr('bookingDetails.answerRequired') || 'This answer is required.'}
                    </Text>
                  ) : null}
                </View>
              );
            })}
          </>
        ) : null}

        {/* ── 2. Evidencia ──────────────────────────────────────────── */}
        <View style={styles.sectionGap} />
        <Eyebrow>
          {(tr('bookingDetails.evidenceLabel') || 'Photos').toUpperCase()}
          {requiresEvidence ? ' *' : ''}
          {`  ·  ${evidence.length}/${MAX_PHOTOS}`}
        </Eyebrow>
        <Text style={[VispText.body, { color: t.text3, marginBottom: 10 }]}>
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
        <Text style={[VispText.body, { color: t.text3, marginBottom: 10 }]}>
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

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: {
    paddingHorizontal: VispSpace.gutter,
    // Sin esto el último campo queda bajo la barra de acción.
    paddingBottom: 32,
  },
  sectionGap: { height: 26 },
  questionBlock: { marginBottom: 18 },
  choiceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  choice: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: VispRadius.pill,
    borderWidth: 1,
  },
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
