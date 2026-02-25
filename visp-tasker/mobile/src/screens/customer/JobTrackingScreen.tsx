/**
 * VISP - JobTrackingScreen (Glass Redesign)
 *
 * Live job tracking screen with:
 *   - Real job data from backend API
 *   - Mapbox MapView with provider/customer markers
 *   - Route line between provider and customer
 *   - Glass overlays on map and status timeline
 *   - Contact buttons, timer, and completion summary
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { AnimatedSpinner } from '../../components/animations';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import MapboxGL from '@rnmapbox/maps';

import { GlassBackground, GlassCard, GlassButton } from '../../components/glass';
import { Colors, getLevelColor, Spacing, GlassStyles } from '../../theme';
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

  // Route line state
  const [routeCoords, setRouteCoords] = useState<[number, number][] | null>(null);

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
    if (currentStatus !== 'pending' || searchTimedOut) {
      return;
    }

    searchTimeoutRef.current = setTimeout(() => {
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
    const idx = STATUS_STEPS.findIndex((s) => s.status === currentStatus);
    return idx >= 0 ? idx : 0;
  }, [currentStatus]);

  const isCompleted = currentStatus === 'completed';
  const isInProgress = currentStatus === 'in_progress';
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
    const price = job?.finalPrice ?? job?.estimatedPrice ?? 0;
    return price.toFixed(2);
  }, [job?.finalPrice, job?.estimatedPrice]);

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

  // --- Fetch route from provider to customer when provider position updates ---
  useEffect(() => {
    if (
      providerLat == null ||
      providerLng == null ||
      currentStatus === 'completed' ||
      currentStatus === 'in_progress'
    )
      return;

    (async () => {
      try {
        const url =
          `https://api.mapbox.com/directions/v5/mapbox/driving/` +
          `${providerLng},${providerLat};${customerLng},${customerLat}` +
          `?geometries=geojson&overview=full&access_token=${Config.mapboxAccessToken}`;
        const resp = await fetch(url);
        const json = await resp.json();
        if (json.routes && json.routes.length > 0) {
          setRouteCoords(json.routes[0].geometry.coordinates as [number, number][]);
        }
      } catch (err) {
        console.warn('[JobTracking] Route fetch error:', err);
      }
    })();
  }, [providerLat, providerLng, customerLat, customerLng, currentStatus]);

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
              await taskService.getJobDetail(jobId);
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
      <GlassBackground>
        <View style={styles.loadingContainer}>
          <AnimatedSpinner size={48} color={Colors.primary} />
          <Text style={styles.loadingText}>Loading job details...</Text>
        </View>
      </GlassBackground>
    );
  }

  if (error || !job) {
    return (
      <GlassBackground>
        <View style={styles.loadingContainer}>
          <Text style={styles.errorText}>{error ?? 'Job not found'}</Text>
        </View>
      </GlassBackground>
    );
  }

  // ── Render ────────────────────────────────
  return (
    <GlassBackground>
      <View style={styles.container}>
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Provider Card */}
          <View style={styles.section}>
            <GlassCard variant="dark">
              <View style={styles.providerHeader}>
                {/* Avatar */}
                <View style={styles.avatar}>
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
                    <Text style={styles.contactButtonText}>Call</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.contactButton}
                    onPress={handleMessage}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel="Message provider"
                  >
                    <Text style={styles.contactButtonText}>Message</Text>
                  </TouchableOpacity>
                </View>
              )}
            </GlassCard>
          </View>

          {/* Searching for provider — NO map */}
          {currentStatus === 'pending' && !searchTimedOut && (
            <View style={styles.section}>
              <GlassCard variant="standard" style={styles.searchingCard}>
                <AnimatedSpinner size={48} color={Colors.primary} />
                <Text style={styles.searchingTitle}>
                  Searching for providers...
                </Text>
                <Text style={styles.searchingSubtext}>
                  We're finding the best available provider near you.
                  This usually takes a moment.
                </Text>
              </GlassCard>
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
                    centerCoordinate={
                      providerLat != null && providerLng != null
                        ? [
                          (Number(providerLng) + customerLng) / 2,
                          (Number(providerLat) + customerLat) / 2,
                        ]
                        : [customerLng, customerLat]
                    }
                    zoomLevel={12}
                    animationMode="flyTo"
                    animationDuration={1000}
                  />

                  {/* Route line from provider to customer */}
                  {routeCoords && routeCoords.length > 0 && (
                    <MapboxGL.ShapeSource
                      id="tracking-route-source"
                      shape={{
                        type: 'Feature',
                        geometry: {
                          type: 'LineString',
                          coordinates: routeCoords,
                        },
                        properties: {},
                      }}
                    >
                      <MapboxGL.LineLayer
                        id="tracking-route-line"
                        style={{
                          lineColor: Colors.primary,
                          lineWidth: 4,
                          lineOpacity: 0.8,
                          lineCap: 'round',
                          lineJoin: 'round',
                        }}
                      />
                    </MapboxGL.ShapeSource>
                  )}

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
                      coordinate={[Number(providerLng), Number(providerLat)]}
                    >
                      <View style={styles.providerMarker}>
                        <Text style={styles.providerMarkerText}>V</Text>
                      </View>
                    </MapboxGL.MarkerView>
                  )}
                </MapboxGL.MapView>

                {/* ETA glass overlay */}
                {tracking?.etaMinutes != null && tracking.etaMinutes > 0 && (
                  <View style={styles.etaOverlay}>
                    <Text style={styles.etaOverlayLabel}>ETA</Text>
                    <Text style={styles.etaOverlayValue}>{tracking.etaMinutes} min</Text>
                  </View>
                )}
              </View>

              {/* Provider arrived / in progress banner */}
              {(currentStatus === 'arrived' || currentStatus === 'in_progress') && (
                <GlassCard
                  variant="standard"
                  padding={Spacing.md}
                  style={styles.arrivedBanner}
                >
                  <Text style={styles.arrivedBannerText}>
                    {currentStatus === 'arrived'
                      ? 'Provider has arrived at your location'
                      : 'Work is in progress'}
                  </Text>
                </GlassCard>
              )}
            </View>
          )}

          {/* No Provider Found — Search Timed Out */}
          {searchTimedOut && (
            <View style={styles.section}>
              <GlassCard variant="dark">
                <View style={styles.noProviderContent}>
                  <Text style={styles.noProviderTitle}>No Providers Available</Text>
                  <Text style={styles.noProviderText}>
                    We couldn't find a provider in your area right now. Your job
                    request has been saved -- when a provider becomes available,
                    they'll receive your request and you'll be notified.
                  </Text>
                  <View style={styles.noProviderButtons}>
                    <GlassButton
                      title="OK, Notify Me"
                      variant="glow"
                      onPress={handleKeepWaiting}
                    />
                    <GlassButton
                      title="Cancel Job"
                      variant="outline"
                      onPress={handleCancelJob}
                      style={styles.cancelJobBtnStyle}
                    />
                  </View>
                </View>
              </GlassCard>
            </View>
          )}

          {/* In Progress Timer */}
          {isInProgress && (
            <View style={styles.section}>
              <GlassCard variant="standard" style={styles.timerCardBorder}>
                <View style={styles.timerContent}>
                  <Text style={styles.timerLabel}>Work In Progress</Text>
                  <Text style={styles.timerValue}>{formattedTimer}</Text>
                  <View style={styles.timerMeta}>
                    <Text style={styles.timerMetaLabel}>Running estimate</Text>
                    <Text style={styles.timerMetaValue}>${runningCost}</Text>
                  </View>
                  <Text style={styles.timerNote}>
                    Estimated price. Final price may vary.
                  </Text>
                </View>
              </GlassCard>
            </View>
          )}

          {/* Completed Summary */}
          {isCompleted && (
            <View style={styles.section}>
              <GlassCard variant="elevated" style={styles.completedCardBorder}>
                <View style={styles.completedContent}>
                  <Text style={styles.completedTitle}>Job Completed</Text>
                  <Text style={styles.completedPrice}>${finalPrice.toFixed(2)}</Text>
                  <Text style={styles.completedSubtext}>
                    Thank you for using VISP. Please rate your experience.
                  </Text>
                  <GlassButton
                    title="Rate & Pay"
                    variant="glow"
                    onPress={handleRateProvider}
                  />
                </View>
              </GlassCard>
            </View>
          )}

          {/* Status Timeline */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Job Timeline</Text>
            <GlassCard variant="dark">
              <View style={styles.timeline}>
                {STATUS_STEPS.map((step, index) => {
                  const isPast = index < currentStepIndex;
                  const isCurrent = index === currentStepIndex;
                  const isFuture = index > currentStepIndex;
                  const isLast = index === STATUS_STEPS.length - 1;

                  const stepColor = isPast
                    ? Colors.success
                    : isCurrent
                      ? 'rgba(120, 80, 255, 0.9)'
                      : 'rgba(255, 255, 255, 0.15)';

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
                          {isPast && <Text style={styles.timelineDotCheck}>+</Text>}
                        </View>
                        {!isLast && (
                          <View
                            style={[
                              styles.timelineLine,
                              {
                                backgroundColor: isPast
                                  ? Colors.success
                                  : 'rgba(255, 255, 255, 0.10)',
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
            </GlassCard>
          </View>

          {/* Service Scope Notice */}
          <View style={styles.section}>
            <GlassCard variant="dark" padding={Spacing.lg} style={styles.noticeCardBorder}>
              <Text style={styles.noticeTitle}>Service Scope</Text>
              <Text style={styles.noticeText}>
                The provider will perform exactly the work described in your
                booking. Additional services require a separate booking. The
                provider cannot add scope to this job.
              </Text>
            </GlassCard>
          </View>

          <View style={styles.bottomPadding} />
        </ScrollView>
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

  // Loading
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.md,
  },
  loadingText: {
    ...Typography.body,
    color: 'rgba(255, 255, 255, 0.6)',
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
    color: '#FFFFFF',
    marginBottom: Spacing.lg,
  },

  // Provider Card
  providerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.lg,
  },
  avatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'rgba(120, 80, 255, 0.25)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing.lg,
    borderWidth: 2,
    borderColor: 'rgba(120, 80, 255, 0.5)',
  },
  avatarText: {
    fontSize: FontSize.title3,
    fontWeight: FontWeight.bold as '700',
    color: '#FFFFFF',
  },
  providerInfo: {
    flex: 1,
  },
  providerName: {
    ...Typography.title3,
    color: '#FFFFFF',
    marginBottom: Spacing.xxs,
  },
  providerMeta: {
    ...Typography.footnote,
    color: 'rgba(255, 255, 255, 0.5)',
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
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    gap: Spacing.sm,
  },
  contactButtonText: {
    ...Typography.footnote,
    color: Colors.primary,
    fontWeight: FontWeight.semiBold as '600',
  },

  // Map
  mapCard: {
    borderRadius: BorderRadius.md,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
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
    backgroundColor: 'rgba(120, 80, 255, 0.9)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  providerMarkerText: {
    fontSize: 16,
    fontWeight: FontWeight.bold as '700',
    color: '#FFFFFF',
  },

  // ETA Overlay (glass)
  etaOverlay: {
    position: 'absolute',
    top: Spacing.md,
    right: Spacing.md,
    backgroundColor: 'rgba(10, 10, 30, 0.7)',
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    alignItems: 'center',
  },
  etaOverlayLabel: {
    ...Typography.caption,
    color: 'rgba(255, 255, 255, 0.5)',
  },
  etaOverlayValue: {
    ...Typography.headline,
    color: Colors.primary,
    fontWeight: FontWeight.bold as '700',
  },

  // Searching card
  searchingCard: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 200,
  },
  searchingTitle: {
    ...Typography.headline,
    color: '#FFFFFF',
    marginTop: Spacing.lg,
  },
  searchingSubtext: {
    ...Typography.footnote,
    color: 'rgba(255, 255, 255, 0.5)',
    marginTop: Spacing.sm,
    textAlign: 'center',
  },

  // Arrived banner
  arrivedBanner: {
    marginTop: Spacing.sm,
    alignItems: 'center',
    borderColor: 'rgba(39, 174, 96, 0.4)',
  },
  arrivedBannerText: {
    ...Typography.headline,
    color: Colors.success,
    textAlign: 'center',
  },

  // Timer Card
  timerCardBorder: {
    borderColor: 'rgba(120, 80, 255, 0.4)',
  },
  timerContent: {
    alignItems: 'center',
  },
  timerLabel: {
    ...Typography.label,
    color: 'rgba(120, 80, 255, 0.9)',
    marginBottom: Spacing.md,
  },
  timerValue: {
    fontSize: 48,
    fontWeight: FontWeight.bold as '700',
    color: '#FFFFFF',
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
    color: 'rgba(255, 255, 255, 0.5)',
  },
  timerMetaValue: {
    ...Typography.headline,
    color: Colors.primary,
  },
  timerNote: {
    ...Typography.caption,
    color: 'rgba(255, 255, 255, 0.3)',
    textAlign: 'center',
  },

  // Completed Card
  completedCardBorder: {
    borderColor: 'rgba(39, 174, 96, 0.4)',
  },
  completedContent: {
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
    color: '#FFFFFF',
    marginBottom: Spacing.sm,
  },
  completedSubtext: {
    ...Typography.footnote,
    color: 'rgba(255, 255, 255, 0.5)',
    textAlign: 'center',
    marginBottom: Spacing.xl,
  },

  // No provider
  noProviderContent: {
    alignItems: 'center',
  },
  noProviderTitle: {
    ...Typography.title3,
    color: '#FFFFFF',
    marginBottom: Spacing.sm,
    textAlign: 'center',
  },
  noProviderText: {
    ...Typography.footnote,
    color: 'rgba(255, 255, 255, 0.5)',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: Spacing.lg,
  },
  noProviderButtons: {
    width: '100%',
    gap: Spacing.sm,
  },
  cancelJobBtnStyle: {
    borderColor: 'rgba(231, 76, 60, 0.5)',
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
    borderColor: 'rgba(120, 80, 255, 0.6)',
    backgroundColor: 'rgba(10, 10, 30, 0.8)',
  },
  timelineDotCheck: {
    fontSize: 10,
    color: '#FFFFFF',
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
    color: '#FFFFFF',
    marginBottom: Spacing.xxs,
  },
  timelineLabelCurrent: {
    color: 'rgba(120, 80, 255, 0.9)',
  },
  timelineLabelFuture: {
    color: 'rgba(255, 255, 255, 0.3)',
  },
  timelineDescription: {
    ...Typography.footnote,
    color: 'rgba(255, 255, 255, 0.5)',
  },
  timelineDescriptionFuture: {
    color: 'rgba(255, 255, 255, 0.25)',
  },

  // Notice Card
  noticeCardBorder: {
    borderColor: 'rgba(243, 156, 18, 0.25)',
  },
  noticeTitle: {
    ...Typography.headline,
    color: Colors.warning,
    marginBottom: Spacing.sm,
  },
  noticeText: {
    ...Typography.footnote,
    color: 'rgba(255, 255, 255, 0.5)',
    lineHeight: 20,
  },

  // Bottom padding
  bottomPadding: {
    height: Spacing.massive,
  },
});

export default JobTrackingScreen;
