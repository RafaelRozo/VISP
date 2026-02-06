/**
 * VISP/Tasker - EmergencyInProgressScreen
 *
 * Job in progress indicator.
 * Features:
 *   - Timer showing elapsed time
 *   - Provider info
 *   - Emergency contact button
 *   - "Provider cannot add scope" notice
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  Linking,
  Alert,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Colors } from '../../theme/colors';
import { Spacing } from '../../theme/spacing';
import { Typography, FontWeight, FontSize } from '../../theme/typography';
import { BorderRadius } from '../../theme/borders';
import { Shadows } from '../../theme/shadows';
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
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        {/* Status header */}
        <View style={styles.header}>
          <View style={styles.statusIndicator}>
            <View style={styles.statusDotPulse} />
            <Text style={styles.statusText}>Service in Progress</Text>
          </View>
        </View>

        {/* Elapsed time */}
        <View style={styles.timerSection}>
          <Text style={styles.timerLabel}>ELAPSED TIME</Text>
          <Text style={styles.timerValue}>{elapsedTime}</Text>
          <View style={styles.timerDivider} />
        </View>

        {/* Provider info */}
        {provider && (
          <View style={styles.providerSection}>
            <View style={styles.providerCard}>
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
            </View>
          </View>
        )}

        {/* Scope notice */}
        <View style={styles.noticeSection}>
          <View style={styles.noticeCard}>
            <Text style={styles.noticeTitle}>Important</Text>
            <Text style={styles.noticeText}>
              The provider cannot add additional services or scope to this
              job. If additional work is needed, a new job must be created.
              This policy protects you from unauthorized charges.
            </Text>
          </View>
        </View>

        {/* Job details */}
        <View style={styles.detailsSection}>
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
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Started At</Text>
            <Text style={styles.detailValue}>
              {activeJob?.startedAt
                ? new Date(activeJob.startedAt).toLocaleTimeString()
                : 'N/A'}
            </Text>
          </View>
        </View>

        {/* Emergency contact button */}
        <View style={styles.emergencyContactContainer}>
          <TouchableOpacity
            style={styles.emergencyContactButton}
            onPress={handleEmergencyContact}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Contact emergency support"
          >
            <Text style={styles.emergencyContactText}>
              Emergency Support Contact
            </Text>
          </TouchableOpacity>
        </View>
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
  },
  statusText: {
    ...Typography.title2,
    color: Colors.textPrimary,
  },

  // Timer
  timerSection: {
    alignItems: 'center',
    paddingVertical: Spacing.xxl,
  },
  timerLabel: {
    ...Typography.label,
    color: Colors.textSecondary,
    letterSpacing: 1.5,
    marginBottom: Spacing.sm,
  },
  timerValue: {
    fontSize: 56,
    fontWeight: FontWeight.bold,
    color: Colors.primary,
    fontVariant: ['tabular-nums'],
  },
  timerDivider: {
    width: 60,
    height: 2,
    backgroundColor: Colors.primary,
    marginTop: Spacing.lg,
    borderRadius: 1,
  },

  // Provider
  providerSection: {
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.lg,
  },
  providerCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  providerRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  providerAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: Colors.surfaceLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing.md,
    borderWidth: 2,
    borderColor: Colors.primary,
  },
  providerInitial: {
    fontSize: FontSize.title3,
    fontWeight: FontWeight.bold,
    color: Colors.primary,
  },
  providerInfo: {
    flex: 1,
  },
  providerName: {
    ...Typography.headline,
    color: Colors.textPrimary,
    marginBottom: 2,
  },
  providerMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  providerRating: {
    ...Typography.caption,
    color: Colors.textSecondary,
  },
  callButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    ...Shadows.sm,
  },
  callButtonIcon: {
    fontSize: 18,
    fontWeight: FontWeight.bold,
    color: Colors.white,
  },

  // Scope notice
  noticeSection: {
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.lg,
  },
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
    borderBottomColor: Colors.divider,
  },
  detailLabel: {
    ...Typography.footnote,
    color: Colors.textSecondary,
  },
  detailValue: {
    ...Typography.body,
    color: Colors.textPrimary,
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
    backgroundColor: Colors.emergencyRed,
    borderRadius: BorderRadius.md,
    paddingVertical: Spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    ...Shadows.md,
  },
  emergencyContactText: {
    ...Typography.buttonLarge,
    color: Colors.white,
    fontWeight: FontWeight.bold,
  },
});

export default EmergencyInProgressScreen;
