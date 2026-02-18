/**
 * VISP/Tasker - Schedule Screen
 *
 * Calendar view of upcoming jobs, availability management, on-call
 * shift schedule for Level 4 providers, and time-off requests.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
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

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function formatTime(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hrs}h ${mins}m` : `${hrs}h`;
}

function getCalendarDays(): Array<{
  date: Date;
  label: string;
  dayLabel: string;
  isToday: boolean;
}> {
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
      label: date.toLocaleDateString([], { day: 'numeric' }),
      dayLabel: date.toLocaleDateString([], { weekday: 'short' }),
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
  const days = useMemo(() => getCalendarDays(), []);

  return (
    <ScrollView
      horizontal
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
                isSelected && calendarStyles.dayLabelSelected,
              ]}
            >
              {day.dayLabel}
            </Text>
            <Text
              style={[
                calendarStyles.dateLabel,
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
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 4,
    backgroundColor: Colors.surface,
  },
  dayCellSelected: {
    backgroundColor: Colors.primary,
  },
  dayCellToday: {
    borderWidth: 1,
    borderColor: Colors.primary,
  },
  dayLabel: {
    fontSize: 11,
    color: Colors.textTertiary,
    marginBottom: 4,
  },
  dayLabelSelected: {
    color: Colors.white,
  },
  dateLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  dateLabelSelected: {
    color: Colors.white,
  },
  jobDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.primary,
    marginTop: 4,
  },
  jobDotSelected: {
    backgroundColor: Colors.white,
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
          <Text style={jobItemStyles.taskName} numberOfLines={1}>
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
          <Text style={jobItemStyles.detailText}>
            {formatTime(job.scheduledAt)} | {formatDuration(job.estimatedDurationMinutes)}
          </Text>
          <Text style={jobItemStyles.locationText}>{job.customerArea}</Text>
        </View>
        {canStart && (
          <View style={jobItemStyles.startRouteContainer}>
            <View style={jobItemStyles.startRouteBadge}>
              <Text style={jobItemStyles.startRouteText}>▶ Start Route</Text>
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
    backgroundColor: Colors.surface,
    borderRadius: 10,
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
    color: Colors.textPrimary,
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
    color: Colors.white,
    textTransform: 'uppercase',
  },
  details: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  detailText: {
    fontSize: 13,
    color: Colors.textSecondary,
  },
  locationText: {
    fontSize: 13,
    color: Colors.textTertiary,
  },
  startRouteContainer: {
    marginTop: 8,
    alignItems: 'flex-start',
  },
  startRouteBadge: {
    backgroundColor: Colors.primary,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  startRouteText: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.white,
  },
});

// ---------------------------------------------------------------------------
// ShiftItem sub-component
// ---------------------------------------------------------------------------

interface ShiftItemProps {
  shift: OnCallShift;
}

function ShiftItem({ shift }: ShiftItemProps): React.JSX.Element {
  return (
    <View style={shiftStyles.container}>
      <View
        style={[
          shiftStyles.indicator,
          {
            backgroundColor: shift.isActive
              ? Colors.success
              : Colors.textTertiary,
          },
        ]}
      />
      <View style={shiftStyles.content}>
        <Text style={shiftStyles.dateText}>
          {formatDate(shift.startTime)}
        </Text>
        <Text style={shiftStyles.timeText}>
          {formatTime(shift.startTime)} - {formatTime(shift.endTime)}
        </Text>
      </View>
      <View
        style={[
          shiftStyles.statusBadge,
          {
            backgroundColor: shift.isActive
              ? `${Colors.success}20`
              : `${Colors.textTertiary}20`,
          },
        ]}
      >
        <Text
          style={[
            shiftStyles.statusText,
            {
              color: shift.isActive ? Colors.success : Colors.textTertiary,
            },
          ]}
        >
          {shift.isActive ? 'Active' : 'Scheduled'}
        </Text>
      </View>
    </View>
  );
}

const shiftStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 10,
    padding: 14,
    marginHorizontal: 16,
    marginBottom: 8,
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
    color: Colors.textPrimary,
    marginBottom: 2,
  },
  timeText: {
    fontSize: 13,
    color: Colors.textSecondary,
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
    Alert.alert(
      'Request Time Off',
      'Time-off requests will be submitted for approval. This feature will open a date picker to select your requested dates.',
      [{ text: 'OK' }],
    );
  }, []);

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
        'Too Early',
        `You can start this job ${mins} minute${mins !== 1 ? 's' : ''} from now (${EARLY_START_MINUTES} minutes before the scheduled time).`,
        [{ text: 'OK' }],
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

      <Text style={styles.dateHeaderText}>
        {selectedDate.toLocaleDateString([], {
          weekday: 'long',
          month: 'long',
          day: 'numeric',
        })}
      </Text>

      {jobsForDate.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>No Jobs Scheduled</Text>
          <Text style={styles.emptySubtext}>
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
          <Text style={styles.emptyTitle}>On-Call Shifts</Text>
          <Text style={styles.emptySubtext}>
            On-call shifts are only available for Level 4 providers.
          </Text>
        </View>
      ) : !onCallShifts || onCallShifts.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>No Scheduled Shifts</Text>
          <Text style={styles.emptySubtext}>
            Your on-call shift schedule will appear here once assigned.
          </Text>
        </View>
      ) : (
        onCallShifts.map((shift) => (
          <ShiftItem key={shift.id} shift={shift} />
        ))
      )}
    </View>
  );

  const renderTimeOffTab = () => (
    <View>
      <TouchableOpacity
        style={styles.requestButton}
        onPress={handleRequestTimeOff}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel="Request time off"
      >
        <Text style={styles.requestButtonText}>Request Time Off</Text>
      </TouchableOpacity>

      {timeOffRequests.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>No Time-Off Requests</Text>
          <Text style={styles.emptySubtext}>
            Submit a time-off request to block dates on your schedule.
          </Text>
        </View>
      ) : (
        timeOffRequests.map((request) => (
          <View key={request.id} style={styles.timeOffCard}>
            <Text style={styles.timeOffDates}>
              {formatDate(request.startDate)} - {formatDate(request.endDate)}
            </Text>
            <Text style={styles.timeOffReason}>{request.reason}</Text>
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
          </View>
        ))
      )}
    </View>
  );

  return (
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
            { key: 'jobs' as CalendarTab, label: 'Jobs' },
            { key: 'shifts' as CalendarTab, label: 'On-Call' },
            { key: 'timeoff' as CalendarTab, label: 'Time Off' },
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
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  contentContainer: {
    paddingTop: 8,
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderRadius: 10,
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 4,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  tabActive: {
    backgroundColor: Colors.primary,
  },
  tabText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  tabTextActive: {
    color: Colors.white,
  },
  dateHeaderText: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.textPrimary,
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
    color: Colors.textPrimary,
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  requestButton: {
    backgroundColor: Colors.primary,
    borderRadius: 8,
    paddingVertical: 12,
    marginHorizontal: 16,
    marginBottom: 16,
    alignItems: 'center',
  },
  requestButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.white,
  },
  timeOffCard: {
    backgroundColor: Colors.surface,
    borderRadius: 10,
    padding: 14,
    marginHorizontal: 16,
    marginBottom: 8,
  },
  timeOffDates: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.textPrimary,
    marginBottom: 4,
  },
  timeOffReason: {
    fontSize: 13,
    color: Colors.textSecondary,
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
  bottomSpacer: {
    height: 32,
  },
});
