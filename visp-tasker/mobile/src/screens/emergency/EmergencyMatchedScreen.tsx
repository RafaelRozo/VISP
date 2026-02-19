/**
 * VISP - EmergencyMatchedScreen
 *
 * Provider found notification screen.
 * Features:
 *   - Provider name, photo, rating, level badge
 *   - ETA display
 *   - Provider en-route animation
 *
 * Dark glassmorphism styling with red emergency accent.
 */

import React, { useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  Animated,
  Platform,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { GlassBackground, GlassCard, GlassButton } from '../../components/glass';
import { AnimatedCheckmark } from '../../components/animations';
import { GlassStyles, Colors } from '../../theme';
import { Spacing } from '../../theme/spacing';
import { Typography, FontWeight, FontSize } from '../../theme/typography';
import { useEmergencyStore } from '../../stores/emergencyStore';
import LevelBadge from '../../components/LevelBadge';
import SLATimer from '../../components/SLATimer';
import type { EmergencyFlowParamList } from '../../types';

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

type MatchedRouteProp = RouteProp<EmergencyFlowParamList, 'EmergencyMatched'>;
type MatchedNavProp = NativeStackNavigationProp<EmergencyFlowParamList, 'EmergencyMatched'>;

// ──────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────

function EmergencyMatchedScreen(): React.JSX.Element {
  const route = useRoute<MatchedRouteProp>();
  const navigation = useNavigation<MatchedNavProp>();
  const { jobId } = route.params;

  const {
    activeJob,
    jobStatus,
    sla,
    fetchJobStatus,
    startPolling,
    stopPolling,
  } = useEmergencyStore();

  const checkAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(50)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  // Start polling
  useEffect(() => {
    fetchJobStatus(jobId);
    startPolling(jobId);

    return () => stopPolling();
  }, [jobId, fetchJobStatus, startPolling, stopPolling]);

  // Navigate on status change
  useEffect(() => {
    if (jobStatus === 'en_route' || jobStatus === 'arrived') {
      // Auto-navigate to tracking after a brief delay to show matched state
      const timer = setTimeout(() => {
        navigation.replace('EmergencyTracking', { jobId });
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [jobStatus, jobId, navigation]);

  // Entry animations
  useEffect(() => {
    Animated.sequence([
      Animated.spring(checkAnim, {
        toValue: 1,
        friction: 5,
        tension: 40,
        useNativeDriver: true,
      }),
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: 400,
          useNativeDriver: true,
        }),
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 400,
          useNativeDriver: true,
        }),
      ]),
    ]).start();
  }, [checkAnim, slideAnim, fadeAnim]);

  // Handle proceed to tracking
  const handleProceedToTracking = useCallback(() => {
    navigation.replace('EmergencyTracking', { jobId });
  }, [navigation, jobId]);

  const provider = activeJob?.provider;
  const slaDeadline = activeJob?.slaDeadline || new Date(Date.now() + sla.arrivalTimeMinutes * 60000).toISOString();

  return (
    <GlassBackground>
      <View style={styles.container}>
        {/* Success check animation - SVG AnimatedCheckmark with spring entry */}
        <Animated.View
          style={[
            styles.checkContainer,
            {
              transform: [{ scale: checkAnim }],
            },
          ]}
        >
          <AnimatedCheckmark size={80} color="#27AE60" />
        </Animated.View>

        <Text style={styles.matchedTitle}>Provider Found!</Text>
        <Text style={styles.matchedSubtitle}>
          A Level 4 emergency provider has been dispatched
        </Text>

        {/* Provider card - elevated glass */}
        {provider && (
          <Animated.View
            style={[
              styles.providerCardWrapper,
              {
                transform: [{ translateY: slideAnim }],
                opacity: fadeAnim,
              },
            ]}
          >
            <GlassCard variant="elevated" style={styles.providerCard}>
              {/* Provider avatar */}
              <View style={styles.providerAvatarContainer}>
                {provider.photoUrl ? (
                  <Image
                    source={{ uri: provider.photoUrl }}
                    style={styles.providerAvatar}
                    accessibilityLabel={`Photo of ${provider.firstName}`}
                  />
                ) : (
                  <View style={styles.providerAvatarPlaceholder}>
                    <Text style={styles.providerAvatarInitial}>
                      {provider.firstName.charAt(0)}
                    </Text>
                  </View>
                )}
                <LevelBadge level={provider.level} size="small" style={styles.providerBadge} />
              </View>

              {/* Provider info */}
              <Text style={styles.providerName}>
                {provider.firstName} {provider.lastName.charAt(0)}.
              </Text>

              <View style={styles.providerStats}>
                <View style={styles.statItem}>
                  <Text style={styles.statValue}>
                    {provider.rating.toFixed(1)}
                  </Text>
                  <Text style={styles.statLabel}>Rating</Text>
                </View>
                <View style={styles.statDivider} />
                <View style={styles.statItem}>
                  <Text style={styles.statValue}>
                    {provider.completedJobs}
                  </Text>
                  <Text style={styles.statLabel}>Jobs</Text>
                </View>
                <View style={styles.statDivider} />
                <View style={styles.statItem}>
                  <Text style={styles.statValue}>
                    {provider.yearsExperience}yr
                  </Text>
                  <Text style={styles.statLabel}>Experience</Text>
                </View>
              </View>

              {/* Specializations - glass chips */}
              {provider.specializations.length > 0 && (
                <View style={styles.specializationsRow}>
                  {provider.specializations.slice(0, 3).map((spec, idx) => (
                    <View key={idx} style={styles.specChip}>
                      <Text style={styles.specChipText}>{spec}</Text>
                    </View>
                  ))}
                </View>
              )}
            </GlassCard>
          </Animated.View>
        )}

        {/* ETA display - glass card */}
        <Animated.View
          style={[
            styles.etaContainer,
            {
              transform: [{ translateY: slideAnim }],
              opacity: fadeAnim,
            },
          ]}
        >
          {activeJob?.etaMinutes !== undefined && (
            <GlassCard variant="standard" style={styles.etaCardBorder}>
              <View style={styles.etaContent}>
                <Text style={styles.etaLabel}>Estimated Arrival</Text>
                <Text style={styles.etaValue}>{activeJob.etaMinutes}</Text>
                <Text style={styles.etaUnit}>minutes</Text>
              </View>
            </GlassCard>
          )}
        </Animated.View>

        {/* SLA Timer */}
        <View style={styles.slaContainer}>
          <SLATimer
            deadline={slaDeadline}
            totalDurationMinutes={sla.arrivalTimeMinutes}
            label="Arrival Deadline"
            compact
          />
        </View>

        {/* Proceed button - red glow */}
        <View style={styles.ctaContainer}>
          <GlassButton
            title="Track Provider"
            onPress={handleProceedToTracking}
            variant="glow"
            style={styles.trackButton}
          />
        </View>
      </View>
    </GlassBackground>
  );
}

// ──────────────────────────────────────────────
// Styles
// ──────────────────────────────────────────────

const EMERGENCY_RED_GLOW = 'rgba(231, 76, 60, 0.6)';

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
  },

  // Check animation — now powered by AnimatedCheckmark SVG component
  checkContainer: {
    marginTop: Spacing.huge,
    marginBottom: Spacing.xl,
    alignItems: 'center',
  },

  // Matched text
  matchedTitle: {
    ...Typography.title1,
    color: '#FFFFFF',
    textAlign: 'center',
    marginBottom: Spacing.sm,
  },
  matchedSubtitle: {
    ...Typography.body,
    color: 'rgba(255, 255, 255, 0.55)',
    textAlign: 'center',
    marginBottom: Spacing.xxl,
  },

  // Provider card
  providerCardWrapper: {
    width: '100%',
    marginBottom: Spacing.xl,
  },
  providerCard: {
    alignItems: 'center',
  },
  providerAvatarContainer: {
    position: 'relative',
    marginBottom: Spacing.md,
  },
  providerAvatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 3,
    borderColor: Colors.emergencyRed,
  },
  providerAvatarPlaceholder: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(255, 255, 255, 0.10)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: Colors.emergencyRed,
  },
  providerAvatarInitial: {
    fontSize: FontSize.title1,
    fontWeight: FontWeight.bold,
    color: Colors.emergencyRed,
  },
  providerBadge: {
    position: 'absolute',
    bottom: -4,
    right: -8,
  },
  providerName: {
    ...Typography.title3,
    color: '#FFFFFF',
    marginBottom: Spacing.md,
  },
  providerStats: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  statItem: {
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
  },
  statValue: {
    ...Typography.headline,
    color: '#FFFFFF',
    fontWeight: FontWeight.bold,
  },
  statLabel: {
    ...Typography.caption,
    color: 'rgba(255, 255, 255, 0.5)',
    marginTop: 2,
  },
  statDivider: {
    width: 1,
    height: 30,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
  },
  specializationsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.xs,
    justifyContent: 'center',
  },
  specChip: {
    backgroundColor: 'rgba(255, 255, 255, 0.10)',
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xxs,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  specChipText: {
    ...Typography.caption,
    color: 'rgba(255, 255, 255, 0.6)',
  },

  // ETA
  etaContainer: {
    width: '100%',
    marginBottom: Spacing.lg,
  },
  etaCardBorder: {
    borderColor: 'rgba(231, 76, 60, 0.30)',
  },
  etaContent: {
    alignItems: 'center',
  },
  etaLabel: {
    ...Typography.caption,
    color: 'rgba(255, 255, 255, 0.5)',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  etaValue: {
    fontSize: 48,
    fontWeight: FontWeight.bold,
    color: Colors.emergencyRed,
  },
  etaUnit: {
    ...Typography.body,
    color: 'rgba(255, 255, 255, 0.5)',
  },

  // SLA
  slaContainer: {
    width: '100%',
    alignItems: 'center',
    marginBottom: Spacing.xl,
  },

  // CTA
  ctaContainer: {
    position: 'absolute',
    bottom: Spacing.xxl,
    left: Spacing.lg,
    right: Spacing.lg,
  },
  trackButton: {
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

export default EmergencyMatchedScreen;
