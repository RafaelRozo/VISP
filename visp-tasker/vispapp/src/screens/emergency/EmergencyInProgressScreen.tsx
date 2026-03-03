/**
 * VISP - EmergencyInProgressScreen
 *
 * Job in progress indicator.
 * Features:
 *   - Timer showing elapsed time
 *   - Provider info
 *   - Emergency contact button
 *   - "Provider cannot add scope" notice
 *
 * Dark glassmorphism styling with red emergency accent.
 */

import React, { useEffect, useState, useCallback } from 'react';
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
import LevelBadge from '../../components/LevelBadge';
import type { EmergencyFlowParamList } from '../../types';

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

type InProgressRouteProp = RouteProp<EmergencyFlowParamList, 'EmergencyInProgress'>;
type InProgressNavProp = NativeStackNavigationProp<EmergencyFlowParamList, 'EmergencyInProgress'>;

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function formatElapsedTime(startedAt: string): string {
  const startMs = new Date(startedAt).getTime();
  const nowMs = Date.now();
  const elapsedSeconds = Math.floor((nowMs - startMs) / 1000);

  const hours = Math.floor(elapsedSeconds / 3600);
  const minutes = Math.floor((elapsedSeconds % 3600) / 60);
  const seconds = elapsedSeconds % 60;

  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

// ──────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────

function EmergencyInProgressScreen(): React.JSX.Element {
  const route = useRoute<InProgressRouteProp>();
  const navigation = useNavigation<InProgressNavProp>();
  const { jobId } = route.params;

  const {
    activeJob,
    jobStatus,
    fetchJobStatus,
    startPolling,
    stopPolling,
  } = useEmergencyStore();

  const [elapsedTime, setElapsedTime] = useState('00:00');

  // Start polling
  useEffect(() => {
    fetchJobStatus(jobId);
    startPolling(jobId);
    return () => stopPolling();
  }, [jobId, fetchJobStatus, startPolling, stopPolling]);

  // Navigate on status change
  useEffect(() => {
    if (jobStatus === 'completed') {
      navigation.replace('EmergencyCompletion', { jobId });
    } else if (jobStatus === 'cancelled') {
      navigation.replace('EmergencyCancel', { jobId });
    }
  }, [jobStatus, jobId, navigation]);

  // Elapsed time counter
  useEffect(() => {
    if (!activeJob?.startedAt) {
      return;
    }

    const interval = setInterval(() => {
      setElapsedTime(formatElapsedTime(activeJob.startedAt!));
    }, 1000);

    // Initial update
    setElapsedTime(formatElapsedTime(activeJob.startedAt!));

    return () => clearInterval(interval);
  }, [activeJob?.startedAt]);

  // Emergency contact
  const handleEmergencyContact = useCallback(() => {
    Alert.alert(
      'Emergency Contact',
      'Contact our emergency support line for immediate assistance.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Call Support',
          onPress: () => {
            Linking.openURL('tel:+18005551234');
          },
        },
      ],
    );
  }, []);

  // Call provider
  const handleCallProvider = useCallback(() => {
    Alert.alert(
      'Call Provider',
      'You will be connected through a secure line.',
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

  const provider = activeJob?.provider;

  return (
    <GlassBackground>
      {/* Status header */}
      <View style={styles.header}>
        <View style={styles.statusIndicator}>
          <View style={styles.statusDotPulse} />
          <Text style={styles.statusText}>Service in Progress</Text>
        </View>
      </View>

      {/* Elapsed time - glass card */}
      <View style={styles.timerSection}>
        <GlassCard variant="dark" style={styles.timerCard}>
          <Text style={styles.timerLabel}>ELAPSED TIME</Text>
          <Text style={styles.timerValue}>{elapsedTime}</Text>
          <View style={styles.timerDivider} />
        </GlassCard>
      </View>

      {/* Provider info - glass card */}
      {provider && (
        <View style={styles.providerSection}>
          <GlassCard variant="standard">
            <View style={styles.providerRow}>
              <View style={styles.providerAvatar}>
                <Text style={styles.providerInitial}>
                  {provider.firstName.charAt(0)}
                </Text>
              </View>
              <View style={styles.providerInfo}>
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
              <TouchableOpacity
                style={styles.callButton}
                onPress={handleCallProvider}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel="Call provider"
              >
                <Text style={styles.callButtonIcon}>C</Text>
              </TouchableOpacity>
            </View>
          </GlassCard>
        </View>
      )}

      {/* Scope notice - glass card with warning */}
      <View style={styles.noticeSection}>
        <GlassCard variant="dark" style={styles.noticeCard}>
          <Text style={styles.noticeTitle}>Important</Text>
          <Text style={styles.noticeText}>
            The provider cannot add additional services or scope to this
            job. If additional work is needed, a new job must be created.
            This policy protects you from unauthorized charges.
          </Text>
        </GlassCard>
      </View>

      {/* Job details - glass list */}
      <View style={styles.detailsSection}>
        <GlassCard variant="dark">
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Emergency Type</Text>
            <Text style={styles.detailValue}>
              {activeJob?.emergencyType
                ? activeJob.emergencyType.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase())
                : 'N/A'}
            </Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Location</Text>
            <Text style={styles.detailValue} numberOfLines={1}>
              {activeJob?.location?.formattedAddress || 'N/A'}
            </Text>
          </View>
          <View style={[styles.detailRow, styles.detailRowLast]}>
            <Text style={styles.detailLabel}>Started At</Text>
            <Text style={styles.detailValue}>
              {activeJob?.startedAt
                ? new Date(activeJob.startedAt).toLocaleTimeString()
                : 'N/A'}
            </Text>
          </View>
        </GlassCard>
      </View>

      {/* Emergency contact button - red glow */}
      <View style={styles.emergencyContactContainer}>
        <GlassButton
          title="Emergency Support Contact"
          onPress={handleEmergencyContact}
          variant="glow"
          style={styles.emergencyContactButton}
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
  // Header
  header: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.xl,
    paddingBottom: Spacing.md,
  },
  statusIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusDotPulse: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: Colors.success,
    marginRight: Spacing.sm,
    ...Platform.select({
      ios: {
        shadowColor: 'rgba(39, 174, 96, 0.6)',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 1,
        shadowRadius: 8,
      },
      android: { elevation: 4 },
    }),
  },
  statusText: {
    ...Typography.title2,
    color: '#FFFFFF',
  },

  // Timer
  timerSection: {
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.lg,
  },
  timerCard: {
    alignItems: 'center',
  },
  timerLabel: {
    ...Typography.label,
    color: 'rgba(255, 255, 255, 0.5)',
    letterSpacing: 1.5,
    marginBottom: Spacing.sm,
  },
  timerValue: {
    fontSize: 56,
    fontWeight: FontWeight.bold,
    color: Colors.emergencyRed,
    fontVariant: ['tabular-nums'],
  },
  timerDivider: {
    width: 60,
    height: 2,
    backgroundColor: Colors.emergencyRed,
    marginTop: Spacing.lg,
    borderRadius: 1,
    ...Platform.select({
      ios: {
        shadowColor: EMERGENCY_RED_GLOW,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 1,
        shadowRadius: 8,
      },
      android: {},
    }),
  },

  // Provider
  providerSection: {
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.lg,
  },
  providerRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  providerAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255, 255, 255, 0.10)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing.md,
    borderWidth: 2,
    borderColor: Colors.emergencyRed,
  },
  providerInitial: {
    fontSize: FontSize.title3,
    fontWeight: FontWeight.bold,
    color: Colors.emergencyRed,
  },
  providerInfo: {
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
  callButton: {
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
        shadowRadius: 12,
      },
      android: { elevation: 6 },
    }),
  },
  callButtonIcon: {
    fontSize: 18,
    fontWeight: FontWeight.bold,
    color: '#FFFFFF',
  },

  // Scope notice
  noticeSection: {
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.lg,
  },
  noticeCard: {
    borderColor: 'rgba(243, 156, 18, 0.30)',
  },
  noticeTitle: {
    ...Typography.headline,
    color: Colors.warning,
    marginBottom: Spacing.sm,
  },
  noticeText: {
    ...Typography.footnote,
    color: 'rgba(255, 255, 255, 0.55)',
    lineHeight: 20,
  },

  // Details
  detailsSection: {
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.lg,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
  },
  detailRowLast: {
    borderBottomWidth: 0,
  },
  detailLabel: {
    ...Typography.footnote,
    color: 'rgba(255, 255, 255, 0.5)',
  },
  detailValue: {
    ...Typography.body,
    color: '#FFFFFF',
    fontWeight: FontWeight.medium,
    flex: 1,
    textAlign: 'right',
    marginLeft: Spacing.md,
  },

  // Emergency contact
  emergencyContactContainer: {
    position: 'absolute',
    bottom: Spacing.xxl,
    left: Spacing.lg,
    right: Spacing.lg,
  },
  emergencyContactButton: {
    backgroundColor: 'rgba(231, 76, 60, 0.8)',
    paddingVertical: 16,
    ...Platform.select({
      ios: {
        shadowColor: EMERGENCY_RED_GLOW,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 1,
        shadowRadius: 20,
      },
      android: { elevation: 8 },
    }),
  },
});

export default EmergencyInProgressScreen;
