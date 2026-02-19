/**
 * VISP - MatchingScreen (Glass Redesign)
 *
 * Animated "Finding your provider..." screen.
 * Features:
 *   - Pulsing search animation in glass panel
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
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { GlassBackground, GlassCard, GlassButton } from '../../components/glass';
import { PulseRing, AnimatedCheckmark } from '../../components/animations';
import { Colors } from '../../theme/colors';
import { Spacing } from '../../theme/spacing';
import { Typography, FontWeight, FontSize } from '../../theme/typography';
import { taskService } from '../../services/taskService';
import type { CustomerFlowParamList } from '../../types';

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

type MatchingRouteProp = RouteProp<CustomerFlowParamList, 'Matching'>;
type MatchingNavProp = NativeStackNavigationProp<CustomerFlowParamList, 'Matching'>;

type SearchPhase = 'searching' | 'found' | 'assigning' | 'confirmed' | 'timeout';

// ──────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────

const STATUS_MESSAGES: Record<SearchPhase, string> = {
  searching: 'Finding available providers near you...',
  found: 'Provider found! Confirming availability...',
  assigning: 'Assigning your provider...',
  confirmed: 'Your provider has been assigned!',
  timeout: 'No providers available right now.',
};

const POLLING_INTERVAL_MS = 5000;
const SEARCH_TIMEOUT_MS = 120_000; // 2 minutes

// Status values that mean a provider has been matched
const MATCHED_STATUSES = [
  'matched', 'provider_accepted', 'provider_en_route', 'arrived', 'in_progress', 'completed',
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
  const dotScale = useRef(new Animated.Value(1)).current;
  const pollingRef = useRef<NodeJS.Timeout | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Hide the header back button during matching
  useEffect(() => {
    navigation.setOptions({
      headerShown: false,
    });
  }, [navigation]);

  // Center dot pulse animation
  useEffect(() => {
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

    dotAnim.start();

    return () => {
      dotAnim.stop();
    };
  }, [dotScale]);

  // Real backend polling for provider match
  useEffect(() => {
    if (isCancelled || phase === 'confirmed' || phase === 'timeout') return;

    async function pollTracking() {
      try {
        const data = await taskService.getJobTracking(jobId);
        const st = data.status;

        if (MATCHED_STATUSES.includes(st)) {
          // Provider found!
          setPhase('found');

          // Brief delay then navigate to tracking
          setTimeout(() => {
            setPhase('confirmed');
            setTimeout(() => {
              if (!isCancelled) {
                navigation.navigate('JobTracking', { jobId });
              }
            }, 1500);
          }, 1500);

          // Stop polling & timeout
          if (pollingRef.current) clearInterval(pollingRef.current);
          if (timeoutRef.current) clearTimeout(timeoutRef.current);
          return;
        }
      } catch (err) {
        console.warn('[Matching] Polling error:', err);
      }
    }

    pollTracking();
    pollingRef.current = setInterval(pollTracking, POLLING_INTERVAL_MS);

    // 2-minute timeout
    timeoutRef.current = setTimeout(() => {
      if (pollingRef.current) clearInterval(pollingRef.current);
      setPhase('timeout');

      Alert.alert(
        'No Providers Available',
        'We couldn\'t find a provider in your area right now. Your job request has been saved — you\'ll be notified when a provider becomes available.',
        [
          {
            text: 'OK',
            onPress: () => {
              // Navigate to CustomerHome in root stack
              const rootNav = navigation.getParent();
              if (rootNav) {
                rootNav.reset({
                  index: 0,
                  routes: [{ name: 'CustomerHome' as any }],
                });
              } else {
                navigation.goBack();
              }
            },
          },
        ],
      );
    }, SEARCH_TIMEOUT_MS);

    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [isCancelled, jobId, navigation, phase]);

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

  const isCompleted = phase === 'confirmed';

  return (
    <GlassBackground>
      <View style={styles.container}>
        {/* Top section: task name */}
        <View style={styles.topSection}>
          <Text style={styles.taskLabel}>Booking</Text>
          <Text style={styles.taskName}>{taskName}</Text>
        </View>

        {/* Center animation inside glass panel */}
        <View style={styles.animationContainer}>
          <GlassCard variant="dark" padding={Spacing.xxl} style={styles.glassAnimPanel}>
            <View style={styles.pulseContainer}>
              {/* SVG PulseRing animation replaces manual Animated.View rings */}
              {!isCompleted && (
                <PulseRing
                  size={220}
                  color="#7850FF"
                  ringCount={3}
                  duration={2000}
                  centerRadius={20}
                  maxRadius={100}
                />
              )}

              {/* AnimatedCheckmark for confirmed state */}
              {isCompleted && (
                <AnimatedCheckmark
                  size={100}
                  color={Colors.success}
                />
              )}

              {/* Overlay center dot with text label when searching */}
              {!isCompleted && (
                <Animated.View
                  style={[
                    styles.centerDot,
                    styles.centerDotOverlay,
                    { transform: [{ scale: dotScale }] },
                  ]}
                >
                  <Text style={styles.centerDotText}>V</Text>
                </Animated.View>
              )}
            </View>
          </GlassCard>

          {/* Status text */}
          <Text style={styles.statusText}>{STATUS_MESSAGES[phase]}</Text>

          {/* Phase indicator dots */}
          <View style={styles.phaseDotsContainer}>
            {(['searching', 'found', 'confirmed'] as SearchPhase[]).map((p, index) => {
              const phaseOrder: SearchPhase[] = ['searching', 'found', 'confirmed'];
              const currentIdx = phaseOrder.indexOf(phase);
              const isActive = currentIdx >= index;
              return (
                <View
                  key={p}
                  style={[
                    styles.phaseDot,
                    isActive && styles.phaseDotActive,
                    p === 'confirmed' && isActive && styles.phaseDotConfirmed,
                  ]}
                />
              );
            })}
          </View>
        </View>

        {/* Bottom section: cancel */}
        <View style={styles.bottomSection}>
          {!isCompleted && (
            <GlassButton
              title="Cancel"
              variant="outline"
              onPress={handleCancel}
              style={styles.cancelButtonStyle}
            />
          )}

          <Text style={styles.footerText}>
            VISP acts as a platform intermediary only.
            {'\n'}Providers are independent service professionals.
          </Text>
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
    color: 'rgba(255, 255, 255, 0.4)',
    marginBottom: Spacing.xs,
  },
  taskName: {
    ...Typography.title2,
    color: '#FFFFFF',
    textAlign: 'center',
  },

  // Animation
  animationContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  glassAnimPanel: {
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: Spacing.xxl,
    marginBottom: Spacing.xxl,
  },
  pulseContainer: {
    width: 280,
    height: 280,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerDot: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'rgba(120, 80, 255, 0.8)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerDotOverlay: {
    position: 'absolute',
  },
  centerDotText: {
    fontSize: FontSize.title2,
    fontWeight: FontWeight.bold as '700',
    color: '#FFFFFF',
  },
  statusText: {
    ...Typography.body,
    color: 'rgba(255, 255, 255, 0.6)',
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
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
  },
  phaseDotActive: {
    backgroundColor: 'rgba(120, 80, 255, 0.8)',
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
  cancelButtonStyle: {
    paddingHorizontal: Spacing.xxxl,
    marginBottom: Spacing.xl,
  },
  footerText: {
    ...Typography.caption,
    color: 'rgba(255, 255, 255, 0.3)',
    textAlign: 'center',
    lineHeight: 16,
  },
});

export default MatchingScreen;
