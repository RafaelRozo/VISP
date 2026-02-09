/**
 * VISP/Tasker - BookingScreen
 *
 * Booking confirmation screen with:
 *   - Selected task summary with level badge
 *   - Location input (device location or manual)
 *   - Schedule picker (Now or date/time)
 *   - Mandatory legal acknowledgment checkboxes
 *   - Confirm Booking button
 *
 * On confirm: POST /api/v1/jobs, then navigate to MatchingScreen.
 * For MVP: if API fails, create a mock job and proceed.
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
  TextInput,
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
import { post } from '../../services/apiClient';
import type { CustomerFlowParamList } from '../../types';

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

type BookingRouteProp = RouteProp<CustomerFlowParamList, 'Booking'>;
type BookingNavProp = NativeStackNavigationProp<CustomerFlowParamList, 'Booking'>;

type ScheduleMode = 'now' | 'scheduled';

interface CalendarDate {
  dateString: string;
  dayOfWeek: string;
  dayOfMonth: number;
  month: string;
  isToday: boolean;
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function generateCalendarDates(count: number): CalendarDate[] {
  const dates: CalendarDate[] = [];
  const now = new Date();
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const monthNames = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];

  for (let i = 1; i <= count; i++) {
    const date = new Date(now);
    date.setDate(date.getDate() + i);
    dates.push({
      dateString: date.toISOString().split('T')[0],
      dayOfWeek: dayNames[date.getDay()],
      dayOfMonth: date.getDate(),
      month: monthNames[date.getMonth()],
      isToday: false,
    });
  }
  return dates;
}

const LEVEL_LABELS: Record<number, string> = {
  1: 'General Help',
  2: 'Experienced',
  3: 'Certified Pro',
  4: 'Emergency',
};

// ──────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────

function BookingScreen(): React.JSX.Element {
  const route = useRoute<BookingRouteProp>();
  const navigation = useNavigation<BookingNavProp>();
  const { task } = route.params;

  // Form state
  const [locationAddress, setLocationAddress] = useState('');
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>('now');
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedTime, setSelectedTime] = useState('');

  // Legal consent state
  const [consentIndependent, setConsentIndependent] = useState(false);
  const [consentScope, setConsentScope] = useState(false);
  const [consentPricing, setConsentPricing] = useState(false);

  // Emergency-specific SLA consent
  const isEmergency = task.level === 4;
  const [consentSLA, setConsentSLA] = useState(false);

  // Loading
  const [isSubmitting, setIsSubmitting] = useState(false);

  const calendarDates = useMemo(() => generateCalendarDates(14), []);

  const levelColor = getLevelColor(task.level);

  // Set header title
  useEffect(() => {
    navigation.setOptions({ title: 'Confirm Booking' });
  }, [navigation]);

  // Time slot options
  const timeSlots = useMemo(() => [
    { id: '08:00', label: '8:00 AM' },
    { id: '09:00', label: '9:00 AM' },
    { id: '10:00', label: '10:00 AM' },
    { id: '11:00', label: '11:00 AM' },
    { id: '12:00', label: '12:00 PM' },
    { id: '13:00', label: '1:00 PM' },
    { id: '14:00', label: '2:00 PM' },
    { id: '15:00', label: '3:00 PM' },
    { id: '16:00', label: '4:00 PM' },
    { id: '17:00', label: '5:00 PM' },
  ], []);

  // Form validation
  const allConsentsAccepted = useMemo(() => {
    const baseConsents = consentIndependent && consentScope && consentPricing;
    if (isEmergency) {
      return baseConsents && consentSLA;
    }
    return baseConsents;
  }, [consentIndependent, consentScope, consentPricing, consentSLA, isEmergency]);

  const hasLocation = locationAddress.trim().length > 0;

  const hasSchedule = useMemo(() => {
    if (scheduleMode === 'now') return true;
    return selectedDate !== '' && selectedTime !== '';
  }, [scheduleMode, selectedDate, selectedTime]);

  const isFormValid = allConsentsAccepted && hasLocation && hasSchedule;

  // Build scheduledAt ISO string
  const buildScheduledAt = useCallback((): string | null => {
    if (scheduleMode === 'now') return null;
    if (!selectedDate || !selectedTime) return null;
    return `${selectedDate}T${selectedTime}:00.000Z`;
  }, [scheduleMode, selectedDate, selectedTime]);

  // Submit booking
  const handleConfirmBooking = useCallback(async () => {
    if (!isFormValid) return;

    setIsSubmitting(true);

    const scheduledAt = buildScheduledAt();

    const payload = {
      serviceTaskId: task.taskId,
      locationAddress,
      locationLat: 43.6532,
      locationLng: -79.3832,
      scheduledAt,
    };

    try {
      const result = await post<{ id: string }>('/jobs', payload);
      navigation.navigate('Matching', {
        jobId: result.id,
        taskName: task.taskName,
      });
    } catch {
      // MVP fallback: create mock job and proceed
      if (__DEV__) {
        console.warn('[BookingScreen] API failed, using mock job for MVP');
        const mockJobId = `job-${Date.now()}`;
        navigation.navigate('Matching', {
          jobId: mockJobId,
          taskName: task.taskName,
        });
      } else {
        Alert.alert(
          'Booking Failed',
          'Unable to create your booking. Please try again.',
        );
      }
    } finally {
      setIsSubmitting(false);
    }
  }, [isFormValid, buildScheduledAt, task, locationAddress, navigation]);

  // Format duration
  const formatDuration = (minutes: number): string => {
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const rem = minutes % 60;
    if (rem === 0) return `${hours}h`;
    return `${hours}h ${rem}m`;
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Task Summary Card */}
          <View style={styles.section}>
            <View style={styles.taskCard}>
              <View style={styles.taskCardHeader}>
                <Text style={styles.taskCardName}>{task.taskName}</Text>
                <LevelBadge level={task.level} size="small" />
              </View>
              <Text style={styles.taskCardCategory}>{task.categoryName}</Text>
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

          {/* Location Input */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Service Location</Text>
            <View style={styles.inputContainer}>
              <Text style={styles.inputIcon}>L</Text>
              <TextInput
                style={styles.textInput}
                placeholder="Enter your address..."
                placeholderTextColor={Colors.inputPlaceholder}
                value={locationAddress}
                onChangeText={setLocationAddress}
                autoCapitalize="words"
                returnKeyType="done"
                accessibilityLabel="Service address"
                accessibilityHint="Enter the address where you need the service"
              />
            </View>
            <TouchableOpacity
              style={styles.useLocationButton}
              onPress={() => {
                setLocationAddress('123 King Street West, Toronto, ON M5V 1A1');
              }}
              activeOpacity={0.7}
              accessibilityLabel="Use current location"
            >
              <Text style={styles.useLocationIcon}>*</Text>
              <Text style={styles.useLocationText}>Use current location</Text>
            </TouchableOpacity>
          </View>

          {/* Schedule */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>When do you need this?</Text>

            {/* Now / Scheduled toggle */}
            <View style={styles.scheduleToggle}>
              <TouchableOpacity
                style={[
                  styles.scheduleToggleBtn,
                  scheduleMode === 'now' && styles.scheduleToggleBtnActive,
                ]}
                onPress={() => setScheduleMode('now')}
                activeOpacity={0.7}
                accessibilityRole="radio"
                accessibilityState={{ selected: scheduleMode === 'now' }}
              >
                <Text
                  style={[
                    styles.scheduleToggleBtnText,
                    scheduleMode === 'now' && styles.scheduleToggleBtnTextActive,
                  ]}
                >
                  As Soon As Possible
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.scheduleToggleBtn,
                  scheduleMode === 'scheduled' && styles.scheduleToggleBtnActive,
                ]}
                onPress={() => setScheduleMode('scheduled')}
                activeOpacity={0.7}
                accessibilityRole="radio"
                accessibilityState={{ selected: scheduleMode === 'scheduled' }}
              >
                <Text
                  style={[
                    styles.scheduleToggleBtnText,
                    scheduleMode === 'scheduled' && styles.scheduleToggleBtnTextActive,
                  ]}
                >
                  Pick Date & Time
                </Text>
              </TouchableOpacity>
            </View>

            {/* Date/Time picker */}
            {scheduleMode === 'scheduled' && (
              <>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.dateScrollContent}
                  style={styles.dateScrollView}
                >
                  {calendarDates.map((date) => {
                    const isSelected = selectedDate === date.dateString;
                    return (
                      <TouchableOpacity
                        key={date.dateString}
                        style={[
                          styles.dateCard,
                          isSelected && styles.dateCardSelected,
                        ]}
                        onPress={() => setSelectedDate(date.dateString)}
                        activeOpacity={0.7}
                        accessibilityRole="button"
                        accessibilityState={{ selected: isSelected }}
                      >
                        <Text
                          style={[
                            styles.dateDayOfWeek,
                            isSelected && styles.dateTextSelected,
                          ]}
                        >
                          {date.dayOfWeek}
                        </Text>
                        <Text
                          style={[
                            styles.dateDayOfMonth,
                            isSelected && styles.dateTextSelected,
                          ]}
                        >
                          {date.dayOfMonth}
                        </Text>
                        <Text
                          style={[
                            styles.dateMonth,
                            isSelected && styles.dateTextSelected,
                          ]}
                        >
                          {date.month}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>

                {selectedDate !== '' && (
                  <View style={styles.timeSlotsContainer}>
                    <Text style={styles.subsectionTitle}>Select Time</Text>
                    <View style={styles.timeSlotsGrid}>
                      {timeSlots.map((slot) => {
                        const isSelected = selectedTime === slot.id;
                        return (
                          <TouchableOpacity
                            key={slot.id}
                            style={[
                              styles.timeSlot,
                              isSelected && styles.timeSlotSelected,
                            ]}
                            onPress={() => setSelectedTime(slot.id)}
                            activeOpacity={0.7}
                            accessibilityRole="button"
                            accessibilityState={{ selected: isSelected }}
                          >
                            <Text
                              style={[
                                styles.timeSlotText,
                                isSelected && styles.timeSlotTextSelected,
                              ]}
                            >
                              {slot.label}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>
                )}
              </>
            )}
          </View>

          {/* Emergency SLA Notice */}
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

          {/* Legal Acknowledgments */}
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
                  <Text style={styles.checkmark}>V</Text>
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
                {consentScope && <Text style={styles.checkmark}>V</Text>}
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
                {consentPricing && <Text style={styles.checkmark}>V</Text>}
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
                  {consentSLA && <Text style={styles.checkmark}>V</Text>}
                </View>
                <Text style={styles.checkboxLabel}>
                  I understand emergency pricing applies ($150+ base) and
                  accept the SLA terms. Cancellation after provider dispatch
                  incurs a fee.
                </Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Price Estimate */}
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

        {/* Confirm Booking CTA */}
        <View style={styles.ctaContainer}>
          <View style={styles.ctaPriceInfo}>
            <Text style={styles.ctaPriceLabel}>From</Text>
            <Text style={styles.ctaPriceValue}>${task.priceRangeMin}</Text>
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

  // Sections
  section: {
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.xl,
  },
  sectionTitle: {
    ...Typography.headline,
    color: Colors.textPrimary,
    marginBottom: Spacing.md,
  },
  subsectionTitle: {
    ...Typography.footnote,
    color: Colors.textSecondary,
    fontWeight: FontWeight.semiBold as '600',
    marginBottom: Spacing.sm,
    marginTop: Spacing.md,
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
    marginBottom: Spacing.xs,
  },
  taskCardName: {
    ...Typography.title3,
    color: Colors.textPrimary,
    flex: 1,
    marginRight: Spacing.sm,
  },
  taskCardCategory: {
    ...Typography.caption,
    color: Colors.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: Spacing.sm,
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

  // Location Input
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.inputBackground,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    borderColor: Colors.inputBorder,
    paddingHorizontal: Spacing.md,
    height: 48,
  },
  inputIcon: {
    fontSize: 16,
    color: Colors.textTertiary,
    fontWeight: FontWeight.bold as '700',
    marginRight: Spacing.sm,
  },
  textInput: {
    flex: 1,
    ...Typography.body,
    color: Colors.inputText,
    paddingVertical: 0,
  },
  useLocationButton: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: Spacing.sm,
    paddingVertical: Spacing.xs,
  },
  useLocationIcon: {
    fontSize: 14,
    color: Colors.primary,
    fontWeight: FontWeight.bold as '700',
    marginRight: Spacing.xs,
  },
  useLocationText: {
    ...Typography.footnote,
    color: Colors.primary,
    fontWeight: FontWeight.medium as '500',
  },

  // Schedule Toggle
  scheduleToggle: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  scheduleToggleBtn: {
    flex: 1,
    paddingVertical: Spacing.md,
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  scheduleToggleBtnActive: {
    backgroundColor: `${Colors.primary}15`,
    borderColor: Colors.primary,
  },
  scheduleToggleBtnText: {
    ...Typography.footnote,
    color: Colors.textSecondary,
    fontWeight: FontWeight.medium as '500',
  },
  scheduleToggleBtnTextActive: {
    color: Colors.primary,
    fontWeight: FontWeight.semiBold as '600',
  },

  // Date Picker
  dateScrollView: {
    marginBottom: Spacing.sm,
  },
  dateScrollContent: {
    gap: Spacing.sm,
  },
  dateCard: {
    width: 72,
    paddingVertical: Spacing.md,
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  dateCardSelected: {
    backgroundColor: `${Colors.primary}15`,
    borderColor: Colors.primary,
  },
  dateDayOfWeek: {
    ...Typography.caption,
    color: Colors.textSecondary,
    marginBottom: Spacing.xxs,
  },
  dateDayOfMonth: {
    fontSize: FontSize.title3,
    fontWeight: FontWeight.bold as '700',
    color: Colors.textPrimary,
    marginBottom: Spacing.xxs,
  },
  dateMonth: {
    ...Typography.caption,
    color: Colors.textSecondary,
  },
  dateTextSelected: {
    color: Colors.primary,
  },

  // Time Slots
  timeSlotsContainer: {
    marginTop: Spacing.sm,
  },
  timeSlotsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  timeSlot: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  timeSlotSelected: {
    backgroundColor: `${Colors.primary}15`,
    borderColor: Colors.primary,
  },
  timeSlotText: {
    ...Typography.footnote,
    color: Colors.textPrimary,
    fontWeight: FontWeight.medium as '500',
  },
  timeSlotTextSelected: {
    color: Colors.primary,
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
