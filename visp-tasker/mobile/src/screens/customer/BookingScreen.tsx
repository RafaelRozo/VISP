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
import { Spacing } from '../../theme/spacing';
import { Typography, FontWeight, FontSize } from '../../theme/typography';
import { BorderRadius } from '../../theme/borders';
import { GlassStyles } from '../../theme/glass';
import { GlassBackground, GlassCard, GlassButton } from '../../components/glass';
import LevelBadge from '../../components/LevelBadge';
import { taskService, PRIORITY_OPTIONS, PREDEFINED_NOTES } from '../../services/taskService';
import { paymentService } from '../../services/paymentService';
import { useAuthStore } from '../../stores/authStore';
import type { CustomerFlowParamList } from '../../types';

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

/** Format minutes to "2h" or "1h 30m" */
function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  if (rem === 0) return `${hours}h`;
  return `${hours}h ${rem}m`;
}

// ──────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────

function BookingScreen(): React.JSX.Element {
  const route = useRoute<BookingRouteProp>();
  const navigation = useNavigation<BookingNavProp>();
  const { task } = route.params;

  // Legal consent state
  const [consentIndependent, setConsentIndependent] = useState(false);
  const [consentScope, setConsentScope] = useState(false);
  const [consentPricing, setConsentPricing] = useState(false);

  // Emergency-specific SLA consent
  const isEmergency = task.level === 4;
  const [consentSLA, setConsentSLA] = useState(false);

  // Payment state
  const [paymentStatus, setPaymentStatus] = useState<'idle' | 'processing' | 'succeeded' | 'failed'>('idle');
  const stripeCustomerId = useAuthStore((s) => s.user?.stripeCustomerId);

  // Loading
  const [isSubmitting, setIsSubmitting] = useState(false);

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
        estimatedPrice: task.estimatedPrice,
      });

      // Level-aware payment intent creation:
      // L1/L2 (TIME_BASED): create intent now with estimated amount
      // L3/L4 (NEGOTIATED): defer -- intent created after proposal acceptance
      const isTimeBased = task.level <= 2;

      if (isTimeBased) {
        const quotedAmountCents = result.estimatedPrice > 0
          ? Math.round(result.estimatedPrice * 100)
          : Math.round(((task.priceRangeMin + task.priceRangeMax) / 2) * 100);

        if (quotedAmountCents > 0) {
          try {
            setPaymentStatus('processing');

            // Auto-create Stripe customer if the user doesn't have one yet
            let customerIdForPayment = stripeCustomerId ?? null;
            if (!customerIdForPayment) {
              try {
                customerIdForPayment = await paymentService.ensureStripeCustomer();
                // Persist the new stripeCustomerId back to auth store
                const currentUser = useAuthStore.getState().user;
                if (currentUser && customerIdForPayment) {
                  useAuthStore.getState().setUser({
                    ...currentUser,
                    stripeCustomerId: customerIdForPayment,
                  });
                }
              } catch (custErr) {
                console.warn('[BookingScreen] Auto-create Stripe customer failed:', custErr);
                // Non-blocking -- proceed without customer association
              }
            }

            const paymentIntent = await paymentService.createPaymentIntent(
              result.bookingId,
              quotedAmountCents,
              'cad',
              customerIdForPayment,
            );
            console.log('[BookingScreen] PaymentIntent created:', paymentIntent.id, paymentIntent.status);
            setPaymentStatus('succeeded');
          } catch (paymentError: any) {
            console.warn('[BookingScreen] Payment intent creation failed:', paymentError?.message);
            setPaymentStatus('failed');
            // Payment failure is non-blocking -- the job is created and
            // payment can be retried later. Continue to matching.
          }
        }
      } else {
        // L3/L4 NEGOTIATED: payment intent is created after provider
        // proposal is accepted (handled by a separate flow).
        console.log('[BookingScreen] L3/L4 negotiated pricing -- deferring payment intent to proposal acceptance');
      }

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
  }, [isFormValid, task, navigation]);

  return (
    <GlassBackground>
      <View style={styles.container}>
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* ── Header ────────────────── */}
          <View style={styles.headerSection}>
            <Text style={styles.headerTitle}>Review Your Booking</Text>
            <Text style={styles.headerSubtitle}>
              Please review all details below before confirming.
            </Text>
          </View>

          {/* ── Task Summary ────────────────── */}
          <View style={styles.section}>
            <GlassCard variant="dark">
              <View style={styles.taskCardHeader}>
                <Text style={styles.taskCardName}>{task.taskName}</Text>
                <LevelBadge level={task.level} size="small" />
              </View>
              <Text style={styles.taskCardDescription} numberOfLines={2}>
                {task.description}
              </Text>
              <View style={styles.taskCardMeta}>
                <View style={styles.metaItem}>
                  <Text style={styles.metaLabel}>Level</Text>
                  <Text style={[styles.metaValue, { color: levelColor }]}>
                    {LEVEL_LABELS[task.level]}
                  </Text>
                </View>
                <View style={styles.metaItem}>
                  <Text style={styles.metaLabel}>Duration</Text>
                  <Text style={styles.metaValue}>
                    {formatDuration(task.estimatedDurationMinutes)}
                  </Text>
                </View>
                <View style={styles.metaItem}>
                  <Text style={styles.metaLabel}>Estimate</Text>
                  <Text style={[styles.metaValue, { color: Colors.primary }]}>
                    ${task.priceRangeMin} - ${task.priceRangeMax}
                  </Text>
                </View>
              </View>
            </GlassCard>
          </View>

          {/* ── Service Location ────────────────── */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Service Location</Text>
              <TouchableOpacity onPress={handleEdit} activeOpacity={0.7}>
                <Text style={styles.editLink}>Edit</Text>
              </TouchableOpacity>
            </View>
            <GlassCard variant="standard">
              <View style={styles.reviewCardRow}>
                <Text style={styles.reviewCardIcon}>P</Text>
                <View style={styles.reviewCardContent}>
                  <Text style={styles.reviewCardPrimary}>
                    {task.address?.formattedAddress ?? 'No address provided'}
                  </Text>
                  {task.address?.city ? (
                    <Text style={styles.reviewCardSecondary}>
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
              <Text style={styles.sectionTitle}>Schedule</Text>
              <TouchableOpacity onPress={handleEdit} activeOpacity={0.7}>
                <Text style={styles.editLink}>Edit</Text>
              </TouchableOpacity>
            </View>
            <GlassCard variant="standard">
              <View style={styles.reviewCardRow}>
                <Text style={styles.reviewCardIcon}>C</Text>
                <View style={styles.reviewCardContent}>
                  {task.isFlexibleSchedule ? (
                    <>
                      <Text style={styles.reviewCardPrimary}>Flexible Schedule</Text>
                      <Text style={styles.reviewCardSecondary}>
                        We'll find the best available time for you
                      </Text>
                    </>
                  ) : (
                    <>
                      <Text style={styles.reviewCardPrimary}>
                        {formatDisplayDate(task.scheduledDate)}
                      </Text>
                      <Text style={styles.reviewCardSecondary}>
                        {formatDisplayTime(task.scheduledTimeSlot)}
                      </Text>
                    </>
                  )}
                </View>
              </View>
            </GlassCard>
          </View>

          {/* ── Priority ────────────────── */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Priority</Text>
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
                  <Text style={styles.reviewCardPrimary}>
                    {priorityOption?.label ?? 'Standard'}
                  </Text>
                  <Text style={styles.reviewCardSecondary}>
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

          {/* ── Additional Notes ────────────────── */}
          {selectedNoteLabels.length > 0 && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Additional Info</Text>
                <TouchableOpacity onPress={handleEdit} activeOpacity={0.7}>
                  <Text style={styles.editLink}>Edit</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.notesContainer}>
                {selectedNoteLabels.map((label, idx) => (
                  <View key={idx} style={styles.noteTag}>
                    <Text style={styles.noteTagText}>  {label}</Text>
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
                <Text style={styles.slaText}>
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
            <Text style={styles.sectionTitle}>Legal Acknowledgments</Text>
            <Text style={styles.legalSubtitle}>
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
                  <Text style={styles.checkmark}>✓</Text>
                )}
              </View>
              <Text style={styles.checkboxLabel}>
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
                {consentScope && <Text style={styles.checkmark}>✓</Text>}
              </View>
              <Text style={styles.checkboxLabel}>
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
                {consentPricing && <Text style={styles.checkmark}>✓</Text>}
              </View>
              <Text style={styles.checkboxLabel}>
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
                  {consentSLA && <Text style={styles.checkmark}>✓</Text>}
                </View>
                <Text style={styles.checkboxLabel}>
                  I understand emergency pricing applies ($150+ base) and
                  accept the SLA terms. Cancellation after provider dispatch
                  incurs a fee.
                </Text>
              </TouchableOpacity>
            )}
          </View>

          {/* ── Pricing Model Info ────────────────── */}
          <View style={styles.section}>
            <GlassCard variant="elevated" style={styles.estimateCardBorder}>
              {task.level <= 2 ? (
                <View style={styles.estimateContent}>
                  <Text style={styles.estimateLabel}>Time-Based Pricing</Text>
                  <Text style={styles.estimatePrice}>
                    ${task.priceRangeMin} - ${task.priceRangeMax}/hr
                  </Text>
                  <View style={styles.estimateDetailRow}>
                    <Text style={styles.estimateDetailLabel}>Est. Duration</Text>
                    <Text style={styles.estimateDetailValue}>
                      {formatDuration(task.estimatedDurationMinutes)}
                    </Text>
                  </View>
                  <View style={styles.estimateDetailRow}>
                    <Text style={styles.estimateDetailLabel}>Est. Total</Text>
                    <Text style={styles.estimateDetailValue}>
                      ${task.estimatedPrice > 0
                        ? task.estimatedPrice.toFixed(2)
                        : `${task.priceRangeMin} - ${task.priceRangeMax}`}
                    </Text>
                  </View>
                  <Text style={styles.estimateNote}>
                    You are billed based on actual time worked at the provider's
                    hourly rate. Final amount may differ from the estimate.
                  </Text>
                </View>
              ) : task.level === 3 ? (
                <View style={styles.estimateContent}>
                  <Text style={styles.estimateLabel}>Negotiated Pricing</Text>
                  <Text style={styles.estimatePrice}>
                    ${task.priceRangeMin} - ${task.priceRangeMax}
                  </Text>
                  <Text style={styles.estimateNote}>
                    This service requires a price agreement with your provider.
                    The guide range above is for reference. Your provider will
                    submit a proposal after reviewing the job details.
                  </Text>
                </View>
              ) : (
                <View style={styles.estimateContent}>
                  <Text style={[styles.estimateLabel, { color: Colors.emergencyRed }]}>
                    Emergency Pricing
                  </Text>
                  <Text style={[styles.estimatePrice, { color: Colors.emergencyRed }]}>
                    ${task.priceRangeMin} - ${task.priceRangeMax}
                  </Text>
                  <Text style={styles.estimateNote}>
                    Emergency service. Guide range shown above. Additional
                    emergency surcharges, after-hours fees, and minimum charges
                    may apply. Your provider will submit a proposal.
                  </Text>
                </View>
              )}
            </GlassCard>
          </View>

          {/* Bottom spacing for CTA */}
          <View style={styles.bottomPadding} />
        </ScrollView>

        {/* ── Confirm Booking CTA ────────────────── */}
        <View style={styles.ctaContainer}>
          <View style={styles.ctaPriceInfo}>
            <Text style={styles.ctaPriceLabel}>
              {task.estimatedPrice > 0 ? 'Estimated' : 'Range'}
            </Text>
            <Text style={styles.ctaPriceValue}>
              {task.estimatedPrice > 0
                ? `$${task.estimatedPrice.toFixed(2)}`
                : `$${task.priceRangeMin} - $${task.priceRangeMax}`}
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
    </GlassBackground>
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
