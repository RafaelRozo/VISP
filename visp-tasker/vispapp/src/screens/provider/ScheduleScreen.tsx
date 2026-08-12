/**
 * VISP - Schedule Screen
 *
 * Calendar view of upcoming jobs, availability management, on-call
 * shift schedule for Level 4 providers, and time-off requests.
 *
 * Redesigned with dark glassmorphism.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Colors, getLevelColor, getStatusColor } from '../../theme/colors';
import { useTheme } from '../../theme/ThemeContext';
import { useTranslation } from '../../i18n';
import { useAppStore } from '../../stores/appStore';
import { GlassStyles } from '../../theme/glass';
import { GlassCard, GlassButton } from '../../components/glass';
import { Screen, ScreenTitle } from '../../components/visp';
import { useProviderStore } from '../../stores/providerStore';
import { OnCallShift, ScheduledJob, TimeOffRequest } from '../../types';
import { post } from '../../services/apiClient';

// How many minutes before the job start time the provider can begin navigation
const EARLY_START_MINUTES = 10;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CalendarTab = 'jobs' | 'shifts' | 'timeoff';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getLocale(): string {
  // Read language directly from store (works outside components)
  try {
    const lang = require('../../stores/appStore').useAppStore.getState().language;
    return lang === 'fr' ? 'fr-CA' : 'en-CA';
  } catch {
    return 'en-CA';
  }
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString(getLocale(), {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function formatTime(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleTimeString(getLocale(), { hour: '2-digit', minute: '2-digit' });
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hrs}h ${mins}m` : `${hrs}h`;
}

function getCalendarDays(locale: string = 'en'): Array<{
  date: Date;
  label: string;
  dayLabel: string;
  isToday: boolean;
}> {
  const loc = locale === 'fr' ? 'fr-CA' : 'en-CA';
  const days: Array<{
    date: Date;
    label: string;
    dayLabel: string;
    isToday: boolean;
  }> = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let i = 0; i < 14; i++) {
    const date = new Date(today);
    date.setDate(today.getDate() + i);
    days.push({
      date,
      label: date.toLocaleDateString(loc, { day: 'numeric' }),
      dayLabel: date.toLocaleDateString(loc, { weekday: 'short' }),
      isToday: i === 0,
    });
  }

  return days;
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

// ---------------------------------------------------------------------------
// CalendarStrip sub-component
// ---------------------------------------------------------------------------

interface CalendarStripProps {
  selectedDate: Date;
  onSelectDate: (date: Date) => void;
  jobDates: Set<string>;
}

function CalendarStrip({
  selectedDate,
  onSelectDate,
  jobDates,
}: CalendarStripProps): React.JSX.Element {
  const theme = useTheme();
  const lang = useAppStore((s) => s.language);
  const days = useMemo(() => getCalendarDays(lang), [lang]);

  return (
    <ScrollView
      horizontal
      // flexGrow:0 obligatorio: sin altura ni flexGrow un scroll
      // horizontal se expande y roba el espacio vertical del padre.
      style={{ flexGrow: 0 }}
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={calendarStyles.container}
    >
      {days.map((day, index) => {
        const isSelected = isSameDay(day.date, selectedDate);
        const hasJobs = jobDates.has(day.date.toISOString().split('T')[0]);

        return (
          <TouchableOpacity
            key={index}
            style={[
              calendarStyles.dayCell,
              isSelected && calendarStyles.dayCellSelected,
              day.isToday && !isSelected && calendarStyles.dayCellToday,
            ]}
            onPress={() => onSelectDate(day.date)}
            accessibilityRole="button"
            accessibilityLabel={`Select ${day.dayLabel} ${day.label}`}
          >
            <Text
              style={[
                calendarStyles.dayLabel,
                !isSelected && { color: theme.textSecondary },
                isSelected && calendarStyles.dayLabelSelected,
              ]}
            >
              {day.dayLabel}
            </Text>
            <Text
              style={[
                calendarStyles.dateLabel,
                !isSelected && { color: theme.textPrimary },
                isSelected && calendarStyles.dateLabelSelected,
              ]}
            >
              {day.label}
            </Text>
            {hasJobs && (
              <View
                style={[
                  calendarStyles.jobDot,
                  isSelected && calendarStyles.jobDotSelected,
                ]}
              />
            )}
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

const calendarStyles = StyleSheet.create({
  container: {
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  dayCell: {
    width: 52,
    height: 72,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.10)',
  },
  dayCellSelected: {
    backgroundColor: 'rgba(120, 80, 255, 0.8)',
    borderColor: 'rgba(255, 255, 255, 0.30)',
    ...Platform.select({
      ios: {
        shadowColor: 'rgba(120, 80, 255, 0.6)',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 1,
        shadowRadius: 12,
      },
      android: { elevation: 6 },
    }),
  },
  dayCellToday: {
    borderWidth: 1,
    borderColor: Colors.primary,
  },
  dayLabel: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.4)',
    marginBottom: 4,
  },
  dayLabelSelected: {
    color: '#FFFFFF',
  },
  dateLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  dateLabelSelected: {
    color: '#FFFFFF',
  },
  jobDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.primary,
    marginTop: 4,
  },
  jobDotSelected: {
    backgroundColor: '#FFFFFF',
  },
});

// ---------------------------------------------------------------------------
// ScheduledJobItem sub-component
// ---------------------------------------------------------------------------

interface ScheduledJobItemProps {
  job: ScheduledJob;
  onPress: (job: ScheduledJob) => void;
}

function ScheduledJobItem({ job, onPress }: ScheduledJobItemProps): React.JSX.Element {
  const theme = useTheme();
  const levelColor = getLevelColor(job.level);
  const statusColor = getStatusColor(job.status);

  // Check if we're within the start window
  const jobStart = new Date(job.scheduledAt);
  const now = new Date();
  const minutesUntilStart = (jobStart.getTime() - now.getTime()) / 60000;
  const canStart = minutesUntilStart <= EARLY_START_MINUTES;

  return (
    <TouchableOpacity
      style={jobItemStyles.container}
      onPress={() => onPress(job)}
      activeOpacity={0.7}
    >
      <View style={[jobItemStyles.levelStrip, { backgroundColor: levelColor }]} />
      <View style={jobItemStyles.content}>
        <View style={jobItemStyles.header}>
          <Text style={[jobItemStyles.taskName, { color: theme.textPrimary }]} numberOfLines={1}>
            {job.taskName}
          </Text>
          <View
            style={[
              jobItemStyles.statusBadge,
              { backgroundColor: statusColor },
            ]}
          >
            <Text style={jobItemStyles.statusText}>{job.status}</Text>
          </View>
        </View>
        <View style={jobItemStyles.details}>
          <Text style={[jobItemStyles.detailText, { color: theme.textSecondary }]}>
            {formatTime(job.scheduledAt)} | {formatDuration(job.estimatedDurationMinutes)}
          </Text>
          <Text style={[jobItemStyles.locationText, { color: theme.textTertiary }]}>{job.customerArea}</Text>
        </View>
        {canStart && (
          <View style={jobItemStyles.startRouteContainer}>
            <View style={jobItemStyles.startRouteBadge}>
              <Text style={jobItemStyles.startRouteText}>Start Route</Text>
            </View>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}

const jobItemStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    borderRadius: 14,
    marginHorizontal: 16,
    marginBottom: 8,
    overflow: 'hidden',
  },
  levelStrip: {
    width: 4,
  },
  content: {
    flex: 1,
    padding: 12,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  taskName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
    flex: 1,
    marginRight: 8,
  },
  statusBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  statusText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#FFFFFF',
    textTransform: 'uppercase',
  },
  details: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  detailText: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.6)',
  },
  locationText: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.4)',
  },
  startRouteContainer: {
    marginTop: 8,
    alignItems: 'flex-start',
  },
  startRouteBadge: {
    backgroundColor: 'rgba(120, 80, 255, 0.8)',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.25)',
    ...Platform.select({
      ios: {
        shadowColor: 'rgba(120, 80, 255, 0.6)',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 1,
        shadowRadius: 8,
      },
      android: { elevation: 4 },
    }),
  },
  startRouteText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});

// ---------------------------------------------------------------------------
// ShiftItem sub-component
// ---------------------------------------------------------------------------

interface ShiftItemProps {
  shift: OnCallShift;
}

function ShiftItem({ shift }: ShiftItemProps): React.JSX.Element {
  const theme = useTheme();
  return (
    <GlassCard variant="dark" padding={14} style={shiftStyles.container}>
      <View style={shiftStyles.row}>
        <View
          style={[
            shiftStyles.indicator,
            {
              backgroundColor: shift.isActive
                ? Colors.success
                : 'rgba(255, 255, 255, 0.3)',
              ...(shift.isActive
                ? Platform.select({
                    ios: {
                      shadowColor: Colors.success,
                      shadowOffset: { width: 0, height: 0 },
                      shadowOpacity: 0.8,
                      shadowRadius: 4,
                    },
                    android: {},
                  })
                : {}),
            },
          ]}
        />
        <View style={shiftStyles.content}>
          <Text style={[shiftStyles.dateText, { color: theme.textPrimary }]}>
            {formatDate(shift.startTime)}
          </Text>
          <Text style={[shiftStyles.timeText, { color: theme.textSecondary }]}>
            {formatTime(shift.startTime)} - {formatTime(shift.endTime)}
          </Text>
        </View>
        <View
          style={[
            shiftStyles.statusBadge,
            {
              backgroundColor: shift.isActive
                ? `${Colors.success}20`
                : 'rgba(255, 255, 255, 0.08)',
            },
          ]}
        >
          <Text
            style={[
              shiftStyles.statusText,
              {
                color: shift.isActive ? Colors.success : 'rgba(255, 255, 255, 0.5)',
              },
            ]}
          >
            {shift.isActive ? 'Active' : 'Scheduled'}
          </Text>
        </View>
      </View>
    </GlassCard>
  );
}

const shiftStyles = StyleSheet.create({
  container: {
    marginHorizontal: 16,
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  indicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 12,
  },
  content: {
    flex: 1,
  },
  dateText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 2,
  },
  timeText: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.6)',
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '600',
  },
});

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function ScheduleScreen(): React.JSX.Element {
  const theme = useTheme();
  const { t, language } = useTranslation();
  const {
    scheduledJobs,
    onCallShifts,
    providerProfile,
    isLoadingSchedule,
    fetchSchedule,
  } = useProviderStore();

  const [selectedDate, setSelectedDate] = useState<Date>(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return today;
  });
  const [activeTab, setActiveTab] = useState<CalendarTab>('jobs');
  const [timeOffRequests, setTimeOffRequests] = useState<TimeOffRequest[]>([]);
  const [showTimeOffForm, setShowTimeOffForm] = useState(false);
  const [timeOffStartDate, setTimeOffStartDate] = useState<Date | null>(null);
  const [timeOffEndDate, setTimeOffEndDate] = useState<Date | null>(null);
  const [timeOffReason, setTimeOffReason] = useState('');
  const [isSubmittingTimeOff, setIsSubmittingTimeOff] = useState(false);

  const isLevel4 = providerProfile?.level === 4;

  useEffect(() => {
    fetchSchedule();
  }, [fetchSchedule]);

  // Set of dates that have jobs (for calendar dots)
  const jobDates = useMemo(() => {
    const dates = new Set<string>();
    (scheduledJobs || []).forEach((job) => {
      const date = new Date(job.scheduledAt).toISOString().split('T')[0];
      dates.add(date);
    });
    return dates;
  }, [scheduledJobs]);

  // Jobs for selected date
  const jobsForDate = useMemo(() => {
    return (scheduledJobs || []).filter((job) => {
      const jobDate = new Date(job.scheduledAt);
      return isSameDay(jobDate, selectedDate);
    });
  }, [scheduledJobs, selectedDate]);

  const onRefresh = useCallback(() => {
    fetchSchedule();
  }, [fetchSchedule]);

  const handleRequestTimeOff = useCallback(() => {
    setShowTimeOffForm(true);
    // Default start = tomorrow, end = day after
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    const dayAfter = new Date(tomorrow);
    dayAfter.setDate(dayAfter.getDate() + 1);
    setTimeOffStartDate(tomorrow);
    setTimeOffEndDate(dayAfter);
    setTimeOffReason('');
  }, []);

  const handleSubmitTimeOff = useCallback(async () => {
    if (!timeOffStartDate || !timeOffEndDate) {
      Alert.alert(t('scheduleScreen.selectDates'), t('scheduleScreen.selectBothDates'));
      return;
    }
    if (timeOffEndDate < timeOffStartDate) {
      Alert.alert(t('scheduleScreen.selectDates'), t('scheduleScreen.invalidDates'));
      return;
    }
    setIsSubmittingTimeOff(true);
    try {
      await post('/provider/time-off', {
        start_date: timeOffStartDate.toISOString().split('T')[0],
        end_date: timeOffEndDate.toISOString().split('T')[0],
        reason: timeOffReason || 'Personal',
      });
      // Add to local list optimistically
      setTimeOffRequests((prev) => [
        ...prev,
        {
          id: `local-${Date.now()}`,
          startDate: timeOffStartDate.toISOString(),
          endDate: timeOffEndDate.toISOString(),
          reason: timeOffReason || 'Personal',
          status: 'pending' as const,
          createdAt: new Date().toISOString(),
        },
      ]);
      setShowTimeOffForm(false);
      Alert.alert(t('scheduleScreen.submitted'), t('scheduleScreen.timeOffSubmitted'));
    } catch {
      Alert.alert(t('common.error'), t('scheduleScreen.submitFailed'));
    } finally {
      setIsSubmittingTimeOff(false);
    }
  }, [timeOffStartDate, timeOffEndDate, timeOffReason]);

  // ------------------------------------------
  // Tab content renderers
  // ------------------------------------------

  const navigation = useNavigation<any>();

  const handleJobPress = useCallback((job: ScheduledJob) => {
    const jobStart = new Date(job.scheduledAt);
    const now = new Date();
    const minutesUntilStart = (jobStart.getTime() - now.getTime()) / 60000;

    if (minutesUntilStart > EARLY_START_MINUTES) {
      const mins = Math.ceil(minutesUntilStart - EARLY_START_MINUTES);
      Alert.alert(
        t('scheduleScreen.tooEarly'),
        t('scheduleScreen.canStartIn', { mins }),
        [{ text: t('common.ok') }],
      );
      return;
    }

    // Navigate to ActiveJob screen in the Jobs tab stack
    navigation.navigate('JobsTab', {
      screen: 'ActiveJob',
      params: { jobId: job.id },
    });
  }, [navigation]);

  const renderJobsTab = () => (
    <View>
      <CalendarStrip
        selectedDate={selectedDate}
        onSelectDate={setSelectedDate}
        jobDates={jobDates}
      />

      <Text style={[styles.dateHeaderText, { color: theme.textPrimary }]}>
        {selectedDate.toLocaleDateString(language === 'fr' ? 'fr-CA' : 'en-CA', {
          weekday: 'long',
          month: 'long',
          day: 'numeric',
        })}
      </Text>

      {jobsForDate.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={[styles.emptyTitle, { color: theme.textPrimary }]}>{t('scheduleScreen.noJobsScheduled')}</Text>
          <Text style={[styles.emptySubtext, { color: theme.textSecondary }]}>
            No jobs scheduled for this date.
          </Text>
        </View>
      ) : (
        jobsForDate.map((job) => (
          <ScheduledJobItem key={job.id} job={job} onPress={handleJobPress} />
        ))
      )}
    </View>
  );

  const renderShiftsTab = () => (
    <View>
      {!isLevel4 ? (
        <View style={styles.emptyState}>
          <Text style={[styles.emptyTitle, { color: theme.textPrimary }]}>{t('scheduleScreen.onCall')}</Text>
          <Text style={[styles.emptySubtext, { color: theme.textSecondary }]}>
            On-call shifts are only available for Level 4 providers.
          </Text>
        </View>
      ) : !onCallShifts || onCallShifts.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={[styles.emptyTitle, { color: theme.textPrimary }]}>{t('scheduleScreen.noScheduledShifts')}</Text>
          <Text style={[styles.emptySubtext, { color: theme.textSecondary }]}>
            {t('scheduleScreen.shiftsAppearHere')}
          </Text>
        </View>
      ) : (
        onCallShifts.map((shift) => (
          <ShiftItem key={shift.id} shift={shift} />
        ))
      )}
    </View>
  );

  const timeOffCalendarDays = useMemo(() => {
    const loc = language === 'fr' ? 'fr-CA' : 'en-CA';
    const days: Array<{ date: Date; label: string; dayLabel: string }> = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (let i = 1; i <= 30; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      days.push({
        date: d,
        label: d.toLocaleDateString(loc, { day: 'numeric' }),
        dayLabel: d.toLocaleDateString(loc, { weekday: 'short' }),
      });
    }
    return days;
  }, [language]);

  const renderTimeOffTab = () => (
    <View>
      {!showTimeOffForm ? (
        <View style={styles.requestButtonWrapper}>
          <GlassButton
            title={t('scheduleScreen.requestTimeOff')}
            variant="glow"
            onPress={handleRequestTimeOff}
            style={styles.requestButton}
          />
        </View>
      ) : (
        <GlassCard variant="dark" padding={16} style={styles.timeOffFormCard}>
          <Text style={[styles.timeOffFormTitle, { color: theme.textPrimary }]}>{t('scheduleScreen.selectDates')}</Text>

          {/* Start Date */}
          <Text style={[styles.timeOffFormLabel, { color: theme.textSecondary }]}>{t('scheduleScreen.startDate')}</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.timeOffDateScroll}
          >
            {timeOffCalendarDays.map((day, idx) => {
              const isSelected = timeOffStartDate && isSameDay(day.date, timeOffStartDate);
              return (
                <TouchableOpacity
                  key={idx}
                  style={[
                    styles.timeOffDayCell,
                    isSelected && styles.timeOffDayCellSelected,
                  ]}
                  onPress={() => {
                    setTimeOffStartDate(day.date);
                    if (timeOffEndDate && day.date > timeOffEndDate) {
                      const nextDay = new Date(day.date);
                      nextDay.setDate(nextDay.getDate() + 1);
                      setTimeOffEndDate(nextDay);
                    }
                  }}
                >
                  <Text style={[styles.timeOffDayLabel, !isSelected && { color: theme.textSecondary }, isSelected && styles.timeOffDayLabelSelected]}>
                    {day.dayLabel}
                  </Text>
                  <Text style={[styles.timeOffDateLabel, !isSelected && { color: theme.textPrimary }, isSelected && styles.timeOffDateLabelSelected]}>
                    {day.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {/* End Date */}
          <Text style={[styles.timeOffFormLabel, { color: theme.textSecondary }]}>{t('scheduleScreen.endDate')}</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.timeOffDateScroll}
          >
            {timeOffCalendarDays
              .filter((day) => !timeOffStartDate || day.date >= timeOffStartDate)
              .map((day, idx) => {
                const isSelected = timeOffEndDate && isSameDay(day.date, timeOffEndDate);
                return (
                  <TouchableOpacity
                    key={idx}
                    style={[
                      styles.timeOffDayCell,
                      isSelected && styles.timeOffDayCellSelected,
                    ]}
                    onPress={() => setTimeOffEndDate(day.date)}
                  >
                    <Text style={[styles.timeOffDayLabel, isSelected && styles.timeOffDayLabelSelected]}>
                      {day.dayLabel}
                    </Text>
                    <Text style={[styles.timeOffDateLabel, isSelected && styles.timeOffDateLabelSelected]}>
                      {day.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
          </ScrollView>

          {/* Reason */}
          <Text style={[styles.timeOffFormLabel, { color: theme.textSecondary }]}>{t('scheduleScreen.reason')}</Text>
          <TextInput
            style={[styles.timeOffReasonInput, { color: theme.textPrimary, backgroundColor: theme.inputBackground, borderColor: theme.inputBorder }]}
            value={timeOffReason}
            onChangeText={setTimeOffReason}
            placeholder={language === 'fr' ? 'Personnel, vacances, etc.' : 'Personal, vacation, etc.'}
            placeholderTextColor={theme.inputPlaceholder}
            maxLength={100}
          />

          {/* Summary */}
          {timeOffStartDate && timeOffEndDate && (
            <Text style={styles.timeOffSummary}>
              {formatDate(timeOffStartDate.toISOString())} - {formatDate(timeOffEndDate.toISOString())}
            </Text>
          )}

          {/* Actions */}
          <View style={styles.timeOffActions}>
            <GlassButton
              title={t('common.cancel')}
              variant="outline"
              onPress={() => setShowTimeOffForm(false)}
              style={styles.timeOffCancelBtn}
            />
            <GlassButton
              title={t('scheduleScreen.submitRequest')}
              variant="glow"
              onPress={handleSubmitTimeOff}
              loading={isSubmittingTimeOff}
              disabled={!timeOffStartDate || !timeOffEndDate || isSubmittingTimeOff}
              style={styles.timeOffSubmitBtn}
            />
          </View>
        </GlassCard>
      )}

      {timeOffRequests.length === 0 && !showTimeOffForm ? (
        <View style={styles.emptyState}>
          <Text style={[styles.emptyTitle, { color: theme.textPrimary }]}>{t('scheduleScreen.noTimeOffRequests')}</Text>
          <Text style={[styles.emptySubtext, { color: theme.textSecondary }]}>
            Submit a time-off request to block dates on your schedule.
          </Text>
        </View>
      ) : (
        timeOffRequests.map((request) => (
          <GlassCard key={request.id} variant="dark" padding={14} style={styles.timeOffCard}>
            <Text style={[styles.timeOffDates, { color: theme.textPrimary }]}>
              {formatDate(request.startDate)} - {formatDate(request.endDate)}
            </Text>
            <Text style={[styles.timeOffReason, { color: theme.textSecondary }]}>{request.reason}</Text>
            <View
              style={[
                styles.timeOffStatus,
                {
                  backgroundColor:
                    request.status === 'approved'
                      ? `${Colors.success}20`
                      : request.status === 'rejected'
                        ? `${Colors.emergencyRed}20`
                        : `${Colors.warning}20`,
                },
              ]}
            >
              <Text
                style={[
                  styles.timeOffStatusText,
                  {
                    color:
                      request.status === 'approved'
                        ? Colors.success
                        : request.status === 'rejected'
                          ? Colors.emergencyRed
                          : Colors.warning,
                  },
                ]}
              >
                {request.status.charAt(0).toUpperCase() +
                  request.status.slice(1)}
              </Text>
            </View>
          </GlassCard>
        ))
      )}
    </View>
  );

  return (
    <Screen>
      <ScreenTitle title={t('nav.schedule')} sub="§ Provider" />
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.contentContainer}
        refreshControl={
          <RefreshControl
            refreshing={isLoadingSchedule}
            onRefresh={onRefresh}
            tintColor={Colors.primary}
            colors={[Colors.primary]}
          />
        }
      >
        {/* Tab bar */}
        <View style={styles.tabBar}>
          {(
            [
              { key: 'jobs' as CalendarTab, label: t('scheduleScreen.jobs') },
              { key: 'shifts' as CalendarTab, label: t('scheduleScreen.onCall') },
              { key: 'timeoff' as CalendarTab, label: t('scheduleScreen.timeOff') },
            ] as const
          ).map((tab) => (
            <TouchableOpacity
              key={tab.key}
              style={[
                styles.tab,
                activeTab === tab.key && styles.tabActive,
              ]}
              onPress={() => setActiveTab(tab.key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: activeTab === tab.key }}
            >
              <Text
                style={[
                  styles.tabText,
                  { color: theme.textSecondary },
                  activeTab === tab.key && styles.tabTextActive,
                ]}
              >
                {tab.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {activeTab === 'jobs' && renderJobsTab()}
        {activeTab === 'shifts' && renderShiftsTab()}
        {activeTab === 'timeoff' && renderTimeOffTab()}

        <View style={styles.bottomSpacer} />
      </ScrollView>
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  contentContainer: {
    // Sin esto el último elemento queda debajo de la tab bar / barra
    // de acción y no se puede alcanzar.
    paddingBottom: 40,
    paddingTop: 8,
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    borderRadius: 14,
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 4,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
  },
  tabActive: {
    backgroundColor: 'rgba(120, 80, 255, 0.8)',
    ...Platform.select({
      ios: {
        shadowColor: 'rgba(120, 80, 255, 0.6)',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 1,
        shadowRadius: 10,
      },
      android: { elevation: 6 },
    }),
  },
  tabText: {
    fontSize: 14,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.5)',
  },
  tabTextActive: {
    color: '#FFFFFF',
  },
  dateHeaderText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 40,
    paddingHorizontal: 40,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.5)',
    textAlign: 'center',
    lineHeight: 20,
  },
  requestButtonWrapper: {
    marginHorizontal: 16,
    marginBottom: 16,
  },
  requestButton: {
    width: '100%',
  },
  timeOffCard: {
    marginHorizontal: 16,
    marginBottom: 8,
  },
  timeOffDates: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  timeOffReason: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.6)',
    marginBottom: 8,
  },
  timeOffStatus: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  timeOffStatusText: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  // ── Time Off Form ─────────────────────
  timeOffFormCard: {
    marginHorizontal: 16,
    marginBottom: 16,
  },
  timeOffFormTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 16,
  },
  timeOffFormLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.5)',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
    marginTop: 12,
  },
  timeOffDateScroll: {
    // flexGrow:0 obligatorio: sin él el scroll horizontal se expande
    // y roba el espacio vertical del modal.
    flexGrow: 0,
    marginBottom: 4,
  },
  timeOffDayCell: {
    width: 52,
    height: 64,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.10)',
  },
  timeOffDayCellSelected: {
    backgroundColor: 'rgba(120, 80, 255, 0.8)',
    borderColor: 'rgba(255, 255, 255, 0.30)',
  },
  timeOffDayLabel: {
    fontSize: 10,
    color: 'rgba(255, 255, 255, 0.4)',
    marginBottom: 4,
  },
  timeOffDayLabelSelected: {
    color: '#FFFFFF',
  },
  timeOffDateLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  timeOffDateLabelSelected: {
    color: '#FFFFFF',
  },
  timeOffReasonInput: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: '#FFFFFF',
    marginBottom: 12,
  },
  timeOffSummary: {
    fontSize: 14,
    color: 'rgba(120, 80, 255, 0.9)',
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 16,
  },
  timeOffActions: {
    flexDirection: 'row',
    gap: 12,
  },
  timeOffCancelBtn: {
    flex: 0,
    paddingHorizontal: 24,
  },
  timeOffSubmitBtn: {
    flex: 1,
  },

  bottomSpacer: {
    height: 32,
  },
});
