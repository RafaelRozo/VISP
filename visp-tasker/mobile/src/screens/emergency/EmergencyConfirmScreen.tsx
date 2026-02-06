/**
 * VISP/Tasker - EmergencyConfirmScreen
 *
 * Summary of emergency type + location.
 * Features:
 *   - Emergency pricing disclosure (multipliers)
 *   - SLA guarantee display (response time, arrival time)
 *   - Accept emergency pricing checkbox
 *   - Legal consent for emergency terms
 *   - "Request Emergency Help NOW" button
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
import { EMERGENCY_TYPES, EMERGENCY_CONSENT_VERSION } from '../../services/emergencyService';
import LevelBadge from '../../components/LevelBadge';
import type { EmergencyFlowParamList } from '../../types';

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

type ConfirmRouteProp = RouteProp<EmergencyFlowParamList, 'EmergencyConfirm'>;
type ConfirmNavProp = NativeStackNavigationProp<EmergencyFlowParamList, 'EmergencyConfirm'>;

// ──────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────

function EmergencyConfirmScreen(): React.JSX.Element {
  const route = useRoute<ConfirmRouteProp>();
  const navigation = useNavigation<ConfirmNavProp>();
  const { emergencyType, location } = route.params;

  const {
    sla,
    pricing,
    pricingAccepted,
    legalConsentAccepted,
    isLoadingPricing,
    isLoadingSLA,
    isSubmittingRequest,
    error,
    fetchPricingAndSLA,
    setPricingAccepted,
    setLegalConsentAccepted,
    submitEmergencyRequest,
  } = useEmergencyStore();

  // Find the emergency type config
  const typeConfig = EMERGENCY_TYPES.find((t) => t.type === emergencyType);

  // Fetch pricing and SLA on mount
  useEffect(() => {
    fetchPricingAndSLA();
  }, [fetchPricingAndSLA]);

  // Toggle pricing acceptance
  const handleTogglePricing = useCallback(() => {
    setPricingAccepted(!pricingAccepted);
  }, [pricingAccepted, setPricingAccepted]);

  // Toggle legal consent
  const handleToggleConsent = useCallback(() => {
    setLegalConsentAccepted(!legalConsentAccepted);
  }, [legalConsentAccepted, setLegalConsentAccepted]);

  // Submit emergency request
  const handleRequestHelp = useCallback(async () => {
    if (!pricingAccepted) {
      Alert.alert(
        'Pricing Acceptance Required',
        'You must accept the emergency pricing before proceeding.',
      );
      return;
    }
    if (!legalConsentAccepted) {
      Alert.alert(
        'Legal Consent Required',
        'You must accept the emergency service terms before proceeding.',
      );
      return;
    }

    try {
      const jobId = await submitEmergencyRequest();
      navigation.navigate('EmergencySearching', { jobId });
    } catch {
      Alert.alert(
        'Request Failed',
        'Unable to submit your emergency request. Please try again.',
      );
    }
  }, [
    pricingAccepted,
    legalConsentAccepted,
    submitEmergencyRequest,
    navigation,
  ]);

  const isLoading = isLoadingPricing || isLoadingSLA;
  const canSubmit = pricingAccepted && legalConsentAccepted && !isSubmittingRequest && !isLoading;

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Emergency header */}
          <View style={styles.header}>
            <View style={styles.emergencyBadge}>
              <Text style={styles.emergencyBadgeText}>EMERGENCY REQUEST</Text>
            </View>
            <Text style={styles.title}>Confirm Emergency</Text>
          </View>

          {/* Emergency summary */}
          <View style={styles.section}>
            <View style={styles.summaryCard}>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Type</Text>
                <View style={styles.summaryValueRow}>
                  <Text style={styles.summaryValue}>
                    {typeConfig?.label || emergencyType}
                  </Text>
                  <LevelBadge level={4} size="small" />
                </View>
              </View>

              <View style={styles.divider} />

              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Location</Text>
                <Text style={styles.summaryValue} numberOfLines={2}>
                  {location.formattedAddress}
                </Text>
              </View>
            </View>
          </View>

          {/* SLA guarantee */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>SLA Guarantee</Text>
            {isLoadingSLA ? (
              <ActivityIndicator size="small" color={Colors.primary} />
            ) : (
              <View style={styles.slaCard}>
                <View style={styles.slaRow}>
                  <View style={styles.slaItem}>
                    <Text style={styles.slaValue}>
                      {sla.responseTimeMinutes}
                    </Text>
                    <Text style={styles.slaUnit}>min</Text>
                    <Text style={styles.slaLabel}>Response Time</Text>
                  </View>
                  <View style={styles.slaDivider} />
                  <View style={styles.slaItem}>
                    <Text style={styles.slaValue}>
                      {sla.arrivalTimeMinutes}
                    </Text>
                    <Text style={styles.slaUnit}>min</Text>
                    <Text style={styles.slaLabel}>Arrival Time</Text>
                  </View>
                </View>
                <Text style={styles.slaGuarantee}>{sla.guaranteeText}</Text>
              </View>
            )}
          </View>

          {/* Emergency pricing disclosure */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Emergency Pricing</Text>
            {isLoadingPricing ? (
              <ActivityIndicator size="small" color={Colors.primary} />
            ) : (
              <View style={styles.pricingCard}>
                <View style={styles.pricingRow}>
                  <Text style={styles.pricingLabel}>Rate Multiplier</Text>
                  <Text style={styles.pricingValue}>
                    {pricing.baseMultiplier}x standard rate
                  </Text>
                </View>
                <View style={styles.pricingRow}>
                  <Text style={styles.pricingLabel}>Minimum Charge</Text>
                  <Text style={styles.pricingValue}>
                    ${pricing.minimumCharge}
                  </Text>
                </View>
                <View style={styles.pricingRow}>
                  <Text style={styles.pricingLabel}>Estimated Range</Text>
                  <Text style={styles.pricingValueHighlight}>
                    {pricing.estimatedRange}
                  </Text>
                </View>
                <View style={styles.pricingDivider} />
                <Text style={styles.pricingDisclosure}>
                  {pricing.disclosureText}
                </Text>
              </View>
            )}
          </View>

          {/* Pricing acceptance checkbox */}
          <View style={styles.section}>
            <TouchableOpacity
              style={styles.checkboxRow}
              onPress={handleTogglePricing}
              activeOpacity={0.7}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: pricingAccepted }}
              accessibilityLabel="Accept emergency pricing terms"
            >
              <View
                style={[
                  styles.checkbox,
                  pricingAccepted && styles.checkboxChecked,
                ]}
              >
                {pricingAccepted && (
                  <Text style={styles.checkboxCheck}>V</Text>
                )}
              </View>
              <Text style={styles.checkboxLabel}>
                I understand and accept the emergency pricing terms, including
                the {pricing.baseMultiplier}x rate multiplier and ${pricing.minimumCharge} minimum charge.
              </Text>
            </TouchableOpacity>
          </View>

          {/* Legal consent checkbox */}
          <View style={styles.section}>
            <TouchableOpacity
              style={styles.checkboxRow}
              onPress={handleToggleConsent}
              activeOpacity={0.7}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: legalConsentAccepted }}
              accessibilityLabel="Accept emergency service legal terms"
            >
              <View
                style={[
                  styles.checkbox,
                  legalConsentAccepted && styles.checkboxChecked,
                ]}
              >
                {legalConsentAccepted && (
                  <Text style={styles.checkboxCheck}>V</Text>
                )}
              </View>
              <Text style={styles.checkboxLabel}>
                I consent to the emergency service terms and conditions
                (version {EMERGENCY_CONSENT_VERSION}). I understand that an SLA snapshot
                will be created at the time of booking and terms are immutable
                after job creation. The provider cannot add scope to this job.
              </Text>
            </TouchableOpacity>
          </View>

          {/* Error */}
          {error && (
            <View style={styles.errorContainer}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          {/* Bottom padding */}
          <View style={styles.bottomPadding} />
        </ScrollView>

        {/* Request button */}
        <View style={styles.ctaContainer}>
          <TouchableOpacity
            style={[
              styles.requestButton,
              !canSubmit && styles.requestButtonDisabled,
            ]}
            onPress={handleRequestHelp}
            disabled={!canSubmit}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Request emergency help now"
            accessibilityState={{ disabled: !canSubmit }}
          >
            {isSubmittingRequest ? (
              <ActivityIndicator size="small" color={Colors.white} />
            ) : (
              <Text style={styles.requestButtonText}>
                Request Emergency Help NOW
              </Text>
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
    paddingBottom: Spacing.lg,
  },

  // Header
  header: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.md,
  },
  emergencyBadge: {
    backgroundColor: Colors.emergencyRed,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.xs,
    alignSelf: 'flex-start',
    marginBottom: Spacing.md,
  },
  emergencyBadgeText: {
    ...Typography.label,
    color: Colors.white,
    fontWeight: FontWeight.heavy,
    letterSpacing: 1,
  },
  title: {
    ...Typography.title1,
    color: Colors.textPrimary,
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

  // Summary card
  summaryCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  summaryRow: {
    marginBottom: Spacing.md,
  },
  summaryLabel: {
    ...Typography.caption,
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: Spacing.xs,
  },
  summaryValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  summaryValue: {
    ...Typography.headline,
    color: Colors.textPrimary,
  },
  divider: {
    height: 1,
    backgroundColor: Colors.divider,
    marginVertical: Spacing.sm,
  },

  // SLA
  slaCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: `${Colors.success}30`,
  },
  slaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.lg,
  },
  slaItem: {
    flex: 1,
    alignItems: 'center',
  },
  slaValue: {
    fontSize: 36,
    fontWeight: FontWeight.bold,
    color: Colors.success,
  },
  slaUnit: {
    ...Typography.caption,
    color: Colors.success,
    fontWeight: FontWeight.medium,
  },
  slaLabel: {
    ...Typography.caption,
    color: Colors.textSecondary,
    marginTop: Spacing.xs,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  slaDivider: {
    width: 1,
    height: 60,
    backgroundColor: Colors.divider,
  },
  slaGuarantee: {
    ...Typography.footnote,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },

  // Pricing
  pricingCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: `${Colors.emergencyRed}30`,
  },
  pricingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  pricingLabel: {
    ...Typography.body,
    color: Colors.textSecondary,
  },
  pricingValue: {
    ...Typography.body,
    color: Colors.textPrimary,
    fontWeight: FontWeight.semiBold,
  },
  pricingValueHighlight: {
    ...Typography.headline,
    color: Colors.emergencyRed,
    fontWeight: FontWeight.bold,
  },
  pricingDivider: {
    height: 1,
    backgroundColor: Colors.divider,
    marginVertical: Spacing.md,
  },
  pricingDisclosure: {
    ...Typography.footnote,
    color: Colors.textSecondary,
    lineHeight: 20,
  },

  // Checkboxes
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: BorderRadius.xs,
    borderWidth: 2,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing.md,
    marginTop: 2,
  },
  checkboxChecked: {
    backgroundColor: Colors.emergencyRed,
    borderColor: Colors.emergencyRed,
  },
  checkboxCheck: {
    fontSize: 14,
    color: Colors.white,
    fontWeight: FontWeight.bold,
  },
  checkboxLabel: {
    ...Typography.footnote,
    color: Colors.textSecondary,
    flex: 1,
    lineHeight: 20,
  },

  // Error
  errorContainer: {
    marginHorizontal: Spacing.lg,
    padding: Spacing.md,
    backgroundColor: `${Colors.error}15`,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    borderColor: `${Colors.error}30`,
  },
  errorText: {
    ...Typography.footnote,
    color: Colors.error,
  },

  // Bottom padding
  bottomPadding: {
    height: 100,
  },

  // CTA
  ctaContainer: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    ...Shadows.lg,
  },
  requestButton: {
    backgroundColor: Colors.emergencyRed,
    borderRadius: BorderRadius.md,
    paddingVertical: Spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    ...Shadows.md,
  },
  requestButtonDisabled: {
    backgroundColor: Colors.textDisabled,
    ...Shadows.none,
  },
  requestButtonText: {
    ...Typography.buttonLarge,
    color: Colors.white,
    fontWeight: FontWeight.bold,
    fontSize: FontSize.callout,
  },
});

export default EmergencyConfirmScreen;
