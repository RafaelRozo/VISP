/**
 * VISP - Active Job Screen
 *
 * Current active job details with status progression bar, navigation to
 * customer location, status transition buttons, before/after photo capture,
 * customer chat, legal acknowledgments, and job timer.
 * Provider cannot add additional services (business rule).
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import MapboxGL from '@rnmapbox/maps';

import { Config } from '../../services/config';
import { Colors, getLevelColor, getStatusColor } from '../../theme/colors';
import { GlassStyles } from '../../theme/glass';
import { GlassBackground, GlassCard, GlassButton } from '../../components/glass';
import { AnimatedSpinner } from '../../components/animations';
import { useProviderStore } from '../../stores/providerStore';
import { JobStatus, PricingModel, ProviderTabParamList } from '../../types';
import { watchPosition, clearWatch, getCurrentPosition } from '../../services/geolocationService';
import { post } from '../../services/apiClient';
import RunningCostTimer from '../../components/RunningCostTimer';

// ---------------------------------------------------------------------------
// Mapbox initialization
// ---------------------------------------------------------------------------
MapboxGL.setAccessToken(Config.mapboxAccessToken);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ActiveJobRoute = RouteProp<ProviderTabParamList, 'ActiveJob'>;
type ActiveJobNav = NativeStackNavigationProp<ProviderTabParamList, 'ActiveJob'>;

// ---------------------------------------------------------------------------
// Status flow definition
// ---------------------------------------------------------------------------

const STATUS_FLOW: JobStatus[] = [
  'accepted',
  'en_route',
  'in_progress',
  'completed',
];

const STATUS_FLOW_LABELS: Record<string, string> = {
  accepted: 'Accepted',
  en_route: 'En Route',
  in_progress: 'In Progress',
  completed: 'Completed',
};

const NEXT_STATUS_ACTIONS: Record<string, { label: string; next: JobStatus }> = {
  accepted: { label: 'Start Route', next: 'en_route' },
  en_route: { label: 'Arrived', next: 'in_progress' },
  in_progress: { label: 'Complete Job', next: 'completed' },
};

// ---------------------------------------------------------------------------
// Status Progress Bar (Glass)
// ---------------------------------------------------------------------------

interface StatusProgressProps {
  currentStatus: JobStatus;
}

function StatusProgress({ currentStatus }: StatusProgressProps): React.JSX.Element {
  const currentIndex = STATUS_FLOW.indexOf(currentStatus);

  return (
    <View style={progressStyles.container}>
      {STATUS_FLOW.map((status, index) => {
        const isActive = index <= currentIndex;
        const isCurrent = index === currentIndex;
        const isLast = index === STATUS_FLOW.length - 1;

        return (
          <React.Fragment key={status}>
            <View style={progressStyles.stepContainer}>
              <View
                style={[
                  progressStyles.circle,
                  isActive && progressStyles.circleActive,
                  isCurrent && progressStyles.circleCurrent,
                ]}
              >
                {isActive && (
                  <Text style={progressStyles.checkmark}>
                    {isCurrent ? '\u25CF' : '\u2713'}
                  </Text>
                )}
              </View>
              <Text
                style={[
                  progressStyles.label,
                  isActive && progressStyles.labelActive,
                ]}
              >
                {STATUS_FLOW_LABELS[status]}
              </Text>
            </View>
            {!isLast && (
              <View
                style={[
                  progressStyles.connector,
                  isActive && index < currentIndex && progressStyles.connectorActive,
                ]}
              />
            )}
          </React.Fragment>
        );
      })}
    </View>
  );
}

const progressStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  stepContainer: {
    alignItems: 'center',
    width: 70,
  },
  circle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: Colors.glassBorder.light,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
    backgroundColor: Colors.glass.white,
  },
  circleActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primary,
  },
  circleCurrent: {
    borderColor: Colors.primary,
    backgroundColor: 'rgba(74, 144, 226, 0.35)',
  },
  checkmark: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.white,
  },
  label: {
    fontSize: 10,
    color: 'rgba(255, 255, 255, 0.4)',
    textAlign: 'center',
  },
  labelActive: {
    color: Colors.textPrimary,
    fontWeight: '600',
  },
  connector: {
    flex: 1,
    height: 2,
    backgroundColor: Colors.glassBorder.subtle,
    marginBottom: 22,
  },
  connectorActive: {
    backgroundColor: Colors.primary,
  },
});

// ---------------------------------------------------------------------------
// Photo Section (Glass)
// ---------------------------------------------------------------------------

interface PhotoSectionProps {
  title: string;
  photos: string[];
  onCapture: () => void;
}

function PhotoSection({
  title,
  photos,
  onCapture,
}: PhotoSectionProps): React.JSX.Element {
  return (
    <View style={photoStyles.container}>
      <Text style={photoStyles.title}>{title}</Text>
      <View style={photoStyles.grid}>
        {photos.map((uri, index) => (
          <View key={index} style={photoStyles.photoPlaceholder}>
            <Text style={photoStyles.photoIndex}>{index + 1}</Text>
          </View>
        ))}
        <TouchableOpacity
          style={photoStyles.addButton}
          onPress={onCapture}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={`Add ${title.toLowerCase()} photo`}
        >
          <Text style={photoStyles.addIcon}>+</Text>
          <Text style={photoStyles.addLabel}>Add Photo</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const photoStyles = StyleSheet.create({
  container: {
    marginTop: 16,
  },
  title: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textPrimary,
    marginBottom: 8,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  photoPlaceholder: {
    width: 72,
    height: 72,
    borderRadius: 10,
    backgroundColor: Colors.glass.white,
    borderWidth: 1,
    borderColor: Colors.glassBorder.subtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoIndex: {
    fontSize: 14,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.55)',
  },
  addButton: {
    width: 72,
    height: 72,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.glassBorder.light,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.glass.white,
  },
  addIcon: {
    fontSize: 20,
    color: Colors.primary,
    marginBottom: 2,
  },
  addLabel: {
    fontSize: 10,
    color: Colors.primary,
  },
});

// ---------------------------------------------------------------------------
// Timer Hook
// ---------------------------------------------------------------------------

function useJobTimer(startedAt: string | null): string {
  const [elapsed, setElapsed] = useState('00:00:00');
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!startedAt) {
      setElapsed('00:00:00');
      return;
    }

    const update = () => {
      const diff = Date.now() - new Date(startedAt).getTime();
      if (diff < 0) {
        setElapsed('00:00:00');
        return;
      }
      const hours = Math.floor(diff / 3600000);
      const minutes = Math.floor((diff % 3600000) / 60000);
      const seconds = Math.floor((diff % 60000) / 1000);
      setElapsed(
        `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`,
      );
    };

    update();
    intervalRef.current = setInterval(update, 1000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [startedAt]);

  return elapsed;
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function ActiveJobScreen(): React.JSX.Element {
  const route = useRoute<ActiveJobRoute>();
  const navigation = useNavigation<ActiveJobNav>();
  const { activeJob, startNavigation, arriveAtJob, completeJob, fetchActiveJob, error } =
    useProviderStore();

  const [isUpdating, setIsUpdating] = useState(false);
  const [beforePhotos, setBeforePhotos] = useState<string[]>([]);
  const [afterPhotos, setAfterPhotos] = useState<string[]>([]);
  const [legalAcknowledged, setLegalAcknowledged] = useState(false);

  // GPS tracking state
  const [providerLat, setProviderLat] = useState<number | null>(null);
  const [providerLng, setProviderLng] = useState<number | null>(null);
  const [routeCoords, setRouteCoords] = useState<[number, number][] | null>(null);
  const [distanceKm, setDistanceKm] = useState<number | null>(null);
  const [etaMinutes, setEtaMinutes] = useState<number | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const broadcastTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastBroadcastRef = useRef<{ lat: number; lng: number } | null>(null);
  const cameraRef = useRef<MapboxGL.Camera>(null);

  const { jobId } = route.params;

  // Timer for in_progress jobs
  const timerDisplay = useJobTimer(activeJob?.startedAt ?? null);

  // Load job if not already active
  useEffect(() => {
    if (!activeJob || activeJob.id !== jobId) {
      fetchActiveJob(jobId);
    }
  }, [activeJob, jobId, fetchActiveJob]);

  // --- Haversine distance in metres ---
  const haversineMetres = useCallback(
    (lat1: number, lng1: number, lat2: number, lng2: number): number => {
      const R = 6371000;
      const toRad = (d: number) => (d * Math.PI) / 180;
      const dLat = toRad(lat2 - lat1);
      const dLng = toRad(lng2 - lng1);
      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    },
    [],
  );

  // --- Fetch route from Mapbox Directions API ---
  const fetchRoute = useCallback(
    async (fromLat: number, fromLng: number, toLat: number, toLng: number) => {
      try {
        const url =
          `https://api.mapbox.com/directions/v5/mapbox/driving/` +
          `${fromLng},${fromLat};${toLng},${toLat}` +
          `?geometries=geojson&overview=full&access_token=${Config.mapboxAccessToken}`;
        const resp = await fetch(url);
        const json = await resp.json();
        if (json.routes && json.routes.length > 0) {
          const r = json.routes[0];
          setRouteCoords(r.geometry.coordinates as [number, number][]);
          setDistanceKm(r.distance / 1000);
          setEtaMinutes(Math.ceil(r.duration / 60));
        }
      } catch (err) {
        console.warn('[ActiveJob] Failed to fetch route:', err);
      }
    },
    [],
  );

  // --- Start GPS tracking when en_route ---
  useEffect(() => {
    if (!activeJob) return;
    const isEnRoute = activeJob.status === 'en_route';

    if (isEnRoute) {
      // Get initial position
      getCurrentPosition()
        .then((pos) => {
          setProviderLat(pos.latitude);
          setProviderLng(pos.longitude);
          // Fetch route from current pos to customer
          if (activeJob.address) {
            fetchRoute(
              pos.latitude,
              pos.longitude,
              activeJob.address.latitude,
              activeJob.address.longitude,
            );
          }
        })
        .catch((err) => console.warn('[ActiveJob] Initial position error:', err));

      // Watch continuous position updates
      watchIdRef.current = watchPosition((pos) => {
        setProviderLat(pos.latitude);
        setProviderLng(pos.longitude);
      });

      // Broadcast location to backend every 5 seconds
      broadcastTimerRef.current = setInterval(async () => {
        const lat = providerLat;
        const lng = providerLng;
        if (lat == null || lng == null) return;

        // Skip if position hasn't changed significantly
        const last = lastBroadcastRef.current;
        if (last && haversineMetres(last.lat, last.lng, lat, lng) < 5) return;

        try {
          await post('/jobs/provider-location', {
            latitude: lat,
            longitude: lng,
          });
          lastBroadcastRef.current = { lat, lng };
        } catch (err) {
          console.warn('[ActiveJob] Location broadcast error:', err);
        }
      }, 5000);
    }

    return () => {
      if (watchIdRef.current != null) {
        clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      if (broadcastTimerRef.current) {
        clearInterval(broadcastTimerRef.current);
        broadcastTimerRef.current = null;
      }
    };
  }, [activeJob?.status, activeJob?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Re-fetch route when position changes significantly ---
  useEffect(() => {
    if (
      activeJob?.status !== 'en_route' ||
      providerLat == null ||
      providerLng == null ||
      !activeJob?.address
    )
      return;

    const dist = haversineMetres(
      providerLat,
      providerLng,
      activeJob.address.latitude,
      activeJob.address.longitude,
    );
    setDistanceKm(dist / 1000);
    // Rough ETA: average 30 km/h in city
    setEtaMinutes(Math.ceil((dist / 1000 / 30) * 60));
  }, [providerLat, providerLng, activeJob?.address, activeJob?.status, haversineMetres]);

  // --- Proximity: within 100m of customer? ---
  const isNearCustomer = !!(activeJob?.address &&
    providerLat != null &&
    providerLng != null &&
    haversineMetres(
      providerLat,
      providerLng,
      activeJob.address.latitude,
      activeJob.address.longitude,
    ) < 100);

  // Handle status update with legal acknowledgment for start job
  const handleStatusUpdate = useCallback(async () => {
    if (!activeJob) return;

    const action = NEXT_STATUS_ACTIONS[activeJob.status];
    if (!action) return;

    // For transitioning from en_route to in_progress, require legal acknowledgment
    if (action.next === 'in_progress' && !legalAcknowledged) {
      Alert.alert(
        'Legal Acknowledgment Required',
        `Before starting work, please confirm:\n\n` +
        `1. I understand this task is limited to "${activeJob.taskName}" only.\n\n` +
        `2. I am acting as an independent contractor.\n\n` +
        `Additional services cannot be performed without a new job request.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'I Acknowledge & Start Job',
            onPress: async () => {
              setLegalAcknowledged(true);
              setIsUpdating(true);
              try {
                await arriveAtJob(jobId);
              } finally {
                setIsUpdating(false);
              }
            },
          },
        ],
      );
      return;
    }

    const confirmMessage =
      action.next === 'completed'
        ? 'Confirm that the job is complete. The customer will be notified and payment will be processed.'
        : `Update job status to "${STATUS_FLOW_LABELS[action.next]}"?`;

    Alert.alert('Update Status', confirmMessage, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Confirm',
        onPress: async () => {
          setIsUpdating(true);
          try {
            if (action.next === 'en_route') {
              await startNavigation(jobId);
            } else if (action.next === 'in_progress') {
              await arriveAtJob(jobId);
            } else if (action.next === 'completed') {
              await completeJob(jobId);
              navigation.goBack();
            }
          } finally {
            setIsUpdating(false);
          }
        },
      },
    ]);
  }, [activeJob, jobId, startNavigation, arriveAtJob, completeJob, navigation, legalAcknowledged]);

  // Photo capture handlers
  const handleCaptureBeforePhoto = useCallback(() => {
    Alert.alert('Camera', 'Camera integration will be connected here.', [
      {
        text: 'OK',
        onPress: () => {
          setBeforePhotos((prev) => [...prev, `before_${prev.length + 1}`]);
        },
      },
    ]);
  }, []);

  const handleCaptureAfterPhoto = useCallback(() => {
    Alert.alert('Camera', 'Camera integration will be connected here.', [
      {
        text: 'OK',
        onPress: () => {
          setAfterPhotos((prev) => [...prev, `after_${prev.length + 1}`]);
        },
      },
    ]);
  }, []);

  // Chat handler -- navigate to ChatScreen
  const handleOpenChat = useCallback(() => {
    if (!activeJob) return;
    navigation.navigate('Chat', {
      jobId: activeJob.id,
      otherUserName: 'Customer',
    });
  }, [activeJob, navigation]);

  // ------------------------------------------
  // Loading state
  // ------------------------------------------

  if (!activeJob) {
    return (
      <GlassBackground>
        <View style={styles.loadingContainer}>
          <AnimatedSpinner size={48} color={Colors.primary} />
          <Text style={styles.loadingText}>Loading job details...</Text>
        </View>
      </GlassBackground>
    );
  }

  const levelColor = getLevelColor(activeJob.level);
  const statusColor = getStatusColor(activeJob.status);
  const nextAction = NEXT_STATUS_ACTIONS[activeJob.status];
  const showBeforePhotos =
    activeJob.status === 'in_progress' || activeJob.status === 'en_route';
  const showAfterPhotos = activeJob.status === 'in_progress';
  const isInProgress = activeJob.status === 'in_progress';

  return (
    <GlassBackground>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.contentContainer}
      >
        {/* Status progress bar */}
        <GlassCard variant="dark" padding={0} style={styles.cardSpacing}>
          <StatusProgress currentStatus={activeJob.status} />
        </GlassCard>

        {/* Timer / pricing display when in_progress */}
        {isInProgress && activeJob.pricingModel === 'TIME_BASED' && activeJob.hourlyRateCents && (
          <RunningCostTimer
            startedAt={activeJob.startedAt!}
            hourlyRateCents={activeJob.hourlyRateCents}
            estimatedDurationMin={activeJob.estimatedDurationMinutes ?? 60}
          />
        )}
        {isInProgress && activeJob.pricingModel !== 'TIME_BASED' && (
          <GlassCard variant="standard" style={styles.timerCard}>
            <Text style={styles.timerLabel}>Job Timer</Text>
            <Text style={styles.timerValue}>{timerDisplay}</Text>
            <View style={styles.agreedPriceRow}>
              <Text style={styles.agreedPriceLabel}>Agreed Price</Text>
              <Text style={styles.agreedPriceValue}>
                ${activeJob.estimatedPrice.toFixed(2)}
              </Text>
            </View>
          </GlassCard>
        )}
        {isInProgress && !activeJob.pricingModel && (
          <GlassCard variant="standard" style={styles.timerCard}>
            <Text style={styles.timerLabel}>Job Timer</Text>
            <Text style={styles.timerValue}>{timerDisplay}</Text>
          </GlassCard>
        )}

        {/* Job details card */}
        <GlassCard variant="dark" style={styles.cardSpacing}>
          <View style={styles.detailsHeader}>
            <View style={[styles.levelBadge, { backgroundColor: levelColor }]}>
              <Text style={styles.levelBadgeText}>L{activeJob.level}</Text>
            </View>
            <View style={styles.detailsHeaderText}>
              <Text style={styles.taskName}>{activeJob.taskName}</Text>
              <Text style={styles.categoryName}>{activeJob.categoryName}</Text>
            </View>
            <View
              style={[styles.statusBadge, { backgroundColor: statusColor }]}
            >
              <Text style={styles.statusBadgeText}>
                {STATUS_FLOW_LABELS[activeJob.status] ?? activeJob.status}
              </Text>
            </View>
          </View>

          {/* Price info */}
          <View style={styles.priceRow}>
            <Text style={styles.priceLabel}>Estimated Pay</Text>
            <Text style={styles.priceValue}>
              ${activeJob.estimatedPrice.toFixed(2)}
            </Text>
          </View>

          {/* SLA deadline */}
          {activeJob.slaDeadline && (
            <View style={styles.slaRow}>
              <Text style={styles.slaLabel}>SLA Deadline</Text>
              <Text style={styles.slaValue}>
                {new Date(activeJob.slaDeadline).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </Text>
            </View>
          )}
        </GlassCard>

        {/* Customer info card */}
        <GlassCard variant="dark" style={styles.cardSpacing}>
          <Text style={styles.sectionTitle}>Customer</Text>
          <View style={styles.customerRow}>
            <View style={styles.customerAvatar}>
              <Text style={styles.customerAvatarText}>C</Text>
            </View>
            <View style={styles.customerInfo}>
              <Text style={styles.customerName}>Customer</Text>
              <Text style={styles.customerSubtext}>
                {activeJob.address.city}, {activeJob.address.province}
              </Text>
            </View>
          </View>
        </GlassCard>

        {/* Live Navigation Map */}
        <GlassCard variant="dark" style={styles.cardSpacing}>
          <Text style={styles.sectionTitle}>Navigation</Text>
          <Text style={styles.addressText}>
            {activeJob.address.street}
          </Text>
          <Text style={styles.addressSubtext}>
            {activeJob.address.city}, {activeJob.address.province}{' '}
            {activeJob.address.postalCode}
          </Text>

          {/* ETA / Distance Overlay */}
          {activeJob.status === 'en_route' && distanceKm != null && (
            <View style={styles.etaOverlay}>
              <Text style={styles.etaText}>
                {distanceKm < 1
                  ? `${Math.round(distanceKm * 1000)} m`
                  : `${distanceKm.toFixed(1)} km`}
              </Text>
              <Text style={styles.etaSeparator}>-</Text>
              <Text style={styles.etaText}>
                {etaMinutes != null ? `${etaMinutes} min` : '...'}
              </Text>
              {isNearCustomer && (
                <View style={styles.nearBadge}>
                  <Text style={styles.nearBadgeText}>Nearby!</Text>
                </View>
              )}
            </View>
          )}

          {/* Mapbox Map View */}
          <View style={styles.mapContainer}>
            <MapboxGL.MapView
              style={styles.map}
              styleURL={MapboxGL.StyleURL.Street}
              scrollEnabled={true}
              zoomEnabled={true}
              rotateEnabled={false}
              pitchEnabled={false}
              attributionEnabled={false}
              logoEnabled={false}
            >
              <MapboxGL.Camera
                ref={cameraRef}
                zoomLevel={13}
                centerCoordinate={
                  providerLat != null && providerLng != null
                    ? [providerLng, providerLat]
                    : [activeJob.address.longitude, activeJob.address.latitude]
                }
                animationMode="flyTo"
                animationDuration={1000}
              />

              {/* Route line */}
              {routeCoords && routeCoords.length > 0 && (
                <MapboxGL.ShapeSource
                  id="route-source"
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
                    id="route-line"
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

              {/* Provider position marker */}
              {providerLat != null && providerLng != null && (
                <MapboxGL.MarkerView
                  id="provider-location"
                  coordinate={[providerLng, providerLat]}
                >
                  <View style={styles.providerMarker}>
                    <View style={styles.providerMarkerInner} />
                  </View>
                </MapboxGL.MarkerView>
              )}

              {/* Customer destination marker */}
              <MapboxGL.MarkerView
                id="customer-location"
                coordinate={[
                  activeJob.address.longitude,
                  activeJob.address.latitude,
                ]}
              >
                <View style={styles.customerMarker} />
              </MapboxGL.MarkerView>
            </MapboxGL.MapView>
            {/* Glass overlay */}
            <View style={styles.mapGlassOverlay} />
          </View>
        </GlassCard>

        {/* Before/after photos */}
        {(showBeforePhotos || showAfterPhotos) && (
          <GlassCard variant="dark" style={styles.cardSpacing}>
            {showBeforePhotos && (
              <PhotoSection
                title="Before Photos"
                photos={beforePhotos}
                onCapture={handleCaptureBeforePhoto}
              />
            )}
            {showAfterPhotos && (
              <PhotoSection
                title="After Photos"
                photos={afterPhotos}
                onCapture={handleCaptureAfterPhoto}
              />
            )}
          </GlassCard>
        )}

        {/* Legal acknowledgment notice (shown before starting) */}
        {activeJob.status === 'en_route' && !legalAcknowledged && (
          <GlassCard variant="dark" style={{...styles.cardSpacing, ...styles.legalBorder}}>
            <Text style={styles.legalTitle}>Before You Start</Text>
            <Text style={styles.legalText}>
              By starting this job, you acknowledge:
            </Text>
            <Text style={styles.legalItem}>
              - This task is limited to "{activeJob.taskName}" only
            </Text>
            <Text style={styles.legalItem}>
              - You are acting as an independent contractor
            </Text>
            <Text style={styles.legalItem}>
              - Additional services require a new job request
            </Text>
          </GlassCard>
        )}

        {/* Business rule notice */}
        <GlassCard variant="dark" style={{...styles.cardSpacing, ...styles.noticeBorder}}>
          <Text style={styles.noticeTitle}>Scope Policy</Text>
          <Text style={styles.noticeText}>
            Additional services cannot be added to this job. If the customer
            requires extra work, a new job must be created through the app.
          </Text>
        </GlassCard>

        {/* Chat button */}
        <View style={styles.buttonSpacing}>
          <GlassButton
            title="Message Customer"
            variant="outline"
            onPress={handleOpenChat}
          />
        </View>

        {/* Status action button */}
        {nextAction && (
          <View style={styles.buttonSpacing}>
            <GlassButton
              title={nextAction.label}
              variant="glow"
              onPress={handleStatusUpdate}
              loading={isUpdating}
              disabled={isUpdating}
            />
          </View>
        )}

        {/* Error display */}
        {error && (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        <View style={styles.bottomSpacer} />
      </ScrollView>
    </GlassBackground>
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
    paddingTop: 16,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.55)',
  },
  cardSpacing: {
    marginHorizontal: 16,
    marginBottom: 12,
  },
  timerCard: {
    marginHorizontal: 16,
    marginBottom: 12,
    alignItems: 'center',
    borderColor: Colors.primary + '60',
  },
  timerLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.55)',
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  timerValue: {
    fontSize: 32,
    fontWeight: '800',
    color: Colors.primary,
    fontVariant: ['tabular-nums'],
  },
  agreedPriceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.glassBorder.subtle,
  },
  agreedPriceLabel: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.55)',
  },
  agreedPriceValue: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.success,
  },
  detailsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  levelBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  levelBadgeText: {
    fontSize: 13,
    fontWeight: '800',
    color: Colors.white,
  },
  detailsHeaderText: {
    flex: 1,
  },
  taskName: {
    fontSize: 17,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  categoryName: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.55)',
    marginTop: 2,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.white,
    textTransform: 'uppercase',
  },
  priceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.glassBorder.subtle,
    marginBottom: 8,
  },
  priceLabel: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.55)',
  },
  priceValue: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.success,
  },
  slaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: Colors.emergencyRed + '15',
    borderRadius: 8,
    padding: 8,
    borderWidth: 1,
    borderColor: Colors.emergencyRed + '30',
  },
  slaLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.emergencyRed,
  },
  slaValue: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.emergencyRed,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: 8,
  },
  customerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
  },
  customerAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.glass.white,
    borderWidth: 1,
    borderColor: Colors.glassBorder.light,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  customerAvatarText: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.primary,
  },
  customerInfo: {
    flex: 1,
  },
  customerName: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  customerSubtext: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.55)',
    marginTop: 2,
  },
  addressText: {
    fontSize: 15,
    color: Colors.textPrimary,
    marginBottom: 4,
  },
  addressSubtext: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.55)',
    marginBottom: 12,
  },
  etaOverlay: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.glass.white,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    marginTop: 8,
    marginBottom: 4,
    borderWidth: 1,
    borderColor: Colors.glassBorder.subtle,
  },
  etaText: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  etaSeparator: {
    fontSize: 15,
    color: 'rgba(255, 255, 255, 0.4)',
    marginHorizontal: 8,
  },
  nearBadge: {
    marginLeft: 8,
    backgroundColor: Colors.success,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  nearBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.white,
  },
  mapContainer: {
    height: 180,
    marginTop: 12,
    marginBottom: 8,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: Colors.glass.dark,
    position: 'relative',
  },
  map: {
    flex: 1,
  },
  mapGlassOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(10, 10, 30, 0.15)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.glassBorder.subtle,
  },
  customerMarker: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: Colors.primary,
    borderWidth: 2,
    borderColor: Colors.white,
  },
  providerMarker: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(33,150,243,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  providerMarkerInner: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#2196F3',
    borderWidth: 2,
    borderColor: Colors.white,
  },
  legalBorder: {
    borderColor: Colors.warning + '60',
  },
  legalTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.warning,
    marginBottom: 8,
  },
  legalText: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.55)',
    marginBottom: 8,
    lineHeight: 18,
  },
  legalItem: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.55)',
    lineHeight: 20,
    marginLeft: 4,
  },
  noticeBorder: {
    borderColor: Colors.glassBorder.subtle,
  },
  noticeTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.warning,
    marginBottom: 6,
  },
  noticeText: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.55)',
    lineHeight: 18,
  },
  buttonSpacing: {
    marginHorizontal: 16,
    marginBottom: 12,
  },
  errorCard: {
    backgroundColor: Colors.glass.white,
    borderRadius: 12,
    padding: 12,
    marginHorizontal: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.emergencyRed + '60',
  },
  errorText: {
    fontSize: 13,
    color: Colors.emergencyRed,
    textAlign: 'center',
  },
  bottomSpacer: {
    height: 32,
  },
});
