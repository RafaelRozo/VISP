/**
 * VISP/Tasker - EmergencyMatchedScreen
 *
 * Provider found notification screen.
 * Features:
 *   - Provider name, photo, rating, level badge
 *   - ETA display
 *   - Provider en-route animation
 */

import React, { useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  Animated,
  SafeAreaView,
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
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        {/* Success check animation */}
        <Animated.View
          style={[
            styles.checkContainer,
            {
              transform: [{ scale: checkAnim }],
            },
          ]}
        >
          <View style={styles.checkCircle}>
            <Text style={styles.checkIcon}>V</Text>
          </View>
        </Animated.View>

        <Text style={styles.matchedTitle}>Provider Found!</Text>
        <Text style={styles.matchedSubtitle}>
          A Level 4 emergency provider has been dispatched
        </Text>

        {/* Provider card */}
        {provider && (
          <Animated.View
            style={[
              styles.providerCard,
              {
                transform: [{ translateY: slideAnim }],
                opacity: fadeAnim,
              },
            ]}
          >
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

            {/* Specializations */}
            {provider.specializations.length > 0 && (
              <View style={styles.specializationsRow}>
                {provider.specializations.slice(0, 3).map((spec, idx) => (
                  <View key={idx} style={styles.specChip}>
                    <Text style={styles.specChipText}>{spec}</Text>
                  </View>
                ))}
              </View>
            )}
          </Animated.View>
        )}

        {/* ETA display */}
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
            <View style={styles.etaCard}>
              <Text style={styles.etaLabel}>Estimated Arrival</Text>
              <Text style={styles.etaValue}>{activeJob.etaMinutes}</Text>
              <Text style={styles.etaUnit}>minutes</Text>
            </View>
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

        {/* Proceed button */}
        <View style={styles.ctaContainer}>
          <TouchableOpacity
            style={styles.trackButton}
            onPress={handleProceedToTracking}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Track provider on map"
          >
            <Text style={styles.trackButtonText}>Track Provider</Text>
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
    paddingHorizontal: Spacing.lg,
  },

  // Check animation
  checkContainer: {
    marginTop: Spacing.huge,
    marginBottom: Spacing.xl,
  },
  checkCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: Colors.success,
    alignItems: 'center',
    justifyContent: 'center',
    ...Shadows.lg,
  },
  checkIcon: {
    fontSize: 36,
    fontWeight: FontWeight.bold,
    color: Colors.white,
  },

  // Matched text
  matchedTitle: {
    ...Typography.title1,
    color: Colors.textPrimary,
    textAlign: 'center',
    marginBottom: Spacing.sm,
  },
  matchedSubtitle: {
    ...Typography.body,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginBottom: Spacing.xxl,
  },

  // Provider card
  providerCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.xl,
    width: '100%',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: Spacing.xl,
    ...Shadows.md,
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
    borderColor: Colors.primary,
  },
  providerAvatarPlaceholder: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: Colors.surfaceLight,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: Colors.primary,
  },
  providerAvatarInitial: {
    fontSize: FontSize.title1,
    fontWeight: FontWeight.bold,
    color: Colors.primary,
  },
  providerBadge: {
    position: 'absolute',
    bottom: -4,
    right: -8,
  },
  providerName: {
    ...Typography.title3,
    color: Colors.textPrimary,
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
    color: Colors.textPrimary,
    fontWeight: FontWeight.bold,
  },
  statLabel: {
    ...Typography.caption,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  statDivider: {
    width: 1,
    height: 30,
    backgroundColor: Colors.divider,
  },
  specializationsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.xs,
    justifyContent: 'center',
  },
  specChip: {
    backgroundColor: Colors.surfaceLight,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xxs,
    borderRadius: BorderRadius.xs,
  },
  specChipText: {
    ...Typography.caption,
    color: Colors.textSecondary,
  },

  // ETA
  etaContainer: {
    width: '100%',
    marginBottom: Spacing.lg,
  },
  etaCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    padding: Spacing.lg,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: `${Colors.primary}30`,
  },
  etaLabel: {
    ...Typography.caption,
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  etaValue: {
    fontSize: 48,
    fontWeight: FontWeight.bold,
    color: Colors.primary,
  },
  etaUnit: {
    ...Typography.body,
    color: Colors.textSecondary,
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
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.md,
    paddingVertical: Spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    ...Shadows.md,
  },
  trackButtonText: {
    ...Typography.buttonLarge,
    color: Colors.white,
    fontWeight: FontWeight.bold,
  },
});

export default EmergencyMatchedScreen;
