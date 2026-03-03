/**
 * VISP - EmergencyTrackingScreen
 *
 * Real-time map tracking of the provider en route.
 * Features:
 *   - Real-time map with provider location
 *   - ETA countdown
 *   - Provider info card
 *   - Call/chat buttons
 *   - SLA timer (time remaining)
 *
 * Dark glassmorphism styling with red emergency accent.
 */

import React, { useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Linking,
  Alert,
  Platform,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { GlassBackground, GlassCard, GlassButton } from '../../components/glass';
import { GlassStyles, Colors } from '../../theme';
import { Spacing } from '../../theme/spacing';
import { Typography, FontWeight, FontSize } from '../../theme/typography';
import { useEmergencyStore } from '../../stores/emergencyStore';
import EmergencyMap from '../../components/EmergencyMap';
import SLATimer from '../../components/SLATimer';
import LevelBadge from '../../components/LevelBadge';
import type { EmergencyFlowParamList } from '../../types';

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

type TrackingRouteProp = RouteProp<EmergencyFlowParamList, 'EmergencyTracking'>;
type TrackingNavProp = NativeStackNavigationProp<EmergencyFlowParamList, 'EmergencyTracking'>;

// ──────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────

function EmergencyTrackingScreen(): React.JSX.Element {
  const route = useRoute<TrackingRouteProp>();
  const navigation = useNavigation<TrackingNavProp>();
  const { jobId } = route.params;

  const {
    activeJob,
    jobStatus,
    sla,
    fetchJobStatus,
    startPolling,
    stopPolling,
  } = useEmergencyStore();

  // Start polling
  useEffect(() => {
    fetchJobStatus(jobId);
    startPolling(jobId);
    return () => stopPolling();
  }, [jobId, fetchJobStatus, startPolling, stopPolling]);

  // Navigate on status change
  useEffect(() => {
    if (jobStatus === 'in_progress') {
      navigation.replace('EmergencyInProgress', { jobId });
    } else if (jobStatus === 'completed') {
      navigation.replace('EmergencyCompletion', { jobId });
    } else if (jobStatus === 'cancelled') {
      navigation.replace('EmergencyCancel', { jobId });
    }
  }, [jobStatus, jobId, navigation]);

  // Call provider
  const handleCallProvider = useCallback(() => {
    // In production, use a masked phone number through the backend
    Alert.alert(
      'Call Provider',
      'You will be connected to your provider through a secure line.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Call',
          onPress: () => {
            Linking.openURL('tel:+18005551234');
          },
        },
      ],
    );
  }, []);

  // Chat with provider
  const handleChatProvider = useCallback(() => {
    // In production, opens the in-app chat
    Alert.alert('Chat', 'In-app chat will open here.');
  }, []);

  // Handle cancel
  const handleCancel = useCallback(() => {
    navigation.navigate('EmergencyCancel', { jobId });
  }, [navigation, jobId]);

  const provider = activeJob?.provider;
  const customerLocation = activeJob?.location
    ? { latitude: activeJob.location.latitude, longitude: activeJob.location.longitude }
    : { latitude: 43.6532, longitude: -79.3832 };

  const providerLocation = activeJob?.providerLocation || undefined;
  const slaDeadline = activeJob?.slaDeadline || new Date(Date.now() + sla.arrivalTimeMinutes * 60000).toISOString();

  return (
    <GlassBackground>
      {/* Map */}
      <View style={styles.mapContainer}>
        <EmergencyMap
          customerLocation={customerLocation}
          providerLocation={providerLocation}
          etaMinutes={activeJob?.etaMinutes}
          showEtaOverlay
        />

        {/* SLA Timer overlay - glass */}
        <View style={styles.slaOverlay}>
          <SLATimer
            deadline={slaDeadline}
            totalDurationMinutes={sla.arrivalTimeMinutes}
            label="Arrival Deadline"
            compact
          />
        </View>
      </View>

      {/* Bottom panel - glass */}
      <View style={styles.bottomPanel}>
        {/* Status indicator */}
        <View style={styles.statusRow}>
          <View style={styles.statusDot} />
          <Text style={styles.statusText}>
            {jobStatus === 'en_route'
              ? 'Provider is on the way'
              : jobStatus === 'arrived'
                ? 'Provider has arrived'
                : 'Tracking provider...'}
          </Text>
          {activeJob?.etaMinutes !== undefined && activeJob.etaMinutes > 0 && (
            <Text style={styles.etaText}>
              ETA {activeJob.etaMinutes} min
            </Text>
          )}
        </View>

        {/* Provider info - glass row */}
        {provider && (
          <View style={styles.providerRow}>
            <View style={styles.providerInfo}>
              <View style={styles.providerAvatarSmall}>
                <Text style={styles.providerInitial}>
                  {provider.firstName.charAt(0)}
                </Text>
              </View>
              <View style={styles.providerDetails}>
                <Text style={styles.providerName}>
                  {provider.firstName} {provider.lastName.charAt(0)}.
                </Text>
                <View style={styles.providerMeta}>
                  <Text style={styles.providerRating}>
                    {provider.rating.toFixed(1)} rating
                  </Text>
                  <LevelBadge level={provider.level} size="small" />
                </View>
              </View>
            </View>

            {/* Action buttons - glass circles */}
            <View style={styles.actionButtons}>
              <TouchableOpacity
                style={styles.actionButton}
                onPress={handleCallProvider}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel="Call provider"
              >
                <Text style={styles.actionButtonIcon}>C</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.actionButton}
                onPress={handleChatProvider}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel="Chat with provider"
              >
                <Text style={styles.actionButtonIcon}>M</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Cancel button - glass outline */}
        <GlassButton
          title="Cancel Request"
          onPress={handleCancel}
          variant="outline"
          style={styles.cancelButton}
        />
      </View>
    </GlassBackground>
  );
}

// ──────────────────────────────────────────────
// Styles
// ──────────────────────────────────────────────

const EMERGENCY_RED_GLOW = 'rgba(231, 76, 60, 0.6)';

const styles = StyleSheet.create({
  // Map
  mapContainer: {
    flex: 1,
    position: 'relative',
  },
  slaOverlay: {
    position: 'absolute',
    top: Spacing.lg,
    left: Spacing.lg,
    backgroundColor: 'rgba(10, 10, 30, 0.65)',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.4,
        shadowRadius: 20,
      },
      android: { elevation: 8 },
    }),
  },

  // Bottom panel - glass
  bottomPanel: {
    backgroundColor: 'rgba(10, 10, 30, 0.75)',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.xl,
    paddingBottom: Spacing.xxl,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.12)',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -12 },
        shadowOpacity: 0.5,
        shadowRadius: 40,
      },
      android: { elevation: 12 },
    }),
  },

  // Status
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.lg,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: Colors.success,
    marginRight: Spacing.sm,
    ...Platform.select({
      ios: {
        shadowColor: 'rgba(39, 174, 96, 0.6)',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 1,
        shadowRadius: 6,
      },
      android: { elevation: 3 },
    }),
  },
  statusText: {
    ...Typography.headline,
    color: '#FFFFFF',
    flex: 1,
  },
  etaText: {
    ...Typography.headline,
    color: Colors.emergencyRed,
    fontWeight: FontWeight.bold,
  },

  // Provider
  providerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.lg,
    paddingVertical: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
  },
  providerInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  providerAvatarSmall: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.10)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing.md,
    borderWidth: 2,
    borderColor: Colors.emergencyRed,
  },
  providerInitial: {
    fontSize: FontSize.callout,
    fontWeight: FontWeight.bold,
    color: Colors.emergencyRed,
  },
  providerDetails: {
    flex: 1,
  },
  providerName: {
    ...Typography.headline,
    color: '#FFFFFF',
    marginBottom: 2,
  },
  providerMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  providerRating: {
    ...Typography.caption,
    color: 'rgba(255, 255, 255, 0.5)',
  },

  // Action buttons - glass circles
  actionButtons: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  actionButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(231, 76, 60, 0.8)',
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      ios: {
        shadowColor: EMERGENCY_RED_GLOW,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 1,
        shadowRadius: 10,
      },
      android: { elevation: 6 },
    }),
  },
  actionButtonIcon: {
    fontSize: 18,
    fontWeight: FontWeight.bold,
    color: '#FFFFFF',
  },

  // Cancel
  cancelButton: {
    borderColor: 'rgba(255, 255, 255, 0.20)',
  },
});

export default EmergencyTrackingScreen;
