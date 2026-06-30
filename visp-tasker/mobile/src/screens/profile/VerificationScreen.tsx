/**
 * VISP - Verification Screen
 *
 * Step-by-step verification process with background check status,
 * license upload, insurance certificate upload, progress tracker
 * showing what's verified, and next steps for level advancement.
 *
 * Dark glassmorphism redesign.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Colors, getLevelColor } from '../../theme/colors';
import { GlassStyles } from '../../theme/glass';
import { GlassBackground, GlassCard, GlassButton } from '../../components/glass';
import { AnimatedSpinner, AnimatedCheckmark } from '../../components/animations';
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
  borderColor: string;
  glowShadow?: object;
} {
  switch (status) {
    case 'completed':
      return {
        label: 'Verified',
        color: Colors.success,
        bgColor: `${Colors.success}20`,
        borderColor: `${Colors.success}40`,
      };
    case 'in_progress':
      return {
        label: 'In Review',
        color: Colors.warning,
        bgColor: `${Colors.warning}20`,
        borderColor: `${Colors.warning}40`,
      };
    case 'failed':
      return {
        label: 'Action Required',
        color: Colors.emergencyRed,
        bgColor: `${Colors.emergencyRed}20`,
        borderColor: `${Colors.emergencyRed}40`,
        glowShadow: Platform.select({
          ios: {
            shadowColor: Colors.emergencyRed,
            shadowOffset: { width: 0, height: 0 },
            shadowOpacity: 0.4,
            shadowRadius: 8,
          },
          android: { elevation: 4 },
        }),
      };
    default:
      return {
        label: 'Not Started',
        color: 'rgba(255, 255, 255, 0.35)',
        bgColor: Colors.glass.white,
        borderColor: Colors.glassBorder.subtle,
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
        {step.status === 'completed' ? (
          <AnimatedCheckmark size={32} color={Colors.success} delay={stepNumber * 150} />
        ) : (
          <View
            style={[
              stepStyles.circle,
              step.status === 'in_progress' && {
                backgroundColor: Colors.warning,
                borderColor: Colors.warning,
                ...Platform.select({
                  ios: {
                    shadowColor: Colors.warning,
                    shadowOffset: { width: 0, height: 0 },
                    shadowOpacity: 0.5,
                    shadowRadius: 8,
                  },
                  android: { elevation: 4 },
                }),
              },
              step.status === 'failed' && {
                backgroundColor: Colors.emergencyRed,
                borderColor: Colors.emergencyRed,
                ...Platform.select({
                  ios: {
                    shadowColor: Colors.emergencyRed,
                    shadowOffset: { width: 0, height: 0 },
                    shadowOpacity: 0.5,
                    shadowRadius: 8,
                  },
                  android: { elevation: 4 },
                }),
              },
            ]}
          >
            <Text style={stepStyles.circleText}>
              {String(stepNumber)}
            </Text>
          </View>
        )}
        {!isLast && (
          <View
            style={[
              stepStyles.line,
              step.status === 'completed' && {
                backgroundColor: `${Colors.success}80`,
              },
            ]}
          />
        )}
      </View>

      {/* Content - glass card */}
      <GlassCard
        variant="standard"
        padding={14}
        style={{
          ...stepStyles.content,
          ...(step.status === 'failed' && {
            borderColor: `${Colors.emergencyRed}40`,
          }),
          ...(step.status === 'completed' && {
            borderColor: `${Colors.success}30`,
          }),
          ...(step.status === 'in_progress' && {
            borderColor: `${Colors.warning}30`,
          }),
        }}
      >
        <View style={stepStyles.header}>
          <View style={stepStyles.headerLeft}>
            <Text style={stepStyles.title}>{step.title}</Text>
            <View
              style={[
                stepStyles.levelTag,
                { borderColor: levelColor, backgroundColor: `${levelColor}15` },
              ]}
            >
              <Text style={[stepStyles.levelTagText, { color: levelColor }]}>
                L{step.requiredForLevel}+
              </Text>
            </View>
          </View>
          <View
            style={[
              GlassStyles.badge,
              {
                backgroundColor: statusConfig.bgColor,
                borderColor: statusConfig.borderColor,
              },
              statusConfig.glowShadow,
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

        {step.status === 'not_started' && (
          <GlassButton
            title="Upload Document"
            variant="glass"
            onPress={() => onAction(step)}
          />
        )}
        {step.status === 'failed' && (
          <GlassButton
            title="Re-upload"
            variant="outline"
            onPress={() => onAction(step)}
            style={{ borderColor: `${Colors.emergencyRed}50` }}
          />
        )}
      </GlassCard>
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
    borderColor: Colors.glassBorder.light,
    backgroundColor: Colors.glass.white,
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
    backgroundColor: Colors.glassBorder.subtle,
    marginVertical: 4,
  },
  content: {
    flex: 1,
    marginLeft: 8,
    marginBottom: 12,
    borderRadius: 16,
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
    borderRadius: 6,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  levelTagText: {
    fontSize: 10,
    fontWeight: '700',
  },
  statusText: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  description: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.50)',
    lineHeight: 18,
    marginBottom: 10,
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
      <GlassBackground>
        <View style={styles.loadingContainer}>
          <AnimatedSpinner size={48} color={Colors.primary} />
          <Text style={styles.loadingText}>Loading verification status...</Text>
        </View>
      </GlassBackground>
    );
  }

  return (
    <GlassBackground>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}
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
        <GlassCard variant="elevated" style={styles.glassCardMargin}>
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
                GlassStyles.badge,
                {
                  backgroundColor: `${getLevelColor(currentLevel)}25`,
                  borderColor: `${getLevelColor(currentLevel)}50`,
                },
              ]}
            >
              <Text style={[styles.currentLevelBadgeText, { color: getLevelColor(currentLevel) }]}>
                L{currentLevel} {LEVEL_NAMES[currentLevel]}
              </Text>
            </View>
          </View>
        </GlassCard>

        {/* Next steps info */}
        {currentLevel < 4 && (
          <GlassCard
            variant="dark"
            style={styles.nextStepsCard}
          >
            <Text style={styles.nextStepsTitle}>
              Next: Level {currentLevel + 1} -{' '}
              {LEVEL_NAMES[(currentLevel + 1) as ServiceLevel]}
            </Text>
            <Text style={styles.nextStepsText}>
              Complete the remaining verification steps below to unlock the next
              service level and access higher-paying jobs.
            </Text>
          </GlassCard>
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

        {/* Submit all button when there are actionable steps */}
        {steps.some((s) => s.status === 'not_started' || s.status === 'failed') && (
          <View style={styles.submitContainer}>
            <GlassButton
              title="Submit All Documents"
              variant="glow"
              onPress={() => {
                Alert.alert(
                  'Submit All',
                  'In production, this will submit all uploaded documents for review.',
                  [{ text: 'OK' }],
                );
              }}
            />
          </View>
        )}

        <View style={styles.bottomSpacer} />
      </ScrollView>
    </GlassBackground>
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
  scrollView: {
    flex: 1,
  },
  contentContainer: {
    paddingTop: 16,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.50)',
  },
  glassCardMargin: {
    marginHorizontal: 16,
    marginBottom: 12,
  },
  nextStepsCard: {
    marginHorizontal: 16,
    marginBottom: 12,
    borderColor: 'rgba(120, 80, 255, 0.35)',
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
    backgroundColor: Colors.glass.white,
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 8,
    borderWidth: 1,
    borderColor: Colors.glassBorder.subtle,
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: 'rgba(120, 80, 255, 0.8)',
    borderRadius: 4,
    ...Platform.select({
      ios: {
        shadowColor: 'rgba(120, 80, 255, 0.6)',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 1,
        shadowRadius: 6,
      },
      android: {},
    }),
  },
  progressSubtext: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.40)',
    marginBottom: 12,
  },
  currentLevelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.glassBorder.subtle,
  },
  currentLevelLabel: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.50)',
    marginRight: 8,
  },
  currentLevelBadgeText: {
    fontSize: 12,
    fontWeight: '700',
  },
  nextStepsTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.primary,
    marginBottom: 6,
  },
  nextStepsText: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.50)',
    lineHeight: 18,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.textPrimary,
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  submitContainer: {
    marginHorizontal: 16,
    marginTop: 8,
  },
  bottomSpacer: {
    height: 32,
  },
});
