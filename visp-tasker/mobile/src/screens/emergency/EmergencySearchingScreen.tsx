/**
 * VISP/Tasker - EmergencySearchingScreen
 *
 * Full-screen animation while searching for a provider.
 * Features:
 *   - Pulsing radar/search animation
 *   - "Finding nearest available provider..." text
 *   - SLA countdown timer
 *   - Cancel option
 */

import React, { useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  TouchableOpacity,
  SafeAreaView,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Colors } from '../../theme/colors';
import { Spacing } from '../../theme/spacing';
import { Typography, FontWeight, FontSize } from '../../theme/typography';
import { BorderRadius } from '../../theme/borders';
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

  // Pulse animations for the radar rings
  const pulse1 = useRef(new Animated.Value(0)).current;
  const pulse2 = useRef(new Animated.Value(0)).current;
  const pulse3 = useRef(new Animated.Value(0)).current;
  const dotPulse = useRef(new Animated.Value(0.6)).current;

  // Start polling and animations on mount
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

  // Radar pulse animation
  useEffect(() => {
    const createPulse = (animValue: Animated.Value, delay: number) => {
      return Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.parallel([
            Animated.timing(animValue, {
              toValue: 1,
              duration: 2000,
              useNativeDriver: true,
            }),
          ]),
          Animated.timing(animValue, {
            toValue: 0,
            duration: 0,
            useNativeDriver: true,
          }),
        ]),
      );
    };

    const animations = [
      createPulse(pulse1, 0),
      createPulse(pulse2, 600),
      createPulse(pulse3, 1200),
    ];

    animations.forEach((a) => a.start());

    // Center dot pulse
    const dotAnimation = Animated.loop(
      Animated.sequence([
        Animated.timing(dotPulse, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(dotPulse, {
          toValue: 0.6,
          duration: 800,
          useNativeDriver: true,
        }),
      ]),
    );
    dotAnimation.start();

    return () => {
      animations.forEach((a) => a.stop());
      dotAnimation.stop();
    };
  }, [pulse1, pulse2, pulse3, dotPulse]);

  // Handle cancel
  const handleCancel = useCallback(() => {
    navigation.navigate('EmergencyCancel', { jobId });
  }, [navigation, jobId]);

  // Animation interpolations
  const createRingStyle = (animValue: Animated.Value, maxSize: number) => ({
    opacity: animValue.interpolate({
      inputRange: [0, 0.5, 1],
      outputRange: [0.6, 0.3, 0],
    }),
    transform: [
      {
        scale: animValue.interpolate({
          inputRange: [0, 1],
          outputRange: [0.3, 1],
        }),
      },
    ],
  });

  const slaDeadline = activeJob?.slaDeadline || new Date(Date.now() + sla.responseTimeMinutes * 60000).toISOString();

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        {/* SLA Timer at top */}
        <View style={styles.timerContainer}>
          <SLATimer
            deadline={slaDeadline}
            totalDurationMinutes={sla.responseTimeMinutes}
            label="Response Deadline"
          />
        </View>

        {/* Radar animation */}
        <View style={styles.radarContainer}>
          {/* Pulse rings */}
          <Animated.View
            style={[styles.radarRing, styles.radarRing1, createRingStyle(pulse1, 200)]}
          />
          <Animated.View
            style={[styles.radarRing, styles.radarRing2, createRingStyle(pulse2, 160)]}
          />
          <Animated.View
            style={[styles.radarRing, styles.radarRing3, createRingStyle(pulse3, 120)]}
          />

          {/* Center dot */}
          <Animated.View style={[styles.radarCenter, { opacity: dotPulse }]}>
            <View style={styles.radarCenterInner}>
              <Text style={styles.radarCenterIcon}>!</Text>
            </View>
          </Animated.View>
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

        {/* Cancel option */}
        <View style={styles.cancelContainer}>
          <TouchableOpacity
            style={styles.cancelButton}
            onPress={handleCancel}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Cancel emergency request"
          >
            <Text style={styles.cancelButtonText}>Cancel Request</Text>
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
    alignItems: 'center',
  },

  // Timer
  timerContainer: {
    width: '100%',
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.xl,
    marginBottom: Spacing.xl,
  },

  // Radar
  radarContainer: {
    width: 260,
    height: 260,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.xxxl,
  },
  radarRing: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: Colors.emergencyRed,
    borderRadius: 9999,
  },
  radarRing1: {
    width: 260,
    height: 260,
  },
  radarRing2: {
    width: 200,
    height: 200,
  },
  radarRing3: {
    width: 140,
    height: 140,
  },
  radarCenter: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: `${Colors.emergencyRed}30`,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radarCenterInner: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: Colors.emergencyRed,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radarCenterIcon: {
    fontSize: 24,
    fontWeight: FontWeight.bold,
    color: Colors.white,
  },

  // Status
  statusContainer: {
    paddingHorizontal: Spacing.xxl,
    alignItems: 'center',
    marginBottom: Spacing.xxxl,
  },
  statusTitle: {
    ...Typography.title2,
    color: Colors.textPrimary,
    textAlign: 'center',
    marginBottom: Spacing.md,
  },
  statusDescription: {
    ...Typography.body,
    color: Colors.textSecondary,
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
    backgroundColor: 'transparent',
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.textTertiary,
    paddingVertical: Spacing.lg,
    alignItems: 'center',
  },
  cancelButtonText: {
    ...Typography.buttonLarge,
    color: Colors.textSecondary,
  },
});

export default EmergencySearchingScreen;
