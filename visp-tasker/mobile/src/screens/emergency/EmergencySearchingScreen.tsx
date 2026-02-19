/**
 * VISP - EmergencySearchingScreen
 *
 * Full-screen animation while searching for a provider.
 * Features:
 *   - Pulsing radar/search animation
 *   - "Finding nearest available provider..." text
 *   - SLA countdown timer
 *   - Cancel option
 *
 * Dark glassmorphism styling with red emergency accent.
 */

import React, { useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { GlassBackground, GlassCard, GlassButton } from '../../components/glass';
import { PulseRing } from '../../components/animations';
import { GlassStyles, Colors } from '../../theme';
import { Spacing } from '../../theme/spacing';
import { Typography, FontWeight } from '../../theme/typography';
import { useEmergencyStore } from '../../stores/emergencyStore';
import SLATimer from '../../components/SLATimer';
import type { EmergencyFlowParamList } from '../../types';

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

type SearchingRouteProp = RouteProp<EmergencyFlowParamList, 'EmergencySearching'>;
type SearchingNavProp = NativeStackNavigationProp<EmergencyFlowParamList, 'EmergencySearching'>;

// ──────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────

function EmergencySearchingScreen(): React.JSX.Element {
  const route = useRoute<SearchingRouteProp>();
  const navigation = useNavigation<SearchingNavProp>();
  const { jobId } = route.params;

  const {
    activeJob,
    jobStatus,
    sla,
    fetchJobStatus,
    startPolling,
    stopPolling,
  } = useEmergencyStore();

  // Start polling on mount
  useEffect(() => {
    fetchJobStatus(jobId);
    startPolling(jobId);

    return () => {
      stopPolling();
    };
  }, [jobId, fetchJobStatus, startPolling, stopPolling]);

  // Navigate when status changes
  useEffect(() => {
    if (jobStatus === 'matched' || jobStatus === 'en_route') {
      navigation.replace('EmergencyMatched', { jobId });
    } else if (jobStatus === 'cancelled') {
      navigation.replace('EmergencyCancel', { jobId });
    }
  }, [jobStatus, jobId, navigation]);

  // Handle cancel
  const handleCancel = useCallback(() => {
    navigation.navigate('EmergencyCancel', { jobId });
  }, [navigation, jobId]);

  const slaDeadline = activeJob?.slaDeadline || new Date(Date.now() + sla.responseTimeMinutes * 60000).toISOString();

  return (
    <GlassBackground>
      <View style={styles.container}>
        {/* SLA Timer at top - glass card */}
        <View style={styles.timerContainer}>
          <GlassCard variant="dark" padding={Spacing.md}>
            <SLATimer
              deadline={slaDeadline}
              totalDurationMinutes={sla.responseTimeMinutes}
              label="Response Deadline"
            />
          </GlassCard>
        </View>

        {/* Radar animation - SVG PulseRing */}
        <View style={styles.radarContainer}>
          <PulseRing
            size={240}
            color="#E74C3C"
            ringCount={4}
            duration={1800}
            centerRadius={22}
            maxRadius={110}
          />
        </View>

        {/* Status text */}
        <View style={styles.statusContainer}>
          <Text style={styles.statusTitle}>
            Finding nearest available provider...
          </Text>
          <Text style={styles.statusDescription}>
            We are searching for a Level 4 emergency provider in your area.
            You will be notified as soon as one is matched.
          </Text>
        </View>

        {/* Cancel option - glass outline button */}
        <View style={styles.cancelContainer}>
          <GlassButton
            title="Cancel Request"
            onPress={handleCancel}
            variant="outline"
            style={styles.cancelButton}
          />
        </View>
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
    alignItems: 'center',
  },

  // Timer
  timerContainer: {
    width: '100%',
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.xl,
    marginBottom: Spacing.xl,
  },

  // Radar — now powered by PulseRing SVG component
  radarContainer: {
    width: 260,
    height: 260,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.xxxl,
  },

  // Status
  statusContainer: {
    paddingHorizontal: Spacing.xxl,
    alignItems: 'center',
    marginBottom: Spacing.xxxl,
  },
  statusTitle: {
    ...Typography.title2,
    color: '#FFFFFF',
    textAlign: 'center',
    marginBottom: Spacing.md,
  },
  statusDescription: {
    ...Typography.body,
    color: 'rgba(255, 255, 255, 0.55)',
    textAlign: 'center',
    lineHeight: 22,
  },

  // Cancel
  cancelContainer: {
    position: 'absolute',
    bottom: Spacing.xxl,
    left: Spacing.lg,
    right: Spacing.lg,
  },
  cancelButton: {
    borderColor: 'rgba(255, 255, 255, 0.20)',
  },
});

export default EmergencySearchingScreen;
