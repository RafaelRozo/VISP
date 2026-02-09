/**
 * VISP/Tasker - MatchingScreen
 *
 * Animated "Finding your tasker..." screen.
 * Features:
 *   - Pulsing search animation
 *   - Status text updates during search
 *   - Cancel button
 *   - For MVP: simulates matching with a 3-second timer
 *   - On match: transitions to JobTrackingScreen
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Easing,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Colors, getLevelColor } from '../../theme/colors';
import { Spacing } from '../../theme/spacing';
import { Typography, FontWeight, FontSize } from '../../theme/typography';
import { BorderRadius } from '../../theme/borders';
import type { CustomerFlowParamList } from '../../types';

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

type MatchingRouteProp = RouteProp<CustomerFlowParamList, 'Matching'>;
type MatchingNavProp = NativeStackNavigationProp<CustomerFlowParamList, 'Matching'>;

type SearchPhase = 'searching' | 'found' | 'assigning' | 'confirmed';

// ──────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────

const STATUS_MESSAGES: Record<SearchPhase, string> = {
  searching: 'Finding available providers near you...',
  found: 'Provider found! Confirming availability...',
  assigning: 'Assigning your tasker...',
  confirmed: 'Your tasker has been assigned!',
};

const PHASE_TIMINGS: { phase: SearchPhase; delay: number }[] = [
  { phase: 'searching', delay: 0 },
  { phase: 'found', delay: 2000 },
  { phase: 'assigning', delay: 3500 },
  { phase: 'confirmed', delay: 5000 },
];

// ──────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────

function MatchingScreen(): React.JSX.Element {
  const route = useRoute<MatchingRouteProp>();
  const navigation = useNavigation<MatchingNavProp>();
  const { jobId, taskName } = route.params;

  const [phase, setPhase] = useState<SearchPhase>('searching');
  const [isCancelled, setIsCancelled] = useState(false);

  // Animation values
  const pulse1 = useRef(new Animated.Value(0)).current;
  const pulse2 = useRef(new Animated.Value(0)).current;
  const pulse3 = useRef(new Animated.Value(0)).current;
  const dotScale = useRef(new Animated.Value(1)).current;
  const fadeAnim = useRef(new Animated.Value(1)).current;

  // Hide the header back button during matching
  useEffect(() => {
    navigation.setOptions({
      headerShown: false,
    });
  }, [navigation]);

  // Pulse animations
  useEffect(() => {
    function createPulseAnimation(animValue: Animated.Value, delay: number) {
      return Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(animValue, {
            toValue: 1,
            duration: 2000,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(animValue, {
            toValue: 0,
            duration: 0,
            useNativeDriver: true,
          }),
        ]),
      );
    }

    const anim1 = createPulseAnimation(pulse1, 0);
    const anim2 = createPulseAnimation(pulse2, 600);
    const anim3 = createPulseAnimation(pulse3, 1200);

    const dotAnim = Animated.loop(
      Animated.sequence([
        Animated.timing(dotScale, {
          toValue: 1.2,
          duration: 600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(dotScale, {
          toValue: 1,
          duration: 600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );

    anim1.start();
    anim2.start();
    anim3.start();
    dotAnim.start();

    return () => {
      anim1.stop();
      anim2.stop();
      anim3.stop();
      dotAnim.stop();
    };
  }, [pulse1, pulse2, pulse3, dotScale]);

  // Phase progression (MVP mock matching)
  useEffect(() => {
    if (isCancelled) return;

    const timers: NodeJS.Timeout[] = [];

    PHASE_TIMINGS.forEach(({ phase: targetPhase, delay }) => {
      const timer = setTimeout(() => {
        if (!isCancelled) {
          setPhase(targetPhase);
        }
      }, delay);
      timers.push(timer);
    });

    // Navigate to tracking after confirmed
    const navTimer = setTimeout(() => {
      if (!isCancelled) {
        navigation.navigate('JobTracking', { jobId });
      }
    }, 6000);
    timers.push(navTimer);

    return () => {
      timers.forEach(clearTimeout);
    };
  }, [isCancelled, jobId, navigation]);

  // Cancel handler
  const handleCancel = useCallback(() => {
    Alert.alert(
      'Cancel Booking',
      'Are you sure you want to cancel this booking request?',
      [
        { text: 'Keep Searching', style: 'cancel' },
        {
          text: 'Cancel Booking',
          style: 'destructive',
          onPress: () => {
            setIsCancelled(true);
            navigation.goBack();
          },
        },
      ],
    );
  }, [navigation]);

  // Render pulsing ring
  const renderPulse = (
    animValue: Animated.Value,
    size: number,
  ): React.JSX.Element => {
    const scale = animValue.interpolate({
      inputRange: [0, 1],
      outputRange: [1, size / 60],
    });

    const opacity = animValue.interpolate({
      inputRange: [0, 1],
      outputRange: [0.6, 0],
    });

    return (
      <Animated.View
        style={[
          styles.pulseRing,
          {
            transform: [{ scale }],
            opacity,
          },
        ]}
      />
    );
  };

  const isCompleted = phase === 'confirmed';

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        {/* Top section: task name */}
        <View style={styles.topSection}>
          <Text style={styles.taskLabel}>Booking</Text>
          <Text style={styles.taskName}>{taskName}</Text>
        </View>

        {/* Center animation */}
        <View style={styles.animationContainer}>
          <View style={styles.pulseContainer}>
            {renderPulse(pulse1, 200)}
            {renderPulse(pulse2, 260)}
            {renderPulse(pulse3, 320)}

            <Animated.View
              style={[
                styles.centerDot,
                isCompleted && styles.centerDotConfirmed,
                { transform: [{ scale: dotScale }] },
              ]}
            >
              <Text style={styles.centerDotText}>
                {isCompleted ? 'OK' : 'T'}
              </Text>
            </Animated.View>
          </View>

          {/* Status text */}
          <Text style={styles.statusText}>{STATUS_MESSAGES[phase]}</Text>

          {/* Phase indicator dots */}
          <View style={styles.phaseDotsContainer}>
            {PHASE_TIMINGS.map((item, index) => {
              const isActive = PHASE_TIMINGS.findIndex(
                (p) => p.phase === phase,
              ) >= index;
              return (
                <View
                  key={item.phase}
                  style={[
                    styles.phaseDot,
                    isActive && styles.phaseDotActive,
                    item.phase === 'confirmed' && isActive && styles.phaseDotConfirmed,
                  ]}
                />
              );
            })}
          </View>
        </View>

        {/* Bottom section: cancel */}
        <View style={styles.bottomSection}>
          {!isCompleted && (
            <TouchableOpacity
              style={styles.cancelButton}
              onPress={handleCancel}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Cancel booking request"
            >
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>
          )}

          <Text style={styles.footerText}>
            Tasker acts as a platform intermediary only.
            {'\n'}Providers are independent service professionals.
          </Text>
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
    justifyContent: 'space-between',
  },

  // Top
  topSection: {
    alignItems: 'center',
    paddingTop: Spacing.giant,
    paddingHorizontal: Spacing.xxl,
  },
  taskLabel: {
    ...Typography.label,
    color: Colors.textTertiary,
    marginBottom: Spacing.xs,
  },
  taskName: {
    ...Typography.title2,
    color: Colors.textPrimary,
    textAlign: 'center',
  },

  // Animation
  animationContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulseContainer: {
    width: 320,
    height: 320,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.xxl,
  },
  pulseRing: {
    position: 'absolute',
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 2,
    borderColor: Colors.primary,
  },
  centerDot: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerDotConfirmed: {
    backgroundColor: Colors.success,
  },
  centerDotText: {
    fontSize: FontSize.title2,
    fontWeight: FontWeight.bold as '700',
    color: Colors.white,
  },
  statusText: {
    ...Typography.body,
    color: Colors.textSecondary,
    textAlign: 'center',
    paddingHorizontal: Spacing.xxl,
    marginBottom: Spacing.xl,
  },
  phaseDotsContainer: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  phaseDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.border,
  },
  phaseDotActive: {
    backgroundColor: Colors.primary,
  },
  phaseDotConfirmed: {
    backgroundColor: Colors.success,
  },

  // Bottom
  bottomSection: {
    alignItems: 'center',
    paddingBottom: Spacing.huge,
    paddingHorizontal: Spacing.xxl,
  },
  cancelButton: {
    paddingHorizontal: Spacing.xxxl,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    marginBottom: Spacing.xl,
  },
  cancelButtonText: {
    ...Typography.buttonLarge,
    color: Colors.textSecondary,
  },
  footerText: {
    ...Typography.caption,
    color: Colors.textTertiary,
    textAlign: 'center',
    lineHeight: 16,
  },
});

export default MatchingScreen;
