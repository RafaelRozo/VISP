/**
 * VISP/Tasker - JobTrackingScreen (Real Data + Mapbox)
 *
 * Live job tracking screen with:
 *   - Real job data from backend API
 *   - Mapbox MapView with provider/customer markers
 *   - Route line between provider and customer
 *   - Polling for provider position + ETA every 5 seconds
 *   - Status timeline: Pending → Matched → En Route → Arrived → In Progress → Completed
 *   - Contact buttons (Call, Message)
 *   - In Progress: timer and running cost estimate
 *   - Completed: summary with rating prompt
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import MapboxGL from '@rnmapbox/maps';

import { Colors, getLevelColor } from '../../theme/colors';
import { Spacing } from '../../theme/spacing';
import { Typography, FontWeight, FontSize } from '../../theme/typography';
import { BorderRadius } from '../../theme/borders';
import { Shadows } from '../../theme/shadows';
import LevelBadge from '../../components/LevelBadge';
import { Config } from '../../services/config';
import taskService from '../../services/taskService';
import type {
  CustomerFlowParamList,
  Job,
  JobTrackingData,
  ServiceLevel,
} from '../../types';

// ──────────────────────────────────────────────
// Mapbox initialization
// ──────────────────────────────────────────────
MapboxGL.setAccessToken(Config.mapboxAccessToken);

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

type JobTrackingRouteProp = RouteProp<CustomerFlowParamList, 'JobTracking'>;
type JobTrackingNavProp = NativeStackNavigationProp<CustomerFlowParamList, 'JobTracking'>;

type TrackingStatus = 'pending' | 'pending_match' | 'matched' | 'en_route' | 'arrived' | 'in_progress' | 'completed';

interface StatusStep {
  status: TrackingStatus;
  label: string;
  description: string;
}

// ──────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────

const STATUS_STEPS: StatusStep[] = [
  { status: 'pending', label: 'Searching', description: 'Looking for a provider near you' },
  { status: 'matched', label: 'Matched', description: 'Provider has been assigned' },
  { status: 'en_route', label: 'En Route', description: 'Provider is on the way' },
  { status: 'arrived', label: 'Arrived', description: 'Provider has arrived at your location' },
  { status: 'in_progress', label: 'In Progress', description: 'Work is underway' },
  { status: 'completed', label: 'Completed', description: 'Job has been completed' },
];

const POLLING_INTERVAL_MS = 5000;
const SEARCH_TIMEOUT_MS = 120_000; // 2 minutes
const HOURLY_RATE = 75;

// Map backend status to simplified tracking status
function mapBackendStatus(backendStatus: string): TrackingStatus {
  const normalized = backendStatus.toLowerCase();
  const map: Record<string, TrackingStatus> = {
    pending: 'pending',
    pending_match: 'pending',
    matched: 'matched',
    pending_approval: 'matched',
    scheduled: 'matched',
    accepted: 'matched',
    provider_accepted: 'matched',
    en_route: 'en_route',
    provider_en_route: 'en_route',
    in_progress: 'in_progress',
    completed: 'completed',
  };
  return map[normalized] ?? 'pending';
}

// ──────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────

function JobTrackingScreen(): React.JSX.Element {
  const route = useRoute<JobTrackingRouteProp>();
  const navigation = useNavigation<JobTrackingNavProp>();
  const { jobId } = route.params;

  // State
  const [job, setJob] = useState<Job | null>(null);
  const [tracking, setTracking] = useState<JobTrackingData | null>(null);
  const [currentStatus, setCurrentStatus] = useState<TrackingStatus>('pending');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTimedOut, setSearchTimedOut] = useState(false);

  // Timer state for in_progress
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Set header title
  useEffect(() => {
    navigation.setOptions({ title: 'Job Status' });
  }, [navigation]);

  // ── Initial load ─────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function loadJob() {
      try {
        setIsLoading(true);
        const jobData = await taskService.getJobDetail(jobId);
        if (!cancelled) {
          setJob(jobData);
          setCurrentStatus(mapBackendStatus(jobData.status));
        }
      } catch (err: any) {
        console.error('[JobTracking] Failed to load job:', err);
        if (!cancelled) {
          setError('Failed to load job details');
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    loadJob();
    return () => { cancelled = true; };
  }, [jobId]);

  // ── Polling for tracking data ────────────
  useEffect(() => {
    if (currentStatus === 'completed' || searchTimedOut) {
      return;
    }

    async function poll() {
      try {
        const data = await taskService.getJobTracking(jobId);
        setTracking(data);
        const newStatus = mapBackendStatus(data.status);
        setCurrentStatus(newStatus);

        // If a provider was found, cancel the search timeout
        if (newStatus !== 'pending' && searchTimeoutRef.current) {
          clearTimeout(searchTimeoutRef.current);
          searchTimeoutRef.current = null;
        }
      } catch (err) {
        console.warn('[JobTracking] Polling error:', err);
      }
    }

    poll(); // Initial
    pollingRef.current = setInterval(poll, POLLING_INTERVAL_MS);

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
    };
  }, [jobId, currentStatus, searchTimedOut]);

  // ── 2-minute search timeout ──────────────
  useEffect(() => {
    // Only start the timeout if we're in pending/searching state
    if (currentStatus !== 'pending' || searchTimedOut) {
      return;
    }

    searchTimeoutRef.current = setTimeout(() => {
      // Only time out if still pending (no provider found)
      setSearchTimedOut(true);
    }, SEARCH_TIMEOUT_MS);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
        searchTimeoutRef.current = null;
      }
    };
  }, [currentStatus, searchTimedOut]);

  // ── In-progress timer ────────────────────
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

  // ── Derived values ───────────────────────
  const currentStepIndex = useMemo(() => {
    // Map to step index, skipping pending_match
    const idx = STATUS_STEPS.findIndex((s) => s.status === currentStatus);
    return idx >= 0 ? idx : 0;
  }, [currentStatus]);

  const isCompleted = currentStatus === 'completed';
  const isInProgress = currentStatus === 'in_progress';
  // Use tracking providerName, or fall back to provider info from job detail
  const jobProviderName = job?.provider
    ? `${job.provider.firstName} ${job.provider.lastName}`.trim()
    : null;
  const hasProvider = tracking?.providerName != null || jobProviderName != null;
  const showMap = (currentStatus !== 'pending' && currentStatus !== 'completed' && !searchTimedOut) || hasProvider;

  const providerName = tracking?.providerName ?? jobProviderName ?? 'Finding provider...';

  const formattedTimer = useMemo(() => {
    const mins = Math.floor(elapsedSeconds / 60);
    const secs = elapsedSeconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }, [elapsedSeconds]);

  const runningCost = useMemo(() => {
    const hours = elapsedSeconds / 3600;
    return (HOURLY_RATE * hours).toFixed(2);
  }, [elapsedSeconds]);

  const finalPrice = useMemo(() => {
    return job?.finalPrice ?? job?.estimatedPrice ?? 0;
  }, [job]);

  const providerInitials = useMemo(() => {
    const name = tracking?.providerName ?? '?';
    const parts = name.split(' ');
    return parts.map((p) => p.charAt(0)).join('').toUpperCase();
  }, [tracking?.providerName]);

  // Customer location (job destination)
  const customerLat = job?.address?.latitude ?? 45.4215;
  const customerLng = job?.address?.longitude ?? -75.6972;

  // Provider location
  const providerLat = tracking?.providerLat;
  const providerLng = tracking?.providerLng;

  // ── Handlers ─────────────────────────────
  const handleCall = useCallback(() => {
    const phone = tracking?.providerPhone;
    if (phone) {
      Linking.openURL(`tel:${phone}`);
    } else {
      Alert.alert(
        'Phone Unavailable',
        'Provider phone number is not yet available.',
        [{ text: 'OK' }],
      );
    }
  }, [tracking?.providerPhone]);

  const handleMessage = useCallback(() => {
    navigation.navigate('Chat', {
      jobId,
      otherUserName: providerName,
    });
  }, [navigation, jobId, providerName]);

  const handleRateProvider = useCallback(() => {
    navigation.navigate('Rating', {
      jobId,
      taskName: job?.taskName ?? 'Job',
      finalPrice,
    });
  }, [navigation, jobId, job?.taskName, finalPrice]);

  const handleKeepWaiting = useCallback(() => {
    // Job stays as pending_match in the backend — partners will see it.
    // Navigate back to home. The job will appear in active jobs list.
    Alert.alert(
      'Job Queued',
      'We are broadcasting your request to all nearby providers. You will be notified when someone accepts.',
      [
        {
          text: 'OK',
          onPress: async () => {
            try {
              await taskService.queueJob(jobId);
              navigation.navigate('CustomerHome');
            } catch (e) {
              console.error('Failed to queue job', e);
              Alert.alert('Error', 'Failed to queue job. Please try again.');
            }
          },
        },
      ],
    );
  }, [navigation, jobId]);

  const handleCancelJob = useCallback(() => {
    Alert.alert(
      'Cancel Job',
      'Are you sure you want to cancel this job request?',
      [
        { text: 'No, Keep It', style: 'cancel' },
        {
          text: 'Yes, Cancel',
          style: 'destructive',
          onPress: async () => {
            try {
              await taskService.getJobDetail(jobId); // just to confirm it still exists
              // In production, call PATCH /jobs/{id}/update-status with "cancelled"
              navigation.goBack();
            } catch {
              navigation.goBack();
            }
          },
        },
      ],
    );
  }, [navigation, jobId]);

  // ── Loading state ────────────────────────
  if (isLoading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={styles.loadingText}>Loading job details...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error || !job) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.loadingContainer}>
          <Text style={styles.errorText}>{error ?? 'Job not found'}</Text>
        </View>
      </SafeAreaView>
    );
  }

  // ── Render ────────────────────────────────
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
                <View style={[styles.avatar, { borderColor: Colors.primary }]}>
                  <Text style={styles.avatarText}>{providerInitials}</Text>
                </View>
                <View style={styles.providerInfo}>
                  <Text style={styles.providerName}>{providerName}</Text>
                  {tracking?.etaMinutes != null && currentStatus !== 'in_progress' && currentStatus !== 'completed' && (
                    <Text style={styles.providerMeta}>
                      ETA: {tracking.etaMinutes} min
                    </Text>
                  )}
                </View>
              </View>

              {/* Contact Buttons */}
              {tracking?.providerName && (
                <View style={styles.contactButtons}>
                  <TouchableOpacity
                    style={styles.contactButton}
                    onPress={handleCall}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel="Call provider"
                  >
                    <Text style={styles.contactButtonIcon}>📞</Text>
                    <Text style={styles.contactButtonText}>Call</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.contactButton}
                    onPress={handleMessage}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel="Message provider"
                  >
                    <Text style={styles.contactButtonIcon}>💬</Text>
                    <Text style={styles.contactButtonText}>Message</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          </View>

          {/* Searching for provider — NO map */}
          {currentStatus === 'pending' && !searchTimedOut && (
            <View style={styles.section}>
              <View style={[styles.mapCard, { alignItems: 'center', justifyContent: 'center', minHeight: 200 }]}>
                <ActivityIndicator size="large" color={Colors.primary} />
                <Text style={[styles.searchingText, { color: Colors.textPrimary, marginTop: 16, fontSize: 16 }]}>
                  Searching for providers...
                </Text>
                <Text style={{ color: Colors.textSecondary, marginTop: 8, textAlign: 'center', paddingHorizontal: 24 }}>
                  We're finding the best available provider near you.
                  This usually takes a moment.
                </Text>
              </View>
            </View>
          )}

          {/* Mapbox Map — only when provider is assigned */}
          {showMap && (
            <View style={styles.section}>
              <View style={styles.mapCard}>
                <MapboxGL.MapView
                  style={styles.mapView}
                  styleURL={MapboxGL.StyleURL.Street}
                  logoEnabled={false}
                  attributionEnabled={false}
                  compassEnabled={false}
                >
                  <MapboxGL.Camera
                    centerCoordinate={[customerLng, customerLat]}
                    zoomLevel={13}
                    animationMode="flyTo"
                    animationDuration={1000}
                  />

                  {/* Customer destination marker */}
                  <MapboxGL.MarkerView
                    id="customer-marker"
                    coordinate={[customerLng, customerLat]}
                  >
                    <View style={styles.customerMarker}>
                      <View style={styles.customerMarkerInner} />
                    </View>
                  </MapboxGL.MarkerView>

                  {/* Provider marker */}
                  {providerLat != null && providerLng != null && (
                    <MapboxGL.MarkerView
                      id="provider-marker"
                      coordinate={[providerLng, providerLat]}
                    >
                      <View style={styles.providerMarker}>
                        <Text style={styles.providerMarkerText}>🚗</Text>
                      </View>
                    </MapboxGL.MarkerView>
                  )}
                </MapboxGL.MapView>

                {/* ETA overlay */}
                {tracking?.etaMinutes != null && tracking.etaMinutes > 0 && (
                  <View style={styles.etaOverlay}>
                    <Text style={styles.etaOverlayLabel}>ETA</Text>
                    <Text style={styles.etaOverlayValue}>{tracking.etaMinutes} min</Text>
                  </View>
                )}
              </View>
            </View>
          )}

          {/* No Provider Found — Search Timed Out */}
          {searchTimedOut && (
            <View style={styles.section}>
              <View style={styles.noProviderCard}>
                <Text style={styles.noProviderIcon}>🔍</Text>
                <Text style={styles.noProviderTitle}>No Providers Available</Text>
                <Text style={styles.noProviderText}>
                  We couldn't find a provider in your area right now. Your job
                  request has been saved — when a provider becomes available,
                  they'll receive your request and you'll be notified.
                </Text>
                <View style={styles.noProviderButtons}>
                  <TouchableOpacity
                    style={styles.keepWaitingButton}
                    onPress={handleKeepWaiting}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.keepWaitingText}>OK, Notify Me</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.cancelJobButton}
                    onPress={handleCancelJob}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.cancelJobText}>Cancel Job</Text>
                  </TouchableOpacity>
                </View>
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
                  Based on ${HOURLY_RATE}/hr. Final price may vary.
                </Text>
              </View>
            </View>
          )}

          {/* Completed Summary */}
          {isCompleted && (
            <View style={styles.section}>
              <View style={styles.completedCard}>
                <Text style={styles.completedTitle}>Job Completed ✓</Text>
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
                const isPast = index < currentStepIndex;
                const isCurrent = index === currentStepIndex;
                const isFuture = index > currentStepIndex;
                const isLast = index === STATUS_STEPS.length - 1;

                const stepColor = isPast
                  ? Colors.success
                  : isCurrent
                    ? Colors.primary
                    : Colors.border;

                return (
                  <View key={step.status} style={styles.timelineStep}>
                    <View style={styles.timelineLeftCol}>
                      <View
                        style={[
                          styles.timelineDot,
                          { backgroundColor: stepColor },
                          isCurrent && styles.timelineDotCurrent,
                        ]}
                      >
                        {isPast && <Text style={styles.timelineDotCheck}>✓</Text>}
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

  // Loading
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.md,
  },
  loadingText: {
    ...Typography.body,
    color: Colors.textSecondary,
  },
  errorText: {
    ...Typography.body,
    color: Colors.emergencyRed,
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
    fontSize: 16,
  },
  contactButtonText: {
    ...Typography.footnote,
    color: Colors.primary,
    fontWeight: FontWeight.semiBold as '600',
  },

  // Map
  mapCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.border,
    position: 'relative',
  },
  mapView: {
    height: 260,
    width: '100%',
  },

  // Customer marker
  customerMarker: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: `${Colors.primary}30`,
    alignItems: 'center',
    justifyContent: 'center',
  },
  customerMarkerInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: Colors.primary,
  },

  // Provider marker
  providerMarker: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...Shadows.md,
    borderWidth: 2,
    borderColor: Colors.primary,
  },
  providerMarkerText: {
    fontSize: 18,
  },

  // ETA Overlay
  etaOverlay: {
    position: 'absolute',
    top: Spacing.md,
    right: Spacing.md,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    ...Shadows.sm,
    alignItems: 'center',
  },
  etaOverlayLabel: {
    ...Typography.caption,
    color: Colors.textSecondary,
  },
  etaOverlayValue: {
    ...Typography.headline,
    color: Colors.primary,
    fontWeight: FontWeight.bold as '700',
  },

  // Searching Overlay
  searchingOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.7)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.md,
    gap: Spacing.sm,
  },
  searchingText: {
    ...Typography.footnote,
    color: Colors.white,
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

  // No Provider Found
  noProviderCard: {
    backgroundColor: Colors.card,
    borderRadius: BorderRadius.lg,
    padding: Spacing.xl,
    alignItems: 'center',
    ...Shadows.md,
  },
  noProviderIcon: {
    fontSize: 48,
    marginBottom: Spacing.md,
  },
  noProviderTitle: {
    ...Typography.title3,
    color: Colors.textPrimary,
    marginBottom: Spacing.sm,
    textAlign: 'center',
  },
  noProviderText: {
    ...Typography.footnote,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: Spacing.lg,
  },
  noProviderButtons: {
    width: '100%',
    gap: Spacing.sm,
  },
  keepWaitingButton: {
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.md,
    paddingVertical: Spacing.md,
    alignItems: 'center',
  },
  keepWaitingText: {
    ...Typography.buttonLarge,
    color: Colors.white,
  },
  cancelJobButton: {
    backgroundColor: 'transparent',
    borderRadius: BorderRadius.md,
    paddingVertical: Spacing.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.error,
  },
  cancelJobText: {
    ...Typography.buttonLarge,
    color: Colors.error,
  },

  // Bottom padding
  bottomPadding: {
    height: Spacing.massive,
  },
});

export default JobTrackingScreen;
