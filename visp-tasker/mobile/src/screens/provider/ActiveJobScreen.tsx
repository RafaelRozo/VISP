/**
 * VISP/Tasker - Active Job Screen
 *
 * Current active job details with status progression bar, navigation to
 * customer location, status transition buttons, before/after photo capture,
 * and customer chat. Provider cannot add additional services (business rule).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Colors, getLevelColor, getStatusColor } from '../../theme/colors';
import { useProviderStore } from '../../stores/providerStore';
import { JobStatus, ProviderTabParamList } from '../../types';

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
  accepted: { label: 'Mark En Route', next: 'en_route' },
  en_route: { label: 'Mark Arrived', next: 'in_progress' },
  in_progress: { label: 'Complete Job', next: 'completed' },
};

// ---------------------------------------------------------------------------
// Status Progress Bar
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
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  circleActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primary,
  },
  circleCurrent: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primaryLight,
  },
  checkmark: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.white,
  },
  label: {
    fontSize: 10,
    color: Colors.textTertiary,
    textAlign: 'center',
  },
  labelActive: {
    color: Colors.textPrimary,
    fontWeight: '600',
  },
  connector: {
    flex: 1,
    height: 2,
    backgroundColor: Colors.border,
    marginBottom: 22,
  },
  connectorActive: {
    backgroundColor: Colors.primary,
  },
});

// ---------------------------------------------------------------------------
// Photo Section
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
    borderRadius: 8,
    backgroundColor: Colors.surfaceLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoIndex: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  addButton: {
    width: 72,
    height: 72,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
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
// Main Component
// ---------------------------------------------------------------------------

export default function ActiveJobScreen(): React.JSX.Element {
  const route = useRoute<ActiveJobRoute>();
  const navigation = useNavigation<ActiveJobNav>();
  const { activeJob, updateJobStatus, fetchActiveJob, error } =
    useProviderStore();

  const [isUpdating, setIsUpdating] = useState(false);
  const [beforePhotos, setBeforePhotos] = useState<string[]>([]);
  const [afterPhotos, setAfterPhotos] = useState<string[]>([]);

  const { jobId } = route.params;

  // Load job if not already active
  useEffect(() => {
    if (!activeJob || activeJob.id !== jobId) {
      fetchActiveJob(jobId);
    }
  }, [activeJob, jobId, fetchActiveJob]);

  // Navigate to customer location
  const openNavigation = useCallback(() => {
    if (!activeJob) return;
    const { latitude, longitude } = activeJob.address;
    const label = encodeURIComponent(
      `${activeJob.address.street}, ${activeJob.address.city}`,
    );

    const url = Platform.select({
      ios: `maps:0,0?q=${label}&ll=${latitude},${longitude}`,
      android: `geo:${latitude},${longitude}?q=${latitude},${longitude}(${label})`,
    });

    if (url) {
      Linking.openURL(url).catch(() => {
        // Fallback to Google Maps web URL
        Linking.openURL(
          `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`,
        );
      });
    }
  }, [activeJob]);

  // Handle status update
  const handleStatusUpdate = useCallback(async () => {
    if (!activeJob) return;

    const action = NEXT_STATUS_ACTIONS[activeJob.status];
    if (!action) return;

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
            await updateJobStatus(jobId, action.next);
            if (action.next === 'completed') {
              navigation.goBack();
            }
          } finally {
            setIsUpdating(false);
          }
        },
      },
    ]);
  }, [activeJob, jobId, updateJobStatus, navigation]);

  // Photo capture handlers
  const handleCaptureBeforePhoto = useCallback(() => {
    // In production, this would launch the camera via react-native-image-picker
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

  // Chat handler
  const handleOpenChat = useCallback(() => {
    // Chat screen navigation will be wired in the full navigation setup
    Alert.alert('Chat', 'Chat feature will open in a modal.');
  }, []);

  // ------------------------------------------
  // Loading state
  // ------------------------------------------

  if (!activeJob) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={styles.loadingText}>Loading job details...</Text>
      </View>
    );
  }

  const levelColor = getLevelColor(activeJob.level);
  const statusColor = getStatusColor(activeJob.status);
  const nextAction = NEXT_STATUS_ACTIONS[activeJob.status];
  const showBeforePhotos =
    activeJob.status === 'in_progress' || activeJob.status === 'en_route';
  const showAfterPhotos = activeJob.status === 'in_progress';

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.contentContainer}
    >
      {/* Status progress bar */}
      <View style={styles.progressCard}>
        <StatusProgress currentStatus={activeJob.status} />
      </View>

      {/* Job details card */}
      <View style={styles.detailsCard}>
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
      </View>

      {/* Customer location card */}
      <View style={styles.locationCard}>
        <Text style={styles.sectionTitle}>Customer Location</Text>
        <Text style={styles.addressText}>
          {activeJob.address.street}
        </Text>
        <Text style={styles.addressSubtext}>
          {activeJob.address.city}, {activeJob.address.province}{' '}
          {activeJob.address.postalCode}
        </Text>

        <TouchableOpacity
          style={styles.navigateButton}
          onPress={openNavigation}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Open navigation to customer location"
        >
          <Text style={styles.navigateButtonText}>Open Navigation</Text>
        </TouchableOpacity>
      </View>

      {/* Before/after photos */}
      <View style={styles.photosCard}>
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
      </View>

      {/* Business rule notice */}
      <View style={styles.noticeCard}>
        <Text style={styles.noticeTitle}>Scope Policy</Text>
        <Text style={styles.noticeText}>
          Additional services cannot be added to this job. If the customer
          requires extra work, a new job must be created through the app.
        </Text>
      </View>

      {/* Chat button */}
      <TouchableOpacity
        style={styles.chatButton}
        onPress={handleOpenChat}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel="Chat with customer"
      >
        <Text style={styles.chatButtonText}>Chat with Customer</Text>
      </TouchableOpacity>

      {/* Status action button */}
      {nextAction && (
        <TouchableOpacity
          style={[
            styles.actionButton,
            nextAction.next === 'completed' && styles.completeButton,
            isUpdating && styles.buttonDisabled,
          ]}
          onPress={handleStatusUpdate}
          disabled={isUpdating}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={nextAction.label}
        >
          {isUpdating ? (
            <ActivityIndicator size="small" color={Colors.white} />
          ) : (
            <Text style={styles.actionButtonText}>{nextAction.label}</Text>
          )}
        </TouchableOpacity>
      )}

      {/* Error display */}
      {error && (
        <View style={styles.errorCard}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

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
    paddingTop: 16,
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: Colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: Colors.textSecondary,
  },
  progressCard: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    marginHorizontal: 16,
    marginBottom: 12,
    overflow: 'hidden',
  },
  detailsCard: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 16,
    marginHorizontal: 16,
    marginBottom: 12,
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
    color: Colors.textSecondary,
    marginTop: 2,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
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
    borderTopColor: Colors.border,
    marginBottom: 8,
  },
  priceLabel: {
    fontSize: 14,
    color: Colors.textSecondary,
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
    backgroundColor: Colors.surfaceLight,
    borderRadius: 6,
    padding: 8,
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
  locationCard: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 16,
    marginHorizontal: 16,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: 8,
  },
  addressText: {
    fontSize: 15,
    color: Colors.textPrimary,
    marginBottom: 4,
  },
  addressSubtext: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginBottom: 12,
  },
  navigateButton: {
    backgroundColor: Colors.primary,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  navigateButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.white,
  },
  photosCard: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 16,
    marginHorizontal: 16,
    marginBottom: 12,
  },
  noticeCard: {
    backgroundColor: Colors.surfaceLight,
    borderRadius: 12,
    padding: 16,
    marginHorizontal: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  noticeTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.warning,
    marginBottom: 6,
  },
  noticeText: {
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 18,
  },
  chatButton: {
    borderWidth: 1,
    borderColor: Colors.primary,
    borderRadius: 8,
    paddingVertical: 14,
    marginHorizontal: 16,
    marginBottom: 12,
    alignItems: 'center',
  },
  chatButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.primary,
  },
  actionButton: {
    backgroundColor: Colors.primary,
    borderRadius: 8,
    paddingVertical: 16,
    marginHorizontal: 16,
    marginBottom: 12,
    alignItems: 'center',
  },
  completeButton: {
    backgroundColor: Colors.success,
  },
  actionButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.white,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  errorCard: {
    backgroundColor: Colors.surfaceLight,
    borderRadius: 8,
    padding: 12,
    marginHorizontal: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.emergencyRed,
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
