/**
 * VISP - BookingScreen (Confirm Booking)
 *
 * Confirmation / review screen for a booking.
 * All data (address, date, time, priority, notes) comes pre-populated
 * from the TaskSelectionScreen. Each section has an "Edit" link that
 * navigates back so the user can modify their choices.
 *
 * The only interactive elements here are:
 *   - Legal acknowledgment checkboxes (mandatory)
 *   - "Confirm Booking" button
 *   - "Edit" links to go back
 *
 * On confirm: POST /api/v1/jobs, then navigate to MatchingScreen.
 *
 * CRITICAL: Legal checkboxes are MANDATORY before booking.
 * CRITICAL: No free-text task descriptions. Closed catalog only.
 *
 * Glass redesign: GlassBackground + GlassCard (dark) + GlassButton (glow)
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Colors, getLevelColor } from '../../theme/colors';
import { useTheme } from '../../theme/ThemeContext';
import { useTranslation } from '../../i18n';
import { Spacing } from '../../theme/spacing';
import { Typography, FontWeight, FontSize } from '../../theme/typography';
import { BorderRadius } from '../../theme/borders';
import { GlassStyles } from '../../theme/glass';
import { GlassCard, GlassButton } from '../../components/glass';
import { Screen } from '../../components/visp';
import LevelBadge from '../../components/LevelBadge';
import { taskService, PRIORITY_OPTIONS, PREDEFINED_NOTES } from '../../services/taskService';
import { unitSuffix } from '../../services/offerService';
import { paymentService } from '../../services/paymentService';
import { patch } from '../../services/apiClient';
import { useAuthStore } from '../../stores/authStore';
import { useTaskStore } from '../../stores/taskStore';
import type { CustomerFlowParamList, UserDefaultAddress } from '../../types';

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

type BookingRouteProp = RouteProp<CustomerFlowParamList, 'Booking'>;
type BookingNavProp = NativeStackNavigationProp<CustomerFlowParamList, 'Booking'>;

const LEVEL_LABELS: Record<number, string> = {
  1: 'General Help',
  2: 'Experienced',
  3: 'Certified Pro',
  4: 'Emergency',
};

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

/** Format "2026-02-15" to "Sat, Feb 15, 2026" */
function formatDisplayDate(dateString?: string): string {
  if (!dateString) return 'Flexible';
  const date = new Date(dateString + 'T00:00:00');
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  return `${dayNames[date.getDay()]}, ${monthNames[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

/** Format "14:00" to "2:00 PM" */
function formatDisplayTime(time?: string): string {
  if (!time) return 'Flexible';
  const [h, m] = time.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const displayHour = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${displayHour}:${(m ?? 0).toString().padStart(2, '0')} ${ampm}`;
}

// ──────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────

function BookingScreen(): React.JSX.Element {
  const theme = useTheme();
  const { t } = useTranslation();
  const route = useRoute<BookingRouteProp>();
  const navigation = useNavigation<BookingNavProp>();
  const { task } = route.params;

  // Lo que el cliente rellenó en "More info" vive en el store, no en los params.
  const {
    details,
    evidence,
    extraNote,
    answers,
    materialsRequested,
    materialsBudget,
    contractRate,
    contractHours,
    resetBookingForm,
  } = useTaskStore();

  // Legal consent state
  const [consentIndependent, setConsentIndependent] = useState(false);
  const [consentScope, setConsentScope] = useState(false);
  const [consentPricing, setConsentPricing] = useState(false);

  // Emergency-specific SLA consent
  const isEmergency = task.level === 4;
  const [consentSLA, setConsentSLA] = useState(false);

  // El estado de pago vivía aquí para pintar el progreso de la retención; esa
  // retención se mudó a la aceptación de la oferta y nadie lo leía ya.
  const stripeCustomerId = useAuthStore((s) => s.user?.stripeCustomerId);

  // Loading
  const [isSubmitting, setIsSubmitting] = useState(false);

  // PP5 — quantity picker for per-unit/per-area tasks (fetched from task detail)
  const [allowsQuantity, setAllowsQuantity] = useState(false);
  const [pricingUnit, setPricingUnit] = useState<string | null>(null);
  const [minQuantity, setMinQuantity] = useState(1);
  const [quantity, setQuantity] = useState(1);

  useEffect(() => {
    let active = true;
    taskService.fetchTaskDetail(task.taskId)
      .then((detail) => {
        if (!active) return;
        const minQ = detail.minQuantity && detail.minQuantity > 0 ? detail.minQuantity : 1;
        setAllowsQuantity(Boolean(detail.allowsQuantity));
        setPricingUnit(detail.pricingUnit ?? null);
        setMinQuantity(minQ);
        setQuantity(minQ);
      })
      .catch(() => { /* picker stays hidden; backend defaults the quantity */ });
    return () => { active = false; };
  }, [task.taskId]);

  const levelColor = getLevelColor(task.level);

  // Get priority label and color
  const priorityOption = useMemo(
    () => PRIORITY_OPTIONS.find(p => p.value === (task.priority ?? 'standard')),
    [task.priority],
  );

  // Get selected note labels
  const selectedNoteLabels = useMemo(() => {
    if (!task.selectedNotes || task.selectedNotes.length === 0) return [];
    return task.selectedNotes
      .map(noteId => PREDEFINED_NOTES.find(n => n.id === noteId))
      .filter(Boolean)
      .map(n => n!.label);
  }, [task.selectedNotes]);

  // Set header title
  useEffect(() => {
    navigation.setOptions({ title: 'Confirm Booking' });
  }, [navigation]);

  // Form validation
  const allConsentsAccepted = useMemo(() => {
    const baseConsents = consentIndependent && consentScope && consentPricing;
    if (isEmergency) {
      return baseConsents && consentSLA;
    }
    return baseConsents;
  }, [consentIndependent, consentScope, consentPricing, consentSLA, isEmergency]);

  const isFormValid = allConsentsAccepted;

  // Navigate back to edit
  const handleEdit = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  // Submit booking
  const handleConfirmBooking = useCallback(async () => {
    if (!isFormValid) return;

    setIsSubmitting(true);

    try {
      const result = await taskService.createBooking({
        taskId: task.taskId,
        address: task.address ?? {
          formattedAddress: '',
          latitude: 0,
          longitude: 0,
          street: '',
          city: '',
          province: '',
          postalCode: '',
          country: 'CA',
          placeId: '',
          streetNumber: '',
        },
        scheduledDate: task.scheduledDate ?? '',
        scheduledTimeSlot: task.scheduledTimeSlot ?? '',
        isFlexibleSchedule: task.isFlexibleSchedule ?? false,
        priority: task.priority ?? 'standard',
        selectedNotes: task.selectedNotes ?? [],
        quantity: allowsQuantity
          ? quantity
          : contractHours
            ? parseFloat(contractHours) || undefined
            : undefined,

        // TODO NO: esto NO es opcional. Sin estos campos, todo lo que el cliente
        // aporta en "More info" —descripción, fotos, respuestas a las preguntas
        // del servicio, nota, materiales y la tarifa de contrato— se quedaba en
        // el store y NUNCA llegaba al backend.
        //
        // Esta pantalla arma su propia petición en vez de usar
        // `taskStore.submitBooking`, que sí los incluía, y la diferencia pasó
        // desapercibida porque solo revienta cuando el servicio EXIGE foto o
        // detalles: entonces el backend rechaza con 400 "needs at least one
        // photo" justo después de que el cliente acabara de subirla.
        details: details.trim() || undefined,
        evidence: evidence.length > 0 ? evidence : undefined,
        extraNote: extraNote.trim() || undefined,
        answers: Object.entries(answers)
          .filter(([, v]) => (v ?? '').trim() !== '')
          .map(([questionId, answer]) => ({ questionId, answer: answer.trim() })),
        materialsRequested,
        materialsBudgetCents: materialsBudget
          ? Math.round(parseFloat(materialsBudget) * 100) || undefined
          : undefined,
        customerRateCents: contractRate
          ? Math.round(parseFloat(contractRate) * 100) || undefined
          : undefined,
      });

      // AQUÍ NO SE RETIENE DINERO. Antes se creaba un PaymentIntent con la media
      // del rango del catálogo, porque el precio se conocía al reservar. Con las
      // ofertas ya no: al publicar el trabajo no hay ni tarifa ni tiempo, y puede
      // que no llegue ninguna oferta. Retener sobre una cifra inventada bloquearía
      // el saldo del cliente por un trabajo que quizá nunca ocurra, y por un
      // importe que no se parece al final.
      //
      // La retención vive ahora en OffersScreen, al aceptar una oferta: primer
      // instante en que existe un precio real.
      //
      // Lo único que sí conviene adelantar es el cliente de Stripe: crearlo aquí
      // evita que ese trámite se cruce con la aceptación de la oferta.
      if (!stripeCustomerId) {
        try {
          const nuevoId = await paymentService.ensureStripeCustomer();
          const usuario = useAuthStore.getState().user;
          if (usuario && nuevoId) {
            useAuthStore.getState().setUser({ ...usuario, stripeCustomerId: nuevoId });
          }
        } catch (custErr) {
          console.warn('[BookingScreen] Auto-create Stripe customer failed:', custErr);
        }
      }

      // Auto-save address as default if user doesn't have one yet
      const currentUser = useAuthStore.getState().user;
      if (currentUser && !currentUser.defaultAddress && task.address) {
        const addressPayload: UserDefaultAddress = {
          street: task.address.street || task.address.formattedAddress,
          city: task.address.city || '',
          province: task.address.province || '',
          postalCode: task.address.postalCode || '',
          country: task.address.country || 'CA',
          latitude: task.address.latitude,
          longitude: task.address.longitude,
          formattedAddress: task.address.formattedAddress,
        };
        // Fire-and-forget — don't block the booking flow
        patch('/users/me', { defaultAddress: addressPayload })
          .then(() => {
            useAuthStore.getState().setUser({
              ...currentUser,
              defaultAddress: addressPayload,
            });
          })
          .catch((err) => {
            console.warn('[BookingScreen] Auto-save address failed:', err);
          });
      }

      resetBookingForm();

      navigation.navigate('Matching', {
        jobId: result.bookingId,
        taskName: task.taskName,
      });
    } catch (error: any) {
      console.error('[BookingScreen] Booking failed:', JSON.stringify(error));
      // apiClient interceptor normalizes errors to ApiError: { message, statusCode, code }
      const statusCode = error?.statusCode ?? error?.response?.status ?? 0;
      const detail = error?.message ?? error?.response?.data?.detail ?? 'Unknown error';
      console.error('[BookingScreen] Status:', statusCode, 'Detail:', detail);
      if (statusCode === 401) {
        Alert.alert(
          'Session Expired',
          'Your session has expired. Please log in again to complete your booking.',
        );
      } else {
        Alert.alert(
          'Booking Failed',
          `Unable to create your booking. ${detail}`,
        );
      }
    } finally {
      setIsSubmitting(false);
    }
  }, [
    isFormValid,
    task,
    navigation,
    allowsQuantity,
    quantity,
    details,
    evidence,
    extraNote,
    answers,
    materialsRequested,
    materialsBudget,
    contractRate,
    contractHours,
    stripeCustomerId,
    resetBookingForm,
  ]);

  return (
    <Screen>
      <View style={styles.container}>
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* ── Header ────────────────── */}
          <View style={styles.headerSection}>
            <Text style={[styles.headerTitle, { color: theme.textPrimary }]}>Review Your Booking</Text>
            <Text style={[styles.headerSubtitle, { color: theme.textSecondary }]}>
              Please review all details below before confirming.
            </Text>
          </View>

          {/* ── Task Summary ────────────────── */}
          <View style={styles.section}>
            <GlassCard variant="dark">
              <View style={styles.taskCardHeader}>
                <Text style={[styles.taskCardName, { color: theme.textPrimary }]}>{task.taskName}</Text>
                <LevelBadge level={task.level} size="small" />
              </View>
              <Text style={[styles.taskCardDescription, { color: theme.textSecondary }]} numberOfLines={2}>
                {task.description}
              </Text>
              <View style={styles.taskCardMeta}>
                <View style={styles.metaItem}>
                  <Text style={[styles.metaLabel, { color: theme.textSecondary }]}>Level</Text>
                  <Text style={[styles.metaValue, { color: levelColor }]}>
                    {LEVEL_LABELS[task.level]}
                  </Text>
                </View>
                {/* La DURACIÓN salió de aquí (ofertas v2, 2026-08-20). La estimación
                    del catálogo era una media que no describía este trabajo, y ahora
                    quien dice cuánto tarda es el proveedor en su oferta: enseñar un
                    número nuestro al lado del suyo solo genera discusiones. */}
                <View style={styles.metaItem}>
                  <Text style={[styles.metaLabel, { color: theme.textSecondary }]}>Rate</Text>
                  <Text style={[styles.metaValue, { color: Colors.primary }]}>
                    ${task.priceRangeMin} - ${task.priceRangeMax}
                    <Text style={styles.metaUnit}>{unitSuffix(pricingUnit)}</Text>
                  </Text>
                </View>
              </View>
            </GlassCard>
          </View>

          {/* ── Service Location ────────────────── */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, { color: theme.textPrimary }]}>Service Location</Text>
              <TouchableOpacity onPress={handleEdit} activeOpacity={0.7}>
                <Text style={styles.editLink}>Edit</Text>
              </TouchableOpacity>
            </View>
            <GlassCard variant="standard">
              <View style={styles.reviewCardRow}>
                <Text style={[styles.reviewCardIcon, { color: theme.textSecondary }]}>P</Text>
                <View style={styles.reviewCardContent}>
                  <Text style={[styles.reviewCardPrimary, { color: theme.textPrimary }]}>
                    {task.address?.formattedAddress ?? 'No address provided'}
                  </Text>
                  {task.address?.city ? (
                    <Text style={[styles.reviewCardSecondary, { color: theme.textSecondary }]}>
                      {task.address.city}
                      {task.address.province ? `, ${task.address.province}` : ''}
                      {task.address.postalCode ? ` ${task.address.postalCode}` : ''}
                    </Text>
                  ) : null}
                </View>
              </View>
            </GlassCard>
          </View>

          {/* ── Schedule ────────────────── */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, { color: theme.textPrimary }]}>Schedule</Text>
              <TouchableOpacity onPress={handleEdit} activeOpacity={0.7}>
                <Text style={styles.editLink}>Edit</Text>
              </TouchableOpacity>
            </View>
            <GlassCard variant="standard">
              <View style={styles.reviewCardRow}>
                <Text style={[styles.reviewCardIcon, { color: theme.textSecondary }]}>C</Text>
                <View style={styles.reviewCardContent}>
                  {task.isFlexibleSchedule ? (
                    <>
                      <Text style={[styles.reviewCardPrimary, { color: theme.textPrimary }]}>Flexible Schedule</Text>
                      <Text style={[styles.reviewCardSecondary, { color: theme.textSecondary }]}>
                        We'll find the best available time for you
                      </Text>
                    </>
                  ) : (
                    <>
                      <Text style={[styles.reviewCardPrimary, { color: theme.textPrimary }]}>
                        {formatDisplayDate(task.scheduledDate)}
                      </Text>
                      <Text style={[styles.reviewCardSecondary, { color: theme.textSecondary }]}>
                        {formatDisplayTime(task.scheduledTimeSlot)}
                      </Text>
                    </>
                  )}
                </View>
              </View>
            </GlassCard>
          </View>

          {/* ── Priority: FUERA de la v1 ──────────────────────────────────
              Decisión del cliente (2026-08-11): todo es STANDARD en esta fase.
              Se comenta en lugar de borrar: el selector de TaskSelectionScreen,
              el enum job_priority y los multiplicadores de pricing siguen
              intactos, así que reactivarlo es descomentar.

              <View style={styles.section}>
              <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, { color: theme.textPrimary }]}>Priority</Text>
              <TouchableOpacity onPress={handleEdit} activeOpacity={0.7}>
              <Text style={styles.editLink}>Edit</Text>
              </TouchableOpacity>
              </View>
              <GlassCard variant="standard">
              <View style={styles.reviewCardRow}>
              <View
              style={[
              styles.priorityDot,
              { backgroundColor: priorityOption?.color ?? Colors.success },
              ]}
              />
              <View style={styles.reviewCardContent}>
              <Text style={[styles.reviewCardPrimary, { color: theme.textPrimary }]}>
              {priorityOption?.label ?? 'Standard'}
              </Text>
              <Text style={[styles.reviewCardSecondary, { color: theme.textSecondary }]}>
              {priorityOption?.description ?? ''}
              </Text>
              {(priorityOption?.multiplier ?? 1) > 1 && (
              <Text style={[styles.multiplierBadge, { color: priorityOption?.color }]}>
              {priorityOption?.multiplier}x rate
              </Text>
              )}
              </View>
              </View>
              </GlassCard>
              </View>

          --- fin del bloque comentado --- */}


          {/* ── Quantity (PP5 — per-unit/per-area tasks) ────────────────── */}
          {allowsQuantity && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={[styles.sectionTitle, { color: theme.textPrimary }]}>Quantity</Text>
              </View>
              <GlassCard>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14 }}>
                  <Text style={{ color: theme.textSecondary, fontSize: 14 }}>
                    {pricingUnit ? (t(`myPricesScreen.unit.${pricingUnit}`) as string) : ''}
                  </Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <TouchableOpacity
                      onPress={() => setQuantity((q) => Math.max(minQuantity, q - 1))}
                      activeOpacity={0.7}
                      style={{ width: 40, height: 40, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border, alignItems: 'center', justifyContent: 'center' }}
                    >
                      <Text style={{ color: theme.textPrimary, fontSize: 22, fontWeight: '600' }}>−</Text>
                    </TouchableOpacity>
                    <Text style={{ minWidth: 56, textAlign: 'center', color: theme.textPrimary, fontSize: 18, fontWeight: '700' }}>
                      {quantity}
                    </Text>
                    <TouchableOpacity
                      onPress={() => setQuantity((q) => q + 1)}
                      activeOpacity={0.7}
                      style={{ width: 40, height: 40, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border, alignItems: 'center', justifyContent: 'center' }}
                    >
                      <Text style={{ color: theme.textPrimary, fontSize: 22, fontWeight: '600' }}>＋</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </GlassCard>
            </View>
          )}

          {/* ── Additional Notes ────────────────── */}
          {selectedNoteLabels.length > 0 && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={[styles.sectionTitle, { color: theme.textPrimary }]}>Additional Info</Text>
                <TouchableOpacity onPress={handleEdit} activeOpacity={0.7}>
                  <Text style={styles.editLink}>Edit</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.notesContainer}>
                {selectedNoteLabels.map((label, idx) => (
                  <View key={idx} style={styles.noteTag}>
                    <Text style={[styles.noteTagText, { color: theme.textPrimary }]}>  {label}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* ── Emergency SLA Notice ────────────────── */}
          {isEmergency && (
            <View style={styles.section}>
              <View style={styles.slaCard}>
                <Text style={styles.slaTitle}>Emergency SLA Terms</Text>
                <Text style={[styles.slaText, { color: theme.textSecondary }]}>
                  Emergency services (Level 4) include a guaranteed response
                  time. A provider will be dispatched within 30 minutes.
                  Emergency pricing applies at a minimum of $150 base charge
                  plus hourly rate. Cancellation after provider dispatch incurs
                  a fee.
                </Text>
              </View>
            </View>
          )}

          {/* ── Legal Acknowledgments ────────────────── */}
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: theme.textPrimary }]}>Legal Acknowledgments</Text>
            <Text style={[styles.legalSubtitle, { color: theme.textSecondary }]}>
              You must accept all terms before booking
            </Text>

            {/* Consent 1: Independent providers */}
            <TouchableOpacity
              style={styles.checkboxRow}
              onPress={() => setConsentIndependent(!consentIndependent)}
              activeOpacity={0.7}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: consentIndependent }}
            >
              <View
                style={[
                  styles.checkbox,
                  consentIndependent && styles.checkboxChecked,
                ]}
              >
                {consentIndependent && (
                  <Text style={[styles.checkmark, { color: theme.textPrimary }]}>✓</Text>
                )}
              </View>
              <Text style={[styles.checkboxLabel, { color: theme.textSecondary }]}>
                I understand VISP connects me with independent service
                providers. VISP is a platform intermediary and does not
                directly provide the services.
              </Text>
            </TouchableOpacity>

            {/* Consent 2: Service scope */}
            <TouchableOpacity
              style={styles.checkboxRow}
              onPress={() => setConsentScope(!consentScope)}
              activeOpacity={0.7}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: consentScope }}
            >
              <View
                style={[
                  styles.checkbox,
                  consentScope && styles.checkboxChecked,
                ]}
              >
                {consentScope && <Text style={[styles.checkmark, { color: theme.textPrimary }]}>✓</Text>}
              </View>
              <Text style={[styles.checkboxLabel, { color: theme.textSecondary }]}>
                I understand the service is limited to "{task.taskName}" only.
                The provider cannot add scope or perform additional services
                without a separate booking.
              </Text>
            </TouchableOpacity>

            {/* Consent 3: Pricing */}
            <TouchableOpacity
              style={styles.checkboxRow}
              onPress={() => setConsentPricing(!consentPricing)}
              activeOpacity={0.7}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: consentPricing }}
            >
              <View
                style={[
                  styles.checkbox,
                  consentPricing && styles.checkboxChecked,
                ]}
              >
                {consentPricing && <Text style={[styles.checkmark, { color: theme.textPrimary }]}>✓</Text>}
              </View>
              <Text style={[styles.checkboxLabel, { color: theme.textSecondary }]}>
                I accept the estimated pricing of ${task.priceRangeMin} - $
                {task.priceRangeMax}. Final price may vary based on actual scope
                of work. I will be notified of any changes before they are
                applied.
              </Text>
            </TouchableOpacity>

            {/* Consent 4: Emergency SLA (only for Level 4) */}
            {isEmergency && (
              <TouchableOpacity
                style={styles.checkboxRow}
                onPress={() => setConsentSLA(!consentSLA)}
                activeOpacity={0.7}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: consentSLA }}
              >
                <View
                  style={[
                    styles.checkbox,
                    styles.checkboxEmergency,
                    consentSLA && styles.checkboxCheckedEmergency,
                  ]}
                >
                  {consentSLA && <Text style={[styles.checkmark, { color: theme.textPrimary }]}>✓</Text>}
                </View>
                <Text style={[styles.checkboxLabel, { color: theme.textSecondary }]}>
                  I understand emergency pricing applies ($150+ base) and
                  accept the SLA terms. Cancellation after provider dispatch
                  incurs a fee.
                </Text>
              </TouchableOpacity>
            )}
          </View>

          {/* ── Precio ─────────────────────────────
              Una sola tarjeta, sin ramas por nivel (ofertas v2, 2026-08-20).
              Antes había tres —"time-based", "negociado", "emergencia"— y las tres
              enseñaban un TOTAL estimado. Ya no existe tal cosa al reservar: el
              total es `tarifa del proveedor × su estimación`, y ninguna de las dos
              se conoce hasta que llega una oferta. Lo único honesto que se puede
              mostrar aquí es el rango del catálogo con su unidad. */}
          <View style={styles.section}>
            <GlassCard variant="elevated" style={styles.estimateCardBorder}>
              <View style={styles.estimateContent}>
                <Text style={[styles.estimateLabel, { color: theme.textSecondary }]}>
                  Price range
                </Text>
                <Text style={styles.estimatePrice}>
                  ${task.priceRangeMin} - ${task.priceRangeMax}
                  <Text style={styles.estimateUnit}>{unitSuffix(pricingUnit)}</Text>
                </Text>

                {/* En los servicios por ítem el rango SÍ se puede convertir en un
                    total, porque la cantidad la puso el cliente. */}
                {allowsQuantity && quantity > 1 ? (
                  <View style={styles.estimateDetailRow}>
                    <Text style={[styles.estimateDetailLabel, { color: theme.textSecondary }]}>
                      {quantity} × range
                    </Text>
                    <Text style={[styles.estimateDetailValue, { color: theme.textPrimary }]}>
                      ${(task.priceRangeMin * quantity).toFixed(2)} - $
                      {(task.priceRangeMax * quantity).toFixed(2)}
                    </Text>
                  </View>
                ) : null}

                <Text style={[styles.estimateNote, { color: theme.textSecondary }]}>
                  Providers who work in your area will send you offers with their
                  own price and how long they need. You pick the one you want —
                  nothing is charged until you accept an offer.
                </Text>
              </View>
            </GlassCard>
          </View>

          {/* Bottom spacing for CTA */}
          <View style={styles.bottomPadding} />
        </ScrollView>

        {/* ── Confirm Booking CTA ────────────────── */}
        <View style={styles.ctaContainer}>
          <View style={styles.ctaPriceInfo}>
            {/* Siempre RANGO, nunca "estimado": un total en el botón de confirmar
                se lee como el precio que se va a cobrar, y aquí todavía no hay
                precio — lo pondrá la oferta que el cliente elija. */}
            <Text style={[styles.ctaPriceLabel, { color: theme.textSecondary }]}>Range</Text>
            <Text style={[styles.ctaPriceValue, { color: theme.textPrimary }]}>
              {`$${task.priceRangeMin} - $${task.priceRangeMax}`}
              <Text style={styles.ctaPriceUnit}>{unitSuffix(pricingUnit)}</Text>
            </Text>
          </View>
          <GlassButton
            title="Confirm Booking"
            variant={isEmergency ? 'glass' : 'glow'}
            onPress={handleConfirmBooking}
            disabled={!isFormValid || isSubmitting}
            loading={isSubmitting}
            style={isEmergency
              ? { ...styles.confirmButtonStyle, ...styles.confirmButtonEmergency }
              : styles.confirmButtonStyle
            }
          />
        </View>
      </View>
    </Screen>
  );
}

// ──────────────────────────────────────────────
// Styles
// ──────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    // Sin esto el último elemento queda debajo de la tab bar / barra
    // de acción y no se puede alcanzar.
    paddingBottom: 40,
    paddingTop: Spacing.lg,
  },

  // Header
  headerSection: {
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.xl,
  },
  headerTitle: {
    fontSize: FontSize.title2,
    fontWeight: FontWeight.bold as '700',
    color: '#FFFFFF',
    marginBottom: Spacing.xs,
    textShadowColor: 'rgba(0, 0, 0, 0.3)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 10,
  },
  headerSubtitle: {
    ...Typography.footnote,
    color: 'rgba(255, 255, 255, 0.55)',
  },

  // Sections
  section: {
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.xl,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  sectionTitle: {
    ...Typography.headline,
    color: '#FFFFFF',
    textShadowColor: 'rgba(0, 0, 0, 0.2)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },
  editLink: {
    ...Typography.footnote,
    color: 'rgba(120, 80, 255, 0.9)',
    fontWeight: FontWeight.semiBold as '600',
  },

  // Task Card
  taskCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: Spacing.sm,
  },
  taskCardName: {
    ...Typography.title3,
    color: '#FFFFFF',
    flex: 1,
    marginRight: Spacing.sm,
  },
  taskCardDescription: {
    ...Typography.footnote,
    color: 'rgba(255, 255, 255, 0.6)',
    marginBottom: Spacing.lg,
  },
  taskCardMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
    paddingTop: Spacing.md,
  },
  metaItem: {
    alignItems: 'center',
  },
  metaLabel: {
    ...Typography.caption,
    color: 'rgba(255, 255, 255, 0.4)',
    marginBottom: Spacing.xxs,
  },
  metaValue: {
    ...Typography.footnote,
    color: '#FFFFFF',
    fontWeight: FontWeight.semiBold as '600',
  },
  /** Sufijo de unidad ("/hr", "/item"): más pequeño y apagado que la cifra. */
  metaUnit: {
    ...Typography.caption1,
    fontWeight: FontWeight.regular as '400',
    opacity: 0.75,
  },

  // Review Cards (address, schedule, priority)
  reviewCardRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  reviewCardIcon: {
    fontSize: 16,
    color: 'rgba(255, 255, 255, 0.45)',
    fontWeight: FontWeight.bold as '700',
    marginRight: Spacing.md,
    marginTop: 2,
  },
  reviewCardContent: {
    flex: 1,
  },
  reviewCardPrimary: {
    ...Typography.body,
    color: '#FFFFFF',
    fontWeight: FontWeight.medium as '500',
    marginBottom: Spacing.xxs,
  },
  reviewCardSecondary: {
    ...Typography.footnote,
    color: 'rgba(255, 255, 255, 0.55)',
  },

  // Priority dot
  priorityDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: Spacing.md,
    marginTop: 6,
  },
  multiplierBadge: {
    ...Typography.caption,
    fontWeight: FontWeight.semiBold as '600',
    marginTop: Spacing.xs,
  },

  // Notes
  notesContainer: {
    gap: Spacing.sm,
  },
  noteTag: {
    backgroundColor: 'rgba(120, 80, 255, 0.12)',
    borderRadius: 12,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderWidth: 1,
    borderColor: 'rgba(120, 80, 255, 0.25)',
  },
  noteTagText: {
    ...Typography.footnote,
    color: '#FFFFFF',
  },

  // SLA Card
  slaCard: {
    backgroundColor: 'rgba(231, 76, 60, 0.1)',
    borderRadius: 16,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: 'rgba(231, 76, 60, 0.25)',
  },
  slaTitle: {
    ...Typography.headline,
    color: Colors.emergencyRed,
    marginBottom: Spacing.sm,
  },
  slaText: {
    ...Typography.footnote,
    color: 'rgba(255, 255, 255, 0.6)',
    lineHeight: 20,
  },

  // Legal Acknowledgments
  legalSubtitle: {
    ...Typography.caption,
    color: 'rgba(255, 255, 255, 0.4)',
    marginBottom: Spacing.lg,
    marginTop: Spacing.xs,
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: Spacing.lg,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.25)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing.md,
    marginTop: 2,
    flexShrink: 0,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  checkboxChecked: {
    backgroundColor: 'rgba(120, 80, 255, 0.8)',
    borderColor: 'rgba(120, 80, 255, 0.9)',
  },
  checkboxEmergency: {
    borderColor: 'rgba(231, 76, 60, 0.6)',
  },
  checkboxCheckedEmergency: {
    backgroundColor: 'rgba(231, 76, 60, 0.8)',
    borderColor: Colors.emergencyRed,
  },
  checkmark: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: FontWeight.bold as '700',
  },
  checkboxLabel: {
    ...Typography.footnote,
    color: 'rgba(255, 255, 255, 0.6)',
    flex: 1,
    lineHeight: 20,
  },

  // Estimate Card
  estimateCardBorder: {
    borderColor: 'rgba(120, 80, 255, 0.4)',
  },
  estimateContent: {
    alignItems: 'center',
  },
  estimateLabel: {
    ...Typography.label,
    color: 'rgba(255, 255, 255, 0.55)',
    marginBottom: Spacing.xs,
  },
  estimatePrice: {
    fontSize: FontSize.title1,
    fontWeight: FontWeight.bold as '700',
    color: Colors.primary,
    marginBottom: Spacing.sm,
  },
  estimateUnit: {
    fontSize: FontSize.callout,
    fontWeight: FontWeight.regular as '400',
    opacity: 0.8,
  },
  estimateDetailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    paddingVertical: Spacing.xs,
  },
  estimateDetailLabel: {
    ...Typography.footnote,
    color: 'rgba(255, 255, 255, 0.55)',
  },
  estimateDetailValue: {
    ...Typography.footnote,
    color: '#FFFFFF',
    fontWeight: FontWeight.semiBold as '600',
  },
  estimateNote: {
    ...Typography.caption,
    color: 'rgba(255, 255, 255, 0.4)',
    textAlign: 'center',
    lineHeight: 16,
    marginTop: Spacing.sm,
  },

  // Bottom padding
  bottomPadding: {
    height: 120,
  },

  // CTA
  ctaContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    backgroundColor: 'rgba(10, 10, 30, 0.85)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -8 },
        shadowOpacity: 0.4,
        shadowRadius: 20,
      },
      android: { elevation: 12 },
    }),
  },
  ctaPriceInfo: {
    flexDirection: 'column',
  },
  ctaPriceLabel: {
    ...Typography.caption,
    color: 'rgba(255, 255, 255, 0.55)',
  },
  ctaPriceValue: {
    fontSize: FontSize.title2,
    fontWeight: FontWeight.bold as '700',
    color: '#FFFFFF',
  },
  ctaPriceUnit: {
    fontSize: FontSize.footnote,
    fontWeight: FontWeight.regular as '400',
    opacity: 0.7,
  },
  confirmButtonStyle: {
    minWidth: 180,
  },
  confirmButtonEmergency: {
    backgroundColor: 'rgba(231, 76, 60, 0.8)',
    borderColor: 'rgba(231, 76, 60, 0.5)',
    ...Platform.select({
      ios: {
        shadowColor: 'rgba(231, 76, 60, 0.6)',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 1,
        shadowRadius: 20,
      },
      android: { elevation: 8 },
    }),
  },
});

export default BookingScreen;
