/**
 * VISP/Tasker - JobTrackingScreen
 *
 * Job status tracking screen with:
 *   - Assigned provider info (name, rating, photo placeholder, credentials)
 *   - Map placeholder / ETA display
 *   - Status timeline: Matched -> En Route -> Arrived -> In Progress -> Completed
 *   - Contact buttons (Call, Message)
 *   - In Progress: timer and running cost estimate
 *   - Completed: summary with rating prompt
 *
 * For MVP: uses mock data with simulated status progression.
 *
 * CRITICAL: Closed task catalog. Provider cannot add scope to this job.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
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
import { Colors, getLevelColor, getStatusColor } from '../../theme/colors';
import { Spacing } from '../../theme/spacing';
import { Typography, FontWeight, FontSize } from '../../theme/typography';
import { BorderRadius } from '../../theme/borders';
import { Shadows } from '../../theme/shadows';
import LevelBadge from '../../components/LevelBadge';
import type { CustomerFlowParamList, JobAssignment, ServiceLevel } from '../../types';

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

type JobTrackingRouteProp = RouteProp<CustomerFlowParamList, 'JobTracking'>;
type JobTrackingNavProp = NativeStackNavigationProp<CustomerFlowParamList, 'JobTracking'>;

type TrackingStatus = 'matched' | 'en_route' | 'arrived' | 'in_progress' | 'completed';

interface StatusStep {
  status: TrackingStatus;
  label: string;
  description: string;
}

// ──────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────

const STATUS_STEPS: StatusStep[] = [
  {
    status: 'matched',
    label: 'Matched',
    description: 'Provider assigned to your job',
  },
  {
    status: 'en_route',
    label: 'En Route',
    description: 'Provider is on the way',
  },
  {
    status: 'arrived',
    label: 'Arrived',
    description: 'Provider has arrived at your location',
  },
  {
    status: 'in_progress',
    label: 'In Progress',
    description: 'Work is underway',
  },
  {
    status: 'completed',
    label: 'Completed',
    description: 'Job has been completed',
  },
];

// ──────────────────────────────────────────────
// Mock Data (MVP)
// ──────────────────────────────────────────────

const MOCK_ASSIGNMENT: JobAssignment = {
  id: 'assign-001',
  jobId: '',
  providerId: 'provider-001',
  providerName: 'Michael R.',
  providerRating: 4.8,
  providerPhoto: null,
  providerCompletedJobs: 142,
  providerLevel: 2,
  acceptedAt: new Date().toISOString(),
  eta: 15,
};

const MOCK_TASK_NAME = 'General Plumbing Repair';
const MOCK_HOURLY_RATE = 75;

// Status progression timing for MVP demo
const STATUS_PROGRESSION: { status: TrackingStatus; delay: number }[] = [
  { status: 'matched', delay: 0 },
  { status: 'en_route', delay: 5000 },
  { status: 'arrived', delay: 12000 },
  { status: 'in_progress', delay: 18000 },
  { status: 'completed', delay: 30000 },
];

// ──────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────

function JobTrackingScreen(): React.JSX.Element {
  const route = useRoute<JobTrackingRouteProp>();
  const navigation = useNavigation<JobTrackingNavProp>();
  const { jobId } = route.params;

  const [currentStatus, setCurrentStatus] = useState<TrackingStatus>('matched');
  const [assignment] = useState<JobAssignment>({
    ...MOCK_ASSIGNMENT,
    jobId,
  });
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [eta, setEta] = useState(15);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const progressionRef = useRef<NodeJS.Timeout[]>([]);

  // Set header title
  useEffect(() => {
    navigation.setOptions({ title: 'Job Status' });
  }, [navigation]);

  // MVP: Auto-progress through statuses
  useEffect(() => {
    STATUS_PROGRESSION.forEach(({ status, delay }) => {
      const timer = setTimeout(() => {
        setCurrentStatus(status);

        // Update ETA based on status
        if (status === 'en_route') {
          setEta(12);
        } else if (status === 'arrived') {
          setEta(0);
        }
      }, delay);
      progressionRef.current.push(timer);
    });

    return () => {
      progressionRef.current.forEach(clearTimeout);
    };
  }, []);

  // In-progress timer
  useEffect(() => {
    if (currentStatus === 'in_progress') {
      timerRef.current = setInterval(() => {
        setElapsedSeconds((prev) => prev + 1);
      }, 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [currentStatus]);

  // Derived values
  const currentStepIndex = useMemo(
    () => STATUS_STEPS.findIndex((s) => s.status === currentStatus),
    [currentStatus],
  );

  const isCompleted = currentStatus === 'completed';
  const isInProgress = currentStatus === 'in_progress';

  const formattedTimer = useMemo(() => {
    const mins = Math.floor(elapsedSeconds / 60);
    const secs = elapsedSeconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }, [elapsedSeconds]);

  const runningCost = useMemo(() => {
    const hours = elapsedSeconds / 3600;
    return (MOCK_HOURLY_RATE * hours).toFixed(2);
  }, [elapsedSeconds]);

  const finalPrice = useMemo(() => {
    if (isCompleted) {
      // MVP mock final price
      return 127.50;
    }
    return 0;
  }, [isCompleted]);

  // Handlers
  const handleCall = useCallback(() => {
    Alert.alert(
      'Call Provider',
      `Call ${assignment.providerName}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Call', onPress: () => {} },
      ],
    );
  }, [assignment.providerName]);

  const handleMessage = useCallback(() => {
    navigation.navigate('Chat', {
      jobId,
      otherUserName: assignment.providerName,
    });
  }, [navigation, jobId, assignment.providerName]);

  const handleRateProvider = useCallback(() => {
    navigation.navigate('Rating', {
      jobId,
      taskName: MOCK_TASK_NAME,
      finalPrice,
    });
  }, [navigation, jobId, finalPrice]);

  // Provider initials for avatar
  const providerInitials = useMemo(() => {
    const parts = assignment.providerName.split(' ');
    return parts.map((p) => p.charAt(0)).join('');
  }, [assignment.providerName]);

  const levelColor = getLevelColor(assignment.providerLevel);

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Provider Card */}
          <View style={styles.section}>
            <View style={styles.providerCard}>
              <View style={styles.providerHeader}>
                {/* Avatar */}
                <View style={[styles.avatar, { borderColor: levelColor }]}>
                  <Text style={styles.avatarText}>{providerInitials}</Text>
                </View>
                <View style={styles.providerInfo}>
                  <Text style={styles.providerName}>
                    {assignment.providerName}
                  </Text>
                  <View style={styles.providerMeta}>
                    <Text style={styles.providerRating}>
                      {assignment.providerRating.toFixed(1)} rating
                    </Text>
                    <Text style={styles.providerDot}> -- </Text>
                    <Text style={styles.providerJobs}>
                      {assignment.providerCompletedJobs} jobs
                    </Text>
                  </View>
                  <LevelBadge level={assignment.providerLevel} size="small" />
                </View>
              </View>

              {/* Contact Buttons */}
              <View style={styles.contactButtons}>
                <TouchableOpacity
                  style={styles.contactButton}
                  onPress={handleCall}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel="Call provider"
                >
                  <Text style={styles.contactButtonIcon}>C</Text>
                  <Text style={styles.contactButtonText}>Call</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.contactButton}
                  onPress={handleMessage}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel="Message provider"
                >
                  <Text style={styles.contactButtonIcon}>M</Text>
                  <Text style={styles.contactButtonText}>Message</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>

          {/* ETA / Map Placeholder */}
          {!isCompleted && !isInProgress && (
            <View style={styles.section}>
              <View style={styles.etaCard}>
                <View style={styles.mapPlaceholder}>
                  <Text style={styles.mapPlaceholderText}>Map</Text>
                  <Text style={styles.mapPlaceholderSubtext}>
                    Provider location tracking
                  </Text>
                </View>
                {eta > 0 && (
                  <View style={styles.etaInfo}>
                    <Text style={styles.etaLabel}>Estimated Arrival</Text>
                    <Text style={styles.etaValue}>{eta} min</Text>
                  </View>
                )}
                {currentStatus === 'arrived' && (
                  <View style={styles.etaInfo}>
                    <Text style={styles.arrivedText}>
                      Provider has arrived at your location
                    </Text>
                  </View>
                )}
              </View>
            </View>
          )}

          {/* In Progress Timer */}
          {isInProgress && (
            <View style={styles.section}>
              <View style={styles.timerCard}>
                <Text style={styles.timerLabel}>Work In Progress</Text>
                <Text style={styles.timerValue}>{formattedTimer}</Text>
                <View style={styles.timerMeta}>
                  <Text style={styles.timerMetaLabel}>Running estimate</Text>
                  <Text style={styles.timerMetaValue}>${runningCost}</Text>
                </View>
                <Text style={styles.timerNote}>
                  Based on ${MOCK_HOURLY_RATE}/hr. Final price may vary.
                </Text>
              </View>
            </View>
          )}

          {/* Completed Summary */}
          {isCompleted && (
            <View style={styles.section}>
              <View style={styles.completedCard}>
                <Text style={styles.completedTitle}>Job Completed</Text>
                <Text style={styles.completedPrice}>${finalPrice.toFixed(2)}</Text>
                <Text style={styles.completedSubtext}>
                  Thank you for using Tasker. Please rate your experience.
                </Text>
                <TouchableOpacity
                  style={styles.rateButton}
                  onPress={handleRateProvider}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityLabel="Rate your provider"
                >
                  <Text style={styles.rateButtonText}>Rate & Pay</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Status Timeline */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Job Timeline</Text>
            <View style={styles.timeline}>
              {STATUS_STEPS.map((step, index) => {
                const stepIndex = index;
                const isPast = stepIndex < currentStepIndex;
                const isCurrent = stepIndex === currentStepIndex;
                const isFuture = stepIndex > currentStepIndex;
                const isLast = index === STATUS_STEPS.length - 1;

                const stepColor = isPast
                  ? Colors.success
                  : isCurrent
                    ? Colors.primary
                    : Colors.border;

                return (
                  <View key={step.status} style={styles.timelineStep}>
                    {/* Connector line (not for last item) */}
                    <View style={styles.timelineLeftCol}>
                      <View
                        style={[
                          styles.timelineDot,
                          { backgroundColor: stepColor },
                          isCurrent && styles.timelineDotCurrent,
                        ]}
                      >
                        {isPast && (
                          <Text style={styles.timelineDotCheck}>V</Text>
                        )}
                      </View>
                      {!isLast && (
                        <View
                          style={[
                            styles.timelineLine,
                            {
                              backgroundColor: isPast
                                ? Colors.success
                                : Colors.border,
                            },
                          ]}
                        />
                      )}
                    </View>
                    <View style={styles.timelineContent}>
                      <Text
                        style={[
                          styles.timelineLabel,
                          isFuture && styles.timelineLabelFuture,
                          isCurrent && styles.timelineLabelCurrent,
                        ]}
                      >
                        {step.label}
                      </Text>
                      <Text
                        style={[
                          styles.timelineDescription,
                          isFuture && styles.timelineDescriptionFuture,
                        ]}
                      >
                        {step.description}
                      </Text>
                    </View>
                  </View>
                );
              })}
            </View>
          </View>

          {/* Service Scope Notice */}
          <View style={styles.section}>
            <View style={styles.noticeCard}>
              <Text style={styles.noticeTitle}>Service Scope</Text>
              <Text style={styles.noticeText}>
                The provider will perform exactly the work described in your
                booking. Additional services require a separate booking. The
                provider cannot add scope to this job.
              </Text>
            </View>
          </View>

          <View style={styles.bottomPadding} />
        </ScrollView>
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
    marginBottom: Spacing.lg,
  },

  // Provider Card
  providerCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  providerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.lg,
  },
  avatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: Colors.surfaceLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing.lg,
    borderWidth: 2,
  },
  avatarText: {
    fontSize: FontSize.title3,
    fontWeight: FontWeight.bold as '700',
    color: Colors.textPrimary,
  },
  providerInfo: {
    flex: 1,
  },
  providerName: {
    ...Typography.title3,
    color: Colors.textPrimary,
    marginBottom: Spacing.xxs,
  },
  providerMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.xs,
  },
  providerRating: {
    ...Typography.footnote,
    color: Colors.warning,
    fontWeight: FontWeight.semiBold as '600',
  },
  providerDot: {
    ...Typography.caption,
    color: Colors.textTertiary,
  },
  providerJobs: {
    ...Typography.footnote,
    color: Colors.textSecondary,
  },

  // Contact Buttons
  contactButtons: {
    flexDirection: 'row',
    gap: Spacing.md,
  },
  contactButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.md,
    backgroundColor: Colors.surfaceLight,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: Spacing.sm,
  },
  contactButtonIcon: {
    fontSize: 14,
    color: Colors.primary,
    fontWeight: FontWeight.bold as '700',
  },
  contactButtonText: {
    ...Typography.footnote,
    color: Colors.primary,
    fontWeight: FontWeight.semiBold as '600',
  },

  // ETA Card
  etaCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  mapPlaceholder: {
    height: 160,
    backgroundColor: Colors.surfaceLight,
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  mapPlaceholderText: {
    ...Typography.title3,
    color: Colors.textTertiary,
    marginBottom: Spacing.xxs,
  },
  mapPlaceholderSubtext: {
    ...Typography.caption,
    color: Colors.textTertiary,
  },
  etaInfo: {
    padding: Spacing.lg,
    alignItems: 'center',
  },
  etaLabel: {
    ...Typography.caption,
    color: Colors.textSecondary,
    marginBottom: Spacing.xxs,
  },
  etaValue: {
    fontSize: FontSize.title1,
    fontWeight: FontWeight.bold as '700',
    color: Colors.primary,
  },
  arrivedText: {
    ...Typography.body,
    color: Colors.success,
    fontWeight: FontWeight.semiBold as '600',
  },

  // Timer Card
  timerCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    padding: Spacing.xl,
    borderWidth: 1,
    borderColor: Colors.primary,
    alignItems: 'center',
  },
  timerLabel: {
    ...Typography.label,
    color: Colors.primary,
    marginBottom: Spacing.md,
  },
  timerValue: {
    fontSize: 48,
    fontWeight: FontWeight.bold as '700',
    color: Colors.textPrimary,
    fontVariant: ['tabular-nums'],
    marginBottom: Spacing.md,
  },
  timerMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  timerMetaLabel: {
    ...Typography.footnote,
    color: Colors.textSecondary,
  },
  timerMetaValue: {
    ...Typography.headline,
    color: Colors.primary,
  },
  timerNote: {
    ...Typography.caption,
    color: Colors.textTertiary,
    textAlign: 'center',
  },

  // Completed Card
  completedCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    padding: Spacing.xl,
    borderWidth: 1,
    borderColor: Colors.success,
    alignItems: 'center',
  },
  completedTitle: {
    ...Typography.title3,
    color: Colors.success,
    marginBottom: Spacing.md,
  },
  completedPrice: {
    fontSize: FontSize.title1,
    fontWeight: FontWeight.bold as '700',
    color: Colors.textPrimary,
    marginBottom: Spacing.sm,
  },
  completedSubtext: {
    ...Typography.footnote,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginBottom: Spacing.xl,
  },
  rateButton: {
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.xxxl,
    paddingVertical: Spacing.md,
    ...Shadows.sm,
  },
  rateButtonText: {
    ...Typography.buttonLarge,
    color: Colors.white,
  },

  // Timeline
  timeline: {
    paddingLeft: Spacing.xs,
  },
  timelineStep: {
    flexDirection: 'row',
    minHeight: 60,
  },
  timelineLeftCol: {
    alignItems: 'center',
    width: 24,
    marginRight: Spacing.md,
  },
  timelineDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timelineDotCurrent: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 3,
    borderColor: Colors.primary,
    backgroundColor: Colors.background,
  },
  timelineDotCheck: {
    fontSize: 10,
    color: Colors.white,
    fontWeight: FontWeight.bold as '700',
  },
  timelineLine: {
    width: 2,
    flex: 1,
    marginVertical: Spacing.xxs,
  },
  timelineContent: {
    flex: 1,
    paddingBottom: Spacing.lg,
  },
  timelineLabel: {
    ...Typography.headline,
    color: Colors.textPrimary,
    marginBottom: Spacing.xxs,
  },
  timelineLabelCurrent: {
    color: Colors.primary,
  },
  timelineLabelFuture: {
    color: Colors.textTertiary,
  },
  timelineDescription: {
    ...Typography.footnote,
    color: Colors.textSecondary,
  },
  timelineDescriptionFuture: {
    color: Colors.textTertiary,
  },

  // Notice Card
  noticeCard: {
    backgroundColor: `${Colors.warning}10`,
    borderRadius: BorderRadius.md,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: `${Colors.warning}30`,
  },
  noticeTitle: {
    ...Typography.headline,
    color: Colors.warning,
    marginBottom: Spacing.sm,
  },
  noticeText: {
    ...Typography.footnote,
    color: Colors.textSecondary,
    lineHeight: 20,
  },

  // Bottom padding
  bottomPadding: {
    height: Spacing.massive,
  },
});

export default JobTrackingScreen;
