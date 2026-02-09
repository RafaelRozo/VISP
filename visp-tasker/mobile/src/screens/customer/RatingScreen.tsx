/**
 * VISP/Tasker - RatingScreen
 *
 * Post-job rating screen with:
 *   - Star rating (1-5)
 *   - Predefined feedback tags (no free text -- closed catalog philosophy)
 *   - Optional text feedback area
 *   - Cost breakdown (labor, platform fee, total)
 *   - "Submit & Pay" button
 *   - Legal footer: "Tasker acts as platform intermediary only"
 *
 * For MVP: submits mock rating and navigates back to home.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Colors } from '../../theme/colors';
import { Spacing } from '../../theme/spacing';
import { Typography, FontWeight, FontSize } from '../../theme/typography';
import { BorderRadius } from '../../theme/borders';
import { Shadows } from '../../theme/shadows';
import { post } from '../../services/apiClient';
import type { CustomerFlowParamList } from '../../types';

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

type RatingRouteProp = RouteProp<CustomerFlowParamList, 'Rating'>;
type RatingNavProp = NativeStackNavigationProp<CustomerFlowParamList, 'Rating'>;

// ──────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────

const STAR_VALUES = [1, 2, 3, 4, 5] as const;

const STAR_LABELS: Record<number, string> = {
  1: 'Poor',
  2: 'Fair',
  3: 'Good',
  4: 'Very Good',
  5: 'Excellent',
};

const FEEDBACK_TAGS = [
  { id: 'on_time', label: 'On Time' },
  { id: 'professional', label: 'Professional' },
  { id: 'quality_work', label: 'Quality Work' },
  { id: 'friendly', label: 'Friendly' },
  { id: 'clean_workspace', label: 'Clean Workspace' },
  { id: 'good_communication', label: 'Good Communication' },
  { id: 'fair_pricing', label: 'Fair Pricing' },
  { id: 'would_recommend', label: 'Would Recommend' },
];

const NEGATIVE_FEEDBACK_TAGS = [
  { id: 'late_arrival', label: 'Late Arrival' },
  { id: 'unprofessional', label: 'Unprofessional' },
  { id: 'poor_quality', label: 'Poor Quality' },
  { id: 'messy_workspace', label: 'Messy Workspace' },
  { id: 'poor_communication', label: 'Poor Communication' },
  { id: 'overcharged', label: 'Overcharged' },
];

// ──────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────

function RatingScreen(): React.JSX.Element {
  const route = useRoute<RatingRouteProp>();
  const navigation = useNavigation<RatingNavProp>();
  const { jobId, taskName, finalPrice } = route.params;

  const [rating, setRating] = useState(0);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [feedbackText, setFeedbackText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Set header title
  useEffect(() => {
    navigation.setOptions({ title: 'Rate & Pay' });
  }, [navigation]);

  // Cost breakdown
  const costBreakdown = useMemo(() => {
    const labor = finalPrice * 0.85;
    const platformFee = finalPrice * 0.15;
    const tax = finalPrice * 0.13;
    const total = finalPrice + tax;
    return { labor, platformFee, tax, total };
  }, [finalPrice]);

  // Tags to show based on rating
  const visibleTags = useMemo(() => {
    if (rating >= 4) return FEEDBACK_TAGS;
    if (rating >= 1 && rating <= 2) return [...NEGATIVE_FEEDBACK_TAGS, ...FEEDBACK_TAGS.slice(0, 2)];
    return [...FEEDBACK_TAGS.slice(0, 4), ...NEGATIVE_FEEDBACK_TAGS.slice(0, 3)];
  }, [rating]);

  // Toggle tag
  const handleToggleTag = useCallback((tagId: string) => {
    setSelectedTags((prev) =>
      prev.includes(tagId)
        ? prev.filter((id) => id !== tagId)
        : [...prev, tagId],
    );
  }, []);

  // Submit
  const handleSubmit = useCallback(async () => {
    if (rating === 0) {
      Alert.alert('Rating Required', 'Please select a star rating before submitting.');
      return;
    }

    setIsSubmitting(true);

    const payload = {
      jobId,
      rating,
      tags: selectedTags,
      feedback: feedbackText.trim() || null,
    };

    try {
      await post('/jobs/' + jobId + '/rating', payload);
      Alert.alert(
        'Thank You',
        'Your rating has been submitted. Payment will be processed.',
        [
          {
            text: 'OK',
            onPress: () => {
              navigation.popToTop();
            },
          },
        ],
      );
    } catch {
      // MVP fallback
      if (__DEV__) {
        console.warn('[RatingScreen] API failed, using mock for MVP');
        Alert.alert(
          'Thank You',
          'Your rating has been submitted. Payment will be processed.',
          [
            {
              text: 'OK',
              onPress: () => {
                navigation.popToTop();
              },
            },
          ],
        );
      } else {
        Alert.alert(
          'Submission Failed',
          'Unable to submit your rating. Please try again.',
        );
      }
    } finally {
      setIsSubmitting(false);
    }
  }, [rating, selectedTags, feedbackText, jobId, navigation]);

  const isFormValid = rating > 0;

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Job Summary */}
          <View style={styles.section}>
            <View style={styles.jobSummaryCard}>
              <Text style={styles.jobSummaryLabel}>Completed Service</Text>
              <Text style={styles.jobSummaryName}>{taskName}</Text>
            </View>
          </View>

          {/* Star Rating */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>How was your experience?</Text>
            <View style={styles.starsContainer}>
              {STAR_VALUES.map((star) => {
                const isSelected = rating >= star;
                return (
                  <TouchableOpacity
                    key={star}
                    style={[
                      styles.starButton,
                      isSelected && styles.starButtonSelected,
                    ]}
                    onPress={() => setRating(star)}
                    activeOpacity={0.7}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: isSelected }}
                    accessibilityLabel={`${star} star${star > 1 ? 's' : ''}: ${STAR_LABELS[star]}`}
                  >
                    <Text
                      style={[
                        styles.starText,
                        isSelected && styles.starTextSelected,
                      ]}
                    >
                      *
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            {rating > 0 && (
              <Text style={styles.ratingLabel}>{STAR_LABELS[rating]}</Text>
            )}
          </View>

          {/* Feedback Tags */}
          {rating > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>What stood out?</Text>
              <Text style={styles.tagSubtitle}>Select any that apply</Text>
              <View style={styles.tagsContainer}>
                {visibleTags.map((tag) => {
                  const isSelected = selectedTags.includes(tag.id);
                  const isNegative = NEGATIVE_FEEDBACK_TAGS.some(
                    (n) => n.id === tag.id,
                  );
                  return (
                    <TouchableOpacity
                      key={tag.id}
                      style={[
                        styles.tagChip,
                        isSelected && !isNegative && styles.tagChipSelected,
                        isSelected && isNegative && styles.tagChipSelectedNegative,
                      ]}
                      onPress={() => handleToggleTag(tag.id)}
                      activeOpacity={0.7}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: isSelected }}
                    >
                      <Text
                        style={[
                          styles.tagChipText,
                          isSelected && !isNegative && styles.tagChipTextSelected,
                          isSelected && isNegative && styles.tagChipTextSelectedNegative,
                        ]}
                      >
                        {tag.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          )}

          {/* Optional Feedback Text */}
          {rating > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Additional Comments</Text>
              <Text style={styles.feedbackSubtitle}>Optional</Text>
              <View style={styles.feedbackInputContainer}>
                <TextInput
                  style={styles.feedbackInput}
                  placeholder="Share more about your experience..."
                  placeholderTextColor={Colors.inputPlaceholder}
                  value={feedbackText}
                  onChangeText={setFeedbackText}
                  multiline
                  numberOfLines={4}
                  maxLength={500}
                  textAlignVertical="top"
                  accessibilityLabel="Additional feedback"
                />
              </View>
              <Text style={styles.charCount}>
                {feedbackText.length}/500
              </Text>
            </View>
          )}

          {/* Cost Breakdown */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Cost Breakdown</Text>
            <View style={styles.costCard}>
              <View style={styles.costRow}>
                <Text style={styles.costLabel}>Labor</Text>
                <Text style={styles.costValue}>
                  ${costBreakdown.labor.toFixed(2)}
                </Text>
              </View>
              <View style={styles.costRow}>
                <Text style={styles.costLabel}>Platform Fee</Text>
                <Text style={styles.costValue}>
                  ${costBreakdown.platformFee.toFixed(2)}
                </Text>
              </View>
              <View style={styles.costDivider} />
              <View style={styles.costRow}>
                <Text style={styles.costLabel}>Subtotal</Text>
                <Text style={styles.costValue}>${finalPrice.toFixed(2)}</Text>
              </View>
              <View style={styles.costRow}>
                <Text style={styles.costLabel}>Tax (HST 13%)</Text>
                <Text style={styles.costValue}>
                  ${costBreakdown.tax.toFixed(2)}
                </Text>
              </View>
              <View style={styles.costDivider} />
              <View style={styles.costRow}>
                <Text style={styles.costTotalLabel}>Total</Text>
                <Text style={styles.costTotalValue}>
                  ${costBreakdown.total.toFixed(2)}
                </Text>
              </View>
            </View>
          </View>

          {/* Legal Footer */}
          <View style={styles.section}>
            <View style={styles.legalCard}>
              <Text style={styles.legalText}>
                Tasker acts as a platform intermediary only. Payment is
                processed securely through Stripe. The service provider is an
                independent professional and not an employee of Tasker.
              </Text>
            </View>
          </View>

          {/* Bottom padding for CTA */}
          <View style={styles.bottomPadding} />
        </ScrollView>

        {/* Submit CTA */}
        <View style={styles.ctaContainer}>
          <View style={styles.ctaPriceInfo}>
            <Text style={styles.ctaPriceLabel}>Total</Text>
            <Text style={styles.ctaPriceValue}>
              ${costBreakdown.total.toFixed(2)}
            </Text>
          </View>
          <TouchableOpacity
            style={[
              styles.submitButton,
              (!isFormValid || isSubmitting) && styles.submitButtonDisabled,
            ]}
            onPress={handleSubmit}
            disabled={!isFormValid || isSubmitting}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Submit rating and pay"
            accessibilityState={{ disabled: !isFormValid || isSubmitting }}
          >
            {isSubmitting ? (
              <ActivityIndicator size="small" color={Colors.white} />
            ) : (
              <Text style={styles.submitButtonText}>Submit & Pay</Text>
            )}
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
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: Spacing.lg,
  },

  // Sections
  section: {
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.xl,
  },
  sectionTitle: {
    ...Typography.headline,
    color: Colors.textPrimary,
    marginBottom: Spacing.sm,
  },

  // Job Summary
  jobSummaryCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.success,
    alignItems: 'center',
  },
  jobSummaryLabel: {
    ...Typography.label,
    color: Colors.success,
    marginBottom: Spacing.xs,
  },
  jobSummaryName: {
    ...Typography.title3,
    color: Colors.textPrimary,
    textAlign: 'center',
  },

  // Stars
  starsContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: Spacing.md,
    marginBottom: Spacing.md,
  },
  starButton: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: Colors.surface,
    borderWidth: 2,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  starButtonSelected: {
    backgroundColor: `${Colors.warning}20`,
    borderColor: Colors.warning,
  },
  starText: {
    fontSize: 24,
    color: Colors.textTertiary,
  },
  starTextSelected: {
    color: Colors.warning,
  },
  ratingLabel: {
    ...Typography.body,
    color: Colors.warning,
    fontWeight: FontWeight.semiBold as '600',
    textAlign: 'center',
  },

  // Tags
  tagSubtitle: {
    ...Typography.caption,
    color: Colors.textSecondary,
    marginBottom: Spacing.md,
  },
  tagsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  tagChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.xxl,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  tagChipSelected: {
    backgroundColor: `${Colors.primary}15`,
    borderColor: Colors.primary,
  },
  tagChipSelectedNegative: {
    backgroundColor: `${Colors.error}15`,
    borderColor: Colors.error,
  },
  tagChipText: {
    ...Typography.caption,
    color: Colors.textSecondary,
  },
  tagChipTextSelected: {
    color: Colors.primary,
  },
  tagChipTextSelectedNegative: {
    color: Colors.error,
  },

  // Feedback
  feedbackSubtitle: {
    ...Typography.caption,
    color: Colors.textTertiary,
    marginBottom: Spacing.md,
  },
  feedbackInputContainer: {
    backgroundColor: Colors.inputBackground,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    borderColor: Colors.inputBorder,
    padding: Spacing.md,
    minHeight: 100,
  },
  feedbackInput: {
    ...Typography.body,
    color: Colors.inputText,
    padding: 0,
  },
  charCount: {
    ...Typography.caption,
    color: Colors.textTertiary,
    textAlign: 'right',
    marginTop: Spacing.xs,
  },

  // Cost Breakdown
  costCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  costRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Spacing.sm,
  },
  costLabel: {
    ...Typography.footnote,
    color: Colors.textSecondary,
  },
  costValue: {
    ...Typography.footnote,
    color: Colors.textPrimary,
    fontWeight: FontWeight.medium as '500',
  },
  costDivider: {
    height: 1,
    backgroundColor: Colors.divider,
    marginVertical: Spacing.xs,
  },
  costTotalLabel: {
    ...Typography.headline,
    color: Colors.textPrimary,
  },
  costTotalValue: {
    ...Typography.headline,
    color: Colors.primary,
  },

  // Legal
  legalCard: {
    backgroundColor: Colors.surfaceLight,
    borderRadius: BorderRadius.sm,
    padding: Spacing.md,
  },
  legalText: {
    ...Typography.caption,
    color: Colors.textTertiary,
    lineHeight: 16,
    textAlign: 'center',
  },

  // Bottom padding
  bottomPadding: {
    height: 120,
  },

  // CTA
  ctaContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    ...Shadows.lg,
  },
  ctaPriceInfo: {
    flexDirection: 'column',
  },
  ctaPriceLabel: {
    ...Typography.caption,
    color: Colors.textSecondary,
  },
  ctaPriceValue: {
    fontSize: FontSize.title2,
    fontWeight: FontWeight.bold as '700',
    color: Colors.textPrimary,
  },
  submitButton: {
    backgroundColor: Colors.success,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.xxl,
    paddingVertical: Spacing.md,
    minWidth: 180,
    alignItems: 'center',
    justifyContent: 'center',
    ...Shadows.sm,
  },
  submitButtonDisabled: {
    backgroundColor: Colors.textDisabled,
    ...Shadows.none,
  },
  submitButtonText: {
    ...Typography.buttonLarge,
    color: Colors.white,
  },
});

export default RatingScreen;
