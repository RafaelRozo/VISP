/**
 * VISP - EmergencyCompletionScreen
 *
 * Job completion summary and rating.
 * Features:
 *   - Final price display
 *   - Time breakdown
 *   - Rate provider (1-5 stars + dimensions)
 *   - Payment confirmation
 *
 * Dark glassmorphism styling with red emergency accent.
 */

import React, { useEffect, useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
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
import type { EmergencyFlowParamList, RatingDimension } from '../../types';

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

type CompletionRouteProp = RouteProp<EmergencyFlowParamList, 'EmergencyCompletion'>;
type CompletionNavProp = NativeStackNavigationProp<EmergencyFlowParamList, 'EmergencyCompletion'>;

// ──────────────────────────────────────────────
// Star Rating Component
// ──────────────────────────────────────────────

interface StarRatingProps {
  value: number;
  onSelect: (rating: number) => void;
  size?: number;
}

function StarRating({ value, onSelect, size = 36 }: StarRatingProps): React.JSX.Element {
  return (
    <View style={starStyles.container}>
      {[1, 2, 3, 4, 5].map((star) => (
        <TouchableOpacity
          key={star}
          onPress={() => onSelect(star)}
          activeOpacity={0.6}
          accessibilityRole="button"
          accessibilityLabel={`Rate ${star} star${star > 1 ? 's' : ''}`}
          accessibilityState={{ selected: value >= star }}
        >
          <Text
            style={[
              starStyles.star,
              {
                fontSize: size,
                color: value >= star ? Colors.warning : 'rgba(255, 255, 255, 0.20)',
              },
            ]}
          >
            {value >= star ? '\u2605' : '\u2606'}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const starStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    gap: Spacing.sm,
    justifyContent: 'center',
  },
  star: {
    fontWeight: FontWeight.regular,
  },
});

// ──────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────

function EmergencyCompletionScreen(): React.JSX.Element {
  const route = useRoute<CompletionRouteProp>();
  const navigation = useNavigation<CompletionNavProp>();
  const { jobId } = route.params;

  const {
    activeJob,
    overallRating,
    ratingDimensions,
    isSubmittingRating,
    error,
    fetchJobStatus,
    setOverallRating,
    setRatingDimension,
    submitRating,
    confirmPayment,
    reset,
  } = useEmergencyStore();

  const [paymentConfirmed, setPaymentConfirmed] = useState(false);
  const [ratingSubmitted, setRatingSubmitted] = useState(false);

  // Load job details
  useEffect(() => {
    fetchJobStatus(jobId);
  }, [jobId, fetchJobStatus]);

  // Handle overall star rating
  const handleOverallRating = useCallback(
    (rating: number) => {
      setOverallRating(rating);
    },
    [setOverallRating],
  );

  // Handle dimension rating
  const handleDimensionRating = useCallback(
    (dimensionId: string, value: number) => {
      setRatingDimension(dimensionId, value);
    },
    [setRatingDimension],
  );

  // Submit rating
  const handleSubmitRating = useCallback(async () => {
    if (overallRating === 0) {
      Alert.alert('Rating Required', 'Please rate your overall experience.');
      return;
    }

    try {
      await submitRating(jobId);
      setRatingSubmitted(true);
    } catch {
      Alert.alert('Error', 'Unable to submit your rating. Please try again.');
    }
  }, [overallRating, submitRating, jobId]);

  // Confirm payment
  const handleConfirmPayment = useCallback(async () => {
    try {
      await confirmPayment(jobId);
      setPaymentConfirmed(true);
    } catch {
      Alert.alert('Error', 'Unable to confirm payment. Please try again.');
    }
  }, [confirmPayment, jobId]);

  // Done - go back to home
  const handleDone = useCallback(() => {
    reset();
    // Navigate back to home - in production this would reset to the customer home stack
    navigation.getParent()?.goBack();
  }, [reset, navigation]);

  const provider = activeJob?.provider;
  const timeBreakdown = activeJob?.timeBreakdown;

  return (
    <GlassBackground>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Completion header */}
        <View style={styles.header}>
          <AnimatedCheckmark size={80} color="#27AE60" />
          <Text style={styles.title}>Job Complete</Text>
          <Text style={styles.subtitle}>
            Your emergency service has been completed
          </Text>
        </View>

        {/* Final price - glass card */}
        <View style={styles.section}>
          <GlassCard variant="elevated" style={styles.priceCardBorder}>
            <View style={styles.priceContent}>
              <Text style={styles.priceLabel}>Final Price</Text>
              <Text style={styles.priceValue}>
                ${activeJob?.finalPrice?.toFixed(2) || '0.00'}
              </Text>
            </View>
          </GlassCard>
        </View>

        {/* Time breakdown - glass card */}
        {timeBreakdown && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Time Breakdown</Text>
            <GlassCard variant="dark">
              <View style={styles.breakdownRow}>
                <Text style={styles.breakdownLabel}>Response Time</Text>
                <Text style={styles.breakdownValue}>
                  {timeBreakdown.responseTimeMinutes} min
                </Text>
              </View>
              <View style={styles.breakdownRow}>
                <Text style={styles.breakdownLabel}>Travel Time</Text>
                <Text style={styles.breakdownValue}>
                  {timeBreakdown.travelTimeMinutes} min
                </Text>
              </View>
              <View style={styles.breakdownRow}>
                <Text style={styles.breakdownLabel}>Work Time</Text>
                <Text style={styles.breakdownValue}>
                  {timeBreakdown.workTimeMinutes} min
                </Text>
              </View>
              <View style={styles.breakdownDivider} />
              <View style={styles.breakdownRow}>
                <Text style={styles.breakdownLabelBold}>Total Time</Text>
                <Text style={styles.breakdownValueBold}>
                  {timeBreakdown.totalTimeMinutes} min
                </Text>
              </View>
            </GlassCard>
          </View>
        )}

        {/* Provider info - glass card */}
        {provider && (
          <View style={styles.section}>
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
                  <LevelBadge level={provider.level} size="small" />
                </View>
              </View>
            </GlassCard>
          </View>
        )}

        {/* Rating section - glass card */}
        {!ratingSubmitted ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Rate Your Experience</Text>

            <GlassCard variant="standard" style={styles.ratingCard}>
              <Text style={styles.ratingSubtitle}>Overall Rating</Text>
              <StarRating value={overallRating} onSelect={handleOverallRating} />

              {/* Dimension ratings */}
              <View style={styles.dimensionsContainer}>
                {ratingDimensions.map((dimension: RatingDimension) => (
                  <View key={dimension.id} style={styles.dimensionRow}>
                    <Text style={styles.dimensionLabel}>
                      {dimension.label}
                    </Text>
                    <StarRating
                      value={dimension.value}
                      onSelect={(value) =>
                        handleDimensionRating(dimension.id, value)
                      }
                      size={24}
                    />
                  </View>
                ))}
              </View>

              <GlassButton
                title="Submit Rating"
                onPress={handleSubmitRating}
                variant="glow"
                disabled={overallRating === 0}
                loading={isSubmittingRating}
                style={styles.submitRatingButton}
              />
            </GlassCard>
          </View>
        ) : (
          <View style={styles.section}>
            <GlassCard variant="dark" style={styles.ratingSubmittedCard}>
              <Text style={styles.ratingSubmittedText}>
                Thank you for your feedback!
              </Text>
            </GlassCard>
          </View>
        )}

        {/* Payment confirmation - glass */}
        <View style={styles.section}>
          {!paymentConfirmed ? (
            <GlassButton
              title="Confirm Payment"
              onPress={handleConfirmPayment}
              variant="glow"
              style={styles.paymentButton}
            />
          ) : (
            <GlassCard variant="dark" style={styles.paymentConfirmedCard}>
              <Text style={styles.paymentConfirmedText}>
                Payment Confirmed
              </Text>
            </GlassCard>
          )}
        </View>

        {/* Error */}
        {error && (
          <View style={styles.errorContainer}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {/* Done button - glass outline */}
        <View style={styles.section}>
          <GlassButton
            title="Done"
            onPress={handleDone}
            variant="outline"
          />
        </View>

        {/* Bottom padding */}
        <View style={styles.bottomPadding} />
      </ScrollView>
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
  },
  scrollContent: {
    paddingTop: Spacing.xl,
  },

  // Header — completion icon now uses AnimatedCheckmark SVG component
  header: {
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.xxl,
  },
  title: {
    ...Typography.title1,
    color: '#FFFFFF',
    marginBottom: Spacing.sm,
  },
  subtitle: {
    ...Typography.body,
    color: 'rgba(255, 255, 255, 0.55)',
    textAlign: 'center',
  },

  // Sections
  section: {
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.xl,
  },
  sectionTitle: {
    ...Typography.headline,
    color: '#FFFFFF',
    marginBottom: Spacing.md,
  },

  // Price - elevated glass
  priceCardBorder: {
    borderColor: 'rgba(231, 76, 60, 0.30)',
  },
  priceContent: {
    alignItems: 'center',
    paddingVertical: Spacing.md,
  },
  priceLabel: {
    ...Typography.label,
    color: 'rgba(255, 255, 255, 0.5)',
    marginBottom: Spacing.sm,
  },
  priceValue: {
    fontSize: 44,
    fontWeight: FontWeight.bold,
    color: Colors.emergencyRed,
  },

  // Breakdown
  breakdownRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Spacing.sm,
  },
  breakdownLabel: {
    ...Typography.body,
    color: 'rgba(255, 255, 255, 0.55)',
  },
  breakdownValue: {
    ...Typography.body,
    color: '#FFFFFF',
    fontWeight: FontWeight.medium,
  },
  breakdownDivider: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.10)',
    marginVertical: Spacing.sm,
  },
  breakdownLabelBold: {
    ...Typography.headline,
    color: '#FFFFFF',
  },
  breakdownValueBold: {
    ...Typography.headline,
    color: Colors.emergencyRed,
    fontWeight: FontWeight.bold,
  },

  // Provider
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
    gap: Spacing.xs,
  },
  providerName: {
    ...Typography.headline,
    color: '#FFFFFF',
  },

  // Rating
  ratingCard: {
    alignItems: 'center',
  },
  ratingSubtitle: {
    ...Typography.body,
    color: 'rgba(255, 255, 255, 0.55)',
    marginBottom: Spacing.lg,
  },
  dimensionsContainer: {
    width: '100%',
    marginTop: Spacing.xl,
    gap: Spacing.md,
  },
  dimensionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  dimensionLabel: {
    ...Typography.footnote,
    color: 'rgba(255, 255, 255, 0.55)',
    flex: 1,
  },
  submitRatingButton: {
    backgroundColor: 'rgba(231, 76, 60, 0.8)',
    marginTop: Spacing.xl,
    paddingHorizontal: Spacing.xxl,
    ...Platform.select({
      ios: {
        shadowColor: EMERGENCY_RED_GLOW,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 1,
        shadowRadius: 16,
      },
      android: { elevation: 8 },
    }),
  },
  ratingSubmittedCard: {
    borderColor: 'rgba(39, 174, 96, 0.30)',
    alignItems: 'center',
  },
  ratingSubmittedText: {
    ...Typography.headline,
    color: Colors.success,
  },

  // Payment
  paymentButton: {
    backgroundColor: 'rgba(39, 174, 96, 0.8)',
    paddingVertical: 16,
    ...Platform.select({
      ios: {
        shadowColor: 'rgba(39, 174, 96, 0.6)',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 1,
        shadowRadius: 16,
      },
      android: { elevation: 8 },
    }),
  },
  paymentConfirmedCard: {
    borderColor: 'rgba(39, 174, 96, 0.30)',
    alignItems: 'center',
  },
  paymentConfirmedText: {
    ...Typography.headline,
    color: Colors.success,
  },

  // Error
  errorContainer: {
    marginHorizontal: Spacing.lg,
    padding: Spacing.md,
    backgroundColor: 'rgba(231, 76, 60, 0.12)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(231, 76, 60, 0.30)',
    marginBottom: Spacing.lg,
  },
  errorText: {
    ...Typography.footnote,
    color: Colors.emergencyRed,
  },

  // Bottom padding
  bottomPadding: {
    height: Spacing.massive,
  },
});

export default EmergencyCompletionScreen;
