/**
 * VISP - MatchingScreen (Glass Redesign)
 *
 * Immediate "Job Posted" success flow.
 * Features:
 *   - Brief "Posting your job..." animation (1-2 seconds) with PulseRing
 *   - Transitions to "Job Posted!" success state with AnimatedCheckmark
 *   - "View My Jobs" and "Back to Home" navigation buttons
 *   - Glass design with existing visual style
 */

import React, { useEffect, useRef, useState } from 'react';
import {
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
import type { CustomerFlowParamList } from '../../types';

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

type MatchingRouteProp = RouteProp<CustomerFlowParamList, 'Matching'>;
type MatchingNavProp = NativeStackNavigationProp<CustomerFlowParamList, 'Matching'>;

type PostPhase = 'posting' | 'posted';

// ──────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────

const POSTING_DURATION_MS = 1800;

// ──────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────

function MatchingScreen(): React.JSX.Element {
  const route = useRoute<MatchingRouteProp>();
  const navigation = useNavigation<MatchingNavProp>();
  const { jobId, taskName } = route.params;

  const [phase, setPhase] = useState<PostPhase>('posting');

  // Animation values
  const dotScale = useRef(new Animated.Value(1)).current;
  const contentOpacity = useRef(new Animated.Value(0)).current;

  // Hide the header back button
  useEffect(() => {
    navigation.setOptions({
      headerShown: false,
    });
  }, [navigation]);

  // Center dot pulse animation (only during posting phase)
  useEffect(() => {
    if (phase !== 'posting') return;

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
  }, [dotScale, phase]);

  // Transition from posting to posted after a brief delay
  useEffect(() => {
    const timer = setTimeout(() => {
      setPhase('posted');

      // Fade in the success content
      Animated.timing(contentOpacity, {
        toValue: 1,
        duration: 500,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }).start();
    }, POSTING_DURATION_MS);

    return () => clearTimeout(timer);
  }, [contentOpacity]);

  // Navigation handlers
  const handleViewMyJobs = () => {
    navigation.navigate('MyJobs' as any);
  };

  const handleBackToHome = () => {
    const rootNav = navigation.getParent();
    if (rootNav) {
      rootNav.reset({
        index: 0,
        routes: [{ name: 'CustomerHome' as any }],
      });
    } else {
      navigation.goBack();
    }
  };

  const isPosted = phase === 'posted';

  return (
    <GlassBackground>
      <View style={styles.container}>
        {/* Top section: task name */}
        <View style={styles.topSection}>
          <Text style={styles.taskLabel}>
            {isPosted ? 'Job Posted' : 'Booking'}
          </Text>
          <Text style={styles.taskName}>{taskName}</Text>
        </View>

        {/* Center animation inside glass panel */}
        <View style={styles.animationContainer}>
          <GlassCard variant="dark" padding={Spacing.xxl} style={styles.glassAnimPanel}>
            <View style={styles.pulseContainer}>
              {/* PulseRing animation during posting phase */}
              {!isPosted && (
                <PulseRing
                  size={220}
                  color="#7850FF"
                  ringCount={3}
                  duration={2000}
                  centerRadius={20}
                  maxRadius={100}
                />
              )}

              {/* AnimatedCheckmark for posted state */}
              {isPosted && (
                <AnimatedCheckmark
                  size={100}
                  color={Colors.success}
                />
              )}

              {/* Overlay center dot with text label when posting */}
              {!isPosted && (
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
          <Text style={styles.statusText}>
            {isPosted
              ? 'Job Posted!'
              : 'Posting your job...'}
          </Text>

          {/* Success message and buttons */}
          {isPosted && (
            <Animated.View style={[styles.successContent, { opacity: contentOpacity }]}>
              <Text style={styles.successMessage}>
                Your job request has been posted! You'll be notified when Vispers apply
                to your job. Check your jobs list for updates.
              </Text>

              <View style={styles.buttonGroup}>
                <GlassButton
                  title="View My Jobs"
                  variant="glow"
                  onPress={handleViewMyJobs}
                  style={styles.primaryButton}
                />

                <GlassButton
                  title="Back to Home"
                  variant="outline"
                  onPress={handleBackToHome}
                  style={styles.secondaryButton}
                />
              </View>
            </Animated.View>
          )}

          {/* Phase indicator dots */}
          <View style={styles.phaseDotsContainer}>
            <View
              style={[
                styles.phaseDot,
                styles.phaseDotActive,
              ]}
            />
            <View
              style={[
                styles.phaseDot,
                isPosted && styles.phaseDotActive,
                isPosted && styles.phaseDotConfirmed,
              ]}
            />
          </View>
        </View>

        {/* Bottom section */}
        <View style={styles.bottomSection}>
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

  // Success content
  successContent: {
    alignItems: 'center',
    paddingHorizontal: Spacing.xxl,
    marginBottom: Spacing.xl,
  },
  successMessage: {
    ...Typography.body,
    color: 'rgba(255, 255, 255, 0.7)',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: Spacing.xxl,
  },
  buttonGroup: {
    width: '100%',
    gap: Spacing.md,
  },
  primaryButton: {
    width: '100%',
  },
  secondaryButton: {
    width: '100%',
  },

  // Bottom
  bottomSection: {
    alignItems: 'center',
    paddingBottom: Spacing.huge,
    paddingHorizontal: Spacing.xxl,
  },
  footerText: {
    ...Typography.caption,
    color: 'rgba(255, 255, 255, 0.3)',
    textAlign: 'center',
    lineHeight: 16,
  },
});

export default MatchingScreen;
