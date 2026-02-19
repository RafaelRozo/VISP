/**
 * VISP - EmergencyConfirmScreen
 *
 * Summary of emergency type + location.
 * Features:
 *   - Emergency pricing disclosure (multipliers)
 *   - SLA guarantee display (response time, arrival time)
 *   - Accept emergency pricing checkbox
 *   - Legal consent for emergency terms
 *   - "Request Emergency Help NOW" button
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
import { AnimatedSpinner } from '../../components/animations';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { GlassBackground, GlassCard, GlassButton } from '../../components/glass';
import { GlassStyles, Colors } from '../../theme';
import { Spacing } from '../../theme/spacing';
import { Typography, FontWeight, FontSize } from '../../theme/typography';
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
    <GlassBackground>
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
          <GlassCard variant="dark">
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
          </GlassCard>
        </View>

        {/* SLA guarantee */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>SLA Guarantee</Text>
          {isLoadingSLA ? (
            <AnimatedSpinner size={24} color={Colors.emergencyRed} />
          ) : (
            <GlassCard variant="standard" style={styles.slaCardBorder}>
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
            </GlassCard>
          )}
        </View>

        {/* Emergency pricing disclosure */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Emergency Pricing</Text>
          {isLoadingPricing ? (
            <AnimatedSpinner size={24} color={Colors.emergencyRed} />
          ) : (
            <GlassCard variant="standard" style={styles.pricingCardBorder}>
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
            </GlassCard>
          )}
        </View>

        {/* Pricing acceptance checkbox - glass */}
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

        {/* Legal consent checkbox - glass */}
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

      {/* Request button - glass CTA bar */}
      <View style={styles.ctaContainer}>
        <GlassButton
          title={isSubmittingRequest ? '' : 'Request Emergency Help NOW'}
          onPress={handleRequestHelp}
          variant="glow"
          disabled={!canSubmit}
          loading={isSubmittingRequest}
          style={styles.requestButton}
        />
      </View>
    </GlassBackground>
  );
}

// ──────────────────────────────────────────────
// Styles
// ──────────────────────────────────────────────

const EMERGENCY_RED = 'rgba(231, 76, 60, 1)';
const EMERGENCY_RED_GLOW = 'rgba(231, 76, 60, 0.6)';
const EMERGENCY_RED_BORDER = 'rgba(231, 76, 60, 0.30)';

const styles = StyleSheet.create({
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
    backgroundColor: 'rgba(231, 76, 60, 0.8)',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: 8,
    alignSelf: 'flex-start',
    marginBottom: Spacing.md,
    ...Platform.select({
      ios: {
        shadowColor: EMERGENCY_RED_GLOW,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 1,
        shadowRadius: 12,
      },
      android: { elevation: 6 },
    }),
  },
  emergencyBadgeText: {
    ...Typography.label,
    color: '#FFFFFF',
    fontWeight: FontWeight.heavy,
    letterSpacing: 1,
  },
  title: {
    ...Typography.title1,
    color: '#FFFFFF',
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

  // Summary card
  summaryRow: {
    marginBottom: Spacing.md,
  },
  summaryLabel: {
    ...Typography.caption,
    color: 'rgba(255, 255, 255, 0.5)',
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
    color: '#FFFFFF',
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.10)',
    marginVertical: Spacing.sm,
  },

  // SLA
  slaCardBorder: {
    borderColor: 'rgba(39, 174, 96, 0.30)',
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
    color: 'rgba(255, 255, 255, 0.5)',
    marginTop: Spacing.xs,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  slaDivider: {
    width: 1,
    height: 60,
    backgroundColor: 'rgba(255, 255, 255, 0.10)',
  },
  slaGuarantee: {
    ...Typography.footnote,
    color: 'rgba(255, 255, 255, 0.5)',
    textAlign: 'center',
    lineHeight: 20,
  },

  // Pricing
  pricingCardBorder: {
    borderColor: EMERGENCY_RED_BORDER,
  },
  pricingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  pricingLabel: {
    ...Typography.body,
    color: 'rgba(255, 255, 255, 0.6)',
  },
  pricingValue: {
    ...Typography.body,
    color: '#FFFFFF',
    fontWeight: FontWeight.semiBold,
  },
  pricingValueHighlight: {
    ...Typography.headline,
    color: Colors.emergencyRed,
    fontWeight: FontWeight.bold,
  },
  pricingDivider: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.10)',
    marginVertical: Spacing.md,
  },
  pricingDisclosure: {
    ...Typography.footnote,
    color: 'rgba(255, 255, 255, 0.5)',
    lineHeight: 20,
  },

  // Checkboxes - glass styled
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 16,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.25)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing.md,
    marginTop: 2,
  },
  checkboxChecked: {
    backgroundColor: 'rgba(231, 76, 60, 0.8)',
    borderColor: Colors.emergencyRed,
    ...Platform.select({
      ios: {
        shadowColor: EMERGENCY_RED_GLOW,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 1,
        shadowRadius: 8,
      },
      android: { elevation: 4 },
    }),
  },
  checkboxCheck: {
    fontSize: 14,
    color: '#FFFFFF',
    fontWeight: FontWeight.bold,
  },
  checkboxLabel: {
    ...Typography.footnote,
    color: 'rgba(255, 255, 255, 0.55)',
    flex: 1,
    lineHeight: 20,
  },

  // Error
  errorContainer: {
    marginHorizontal: Spacing.lg,
    padding: Spacing.md,
    backgroundColor: 'rgba(231, 76, 60, 0.12)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: EMERGENCY_RED_BORDER,
  },
  errorText: {
    ...Typography.footnote,
    color: Colors.emergencyRed,
  },

  // Bottom padding
  bottomPadding: {
    height: 100,
  },

  // CTA - glass bar
  ctaContainer: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    backgroundColor: 'rgba(10, 10, 30, 0.80)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
  },
  requestButton: {
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

export default EmergencyConfirmScreen;
