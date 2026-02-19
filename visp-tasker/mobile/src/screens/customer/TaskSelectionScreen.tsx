/**
 * VISP - TaskSelectionScreen
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
 *
 * Glass redesign: GlassBackground + GlassCard + GlassInput + GlassButton
 */

import React, { useEffect, useCallback, useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
  Alert,
  Platform,
} from 'react-native';
import { AnimatedSpinner } from '../../components/animations';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Colors, getLevelColor } from '../../theme/colors';
import { Spacing } from '../../theme/spacing';
import { Typography, FontWeight, FontSize } from '../../theme/typography';
import { BorderRadius } from '../../theme/borders';
import { GlassStyles } from '../../theme/glass';
import { GlassBackground, GlassCard, GlassButton, GlassInput } from '../../components/glass';
import { useTaskStore } from '../../stores/taskStore';
import { useAuthStore } from '../../stores/authStore';
import { PRIORITY_OPTIONS, PREDEFINED_NOTES } from '../../services/taskService';
import { geolocationService } from '../../services/geolocationService';
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

  // Auto-fill address from saved profile
  const user = useAuthStore((state) => state.user);
  useEffect(() => {
    if (user?.defaultAddress && !address) {
      const saved = user.defaultAddress;
      const autoAddress: AddressInfo = {
        placeId: 'saved-profile',
        formattedAddress: saved.formattedAddress || `${saved.street}, ${saved.city}`,
        latitude: saved.latitude ?? 0,
        longitude: saved.longitude ?? 0,
        streetNumber: '',
        street: saved.street,
        city: saved.city,
        province: saved.province,
        postalCode: saved.postalCode,
        country: saved.country || 'CA',
      };
      setAddress(autoAddress);
      setAddressInput(autoAddress.formattedAddress);
    }
  }, [user, address, setAddress]);

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

  // Handle address text change (using real Geocoding API via Mapbox)
  const handleAddressChange = useCallback(async (text: string) => {
    setAddressInput(text);
    if (text.length >= 4) {
      try {
        const result = await geolocationService.geocodeAddress(text);
        if (result && result.formatted_address) {
          // Parse the formatted address into structured components
          const parsed = geolocationService.parseAddress(result.formatted_address);
          setAddressSuggestions([
            {
              placeId: result.place_id || 'mapbox-result',
              formattedAddress: result.formatted_address,
              latitude: result.lat,
              longitude: result.lng,
              streetNumber: '',
              street: parsed.street,
              city: parsed.city,
              province: parsed.province,
              postalCode: parsed.postalCode,
              country: parsed.country || 'CA',
            },
          ]);
          setShowSuggestions(true);
        } else {
          setShowSuggestions(false);
          setAddressSuggestions([]);
        }
      } catch (err) {
        console.warn('Geocoding failed:', err);
        setShowSuggestions(false);
        setAddressSuggestions([]);
      }
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

  // Navigate to Booking confirmation screen with task summary + booking details
  const handleConfirmBooking = useCallback(() => {
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

    if (!taskDetail) return;

    navigation.navigate('Booking', {
      task: {
        taskId: taskDetail.id,
        taskName: taskDetail.name,
        categoryName: taskDetail.categoryId,
        level: taskDetail.level,
        estimatedDurationMinutes: taskDetail.estimatedDurationMinutes,
        priceRangeMin: taskDetail.priceRangeMin,
        priceRangeMax: taskDetail.priceRangeMax,
        estimatedPrice: estimatedPrice,
        description: taskDetail.description,
        // Pass booking details for confirmation screen
        address: address,
        scheduledDate: scheduledDate,
        scheduledTimeSlot: scheduledTimeSlot,
        isFlexibleSchedule: isFlexibleSchedule,
        priority: priority,
        selectedNotes: selectedNotes,
      },
    });
  }, [
    address,
    scheduledDate,
    scheduledTimeSlot,
    isFlexibleSchedule,
    taskDetail,
    estimatedPrice,
    navigation,
    priority,
    selectedNotes,
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
      <GlassBackground>
        <View style={styles.loadingContainer}>
          <AnimatedSpinner size={48} color={Colors.primary} />
          <Text style={styles.loadingText}>Loading...</Text>
        </View>
      </GlassBackground>
    );
  }

  const levelColor = getLevelColor(taskDetail.level);

  return (
    <GlassBackground>
      <View style={styles.container}>
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Task summary card */}
          <View style={styles.section}>
            <GlassCard variant="elevated">
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
            </GlassCard>
          </View>

          {/* Address input */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Service Address</Text>
            <GlassInput
              label=""
              placeholder="Enter your address..."
              value={addressInput}
              onChangeText={handleAddressChange}
              autoCapitalize="words"
              returnKeyType="done"
              accessibilityLabel="Service address"
              accessibilityHint="Enter the address where you need the service"
              icon={<Text style={styles.addressIcon}>P</Text>}
            />

            {/* Address suggestions */}
            {showSuggestions && addressSuggestions.length > 0 && (
              <GlassCard variant="dark" padding={0} style={styles.suggestionsContainer}>
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
              </GlassCard>
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
                <AnimatedSpinner
                  size={24}
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
            <GlassCard variant="standard">
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
                    false: 'rgba(255, 255, 255, 0.12)',
                    true: 'rgba(120, 80, 255, 0.5)',
                  }}
                  thumbColor={isFlexibleSchedule ? 'rgba(120, 80, 255, 1)' : 'rgba(255, 255, 255, 0.5)'}
                  ios_backgroundColor="rgba(255, 255, 255, 0.12)"
                  accessibilityLabel="Flexible schedule toggle"
                />
              </View>
            </GlassCard>
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
                        backgroundColor: `${option.color}18`,
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
              <GlassCard variant="elevated" style={styles.estimateCardBorder}>
                <View style={styles.estimateCardContent}>
                  <Text style={styles.estimateLabel}>Estimated Total</Text>
                  <Text style={styles.estimatePrice}>
                    ${estimatedPrice.toFixed(2)}
                  </Text>
                  {isLoadingEstimate && (
                    <AnimatedSpinner
                      size={24}
                      color={Colors.primary}
                      style={styles.estimateLoader}
                    />
                  )}
                  <Text style={styles.estimateNote}>
                    Final price may vary based on actual scope of work.
                    You will be notified of any changes before they are applied.
                  </Text>
                </View>
              </GlassCard>
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
          {estimatedPrice > 0 ? (
            <View style={styles.ctaPriceInfo}>
              <Text style={styles.ctaPriceLabel}>Estimated</Text>
              <Text style={styles.ctaPriceValue}>
                ${estimatedPrice.toFixed(2)}
              </Text>
            </View>
          ) : taskDetail ? (
            <View style={styles.ctaPriceInfo}>
              <Text style={styles.ctaPriceLabel}>Range</Text>
              <Text style={styles.ctaPriceValue}>
                ${taskDetail.priceRangeMin} - ${taskDetail.priceRangeMax}
              </Text>
            </View>
          ) : null}
          <GlassButton
            title="Continue"
            variant="glow"
            onPress={handleConfirmBooking}
            disabled={!isFormValid}
            style={styles.confirmButtonStyle}
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

  // Sections
  section: {
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.xl,
  },
  sectionTitle: {
    ...Typography.headline,
    color: '#FFFFFF',
    marginBottom: Spacing.md,
    textShadowColor: 'rgba(0, 0, 0, 0.2)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },

  // Task summary
  taskSummaryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: Spacing.sm,
  },
  taskSummaryName: {
    ...Typography.title3,
    color: '#FFFFFF',
    flex: 1,
    marginRight: Spacing.sm,
  },
  taskSummaryDescription: {
    ...Typography.footnote,
    color: 'rgba(255, 255, 255, 0.6)',
    marginBottom: Spacing.md,
  },
  taskSummaryMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  taskSummaryDuration: {
    ...Typography.caption,
    color: 'rgba(255, 255, 255, 0.45)',
  },
  taskSummaryPrice: {
    fontSize: FontSize.callout,
    fontWeight: FontWeight.bold,
  },

  // Address
  addressIcon: {
    fontSize: 16,
    color: 'rgba(255, 255, 255, 0.45)',
    fontWeight: FontWeight.bold,
  },
  suggestionsContainer: {
    marginTop: Spacing.xs,
  },
  suggestionItem: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
  },
  suggestionText: {
    ...Typography.body,
    color: '#FFFFFF',
  },
  suggestionSubtext: {
    ...Typography.caption,
    color: 'rgba(255, 255, 255, 0.45)',
    marginTop: 2,
  },
  selectedAddressCard: {
    backgroundColor: 'rgba(39, 174, 96, 0.12)',
    borderRadius: 12,
    padding: Spacing.md,
    marginTop: Spacing.sm,
    borderWidth: 1,
    borderColor: 'rgba(39, 174, 96, 0.25)',
  },
  selectedAddressText: {
    ...Typography.body,
    color: '#FFFFFF',
  },
  selectedAddressSubtext: {
    ...Typography.caption,
    color: 'rgba(255, 255, 255, 0.6)',
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
    backgroundColor: Colors.glass.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.glassBorder.subtle,
  },
  dateCardSelected: {
    backgroundColor: 'rgba(120, 80, 255, 0.2)',
    borderColor: 'rgba(120, 80, 255, 0.6)',
  },
  dateDayOfWeek: {
    ...Typography.caption,
    color: 'rgba(255, 255, 255, 0.55)',
    marginBottom: Spacing.xxs,
  },
  dateDayOfMonth: {
    fontSize: FontSize.title3,
    fontWeight: FontWeight.bold,
    color: '#FFFFFF',
    marginBottom: Spacing.xxs,
  },
  dateMonth: {
    ...Typography.caption,
    color: 'rgba(255, 255, 255, 0.55)',
  },
  dateTextSelected: {
    color: 'rgba(120, 80, 255, 1)',
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
    backgroundColor: Colors.glass.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.glassBorder.subtle,
  },
  timeSlotSelected: {
    backgroundColor: 'rgba(120, 80, 255, 0.2)',
    borderColor: 'rgba(120, 80, 255, 0.6)',
  },
  timeSlotDisabled: {
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderColor: 'rgba(255, 255, 255, 0.06)',
    opacity: 0.4,
  },
  timeSlotText: {
    ...Typography.footnote,
    color: '#FFFFFF',
    fontWeight: FontWeight.medium,
  },
  timeSlotTextSelected: {
    color: 'rgba(120, 80, 255, 1)',
  },
  timeSlotTextDisabled: {
    color: 'rgba(255, 255, 255, 0.3)',
  },
  timeSlotsLoader: {
    padding: Spacing.lg,
  },
  noSlotsText: {
    ...Typography.body,
    color: 'rgba(255, 255, 255, 0.55)',
    textAlign: 'center',
    paddingVertical: Spacing.lg,
  },

  // Flexible toggle
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  toggleInfo: {
    flex: 1,
    marginRight: Spacing.md,
  },
  toggleLabel: {
    ...Typography.headline,
    color: '#FFFFFF',
    marginBottom: 2,
  },
  toggleDescription: {
    ...Typography.caption,
    color: 'rgba(255, 255, 255, 0.55)',
  },

  // Priority
  priorityContainer: {
    gap: Spacing.sm,
  },
  priorityCard: {
    backgroundColor: Colors.glass.white,
    borderRadius: 16,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.glassBorder.subtle,
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
    borderColor: 'rgba(255, 255, 255, 0.25)',
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
    color: '#FFFFFF',
    flex: 1,
  },
  priorityMultiplier: {
    ...Typography.label,
    fontWeight: FontWeight.bold,
  },
  priorityDescription: {
    ...Typography.footnote,
    color: 'rgba(255, 255, 255, 0.55)',
    marginLeft: 32,
  },

  // Notes
  notesSubtitle: {
    ...Typography.caption,
    color: 'rgba(255, 255, 255, 0.45)',
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
    backgroundColor: Colors.glass.white,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: Colors.glassBorder.subtle,
  },
  noteChipSelected: {
    backgroundColor: 'rgba(120, 80, 255, 0.2)',
    borderColor: 'rgba(120, 80, 255, 0.6)',
  },
  noteChipText: {
    ...Typography.caption,
    color: 'rgba(255, 255, 255, 0.6)',
  },
  noteChipTextSelected: {
    color: 'rgba(120, 80, 255, 1)',
  },

  // Estimate
  estimateCardBorder: {
    borderColor: 'rgba(120, 80, 255, 0.4)',
  },
  estimateCardContent: {
    alignItems: 'center',
  },
  estimateLabel: {
    ...Typography.label,
    color: 'rgba(255, 255, 255, 0.55)',
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
    color: 'rgba(255, 255, 255, 0.4)',
    textAlign: 'center',
    lineHeight: 16,
  },

  // Error
  errorContainer: {
    marginHorizontal: Spacing.lg,
    padding: Spacing.md,
    backgroundColor: 'rgba(231, 76, 60, 0.12)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(231, 76, 60, 0.3)',
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
    fontWeight: FontWeight.bold,
    color: '#FFFFFF',
  },
  confirmButtonStyle: {
    minWidth: 180,
  },

  // Loading
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    ...Typography.footnote,
    color: 'rgba(255, 255, 255, 0.55)',
    marginTop: Spacing.md,
  },
});

export default TaskSelectionScreen;
