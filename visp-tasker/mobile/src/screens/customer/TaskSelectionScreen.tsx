/**
 * VISP/Tasker - TaskSelectionScreen
 *
 * Pre-booking confirmation screen.
 * Features:
 *   - Selected task summary
 *   - Address input (Google Places autocomplete)
 *   - Date/time picker (calendar + time slots)
 *   - Flexible schedule toggle
 *   - Priority selection (standard, priority, urgent)
 *   - Customer notes (predefined options only, NOT free text)
 *   - Price estimate display
 *   - "Confirm Booking" button
 *
 * CRITICAL: No free-text notes. Only predefined selection options.
 */

import React, { useEffect, useCallback, useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Switch,
  ActivityIndicator,
  SafeAreaView,
  Alert,
  Platform,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Colors, getLevelColor } from '../../theme/colors';
import { Spacing } from '../../theme/spacing';
import { Typography, FontWeight, FontSize } from '../../theme/typography';
import { BorderRadius } from '../../theme/borders';
import { Shadows } from '../../theme/shadows';
import { useTaskStore } from '../../stores/taskStore';
import { PRIORITY_OPTIONS, PREDEFINED_NOTES } from '../../services/taskService';
import LevelBadge from '../../components/LevelBadge';
import type {
  CustomerFlowParamList,
  PriorityLevel,
  PriorityOption,
  AddressInfo,
  TimeSlot,
  PredefinedNote,
} from '../../types';

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

type TaskSelectionRouteProp = RouteProp<CustomerFlowParamList, 'TaskSelection'>;
type TaskSelectionNavProp = NativeStackNavigationProp<CustomerFlowParamList, 'TaskSelection'>;

// ──────────────────────────────────────────────
// Helper: Generate calendar dates (next 14 days)
// ──────────────────────────────────────────────

interface CalendarDate {
  dateString: string;
  dayOfWeek: string;
  dayOfMonth: number;
  month: string;
  isToday: boolean;
}

function generateCalendarDates(count: number): CalendarDate[] {
  const dates: CalendarDate[] = [];
  const now = new Date();
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const monthNames = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];

  for (let i = 0; i < count; i++) {
    const date = new Date(now);
    date.setDate(date.getDate() + i);
    dates.push({
      dateString: date.toISOString().split('T')[0],
      dayOfWeek: dayNames[date.getDay()],
      dayOfMonth: date.getDate(),
      month: monthNames[date.getMonth()],
      isToday: i === 0,
    });
  }
  return dates;
}

// ──────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────

function TaskSelectionScreen(): React.JSX.Element {
  const route = useRoute<TaskSelectionRouteProp>();
  const navigation = useNavigation<TaskSelectionNavProp>();
  const { taskId } = route.params;

  const {
    taskDetail,
    selectedTask,
    address,
    scheduledDate,
    scheduledTimeSlot,
    availableTimeSlots,
    isFlexibleSchedule,
    priority,
    selectedNotes,
    estimatedPrice,
    isLoadingDetail,
    isLoadingTimeSlots,
    isLoadingEstimate,
    isSubmittingBooking,
    error,
    fetchTaskDetail,
    fetchTimeSlots,
    calculateEstimate,
    submitBooking,
    setAddress,
    setScheduledDate,
    setScheduledTimeSlot,
    setFlexibleSchedule,
    setPriority,
    toggleNote,
  } = useTaskStore();

  // Local state for address input
  const [addressInput, setAddressInput] = useState('');
  const [addressSuggestions, setAddressSuggestions] = useState<AddressInfo[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const calendarDates = useMemo(() => generateCalendarDates(14), []);

  // Load task detail on mount
  useEffect(() => {
    fetchTaskDetail(taskId);
  }, [taskId, fetchTaskDetail]);

  // Set header title
  useEffect(() => {
    navigation.setOptions({ title: 'Book Service' });
  }, [navigation]);

  // Load time slots when date changes
  useEffect(() => {
    if (scheduledDate && taskDetail) {
      fetchTimeSlots(taskDetail.id, scheduledDate);
    }
  }, [scheduledDate, taskDetail, fetchTimeSlots]);

  // Recalculate estimate when relevant fields change
  useEffect(() => {
    if (selectedTask && address) {
      calculateEstimate();
    }
  }, [selectedTask, address, priority, calculateEstimate]);

  // Handle address text change (simulated Google Places autocomplete)
  const handleAddressChange = useCallback((text: string) => {
    setAddressInput(text);
    if (text.length >= 3) {
      // In production, this would call Google Places Autocomplete API
      setShowSuggestions(true);
      // Simulated suggestion for demonstration
      setAddressSuggestions([
        {
          placeId: 'simulated_place_1',
          formattedAddress: text,
          latitude: 43.6532,
          longitude: -79.3832,
          streetNumber: '123',
          street: text,
          city: 'Toronto',
          province: 'ON',
          postalCode: 'M5V 1A1',
          country: 'CA',
        },
      ]);
    } else {
      setShowSuggestions(false);
      setAddressSuggestions([]);
    }
  }, []);

  // Select an address suggestion
  const handleSelectAddress = useCallback(
    (selectedAddress: AddressInfo) => {
      setAddress(selectedAddress);
      setAddressInput(selectedAddress.formattedAddress);
      setShowSuggestions(false);
      setAddressSuggestions([]);
    },
    [setAddress],
  );

  // Select a date
  const handleSelectDate = useCallback(
    (dateString: string) => {
      setScheduledDate(dateString);
    },
    [setScheduledDate],
  );

  // Select a time slot
  const handleSelectTimeSlot = useCallback(
    (slotId: string) => {
      setScheduledTimeSlot(slotId);
    },
    [setScheduledTimeSlot],
  );

  // Select priority
  const handleSelectPriority = useCallback(
    (priorityValue: PriorityLevel) => {
      setPriority(priorityValue);
    },
    [setPriority],
  );

  // Toggle flexible schedule
  const handleToggleFlexible = useCallback(
    (value: boolean) => {
      setFlexibleSchedule(value);
    },
    [setFlexibleSchedule],
  );

  // Toggle a predefined note
  const handleToggleNote = useCallback(
    (noteId: string) => {
      toggleNote(noteId);
    },
    [toggleNote],
  );

  // Validate and submit booking
  const handleConfirmBooking = useCallback(async () => {
    if (!address) {
      Alert.alert('Address Required', 'Please enter your service address.');
      return;
    }
    if (!scheduledDate && !isFlexibleSchedule) {
      Alert.alert('Date Required', 'Please select a date or enable flexible scheduling.');
      return;
    }
    if (!scheduledTimeSlot && !isFlexibleSchedule) {
      Alert.alert('Time Required', 'Please select a time slot or enable flexible scheduling.');
      return;
    }

    try {
      const result = await submitBooking();
      navigation.navigate('BookingConfirmation', { bookingId: result.bookingId });
    } catch {
      Alert.alert(
        'Booking Failed',
        'Unable to create your booking. Please try again.',
      );
    }
  }, [
    address,
    scheduledDate,
    scheduledTimeSlot,
    isFlexibleSchedule,
    submitBooking,
    navigation,
  ]);

  // Check if form is complete
  const isFormValid = useMemo(() => {
    const hasAddress = address !== null;
    const hasSchedule = isFlexibleSchedule || (scheduledDate !== '' && scheduledTimeSlot !== '');
    return hasAddress && hasSchedule;
  }, [address, isFlexibleSchedule, scheduledDate, scheduledTimeSlot]);

  // Loading
  if (isLoadingDetail || !taskDetail) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={styles.loadingText}>Loading...</Text>
        </View>
      </SafeAreaView>
    );
  }

  const levelColor = getLevelColor(taskDetail.level);

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Task summary card */}
          <View style={styles.section}>
            <View style={styles.taskSummaryCard}>
              <View style={styles.taskSummaryHeader}>
                <Text style={styles.taskSummaryName}>{taskDetail.name}</Text>
                <LevelBadge level={taskDetail.level} size="small" />
              </View>
              <Text style={styles.taskSummaryDescription}>
                {taskDetail.description}
              </Text>
              <View style={styles.taskSummaryMeta}>
                <Text style={styles.taskSummaryDuration}>
                  Est. {taskDetail.estimatedDurationMinutes} min
                </Text>
                <Text style={[styles.taskSummaryPrice, { color: levelColor }]}>
                  ${taskDetail.priceRangeMin} - ${taskDetail.priceRangeMax}
                </Text>
              </View>
            </View>
          </View>

          {/* Address input */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Service Address</Text>
            <View style={styles.addressInputContainer}>
              <Text style={styles.addressIcon}>P</Text>
              <TextInput
                style={styles.addressInput}
                placeholder="Enter your address..."
                placeholderTextColor={Colors.inputPlaceholder}
                value={addressInput}
                onChangeText={handleAddressChange}
                autoCapitalize="words"
                returnKeyType="done"
                accessibilityLabel="Service address"
                accessibilityHint="Enter the address where you need the service"
              />
            </View>

            {/* Address suggestions */}
            {showSuggestions && addressSuggestions.length > 0 && (
              <View style={styles.suggestionsContainer}>
                {addressSuggestions.map((suggestion) => (
                  <TouchableOpacity
                    key={suggestion.placeId}
                    style={styles.suggestionItem}
                    onPress={() => handleSelectAddress(suggestion)}
                    accessibilityLabel={`Select address: ${suggestion.formattedAddress}`}
                  >
                    <Text style={styles.suggestionText}>
                      {suggestion.formattedAddress}
                    </Text>
                    <Text style={styles.suggestionSubtext}>
                      {suggestion.city}, {suggestion.province} {suggestion.postalCode}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {address && (
              <View style={styles.selectedAddressCard}>
                <Text style={styles.selectedAddressText}>
                  {address.formattedAddress}
                </Text>
                <Text style={styles.selectedAddressSubtext}>
                  {address.city}, {address.province} {address.postalCode}
                </Text>
              </View>
            )}
          </View>

          {/* Date picker */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Select Date</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.dateScrollContent}
            >
              {calendarDates.map((date) => {
                const isSelected = scheduledDate === date.dateString;
                return (
                  <TouchableOpacity
                    key={date.dateString}
                    style={[
                      styles.dateCard,
                      isSelected && styles.dateCardSelected,
                    ]}
                    onPress={() => handleSelectDate(date.dateString)}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isSelected }}
                    accessibilityLabel={`${date.dayOfWeek}, ${date.month} ${date.dayOfMonth}${date.isToday ? ', Today' : ''}`}
                  >
                    <Text
                      style={[
                        styles.dateDayOfWeek,
                        isSelected && styles.dateTextSelected,
                      ]}
                    >
                      {date.isToday ? 'Today' : date.dayOfWeek}
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
          </View>

          {/* Time slots */}
          {scheduledDate !== '' && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Select Time</Text>
              {isLoadingTimeSlots ? (
                <ActivityIndicator
                  size="small"
                  color={Colors.primary}
                  style={styles.timeSlotsLoader}
                />
              ) : availableTimeSlots.length > 0 ? (
                <View style={styles.timeSlotsGrid}>
                  {availableTimeSlots.map((slot: TimeSlot) => {
                    const isSelected = scheduledTimeSlot === slot.id;
                    const isDisabled = !slot.available;
                    return (
                      <TouchableOpacity
                        key={slot.id}
                        style={[
                          styles.timeSlot,
                          isSelected && styles.timeSlotSelected,
                          isDisabled && styles.timeSlotDisabled,
                        ]}
                        onPress={() => !isDisabled && handleSelectTimeSlot(slot.id)}
                        disabled={isDisabled}
                        activeOpacity={0.7}
                        accessibilityRole="button"
                        accessibilityState={{
                          selected: isSelected,
                          disabled: isDisabled,
                        }}
                        accessibilityLabel={`Time slot: ${slot.label}${isDisabled ? ', unavailable' : ''}`}
                      >
                        <Text
                          style={[
                            styles.timeSlotText,
                            isSelected && styles.timeSlotTextSelected,
                            isDisabled && styles.timeSlotTextDisabled,
                          ]}
                        >
                          {slot.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              ) : (
                <Text style={styles.noSlotsText}>
                  No time slots available for this date. Try another date.
                </Text>
              )}
            </View>
          )}

          {/* Flexible schedule toggle */}
          <View style={styles.section}>
            <View style={styles.toggleRow}>
              <View style={styles.toggleInfo}>
                <Text style={styles.toggleLabel}>Flexible Schedule</Text>
                <Text style={styles.toggleDescription}>
                  Let us find the best available time for you
                </Text>
              </View>
              <Switch
                value={isFlexibleSchedule}
                onValueChange={handleToggleFlexible}
                trackColor={{
                  false: Colors.border,
                  true: `${Colors.primary}80`,
                }}
                thumbColor={isFlexibleSchedule ? Colors.primary : Colors.textTertiary}
                ios_backgroundColor={Colors.border}
                accessibilityLabel="Flexible schedule toggle"
              />
            </View>
          </View>

          {/* Priority selection */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Priority</Text>
            <View style={styles.priorityContainer}>
              {PRIORITY_OPTIONS.map((option: PriorityOption) => {
                const isSelected = priority === option.value;
                return (
                  <TouchableOpacity
                    key={option.value}
                    style={[
                      styles.priorityCard,
                      isSelected && {
                        borderColor: option.color,
                        backgroundColor: `${option.color}10`,
                      },
                    ]}
                    onPress={() => handleSelectPriority(option.value)}
                    activeOpacity={0.7}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: isSelected }}
                    accessibilityLabel={`${option.label}: ${option.description}`}
                  >
                    <View style={styles.priorityHeader}>
                      <View
                        style={[
                          styles.priorityRadio,
                          isSelected && {
                            borderColor: option.color,
                          },
                        ]}
                      >
                        {isSelected && (
                          <View
                            style={[
                              styles.priorityRadioInner,
                              { backgroundColor: option.color },
                            ]}
                          />
                        )}
                      </View>
                      <Text
                        style={[
                          styles.priorityLabel,
                          isSelected && { color: option.color },
                        ]}
                      >
                        {option.label}
                      </Text>
                      {option.multiplier > 1 && (
                        <Text style={[styles.priorityMultiplier, { color: option.color }]}>
                          {option.multiplier}x
                        </Text>
                      )}
                    </View>
                    <Text style={styles.priorityDescription}>
                      {option.description}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* Predefined notes (NO free text) */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Additional Information</Text>
            <Text style={styles.notesSubtitle}>
              Select any that apply to your service location
            </Text>
            <View style={styles.notesContainer}>
              {PREDEFINED_NOTES.map((note: PredefinedNote) => {
                const isSelected = selectedNotes.includes(note.id);
                return (
                  <TouchableOpacity
                    key={note.id}
                    style={[
                      styles.noteChip,
                      isSelected && styles.noteChipSelected,
                    ]}
                    onPress={() => handleToggleNote(note.id)}
                    activeOpacity={0.7}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: isSelected }}
                    accessibilityLabel={note.label}
                  >
                    <Text
                      style={[
                        styles.noteChipText,
                        isSelected && styles.noteChipTextSelected,
                      ]}
                    >
                      {note.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* Price estimate */}
          {estimatedPrice > 0 && (
            <View style={styles.section}>
              <View style={styles.estimateCard}>
                <Text style={styles.estimateLabel}>Estimated Total</Text>
                <Text style={styles.estimatePrice}>
                  ${estimatedPrice.toFixed(2)}
                </Text>
                {isLoadingEstimate && (
                  <ActivityIndicator
                    size="small"
                    color={Colors.primary}
                    style={styles.estimateLoader}
                  />
                )}
                <Text style={styles.estimateNote}>
                  Final price may vary based on actual scope of work.
                  You will be notified of any changes before they are applied.
                </Text>
              </View>
            </View>
          )}

          {/* Error display */}
          {error && (
            <View style={styles.errorContainer}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          {/* Bottom padding for CTA */}
          <View style={styles.bottomPadding} />
        </ScrollView>

        {/* Confirm booking CTA */}
        <View style={styles.ctaContainer}>
          {estimatedPrice > 0 && (
            <View style={styles.ctaPriceInfo}>
              <Text style={styles.ctaPriceLabel}>Estimated</Text>
              <Text style={styles.ctaPriceValue}>
                ${estimatedPrice.toFixed(2)}
              </Text>
            </View>
          )}
          <TouchableOpacity
            style={[
              styles.confirmButton,
              (!isFormValid || isSubmittingBooking) && styles.confirmButtonDisabled,
            ]}
            onPress={handleConfirmBooking}
            disabled={!isFormValid || isSubmittingBooking}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Confirm booking"
            accessibilityState={{ disabled: !isFormValid || isSubmittingBooking }}
          >
            {isSubmittingBooking ? (
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

  // Task summary
  taskSummaryCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  taskSummaryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: Spacing.sm,
  },
  taskSummaryName: {
    ...Typography.title3,
    color: Colors.textPrimary,
    flex: 1,
    marginRight: Spacing.sm,
  },
  taskSummaryDescription: {
    ...Typography.footnote,
    color: Colors.textSecondary,
    marginBottom: Spacing.md,
  },
  taskSummaryMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  taskSummaryDuration: {
    ...Typography.caption,
    color: Colors.textTertiary,
  },
  taskSummaryPrice: {
    fontSize: FontSize.callout,
    fontWeight: FontWeight.bold,
  },

  // Address
  addressInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.inputBackground,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    borderColor: Colors.inputBorder,
    paddingHorizontal: Spacing.md,
    height: 48,
  },
  addressIcon: {
    fontSize: 16,
    color: Colors.textTertiary,
    fontWeight: FontWeight.bold,
    marginRight: Spacing.sm,
  },
  addressInput: {
    flex: 1,
    ...Typography.body,
    color: Colors.inputText,
    paddingVertical: 0,
  },
  suggestionsContainer: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    borderColor: Colors.border,
    marginTop: Spacing.xs,
    overflow: 'hidden',
  },
  suggestionItem: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.divider,
  },
  suggestionText: {
    ...Typography.body,
    color: Colors.textPrimary,
  },
  suggestionSubtext: {
    ...Typography.caption,
    color: Colors.textTertiary,
    marginTop: 2,
  },
  selectedAddressCard: {
    backgroundColor: `${Colors.success}10`,
    borderRadius: BorderRadius.sm,
    padding: Spacing.md,
    marginTop: Spacing.sm,
    borderWidth: 1,
    borderColor: `${Colors.success}30`,
  },
  selectedAddressText: {
    ...Typography.body,
    color: Colors.textPrimary,
  },
  selectedAddressSubtext: {
    ...Typography.caption,
    color: Colors.textSecondary,
    marginTop: 2,
  },

  // Date picker
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
    fontWeight: FontWeight.bold,
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

  // Time slots
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
  timeSlotDisabled: {
    backgroundColor: Colors.surface,
    borderColor: Colors.border,
    opacity: 0.4,
  },
  timeSlotText: {
    ...Typography.footnote,
    color: Colors.textPrimary,
    fontWeight: FontWeight.medium,
  },
  timeSlotTextSelected: {
    color: Colors.primary,
  },
  timeSlotTextDisabled: {
    color: Colors.textDisabled,
  },
  timeSlotsLoader: {
    padding: Spacing.lg,
  },
  noSlotsText: {
    ...Typography.body,
    color: Colors.textSecondary,
    textAlign: 'center',
    paddingVertical: Spacing.lg,
  },

  // Flexible toggle
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  toggleInfo: {
    flex: 1,
    marginRight: Spacing.md,
  },
  toggleLabel: {
    ...Typography.headline,
    color: Colors.textPrimary,
    marginBottom: 2,
  },
  toggleDescription: {
    ...Typography.caption,
    color: Colors.textSecondary,
  },

  // Priority
  priorityContainer: {
    gap: Spacing.sm,
  },
  priorityCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  priorityHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.xs,
  },
  priorityRadio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing.sm,
  },
  priorityRadioInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  priorityLabel: {
    ...Typography.headline,
    color: Colors.textPrimary,
    flex: 1,
  },
  priorityMultiplier: {
    ...Typography.label,
    fontWeight: FontWeight.bold,
  },
  priorityDescription: {
    ...Typography.footnote,
    color: Colors.textSecondary,
    marginLeft: 32,
  },

  // Notes
  notesSubtitle: {
    ...Typography.caption,
    color: Colors.textSecondary,
    marginBottom: Spacing.md,
  },
  notesContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  noteChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.xxl,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  noteChipSelected: {
    backgroundColor: `${Colors.primary}15`,
    borderColor: Colors.primary,
  },
  noteChipText: {
    ...Typography.caption,
    color: Colors.textSecondary,
  },
  noteChipTextSelected: {
    color: Colors.primary,
  },

  // Estimate
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
    fontWeight: FontWeight.bold,
    color: Colors.primary,
    marginBottom: Spacing.sm,
  },
  estimateLoader: {
    marginBottom: Spacing.sm,
  },
  estimateNote: {
    ...Typography.caption,
    color: Colors.textTertiary,
    textAlign: 'center',
    lineHeight: 16,
  },

  // Error
  errorContainer: {
    marginHorizontal: Spacing.lg,
    padding: Spacing.md,
    backgroundColor: `${Colors.error}15`,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    borderColor: `${Colors.error}30`,
    marginBottom: Spacing.lg,
  },
  errorText: {
    ...Typography.footnote,
    color: Colors.error,
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
    fontWeight: FontWeight.bold,
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
  confirmButtonDisabled: {
    backgroundColor: Colors.textDisabled,
    ...Shadows.none,
  },
  confirmButtonText: {
    ...Typography.buttonLarge,
    color: Colors.white,
  },

  // Loading
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    ...Typography.footnote,
    color: Colors.textSecondary,
    marginTop: Spacing.md,
  },
});

export default TaskSelectionScreen;
