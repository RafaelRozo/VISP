/**
 * VISP/Tasker - EmergencyCancelScreen
 *
 * Cancellation confirmation screen.
 * Features:
 *   - Cancellation fee notice
 *   - Reason selection (predefined options)
 *   - "Confirm Cancel" button
 */

import React, { useCallback, useState } from 'react';
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
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.cancelledContainer}>
          <View style={styles.cancelledIcon}>
            <Text style={styles.cancelledIconText}>X</Text>
          </View>
          <Text style={styles.cancelledTitle}>Request Cancelled</Text>
          <Text style={styles.cancelledDescription}>
            Your emergency request has been cancelled.
          </Text>

          {cancellationFee > 0 && (
            <View style={styles.feeCard}>
              <Text style={styles.feeLabel}>Cancellation Fee</Text>
              <Text style={styles.feeValue}>
                ${cancellationFee.toFixed(2)}
              </Text>
              <Text style={styles.feeNote}>
                This fee will be charged to your payment method on file.
              </Text>
            </View>
          )}

          <TouchableOpacity
            style={styles.doneButton}
            onPress={handleDone}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Return to home screen"
          >
            <Text style={styles.doneButtonText}>Return Home</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
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

          {/* Cancellation fee warning */}
          <View style={styles.section}>
            <View style={styles.warningCard}>
              <Text style={styles.warningTitle}>Cancellation Fee</Text>
              <Text style={styles.warningText}>
                Depending on the status of your request, a cancellation fee
                of up to $50 may be charged. If the provider has already been
                dispatched and is en route, the fee covers their travel costs.
              </Text>
            </View>
          </View>

          {/* Reason selection */}
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

        {/* Action buttons */}
        <View style={styles.ctaContainer}>
          <TouchableOpacity
            style={styles.keepButton}
            onPress={handleGoBack}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Keep my emergency request"
          >
            <Text style={styles.keepButtonText}>Keep Request</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.cancelConfirmButton,
              (!selectedCancellationReason || isCancelling) &&
                styles.cancelConfirmButtonDisabled,
            ]}
            onPress={handleConfirmCancel}
            disabled={!selectedCancellationReason || isCancelling}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Confirm cancellation"
            accessibilityState={{
              disabled: !selectedCancellationReason || isCancelling,
            }}
          >
            {isCancelling ? (
              <ActivityIndicator size="small" color={Colors.white} />
            ) : (
              <Text style={styles.cancelConfirmButtonText}>
                Confirm Cancel
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
    color: Colors.textPrimary,
    marginBottom: Spacing.md,
  },
  subtitle: {
    ...Typography.body,
    color: Colors.textSecondary,
    lineHeight: 22,
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

  // Warning
  warningCard: {
    backgroundColor: `${Colors.emergencyRed}10`,
    borderRadius: BorderRadius.md,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: `${Colors.emergencyRed}30`,
  },
  warningTitle: {
    ...Typography.headline,
    color: Colors.emergencyRed,
    marginBottom: Spacing.sm,
  },
  warningText: {
    ...Typography.footnote,
    color: Colors.textSecondary,
    lineHeight: 20,
  },

  // Reasons
  reasonsContainer: {
    gap: Spacing.sm,
  },
  reasonCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  reasonCardSelected: {
    borderColor: Colors.emergencyRed,
    backgroundColor: `${Colors.emergencyRed}08`,
  },
  reasonRadio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: Colors.border,
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
  },
  reasonText: {
    ...Typography.body,
    color: Colors.textPrimary,
    flex: 1,
  },
  reasonTextSelected: {
    color: Colors.emergencyRed,
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

  // CTA
  ctaContainer: {
    flexDirection: 'row',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    ...Shadows.lg,
  },
  keepButton: {
    flex: 1,
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.md,
    paddingVertical: Spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keepButtonText: {
    ...Typography.buttonLarge,
    color: Colors.white,
    fontWeight: FontWeight.bold,
  },
  cancelConfirmButton: {
    flex: 1,
    backgroundColor: Colors.emergencyRed,
    borderRadius: BorderRadius.md,
    paddingVertical: Spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelConfirmButtonDisabled: {
    backgroundColor: Colors.textDisabled,
  },
  cancelConfirmButtonText: {
    ...Typography.buttonLarge,
    color: Colors.white,
    fontWeight: FontWeight.bold,
  },

  // Cancelled state
  cancelledContainer: {
    flex: 1,
    backgroundColor: Colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xxl,
  },
  cancelledIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: Colors.emergencyRed,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.xl,
    ...Shadows.md,
  },
  cancelledIconText: {
    fontSize: 32,
    fontWeight: FontWeight.bold,
    color: Colors.white,
  },
  cancelledTitle: {
    ...Typography.title1,
    color: Colors.textPrimary,
    marginBottom: Spacing.md,
    textAlign: 'center',
  },
  cancelledDescription: {
    ...Typography.body,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginBottom: Spacing.xxl,
  },
  feeCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    padding: Spacing.xl,
    width: '100%',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: `${Colors.emergencyRed}30`,
    marginBottom: Spacing.xxl,
  },
  feeLabel: {
    ...Typography.label,
    color: Colors.textSecondary,
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
    color: Colors.textTertiary,
    textAlign: 'center',
  },
  doneButton: {
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.md,
    paddingVertical: Spacing.lg,
    paddingHorizontal: Spacing.giant,
    alignItems: 'center',
    ...Shadows.md,
  },
  doneButtonText: {
    ...Typography.buttonLarge,
    color: Colors.white,
    fontWeight: FontWeight.bold,
  },
});

export default EmergencyCancelScreen;
