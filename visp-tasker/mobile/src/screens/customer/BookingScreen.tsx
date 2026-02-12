/**
 * VISP/Tasker - BookingScreen (Confirm Booking)
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
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  SafeAreaView,
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
import { Shadows } from '../../theme/shadows';
import LevelBadge from '../../components/LevelBadge';
import { taskService, PRIORITY_OPTIONS, PREDEFINED_NOTES } from '../../services/taskService';
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
    <SafeAreaView style={styles.safeArea}>
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
            <View style={styles.taskCard}>
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
            </View>
          </View>

          {/* ── Service Location ────────────────── */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Service Location</Text>
              <TouchableOpacity onPress={handleEdit} activeOpacity={0.7}>
                <Text style={styles.editLink}>Edit</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.reviewCard}>
              <Text style={styles.reviewCardIcon}>📍</Text>
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
          </View>

          {/* ── Schedule ────────────────── */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Schedule</Text>
              <TouchableOpacity onPress={handleEdit} activeOpacity={0.7}>
                <Text style={styles.editLink}>Edit</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.reviewCard}>
              <Text style={styles.reviewCardIcon}>📅</Text>
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
          </View>

          {/* ── Priority ────────────────── */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Priority</Text>
              <TouchableOpacity onPress={handleEdit} activeOpacity={0.7}>
                <Text style={styles.editLink}>Edit</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.reviewCard}>
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
                    <Text style={styles.noteTagText}>✓  {label}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* ── Emergency SLA Notice ────────────────── */}
          {isEmergency && (
            <View style={styles.section}>
              <View style={styles.slaCard}>
                <Text style={styles.slaTitle}>⚠️  Emergency SLA Terms</Text>
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
                I understand Tasker connects me with independent service
                providers. Tasker is a platform intermediary and does not
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

          {/* ── Price Estimate ────────────────── */}
          <View style={styles.section}>
            <View style={styles.estimateCard}>
              <Text style={styles.estimateLabel}>Estimated Total</Text>
              <Text style={styles.estimatePrice}>
                ${task.estimatedPrice > 0
                  ? task.estimatedPrice.toFixed(2)
                  : `${task.priceRangeMin} - ${task.priceRangeMax}`}
              </Text>
              <Text style={styles.estimateNote}>
                Final price depends on actual scope of work and provider
                availability. You will be notified of any changes.
              </Text>
            </View>
          </View>

          {/* Bottom spacing for CTA */}
          <View style={styles.bottomPadding} />
        </ScrollView>

        {/* ── Confirm Booking CTA ────────────────── */}
        <View style={styles.ctaContainer}>
          <View style={styles.ctaPriceInfo}>
            <Text style={styles.ctaPriceLabel}>
              {task.estimatedPrice > 0 ? 'Estimated' : 'From'}
            </Text>
            <Text style={styles.ctaPriceValue}>
              {task.estimatedPrice > 0
                ? `$${task.estimatedPrice.toFixed(2)}`
                : `$${task.priceRangeMin} - $${task.priceRangeMax}`}
            </Text>
          </View>
          <TouchableOpacity
            style={[
              styles.confirmButton,
              isEmergency && styles.confirmButtonEmergency,
              (!isFormValid || isSubmitting) && styles.confirmButtonDisabled,
            ]}
            onPress={handleConfirmBooking}
            disabled={!isFormValid || isSubmitting}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Confirm booking"
            accessibilityState={{ disabled: !isFormValid || isSubmitting }}
          >
            {isSubmitting ? (
              <ActivityIndicator size="small" color={Colors.white} />
            ) : (
              <Text style={styles.confirmButtonText}>Confirm Booking</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

// ──────────────────────────────────────────────
// Styles
// ──────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  container: {
    flex: 1,
    backgroundColor: Colors.background,
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
    color: Colors.textPrimary,
    marginBottom: Spacing.xs,
  },
  headerSubtitle: {
    ...Typography.footnote,
    color: Colors.textSecondary,
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
    color: Colors.textPrimary,
  },
  editLink: {
    ...Typography.footnote,
    color: Colors.primary,
    fontWeight: FontWeight.semiBold as '600',
  },

  // Task Card
  taskCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  taskCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: Spacing.sm,
  },
  taskCardName: {
    ...Typography.title3,
    color: Colors.textPrimary,
    flex: 1,
    marginRight: Spacing.sm,
  },
  taskCardDescription: {
    ...Typography.footnote,
    color: Colors.textSecondary,
    marginBottom: Spacing.lg,
  },
  taskCardMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: Colors.divider,
    paddingTop: Spacing.md,
  },
  metaItem: {
    alignItems: 'center',
  },
  metaLabel: {
    ...Typography.caption,
    color: Colors.textTertiary,
    marginBottom: Spacing.xxs,
  },
  metaValue: {
    ...Typography.footnote,
    color: Colors.textPrimary,
    fontWeight: FontWeight.semiBold as '600',
  },

  // Review Cards (address, schedule, priority)
  reviewCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  reviewCardIcon: {
    fontSize: 20,
    marginRight: Spacing.md,
    marginTop: 2,
  },
  reviewCardContent: {
    flex: 1,
  },
  reviewCardPrimary: {
    ...Typography.body,
    color: Colors.textPrimary,
    fontWeight: FontWeight.medium as '500',
    marginBottom: Spacing.xxs,
  },
  reviewCardSecondary: {
    ...Typography.footnote,
    color: Colors.textSecondary,
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
    backgroundColor: `${Colors.primary}10`,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderWidth: 1,
    borderColor: `${Colors.primary}25`,
  },
  noteTagText: {
    ...Typography.footnote,
    color: Colors.textPrimary,
  },

  // SLA Card
  slaCard: {
    backgroundColor: `${Colors.emergencyRed}10`,
    borderRadius: BorderRadius.md,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: `${Colors.emergencyRed}30`,
  },
  slaTitle: {
    ...Typography.headline,
    color: Colors.emergencyRed,
    marginBottom: Spacing.sm,
  },
  slaText: {
    ...Typography.footnote,
    color: Colors.textSecondary,
    lineHeight: 20,
  },

  // Legal Acknowledgments
  legalSubtitle: {
    ...Typography.caption,
    color: Colors.textTertiary,
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
    borderRadius: BorderRadius.xs,
    borderWidth: 2,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing.md,
    marginTop: 2,
    flexShrink: 0,
  },
  checkboxChecked: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  checkboxEmergency: {
    borderColor: Colors.emergencyRed,
  },
  checkboxCheckedEmergency: {
    backgroundColor: Colors.emergencyRed,
    borderColor: Colors.emergencyRed,
  },
  checkmark: {
    color: Colors.white,
    fontSize: 14,
    fontWeight: FontWeight.bold as '700',
  },
  checkboxLabel: {
    ...Typography.footnote,
    color: Colors.textSecondary,
    flex: 1,
    lineHeight: 20,
  },

  // Estimate Card
  estimateCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.primary,
    alignItems: 'center',
  },
  estimateLabel: {
    ...Typography.label,
    color: Colors.textSecondary,
    marginBottom: Spacing.xs,
  },
  estimatePrice: {
    fontSize: FontSize.title1,
    fontWeight: FontWeight.bold as '700',
    color: Colors.primary,
    marginBottom: Spacing.sm,
  },
  estimateNote: {
    ...Typography.caption,
    color: Colors.textTertiary,
    textAlign: 'center',
    lineHeight: 16,
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
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    ...Shadows.lg,
  },
  ctaPriceInfo: {
    flexDirection: 'column',
  },
  ctaPriceLabel: {
    ...Typography.caption,
    color: Colors.textSecondary,
  },
  ctaPriceValue: {
    fontSize: FontSize.title2,
    fontWeight: FontWeight.bold as '700',
    color: Colors.textPrimary,
  },
  confirmButton: {
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.xxl,
    paddingVertical: Spacing.md,
    minWidth: 180,
    alignItems: 'center',
    justifyContent: 'center',
    ...Shadows.sm,
  },
  confirmButtonEmergency: {
    backgroundColor: Colors.emergencyRed,
  },
  confirmButtonDisabled: {
    backgroundColor: Colors.textDisabled,
    ...Shadows.none,
  },
  confirmButtonText: {
    ...Typography.buttonLarge,
    color: Colors.white,
  },
});

export default BookingScreen;
