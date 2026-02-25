/**
 * VISP - TipScreen (Glass Redesign)
 *
 * Shown after job completion. Allows the customer to tip the provider
 * with quick percentage buttons (10%, 15%, 20%) or a custom amount.
 *
 * Calls POST /api/v1/tips with { job_id, amount_cents }.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { GlassBackground, GlassCard, GlassButton, GlassInput } from '../../components/glass';
import { AnimatedCheckmark } from '../../components/animations';
import { Colors } from '../../theme/colors';
import { Spacing } from '../../theme/spacing';
import { Typography, FontWeight, FontSize } from '../../theme/typography';
import { post } from '../../services/apiClient';
import type { CustomerFlowParamList } from '../../types';

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

type TipRouteProp = RouteProp<CustomerFlowParamList, 'Tip'>;
type TipNavProp = NativeStackNavigationProp<CustomerFlowParamList, 'Tip'>;

// ──────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────

const TIP_PERCENTAGES = [
  { label: '10%', value: 0.10 },
  { label: '15%', value: 0.15 },
  { label: '20%', value: 0.20 },
];

// ──────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────

function TipScreen(): React.JSX.Element {
  const route = useRoute<TipRouteProp>();
  const navigation = useNavigation<TipNavProp>();
  const { jobId, taskName, finalPrice, providerName } = route.params;

  const [selectedPercent, setSelectedPercent] = useState<number | null>(null);
  const [customAmount, setCustomAmount] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [tipSent, setTipSent] = useState(false);

  useEffect(() => {
    navigation.setOptions({ title: 'Add a Tip' });
  }, [navigation]);

  // Compute tip amount in cents
  const tipAmountCents = useMemo(() => {
    if (selectedPercent !== null) {
      return Math.round(finalPrice * selectedPercent * 100);
    }
    const parsed = parseFloat(customAmount);
    if (!isNaN(parsed) && parsed > 0) {
      return Math.round(parsed * 100);
    }
    return 0;
  }, [selectedPercent, customAmount, finalPrice]);

  const tipAmountDisplay = (tipAmountCents / 100).toFixed(2);

  // Handle percentage button press
  const handleSelectPercent = useCallback((percent: number) => {
    setSelectedPercent(percent);
    setCustomAmount('');
  }, []);

  // Handle custom amount input
  const handleCustomAmountChange = useCallback((text: string) => {
    const cleaned = text.replace(/[^0-9.]/g, '');
    setCustomAmount(cleaned);
    setSelectedPercent(null);
  }, []);

  // Submit tip
  const handleSendTip = useCallback(async () => {
    if (tipAmountCents <= 0) {
      Alert.alert('Invalid Amount', 'Please select or enter a tip amount.');
      return;
    }

    setIsSubmitting(true);
    try {
      await post('/tips', {
        job_id: jobId,
        amount_cents: tipAmountCents,
      });
      setTipSent(true);
    } catch {
      Alert.alert('Tip Failed', 'Unable to send your tip. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }, [jobId, tipAmountCents]);

  // Skip tip
  const handleSkip = useCallback(() => {
    navigation.popToTop();
  }, [navigation]);

  // After successful tip
  const handleDone = useCallback(() => {
    navigation.popToTop();
  }, [navigation]);

  // Success state
  if (tipSent) {
    return (
      <GlassBackground>
        <View style={styles.successContainer}>
          <GlassCard variant="elevated" style={styles.successCard}>
            <View style={styles.successContent}>
              <AnimatedCheckmark size={64} color="#27AE60" />
              <View style={styles.successIconSpacer} />
              <Text style={styles.successTitle}>Tip Sent!</Text>
              <Text style={styles.successMessage}>
                Your ${tipAmountDisplay} tip has been sent
                {providerName ? ` to ${providerName}` : ''}.
                Thank you for your generosity!
              </Text>
              <GlassButton
                title="Done"
                variant="glow"
                onPress={handleDone}
                style={styles.doneButtonStyle}
              />
            </View>
          </GlassCard>
        </View>
      </GlassBackground>
    );
  }

  return (
    <GlassBackground>
      <View style={styles.container}>
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <View style={styles.section}>
            <Text style={styles.headerTitle}>Add a Tip</Text>
            {providerName && (
              <Text style={styles.headerSubtitle}>
                For {providerName}
              </Text>
            )}
          </View>

          {/* Job Summary */}
          <View style={styles.section}>
            <GlassCard variant="standard" style={styles.jobSummaryBorder}>
              <View style={styles.jobSummaryContent}>
                <Text style={styles.jobSummaryLabel}>Completed Service</Text>
                <Text style={styles.jobSummaryName}>{taskName}</Text>
                <View style={styles.jobSummaryPrice}>
                  <Text style={styles.jobSummaryPriceLabel}>Final Price</Text>
                  <Text style={styles.jobSummaryPriceValue}>
                    ${finalPrice.toFixed(2)}
                  </Text>
                </View>
              </View>
            </GlassCard>
          </View>

          {/* Quick Tip Buttons */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Quick Tip</Text>
            <View style={styles.percentRow}>
              {TIP_PERCENTAGES.map((opt) => {
                const isSelected = selectedPercent === opt.value;
                const amount = (finalPrice * opt.value).toFixed(2);
                return (
                  <TouchableOpacity
                    key={opt.label}
                    style={[
                      styles.percentButton,
                      isSelected && styles.percentButtonSelected,
                    ]}
                    onPress={() => handleSelectPercent(opt.value)}
                    activeOpacity={0.7}
                  >
                    <Text
                      style={[
                        styles.percentLabel,
                        isSelected && styles.percentLabelSelected,
                      ]}
                    >
                      {opt.label}
                    </Text>
                    <Text
                      style={[
                        styles.percentAmount,
                        isSelected && styles.percentAmountSelected,
                      ]}
                    >
                      ${amount}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* Custom Amount */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Custom Amount</Text>
            <View style={styles.customInputRow}>
              <Text style={styles.dollarSign}>$</Text>
              <GlassInput
                placeholder="0.00"
                value={customAmount}
                onChangeText={handleCustomAmountChange}
                keyboardType="decimal-pad"
                returnKeyType="done"
                accessibilityLabel="Custom tip amount"
                containerStyle={styles.customInputContainer}
                style={styles.customInputStyle}
              />
            </View>
          </View>

          {/* Tip Preview */}
          {tipAmountCents > 0 && (
            <View style={styles.section}>
              <GlassCard variant="standard" style={styles.previewCardBorder}>
                <View style={styles.previewContent}>
                  <Text style={styles.previewLabel}>Tip Amount</Text>
                  <Text style={styles.previewValue}>${tipAmountDisplay}</Text>
                </View>
              </GlassCard>
            </View>
          )}

          <View style={styles.bottomPadding} />
        </ScrollView>

        {/* CTA */}
        <View style={styles.ctaContainer}>
          <GlassButton
            title="Skip"
            variant="outline"
            onPress={handleSkip}
            style={styles.skipButtonStyle}
          />
          <GlassButton
            title={`Send $${tipAmountDisplay} Tip`}
            variant="glow"
            onPress={handleSendTip}
            disabled={tipAmountCents <= 0 || isSubmitting}
            loading={isSubmitting}
            style={styles.sendButtonStyle}
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
    marginBottom: Spacing.md,
  },

  // Header
  headerTitle: {
    fontSize: FontSize.title2,
    fontWeight: FontWeight.bold as '700',
    color: '#FFFFFF',
    marginBottom: Spacing.xs,
  },
  headerSubtitle: {
    ...Typography.body,
    color: 'rgba(255, 255, 255, 0.5)',
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
    marginBottom: Spacing.md,
  },
  jobSummaryPrice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  jobSummaryPriceLabel: {
    ...Typography.footnote,
    color: 'rgba(255, 255, 255, 0.5)',
  },
  jobSummaryPriceValue: {
    fontSize: FontSize.title3,
    fontWeight: FontWeight.bold as '700',
    color: '#FFFFFF',
  },

  // Percentage buttons (glass cards)
  percentRow: {
    flexDirection: 'row',
    gap: Spacing.md,
  },
  percentButton: {
    flex: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.07)',
    borderRadius: 16,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    alignItems: 'center',
  },
  percentButtonSelected: {
    borderColor: 'rgba(120, 80, 255, 0.6)',
    backgroundColor: 'rgba(120, 80, 255, 0.20)',
  },
  percentLabel: {
    fontSize: FontSize.headline,
    fontWeight: FontWeight.bold as '700',
    color: 'rgba(255, 255, 255, 0.5)',
    marginBottom: Spacing.xs,
  },
  percentLabelSelected: {
    color: '#FFFFFF',
  },
  percentAmount: {
    ...Typography.footnote,
    color: 'rgba(255, 255, 255, 0.35)',
  },
  percentAmountSelected: {
    color: 'rgba(120, 80, 255, 0.9)',
  },

  // Custom input
  customInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dollarSign: {
    fontSize: FontSize.title2,
    fontWeight: FontWeight.bold as '700',
    color: 'rgba(255, 255, 255, 0.5)',
    marginRight: Spacing.sm,
  },
  customInputContainer: {
    flex: 1,
  },
  customInputStyle: {
    fontSize: FontSize.title2,
    fontWeight: FontWeight.bold as '700',
  },

  // Preview
  previewCardBorder: {
    borderColor: 'rgba(120, 80, 255, 0.4)',
  },
  previewContent: {
    alignItems: 'center',
  },
  previewLabel: {
    ...Typography.label,
    color: 'rgba(255, 255, 255, 0.5)',
    marginBottom: Spacing.xs,
  },
  previewValue: {
    fontSize: FontSize.title1,
    fontWeight: FontWeight.bold as '700',
    color: Colors.primary,
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
    gap: Spacing.md,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -8 },
        shadowOpacity: 0.4,
        shadowRadius: 20,
      },
      android: { elevation: 12 },
    }),
  },
  skipButtonStyle: {
    paddingHorizontal: Spacing.xl,
  },
  sendButtonStyle: {
    flex: 1,
  },

  // Success state
  successContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xxl,
  },
  successCard: {
    width: '100%',
  },
  successContent: {
    alignItems: 'center',
  },
  successIconSpacer: {
    height: Spacing.md,
  },
  successTitle: {
    fontSize: FontSize.title2,
    fontWeight: FontWeight.bold as '700',
    color: '#FFFFFF',
    marginBottom: Spacing.md,
  },
  successMessage: {
    ...Typography.body,
    color: 'rgba(255, 255, 255, 0.6)',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: Spacing.xxl,
  },
  doneButtonStyle: {
    paddingHorizontal: Spacing.huge,
  },
});

export default TipScreen;
