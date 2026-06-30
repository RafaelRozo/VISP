/**
 * VISP - EmergencyCancelScreen
 *
 * Cancellation confirmation screen.
 * Features:
 *   - Cancellation fee notice
 *   - Reason selection (predefined options)
 *   - "Confirm Cancel" button
 *
 * Dark glassmorphism styling with red emergency accent.
 */

import React, { useCallback, useState } from 'react';
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
import { GlassStyles, Colors } from '../../theme';
import { Spacing } from '../../theme/spacing';
import { Typography, FontWeight, FontSize } from '../../theme/typography';
import { useEmergencyStore } from '../../stores/emergencyStore';
import { CANCELLATION_REASONS } from '../../services/emergencyService';
import type { EmergencyFlowParamList, CancellationReason } from '../../types';

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

type CancelRouteProp = RouteProp<EmergencyFlowParamList, 'EmergencyCancel'>;
type CancelNavProp = NativeStackNavigationProp<EmergencyFlowParamList, 'EmergencyCancel'>;

// ──────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────

function EmergencyCancelScreen(): React.JSX.Element {
  const route = useRoute<CancelRouteProp>();
  const navigation = useNavigation<CancelNavProp>();
  const { jobId } = route.params;

  const {
    selectedCancellationReason,
    isCancelling,
    cancellationFee,
    jobStatus,
    error,
    setSelectedCancellationReason,
    cancelJob,
    reset,
  } = useEmergencyStore();

  const [cancelled, setCancelled] = useState(jobStatus === 'cancelled');

  // Select reason
  const handleSelectReason = useCallback(
    (reasonId: string) => {
      setSelectedCancellationReason(reasonId);
    },
    [setSelectedCancellationReason],
  );

  // Confirm cancellation
  const handleConfirmCancel = useCallback(async () => {
    if (!selectedCancellationReason) {
      Alert.alert('Reason Required', 'Please select a cancellation reason.');
      return;
    }

    Alert.alert(
      'Confirm Cancellation',
      'Are you sure you want to cancel this emergency request? A cancellation fee may apply.',
      [
        { text: 'Keep Request', style: 'cancel' },
        {
          text: 'Cancel Request',
          style: 'destructive',
          onPress: async () => {
            try {
              await cancelJob(jobId, selectedCancellationReason);
              setCancelled(true);
            } catch {
              Alert.alert('Error', 'Unable to cancel. Please try again.');
            }
          },
        },
      ],
    );
  }, [selectedCancellationReason, cancelJob, jobId]);

  // Go back
  const handleGoBack = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  // Done - go home
  const handleDone = useCallback(() => {
    reset();
    navigation.getParent()?.goBack();
  }, [reset, navigation]);

  // Already cancelled
  if (cancelled) {
    return (
      <GlassBackground>
        <View style={styles.cancelledContainer}>
          <View style={styles.cancelledIcon}>
            <Text style={styles.cancelledIconText}>X</Text>
          </View>
          <Text style={styles.cancelledTitle}>Request Cancelled</Text>
          <Text style={styles.cancelledDescription}>
            Your emergency request has been cancelled.
          </Text>

          {cancellationFee > 0 && (
            <GlassCard variant="dark" style={styles.feeCard}>
              <Text style={styles.feeLabel}>Cancellation Fee</Text>
              <Text style={styles.feeValue}>
                ${cancellationFee.toFixed(2)}
              </Text>
              <Text style={styles.feeNote}>
                This fee will be charged to your payment method on file.
              </Text>
            </GlassCard>
          )}

          <GlassButton
            title="Return Home"
            onPress={handleDone}
            variant="glow"
            style={styles.doneButton}
          />
        </View>
      </GlassBackground>
    );
  }

  return (
    <GlassBackground>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Cancel Emergency Request?</Text>
          <Text style={styles.subtitle}>
            Are you sure you want to cancel? If a provider has already been
            dispatched, a cancellation fee may apply.
          </Text>
        </View>

        {/* Cancellation fee warning - glass card with red tint */}
        <View style={styles.section}>
          <GlassCard variant="dark" style={styles.warningCard}>
            <Text style={styles.warningTitle}>Cancellation Fee</Text>
            <Text style={styles.warningText}>
              Depending on the status of your request, a cancellation fee
              of up to $50 may be charged. If the provider has already been
              dispatched and is en route, the fee covers their travel costs.
            </Text>
          </GlassCard>
        </View>

        {/* Reason selection - glass list items */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Reason for cancellation</Text>
          <View style={styles.reasonsContainer}>
            {CANCELLATION_REASONS.map((reason: CancellationReason) => {
              const isSelected = selectedCancellationReason === reason.id;
              return (
                <TouchableOpacity
                  key={reason.id}
                  style={[
                    styles.reasonCard,
                    isSelected && styles.reasonCardSelected,
                  ]}
                  onPress={() => handleSelectReason(reason.id)}
                  activeOpacity={0.7}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: isSelected }}
                  accessibilityLabel={reason.label}
                >
                  <View
                    style={[
                      styles.reasonRadio,
                      isSelected && styles.reasonRadioSelected,
                    ]}
                  >
                    {isSelected && <View style={styles.reasonRadioInner} />}
                  </View>
                  <Text
                    style={[
                      styles.reasonText,
                      isSelected && styles.reasonTextSelected,
                    ]}
                  >
                    {reason.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Error */}
        {error && (
          <View style={styles.errorContainer}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}
      </ScrollView>

      {/* Action buttons - glass CTA bar */}
      <View style={styles.ctaContainer}>
        <GlassButton
          title="Keep Request"
          onPress={handleGoBack}
          variant="glow"
          style={styles.keepButton}
        />

        <GlassButton
          title={isCancelling ? '' : 'Confirm Cancel'}
          onPress={handleConfirmCancel}
          variant="outline"
          disabled={!selectedCancellationReason || isCancelling}
          loading={isCancelling}
          style={styles.cancelConfirmButton}
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
    paddingBottom: Spacing.xxl,
  },

  // Header
  header: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.xl,
    paddingBottom: Spacing.lg,
  },
  title: {
    ...Typography.title1,
    color: '#FFFFFF',
    marginBottom: Spacing.md,
  },
  subtitle: {
    ...Typography.body,
    color: 'rgba(255, 255, 255, 0.55)',
    lineHeight: 22,
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

  // Warning - glass card with red border
  warningCard: {
    borderColor: EMERGENCY_RED_BORDER,
  },
  warningTitle: {
    ...Typography.headline,
    color: Colors.emergencyRed,
    marginBottom: Spacing.sm,
  },
  warningText: {
    ...Typography.footnote,
    color: 'rgba(255, 255, 255, 0.55)',
    lineHeight: 20,
  },

  // Reasons - glass list items
  reasonsContainer: {
    gap: Spacing.sm,
  },
  reasonCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 16,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  reasonCardSelected: {
    borderColor: Colors.emergencyRed,
    backgroundColor: 'rgba(231, 76, 60, 0.08)',
    ...Platform.select({
      ios: {
        shadowColor: EMERGENCY_RED_GLOW,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.5,
        shadowRadius: 12,
      },
      android: { elevation: 4 },
    }),
  },
  reasonRadio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.25)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing.md,
  },
  reasonRadioSelected: {
    borderColor: Colors.emergencyRed,
  },
  reasonRadioInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: Colors.emergencyRed,
    ...Platform.select({
      ios: {
        shadowColor: EMERGENCY_RED_GLOW,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 1,
        shadowRadius: 6,
      },
      android: { elevation: 3 },
    }),
  },
  reasonText: {
    ...Typography.body,
    color: '#FFFFFF',
    flex: 1,
  },
  reasonTextSelected: {
    color: Colors.emergencyRed,
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

  // CTA - glass bar
  ctaContainer: {
    flexDirection: 'row',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    backgroundColor: 'rgba(10, 10, 30, 0.80)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
  },
  keepButton: {
    flex: 1,
    backgroundColor: 'rgba(231, 76, 60, 0.8)',
    ...Platform.select({
      ios: {
        shadowColor: EMERGENCY_RED_GLOW,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 1,
        shadowRadius: 16,
      },
      android: { elevation: 6 },
    }),
  },
  cancelConfirmButton: {
    flex: 1,
    borderColor: EMERGENCY_RED_BORDER,
  },

  // Cancelled state
  cancelledContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xxl,
  },
  cancelledIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(231, 76, 60, 0.8)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.xl,
    borderWidth: 1,
    borderColor: EMERGENCY_RED_BORDER,
    ...Platform.select({
      ios: {
        shadowColor: EMERGENCY_RED_GLOW,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 1,
        shadowRadius: 20,
      },
      android: { elevation: 10 },
    }),
  },
  cancelledIconText: {
    fontSize: 32,
    fontWeight: FontWeight.bold,
    color: '#FFFFFF',
  },
  cancelledTitle: {
    ...Typography.title1,
    color: '#FFFFFF',
    marginBottom: Spacing.md,
    textAlign: 'center',
  },
  cancelledDescription: {
    ...Typography.body,
    color: 'rgba(255, 255, 255, 0.55)',
    textAlign: 'center',
    marginBottom: Spacing.xxl,
  },
  feeCard: {
    width: '100%',
    alignItems: 'center',
    borderColor: EMERGENCY_RED_BORDER,
    marginBottom: Spacing.xxl,
  },
  feeLabel: {
    ...Typography.label,
    color: 'rgba(255, 255, 255, 0.5)',
    marginBottom: Spacing.sm,
  },
  feeValue: {
    fontSize: FontSize.title1,
    fontWeight: FontWeight.bold,
    color: Colors.emergencyRed,
    marginBottom: Spacing.sm,
  },
  feeNote: {
    ...Typography.caption,
    color: 'rgba(255, 255, 255, 0.4)',
    textAlign: 'center',
  },
  doneButton: {
    backgroundColor: 'rgba(231, 76, 60, 0.8)',
    paddingHorizontal: Spacing.giant,
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

export default EmergencyCancelScreen;
