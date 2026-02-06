/**
 * VISP/Tasker - Verification Screen
 *
 * Step-by-step verification process with background check status,
 * license upload, insurance certificate upload, progress tracker
 * showing what's verified, and next steps for level advancement.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Colors, getLevelColor } from '../../theme/colors';
import {
  Credential,
  CredentialType,
  ServiceLevel,
} from '../../types';
import { get } from '../../services/apiClient';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface VerificationStep {
  id: string;
  title: string;
  description: string;
  credentialType: CredentialType | null;
  requiredForLevel: ServiceLevel;
  status: 'not_started' | 'in_progress' | 'completed' | 'failed';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const LEVEL_NAMES: Record<number, string> = {
  1: 'Helper',
  2: 'Experienced',
  3: 'Certified Pro',
  4: 'Emergency',
};

function getStepStatusConfig(status: string): {
  label: string;
  color: string;
  bgColor: string;
} {
  switch (status) {
    case 'completed':
      return {
        label: 'Verified',
        color: Colors.success,
        bgColor: `${Colors.success}20`,
      };
    case 'in_progress':
      return {
        label: 'In Review',
        color: Colors.warning,
        bgColor: `${Colors.warning}20`,
      };
    case 'failed':
      return {
        label: 'Action Required',
        color: Colors.emergencyRed,
        bgColor: `${Colors.emergencyRed}20`,
      };
    default:
      return {
        label: 'Not Started',
        color: Colors.textTertiary,
        bgColor: `${Colors.textTertiary}20`,
      };
  }
}

// ---------------------------------------------------------------------------
// VerificationStepCard sub-component
// ---------------------------------------------------------------------------

interface StepCardProps {
  step: VerificationStep;
  stepNumber: number;
  isLast: boolean;
  onAction: (step: VerificationStep) => void;
}

function StepCard({
  step,
  stepNumber,
  isLast,
  onAction,
}: StepCardProps): React.JSX.Element {
  const statusConfig = getStepStatusConfig(step.status);
  const levelColor = getLevelColor(step.requiredForLevel);

  return (
    <View style={stepStyles.container}>
      {/* Left timeline */}
      <View style={stepStyles.timeline}>
        <View
          style={[
            stepStyles.circle,
            step.status === 'completed' && {
              backgroundColor: Colors.success,
              borderColor: Colors.success,
            },
            step.status === 'in_progress' && {
              backgroundColor: Colors.warning,
              borderColor: Colors.warning,
            },
            step.status === 'failed' && {
              backgroundColor: Colors.emergencyRed,
              borderColor: Colors.emergencyRed,
            },
          ]}
        >
          <Text style={stepStyles.circleText}>
            {step.status === 'completed' ? '\u2713' : String(stepNumber)}
          </Text>
        </View>
        {!isLast && (
          <View
            style={[
              stepStyles.line,
              step.status === 'completed' && {
                backgroundColor: Colors.success,
              },
            ]}
          />
        )}
      </View>

      {/* Content */}
      <View style={stepStyles.content}>
        <View style={stepStyles.header}>
          <View style={stepStyles.headerLeft}>
            <Text style={stepStyles.title}>{step.title}</Text>
            <View
              style={[
                stepStyles.levelTag,
                { borderColor: levelColor },
              ]}
            >
              <Text style={[stepStyles.levelTagText, { color: levelColor }]}>
                L{step.requiredForLevel}+
              </Text>
            </View>
          </View>
          <View
            style={[
              stepStyles.statusBadge,
              { backgroundColor: statusConfig.bgColor },
            ]}
          >
            <Text
              style={[
                stepStyles.statusText,
                { color: statusConfig.color },
              ]}
            >
              {statusConfig.label}
            </Text>
          </View>
        </View>

        <Text style={stepStyles.description}>{step.description}</Text>

        {(step.status === 'not_started' || step.status === 'failed') && (
          <TouchableOpacity
            style={[
              stepStyles.actionButton,
              step.status === 'failed' && {
                backgroundColor: Colors.emergencyRed,
              },
            ]}
            onPress={() => onAction(step)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={
              step.status === 'failed'
                ? `Re-upload ${step.title}`
                : `Start ${step.title}`
            }
          >
            <Text style={stepStyles.actionButtonText}>
              {step.status === 'failed' ? 'Re-upload' : 'Start'}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const stepStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    marginHorizontal: 16,
  },
  timeline: {
    alignItems: 'center',
    width: 40,
  },
  circle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  circleText: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.white,
  },
  line: {
    width: 2,
    flex: 1,
    backgroundColor: Colors.border,
    marginVertical: 4,
  },
  content: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 10,
    padding: 14,
    marginLeft: 8,
    marginBottom: 12,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  headerLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginRight: 8,
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  levelTag: {
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  levelTagText: {
    fontSize: 10,
    fontWeight: '700',
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  statusText: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  description: {
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 18,
    marginBottom: 8,
  },
  actionButton: {
    backgroundColor: Colors.primary,
    borderRadius: 6,
    paddingVertical: 8,
    alignItems: 'center',
    marginTop: 4,
  },
  actionButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.white,
  },
});

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function VerificationScreen(): React.JSX.Element {
  const [steps, setSteps] = useState<VerificationStep[]>([]);
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [currentLevel, setCurrentLevel] = useState<ServiceLevel>(1);
  const [isLoading, setIsLoading] = useState(true);

  const fetchVerificationData = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await get<{
        credentials: Credential[];
        currentLevel: ServiceLevel;
      }>('/provider/verification');

      setCredentials(data.credentials);
      setCurrentLevel(data.currentLevel);

      // Build verification steps from credentials
      const verificationSteps: VerificationStep[] = [
        {
          id: 'crc',
          title: 'Background Check',
          description:
            'A criminal record check is required for all service levels. Upload your CRC document to begin the verification process.',
          credentialType: 'criminal_record_check',
          requiredForLevel: 1,
          status: getCredentialStepStatus(data.credentials, 'criminal_record_check'),
        },
        {
          id: 'portfolio',
          title: 'Portfolio / Work History',
          description:
            'Demonstrate your experience with photos of completed work or references from previous clients.',
          credentialType: 'portfolio',
          requiredForLevel: 2,
          status: getCredentialStepStatus(data.credentials, 'portfolio'),
        },
        {
          id: 'license',
          title: 'Trade License',
          description:
            'Upload your valid trade license. This must be current and issued by a recognized authority in your province.',
          credentialType: 'trade_license',
          requiredForLevel: 3,
          status: getCredentialStepStatus(data.credentials, 'trade_license'),
        },
        {
          id: 'insurance',
          title: 'Insurance Certificate',
          description:
            'Upload proof of $2M minimum liability insurance coverage. Your certificate must show the policy period and coverage amount.',
          credentialType: 'insurance_certificate',
          requiredForLevel: 3,
          status: getCredentialStepStatus(data.credentials, 'insurance_certificate'),
        },
        {
          id: 'certification',
          title: 'Professional Certification',
          description:
            'Specialized certifications for emergency services. Required for Level 4 on-call status and SLA-bound work.',
          credentialType: 'certification',
          requiredForLevel: 4,
          status: getCredentialStepStatus(data.credentials, 'certification'),
        },
      ];

      setSteps(verificationSteps);
    } catch {
      // Show empty state on error
      setSteps([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchVerificationData();
  }, [fetchVerificationData]);

  // Overall progress
  const completedCount = steps.filter((s) => s.status === 'completed').length;
  const totalCount = steps.length;
  const progressPercent =
    totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  const handleStepAction = useCallback((step: VerificationStep) => {
    Alert.alert(
      step.title,
      'In production, this will open the document upload flow for this verification step.',
      [{ text: 'OK' }],
    );
  }, []);

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={styles.loadingText}>Loading verification status...</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.contentContainer}
      refreshControl={
        <RefreshControl
          refreshing={isLoading}
          onRefresh={fetchVerificationData}
          tintColor={Colors.primary}
          colors={[Colors.primary]}
        />
      }
    >
      {/* Progress overview */}
      <View style={styles.progressCard}>
        <View style={styles.progressHeader}>
          <Text style={styles.progressTitle}>Verification Progress</Text>
          <Text style={styles.progressPercent}>{progressPercent}%</Text>
        </View>

        <View style={styles.progressBarBackground}>
          <View
            style={[
              styles.progressBarFill,
              { width: `${Math.max(progressPercent, 2)}%` },
            ]}
          />
        </View>

        <Text style={styles.progressSubtext}>
          {completedCount} of {totalCount} steps completed
        </Text>

        <View style={styles.currentLevelRow}>
          <Text style={styles.currentLevelLabel}>Current Level:</Text>
          <View
            style={[
              styles.currentLevelBadge,
              { backgroundColor: getLevelColor(currentLevel) },
            ]}
          >
            <Text style={styles.currentLevelBadgeText}>
              L{currentLevel} {LEVEL_NAMES[currentLevel]}
            </Text>
          </View>
        </View>
      </View>

      {/* Next steps info */}
      {currentLevel < 4 && (
        <View style={styles.nextStepsCard}>
          <Text style={styles.nextStepsTitle}>
            Next: Level {currentLevel + 1} -{' '}
            {LEVEL_NAMES[(currentLevel + 1) as ServiceLevel]}
          </Text>
          <Text style={styles.nextStepsText}>
            Complete the remaining verification steps below to unlock the next
            service level and access higher-paying jobs.
          </Text>
        </View>
      )}

      {/* Verification steps */}
      <Text style={styles.sectionTitle}>Verification Steps</Text>
      {steps.map((step, index) => (
        <StepCard
          key={step.id}
          step={step}
          stepNumber={index + 1}
          isLast={index === steps.length - 1}
          onAction={handleStepAction}
        />
      ))}

      <View style={styles.bottomSpacer} />
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// Helper to map credential to step status
// ---------------------------------------------------------------------------

function getCredentialStepStatus(
  credentials: Credential[],
  type: CredentialType,
): 'not_started' | 'in_progress' | 'completed' | 'failed' {
  const credential = credentials.find((c) => c.type === type);
  if (!credential) return 'not_started';
  switch (credential.status) {
    case 'approved':
      return 'completed';
    case 'pending':
      return 'in_progress';
    case 'rejected':
    case 'expired':
      return 'failed';
    default:
      return 'not_started';
  }
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  contentContainer: {
    paddingTop: 16,
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: Colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: Colors.textSecondary,
  },
  progressCard: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 16,
    marginHorizontal: 16,
    marginBottom: 12,
  },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  progressTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  progressPercent: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.primary,
  },
  progressBarBackground: {
    height: 8,
    backgroundColor: Colors.border,
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 8,
  },
  progressBarFill: {
    height: 8,
    backgroundColor: Colors.primary,
    borderRadius: 4,
  },
  progressSubtext: {
    fontSize: 13,
    color: Colors.textTertiary,
    marginBottom: 12,
  },
  currentLevelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
  },
  currentLevelLabel: {
    fontSize: 14,
    color: Colors.textSecondary,
    marginRight: 8,
  },
  currentLevelBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  currentLevelBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.white,
  },
  nextStepsCard: {
    backgroundColor: Colors.surfaceLight,
    borderRadius: 12,
    padding: 16,
    marginHorizontal: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: Colors.primary,
  },
  nextStepsTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.primary,
    marginBottom: 6,
  },
  nextStepsText: {
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 18,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.textPrimary,
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  bottomSpacer: {
    height: 32,
  },
});
