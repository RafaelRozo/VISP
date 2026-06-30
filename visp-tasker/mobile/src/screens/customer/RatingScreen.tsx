/**
 * VISP - RatingScreen (Glass Redesign)
 *
 * Post-job rating screen with:
 *   - Star rating (1-5) in glass card
 *   - Predefined feedback tags (no free text -- closed catalog philosophy)
 *   - Optional text feedback area with GlassInput
 *   - Cost breakdown in glass card
 *   - "Submit & Pay" glow button
 *   - Legal footer
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { GlassBackground, GlassCard, GlassButton, GlassInput } from '../../components/glass';
import { AnimatedSpinner } from '../../components/animations';
import { Colors } from '../../theme/colors';
import { Spacing } from '../../theme/spacing';
import { Typography, FontWeight, FontSize } from '../../theme/typography';
import { BorderRadius } from '../../theme/borders';
import { GlassStyles } from '../../theme/glass';
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
    const feeRate = (route.params as any)?.platformFeeRate ?? 0.15;
    const taxRate = (route.params as any)?.taxRate ?? 0.13;

    const platformFee = finalPrice * feeRate;
    const labor = finalPrice - platformFee;
    const tax = finalPrice * taxRate;
    const total = finalPrice + tax;
    return { labor, platformFee, tax, total };
  }, [finalPrice, route.params]);

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
        'Your rating has been submitted. Would you like to add a tip for your provider?',
        [
          {
            text: 'No Thanks',
            style: 'cancel',
            onPress: () => {
              navigation.popToTop();
            },
          },
          {
            text: 'Add Tip',
            onPress: () => {
              navigation.navigate('Tip', {
                jobId,
                taskName,
                finalPrice,
              });
            },
          },
        ],
      );
    } catch {
      Alert.alert(
        'Submission Failed',
        'Unable to submit your rating. Please try again.',
      );
    } finally {
      setIsSubmitting(false);
    }
  }, [rating, selectedTags, feedbackText, jobId, navigation]);

  const isFormValid = rating > 0;

  return (
    <GlassBackground>
      <View style={styles.container}>
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Job Summary */}
          <View style={styles.section}>
            <GlassCard variant="standard" style={styles.jobSummaryBorder}>
              <View style={styles.jobSummaryContent}>
                <Text style={styles.jobSummaryLabel}>Completed Service</Text>
                <Text style={styles.jobSummaryName}>{taskName}</Text>
              </View>
            </GlassCard>
          </View>

          {/* Star Rating */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>How was your experience?</Text>
            <GlassCard variant="dark">
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
            </GlassCard>
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
              <GlassInput
                placeholder="Share more about your experience..."
                value={feedbackText}
                onChangeText={setFeedbackText}
                multiline
                numberOfLines={4}
                maxLength={500}
                textAlignVertical="top"
                accessibilityLabel="Additional feedback"
                containerStyle={styles.feedbackContainer}
                style={styles.feedbackInput}
              />
              <Text style={styles.charCount}>
                {feedbackText.length}/500
              </Text>
            </View>
          )}

          {/* Cost Breakdown */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Cost Breakdown</Text>
            <GlassCard variant="dark">
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
            </GlassCard>
          </View>

          {/* Legal Footer */}
          <View style={styles.section}>
            <View style={styles.legalCard}>
              <Text style={styles.legalText}>
                VISP acts as a platform intermediary only. Payment is
                processed securely through Stripe. The service provider is an
                independent professional and not an employee of VISP.
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
          <GlassButton
            title="Submit & Pay"
            variant="glow"
            onPress={handleSubmit}
            disabled={!isFormValid || isSubmitting}
            loading={isSubmitting}
            style={styles.submitButtonStyle}
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
    color: '#FFFFFF',
    marginBottom: Spacing.sm,
  },

  // Job Summary
  jobSummaryBorder: {
    borderColor: 'rgba(39, 174, 96, 0.4)',
  },
  jobSummaryContent: {
    alignItems: 'center',
  },
  jobSummaryLabel: {
    ...Typography.label,
    color: Colors.success,
    marginBottom: Spacing.xs,
  },
  jobSummaryName: {
    ...Typography.title3,
    color: '#FFFFFF',
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
    backgroundColor: 'rgba(255, 255, 255, 0.07)',
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  starButtonSelected: {
    backgroundColor: 'rgba(243, 156, 18, 0.20)',
    borderColor: 'rgba(243, 156, 18, 0.6)',
  },
  starText: {
    fontSize: 24,
    color: 'rgba(255, 255, 255, 0.3)',
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
    color: 'rgba(255, 255, 255, 0.4)',
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
    backgroundColor: 'rgba(255, 255, 255, 0.07)',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  tagChipSelected: {
    backgroundColor: 'rgba(120, 80, 255, 0.20)',
    borderColor: 'rgba(120, 80, 255, 0.5)',
  },
  tagChipSelectedNegative: {
    backgroundColor: 'rgba(231, 76, 60, 0.15)',
    borderColor: 'rgba(231, 76, 60, 0.5)',
  },
  tagChipText: {
    ...Typography.caption,
    color: 'rgba(255, 255, 255, 0.5)',
  },
  tagChipTextSelected: {
    color: 'rgba(120, 80, 255, 0.9)',
  },
  tagChipTextSelectedNegative: {
    color: Colors.error,
  },

  // Feedback
  feedbackSubtitle: {
    ...Typography.caption,
    color: 'rgba(255, 255, 255, 0.3)',
    marginBottom: Spacing.md,
  },
  feedbackContainer: {
    // container for GlassInput
  },
  feedbackInput: {
    minHeight: 100,
  },
  charCount: {
    ...Typography.caption,
    color: 'rgba(255, 255, 255, 0.3)',
    textAlign: 'right',
    marginTop: Spacing.xs,
  },

  // Cost Breakdown
  costRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Spacing.sm,
  },
  costLabel: {
    ...Typography.footnote,
    color: 'rgba(255, 255, 255, 0.5)',
  },
  costValue: {
    ...Typography.footnote,
    color: '#FFFFFF',
    fontWeight: FontWeight.medium as '500',
  },
  costDivider: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.10)',
    marginVertical: Spacing.xs,
  },
  costTotalLabel: {
    ...Typography.headline,
    color: '#FFFFFF',
  },
  costTotalValue: {
    ...Typography.headline,
    color: Colors.primary,
  },

  // Legal
  legalCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: BorderRadius.sm,
    padding: Spacing.md,
  },
  legalText: {
    ...Typography.caption,
    color: 'rgba(255, 255, 255, 0.3)',
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
    backgroundColor: 'rgba(10, 10, 30, 0.85)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
  },
  ctaPriceInfo: {
    flexDirection: 'column',
  },
  ctaPriceLabel: {
    ...Typography.caption,
    color: 'rgba(255, 255, 255, 0.4)',
  },
  ctaPriceValue: {
    fontSize: FontSize.title2,
    fontWeight: FontWeight.bold as '700',
    color: '#FFFFFF',
  },
  submitButtonStyle: {
    minWidth: 180,
  },
});

export default RatingScreen;
