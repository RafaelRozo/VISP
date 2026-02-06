/**
 * VISP/Tasker - EmergencyCompletionScreen
 *
 * Job completion summary and rating.
 * Features:
 *   - Final price display
 *   - Time breakdown
 *   - Rate provider (1-5 stars + dimensions)
 *   - Payment confirmation
 */

import React, { useEffect, useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  SafeAreaView,
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
                color: value >= star ? Colors.warning : Colors.textTertiary,
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
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Completion header */}
        <View style={styles.header}>
          <View style={styles.completionIcon}>
            <Text style={styles.completionIconText}>V</Text>
          </View>
          <Text style={styles.title}>Job Complete</Text>
          <Text style={styles.subtitle}>
            Your emergency service has been completed
          </Text>
        </View>

        {/* Final price */}
        <View style={styles.section}>
          <View style={styles.priceCard}>
            <Text style={styles.priceLabel}>Final Price</Text>
            <Text style={styles.priceValue}>
              ${activeJob?.finalPrice?.toFixed(2) || '0.00'}
            </Text>
          </View>
        </View>

        {/* Time breakdown */}
        {timeBreakdown && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Time Breakdown</Text>
            <View style={styles.breakdownCard}>
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
            </View>
          </View>
        )}

        {/* Provider info */}
        {provider && (
          <View style={styles.section}>
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
                  <LevelBadge level={provider.level} size="small" />
                </View>
              </View>
            </View>
          </View>
        )}

        {/* Rating section */}
        {!ratingSubmitted ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Rate Your Experience</Text>

            {/* Overall rating */}
            <View style={styles.ratingCard}>
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

              <TouchableOpacity
                style={[
                  styles.submitRatingButton,
                  overallRating === 0 && styles.submitRatingButtonDisabled,
                ]}
                onPress={handleSubmitRating}
                disabled={overallRating === 0 || isSubmittingRating}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="Submit rating"
              >
                {isSubmittingRating ? (
                  <ActivityIndicator size="small" color={Colors.white} />
                ) : (
                  <Text style={styles.submitRatingText}>Submit Rating</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <View style={styles.section}>
            <View style={styles.ratingSubmittedCard}>
              <Text style={styles.ratingSubmittedText}>
                Thank you for your feedback!
              </Text>
            </View>
          </View>
        )}

        {/* Payment confirmation */}
        <View style={styles.section}>
          {!paymentConfirmed ? (
            <TouchableOpacity
              style={styles.paymentButton}
              onPress={handleConfirmPayment}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Confirm payment"
            >
              <Text style={styles.paymentButtonText}>Confirm Payment</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.paymentConfirmedCard}>
              <Text style={styles.paymentConfirmedText}>
                Payment Confirmed
              </Text>
            </View>
          )}
        </View>

        {/* Error */}
        {error && (
          <View style={styles.errorContainer}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {/* Done button */}
        <View style={styles.section}>
          <TouchableOpacity
            style={styles.doneButton}
            onPress={handleDone}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Return to home"
          >
            <Text style={styles.doneButtonText}>Done</Text>
          </TouchableOpacity>
        </View>

        {/* Bottom padding */}
        <View style={styles.bottomPadding} />
      </ScrollView>
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
  scrollContent: {
    paddingTop: Spacing.xl,
  },

  // Header
  header: {
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.xxl,
  },
  completionIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: Colors.success,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.lg,
    ...Shadows.md,
  },
  completionIconText: {
    fontSize: 28,
    fontWeight: FontWeight.bold,
    color: Colors.white,
  },
  title: {
    ...Typography.title1,
    color: Colors.textPrimary,
    marginBottom: Spacing.sm,
  },
  subtitle: {
    ...Typography.body,
    color: Colors.textSecondary,
    textAlign: 'center',
  },

  // Sections
  section: {
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.xl,
  },
  sectionTitle: {
    ...Typography.headline,
    color: Colors.textPrimary,
    marginBottom: Spacing.md,
  },

  // Price
  priceCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    padding: Spacing.xxl,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.primary,
  },
  priceLabel: {
    ...Typography.label,
    color: Colors.textSecondary,
    marginBottom: Spacing.sm,
  },
  priceValue: {
    fontSize: 44,
    fontWeight: FontWeight.bold,
    color: Colors.primary,
  },

  // Breakdown
  breakdownCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  breakdownRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Spacing.sm,
  },
  breakdownLabel: {
    ...Typography.body,
    color: Colors.textSecondary,
  },
  breakdownValue: {
    ...Typography.body,
    color: Colors.textPrimary,
    fontWeight: FontWeight.medium,
  },
  breakdownDivider: {
    height: 1,
    backgroundColor: Colors.divider,
    marginVertical: Spacing.sm,
  },
  breakdownLabelBold: {
    ...Typography.headline,
    color: Colors.textPrimary,
  },
  breakdownValueBold: {
    ...Typography.headline,
    color: Colors.primary,
    fontWeight: FontWeight.bold,
  },

  // Provider
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
    gap: Spacing.xs,
  },
  providerName: {
    ...Typography.headline,
    color: Colors.textPrimary,
  },

  // Rating
  ratingCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    padding: Spacing.xl,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
  },
  ratingSubtitle: {
    ...Typography.body,
    color: Colors.textSecondary,
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
    color: Colors.textSecondary,
    flex: 1,
  },
  submitRatingButton: {
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.md,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xxl,
    marginTop: Spacing.xl,
    minWidth: 180,
    alignItems: 'center',
  },
  submitRatingButtonDisabled: {
    backgroundColor: Colors.textDisabled,
  },
  submitRatingText: {
    ...Typography.buttonLarge,
    color: Colors.white,
  },
  ratingSubmittedCard: {
    backgroundColor: `${Colors.success}10`,
    borderRadius: BorderRadius.md,
    padding: Spacing.lg,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: `${Colors.success}30`,
  },
  ratingSubmittedText: {
    ...Typography.headline,
    color: Colors.success,
  },

  // Payment
  paymentButton: {
    backgroundColor: Colors.success,
    borderRadius: BorderRadius.md,
    paddingVertical: Spacing.lg,
    alignItems: 'center',
    ...Shadows.md,
  },
  paymentButtonText: {
    ...Typography.buttonLarge,
    color: Colors.white,
    fontWeight: FontWeight.bold,
  },
  paymentConfirmedCard: {
    backgroundColor: `${Colors.success}10`,
    borderRadius: BorderRadius.md,
    padding: Spacing.lg,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: `${Colors.success}30`,
  },
  paymentConfirmedText: {
    ...Typography.headline,
    color: Colors.success,
  },

  // Error
  errorContainer: {
    marginHorizontal: Spacing.lg,
    padding: Spacing.md,
    backgroundColor: `${Colors.error}15`,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    borderColor: `${Colors.error}30`,
    marginBottom: Spacing.lg,
  },
  errorText: {
    ...Typography.footnote,
    color: Colors.error,
  },

  // Done
  doneButton: {
    backgroundColor: 'transparent',
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.textTertiary,
    paddingVertical: Spacing.lg,
    alignItems: 'center',
  },
  doneButtonText: {
    ...Typography.buttonLarge,
    color: Colors.textSecondary,
  },

  // Bottom padding
  bottomPadding: {
    height: Spacing.massive,
  },
});

export default EmergencyCompletionScreen;
