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
  ActionSheetIOS,
  Alert,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Colors, getLevelColor } from '../../theme/colors';
import { useTheme, ThemeColors } from '../../theme/ThemeContext';
import { useTranslation } from '../../i18n';
import { GlassStyles } from '../../theme/glass';
import { GlassCard, GlassButton } from '../../components/glass';
import { Screen } from '../../components/visp';
import { AnimatedSpinner, AnimatedCheckmark } from '../../components/animations';
import {
  Credential,
  CredentialType,
  ServiceLevel,
} from '../../types';
import { get } from '../../services/apiClient';
import { providerService } from '../../services/providerService';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface VerificationStep {
  id: string;
  title: string;
  description: string;
  credentialType: CredentialType | null;
  /**
   * Cuando viene, el documento va al EXPEDIENTE DE EXPERIENCIA (L1) y no a
   * credenciales: son colas de validación distintas en el admin.
   */
  experienceKind?: 'resume' | 'recommendation_letter' | 'work_photos';
  /**
   * Level this document unlocks, or `null` when it is not tied to a level at all.
   * Two documents are levelless by design (client decision 2026-08-10):
   *   - the driver's licence, which every provider uploads as base ID;
   *   - the insurance certificate, which individual SERVICES require at any
   *     level via the CGL requirement, not the level ladder.
   */
  requiredForLevel: ServiceLevel | null;
  /** Badge text used when `requiredForLevel` is null. */
  tagLabel?: string;
  /**
   * El documento no bloquea nada por sí solo. Se dice en la propia tarjeta, en
   * pequeño: sin eso, seis tarjetas idénticas con "Not started" parecen seis
   * deberes pendientes y el proveedor no sabe por dónde empezar.
   */
  optional?: boolean;
  /** Cuántos lleva subidos de este tipo. */
  count?: number;
  status: 'not_started' | 'in_progress' | 'completed' | 'failed';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Highest level a provider can reach in the v1 beta. L2/L3 are on stand-by. */
const MAX_LEVEL_V1 = 1;

/** Traduce el estado de un documento del expediente al del paso visual. */
function experienceStatus(
  records: { kind: string; status: string }[],
  kind: string,
): VerificationStep['status'] {
  const r = records.find((x) => x.kind === kind);
  if (!r) return 'not_started';
  const s = (r.status || '').toLowerCase();
  if (s === 'validated') return 'completed';
  if (s === 'rejected') return 'failed';
  return 'in_progress';
}


/**
 * El estado "Not Started" venía fijado a `rgba(255,255,255,0.35)`: blanco al 35%.
 * Sobre el fondo oscuro se leía a duras penas, y sobre el claro DESAPARECÍA — de
 * ahí que en modo claro no hubiera ninguna etiqueta de estado. Ahora los tonos
 * neutros salen del tema; los de color (verde, ámbar, rojo) funcionan en ambos.
 */
function getStepStatusConfig(status: string, theme: ThemeColors): {
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
        label: 'Not started',
        color: theme.textTertiary,
        bgColor: 'transparent',
        borderColor: theme.border,
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
  const theme = useTheme();
  const statusConfig = getStepStatusConfig(step.status, theme);
  // Levelless documents (driver's licence, insurance) get a neutral slate tag —
  // painting them with a level colour would imply a rank they don't carry.
  const levelColor =
    step.requiredForLevel === null ? Colors.level0 : getLevelColor(step.requiredForLevel);

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
              { borderColor: theme.border, backgroundColor: theme.surface },
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
            <Text style={[stepStyles.circleText, step.status === 'not_started' && { color: theme.textPrimary }]}>
              {String(stepNumber)}
            </Text>
          </View>
        )}
        {!isLast && (
          <View
            style={[
              stepStyles.line,
              { backgroundColor: theme.border },
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
            <Text
              style={[stepStyles.title, { color: theme.textPrimary }]}
              numberOfLines={2}
            >
              {step.title}
            </Text>
            <View
              style={[
                stepStyles.levelTag,
                { borderColor: levelColor, backgroundColor: `${levelColor}15` },
              ]}
            >
              <Text style={[stepStyles.levelTagText, { color: levelColor }]}>
                {step.requiredForLevel === null
                  ? step.tagLabel ?? 'All'
                  : `L${step.requiredForLevel}`}
              </Text>
            </View>
          </View>
          <View
            style={[
              stepStyles.statusBadge,
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

        <Text style={[stepStyles.description, { color: theme.textSecondary }]}>{step.description}</Text>

        {step.optional || (step.count ?? 0) > 0 ? (
          <Text style={[stepStyles.optionalNote, { color: theme.textTertiary }]}>
            {[
              step.optional ? 'Optional' : null,
              (step.count ?? 0) > 0
                ? `${step.count} uploaded`
                : step.optional
                  ? 'none uploaded yet'
                  : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        ) : null}

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
    // flexShrink en el contenedor Y en el título: sin los dos, un título largo
    // empuja la etiqueta de nivel por encima de la de estado en vez de partirse.
    flex: 1,
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginRight: 8,
  },
  title: {
    flexShrink: 1,
    fontSize: 15,
    fontWeight: '600',
  },
  levelTag: {
    flexShrink: 0,
    borderWidth: 1,
    borderRadius: 5,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  levelTagText: {
    fontSize: 9,
    fontWeight: '700',
  },
  statusBadge: {
    flexShrink: 0,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  statusText: {
    fontSize: 9,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  // Nota de pie de la tarjeta: opcional y cuántos van subidos.
  optionalNote: {
    fontSize: 11,
    lineHeight: 15,
    marginTop: -4,
    marginBottom: 10,
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
  const theme = useTheme();
  const { t } = useTranslation();
  const [steps, setSteps] = useState<VerificationStep[]>([]);
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [currentLevel, setCurrentLevel] = useState<ServiceLevel>(1);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);

  const fetchVerificationData = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await get<{
        credentials: Credential[];
        currentLevel: ServiceLevel;
      }>('/provider/verification');

      setCredentials(data.credentials);
      setCurrentLevel(data.currentLevel);

      // El expediente vive en otra tabla y otro endpoint: si falla, los pasos de
      // experiencia salen como "no empezado" en vez de tumbar la pantalla.
      let experience: { kind: string; status: string }[] = [];
      try {
        experience = await providerService.getExperience();
      } catch {
        experience = [];
      }

      // Cuántos documentos lleva subidos de cada tipo. Sale de las mismas dos
      // listas de las que ya se deduce el estado, así que no cuesta una llamada.
      const cuentaCred = (tipo: CredentialType) =>
        data.credentials.filter((c) => c.type === tipo && c.status !== 'rejected').length;
      const cuentaExp = (kind: string) =>
        experience.filter((e) => e.kind === kind && e.status !== 'rejected').length;

      // Steps for the v1 beta (L0/L1 only — client decision 2026-08-10).
      // See visp-tasker/docs/plan-v1-l0-l1-ontario.md §7 WP1.
      const verificationSteps: VerificationStep[] = [
        {
          id: 'crc',
          title: 'Background Check',
          description:
            'A criminal record check is required for every provider. Upload your CRC document to begin the verification process.',
          credentialType: 'criminal_record_check',
          requiredForLevel: null,
          tagLabel: 'All',
          count: cuentaCred('criminal_record_check'),
          status: getCredentialStepStatus(data.credentials, 'criminal_record_check'),
        },
        {
          id: 'drivers_license',
          title: "Driver's Licence",
          description:
            "Upload your Ontario driver's licence (G1, G2 or G). It works as photo ID and it is what lets you take jobs that involve driving. It is not a trade licence and does not raise your level.",
          credentialType: 'drivers_license',
          requiredForLevel: null,
          tagLabel: 'All',
          optional: true,
          count: cuentaCred('drivers_license'),
          status: getCredentialStepStatus(data.credentials, 'drivers_license'),
        },
        // Expediente de experiencia (L1): TRES documentos distintos, no uno.
        // Antes los tres se mandaban como un 'portfolio' genérico y quien
        // validaba en el admin veía un CV, una carta y unas fotos etiquetados
        // igual, sin poder distinguirlos.
        {
          id: 'exp_resume',
          title: 'CV / Resume',
          description:
            'Upload your CV. VISP checks that the document is complete and legible — it does not judge your skills.',
          credentialType: null,
          experienceKind: 'resume',
          requiredForLevel: 1,
          count: cuentaExp('resume'),
          status: experienceStatus(experience, 'resume'),
        },
        {
          id: 'exp_letters',
          title: 'Reference letters',
          description:
            'Letters of recommendation from previous clients or employers.',
          credentialType: null,
          experienceKind: 'recommendation_letter',
          requiredForLevel: 1,
          optional: true,
          count: cuentaExp('recommendation_letter'),
          status: experienceStatus(experience, 'recommendation_letter'),
        },
        {
          id: 'exp_photos',
          title: 'Photos of previous work',
          description:
            'Pictures of jobs you have completed. They are what a customer looks at first.',
          credentialType: null,
          experienceKind: 'work_photos',
          requiredForLevel: 1,
          count: cuentaExp('work_photos'),
          status: experienceStatus(experience, 'work_photos'),
        },
        {
          id: 'insurance',
          title: 'Insurance Certificate',
          description:
            'Commercial general liability coverage. Some services require it regardless of your level — you can upload it at any time, and services that need it unlock once it is verified.',
          credentialType: 'insurance_certificate',
          requiredForLevel: null,
          tagLabel: 'Some services',
          optional: true,
          count: cuentaCred('insurance_certificate'),
          status: getCredentialStepStatus(data.credentials, 'insurance_certificate'),
        },

        // ── EN STAND-BY hasta que se abran L2/L3 (decisión del cliente 2026-08-10) ──
        //
        // 'Trade License' se retira de esta pantalla porque quedó REDUNDANTE, no
        // porque estorbe: la licencia de oficio ya no es un documento genérico,
        // vive en `service_credential_requirements` con su código real (306A,
        // ESA_LEC, TSSA_G2...) por servicio. Un "Trade License" sin código
        // asociado no lo puede verificar ningún motor contra ningún registro.
        // Cuando se abra L2, la subida va por servicio, no por esta lista.
        //
        // {
        //   id: 'license',
        //   title: 'Trade License',
        //   description:
        //     'Upload your valid trade license. This must be current and issued by a recognized authority in your province.',
        //   credentialType: 'trade_license',
        //   requiredForLevel: 2,
        //   status: getCredentialStepStatus(data.credentials, 'trade_license'),
        // },
        //
        // 'Professional Certification' se retira porque era el requisito de L4
        // (Emergency), que está eliminado como producto.
        //
        // OJO al reactivar cualquiera de los dos: `_MOBILE_CRED_TYPE_MAP` en
        // backend/src/api/routes/providers.py mapea `insurance_certificate` Y
        // `certification` al MISMO CredentialType.CERTIFICATION, así que los dos
        // renglones compartían estado (subías uno y los dos se ponían en verde).
        // Hay que separarlos antes de volver a mostrarlos juntos.
        //
        // {
        //   id: 'certification',
        //   title: 'Professional Certification',
        //   description:
        //     'Specialized certifications for emergency services. Required for Level 4 on-call status and SLA-bound work.',
        //   credentialType: 'certification',
        //   requiredForLevel: 4,
        //   status: getCredentialStepStatus(data.credentials, 'certification'),
        // },
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

  const performUpload = useCallback(
    async (step: VerificationStep, source: 'camera' | 'library') => {
      if (!step.credentialType) return;

      const permRequest =
        source === 'camera'
          ? ImagePicker.requestCameraPermissionsAsync
          : ImagePicker.requestMediaLibraryPermissionsAsync;
      const perm = await permRequest();
      if (!perm.granted) {
        Alert.alert(
          t('common.error'),
          source === 'camera'
            ? t('profileScreen.permissionDenied')
            : t('profileScreen.permissionDenied'),
        );
        return;
      }

      const launcher =
        source === 'camera'
          ? ImagePicker.launchCameraAsync
          : ImagePicker.launchImageLibraryAsync;
      const result = await launcher({
        mediaTypes: ['images'],
        allowsMultipleSelection: false,
        quality: 0.8,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) {
        return;
      }

      const asset = result.assets[0];
      setIsUploading(true);
      try {
        const archivo = {
          uri: asset.uri,
          type: asset.mimeType,
          // `fileName` puede venir null en iOS; el servicio espera string|undefined.
          name: asset.fileName ?? undefined,
        };
        if (step.experienceKind) {
          await providerService.uploadExperience(archivo, step.experienceKind, step.title);
        } else if (step.credentialType) {
          await providerService.uploadCredential(archivo, step.credentialType);
        }
        Alert.alert(
          t('credentials.documentUploaded'),
          t('verification.uploadSuccess', { defaultValue: 'Your document has been submitted for review.' }),
        );
        await fetchVerificationData();
      } catch (error) {
        console.error('[VERIFICATION_UPLOAD] Failed:', error);
        Alert.alert(t('common.error'), t('credentials.uploadFailed'));
      } finally {
        setIsUploading(false);
      }
    },
    [t, fetchVerificationData],
  );

  const handleStepAction = useCallback(
    (step: VerificationStep) => {
      if (!step.credentialType && !step.experienceKind) {
        Alert.alert(step.title, step.description);
        return;
      }
      if (Platform.OS === 'ios') {
        ActionSheetIOS.showActionSheetWithOptions(
          {
            title: step.title,
            options: [
              t('common.cancel'),
              t('profileScreen.takePhoto'),
              t('profileScreen.chooseFromLibrary'),
            ],
            cancelButtonIndex: 0,
            userInterfaceStyle: 'dark',
          },
          (buttonIndex) => {
            if (buttonIndex === 1) performUpload(step, 'camera');
            else if (buttonIndex === 2) performUpload(step, 'library');
          },
        );
      } else {
        Alert.alert(step.title, '', [
          { text: t('profileScreen.takePhoto'), onPress: () => performUpload(step, 'camera') },
          { text: t('profileScreen.chooseFromLibrary'), onPress: () => performUpload(step, 'library') },
          { text: t('common.cancel'), style: 'cancel' },
        ]);
      }
    },
    [t, performUpload],
  );

  if (isLoading) {
    return (
      <Screen>
        <View style={styles.loadingContainer}>
          <AnimatedSpinner size={48} color={Colors.primary} />
          <Text style={[styles.loadingText, { color: theme.textSecondary }]}>Loading verification status...</Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
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
            <Text style={[styles.progressTitle, { color: theme.textPrimary }]}>Verification Progress</Text>
            <Text style={styles.progressPercent}>{progressPercent}%</Text>
          </View>

          <View style={[styles.progressBarBackground, { backgroundColor: theme.border }]}>
            <View
              style={[
                styles.progressBarFill,
                { width: `${Math.max(progressPercent, 2)}%` },
              ]}
            />
          </View>

          <Text style={[styles.progressSubtext, { color: theme.textSecondary }]}>
            {completedCount} of {totalCount} steps completed
          </Text>

          <View style={styles.currentLevelRow}>
            <Text style={[styles.currentLevelLabel, { color: theme.textSecondary }]}>Current Level:</Text>
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
                L{currentLevel}
              </Text>
            </View>
          </View>
        </GlassCard>

        {/* Next steps info. Capped at MAX_LEVEL_V1: promising "Next: Level 2"
            while L2/L3 are on stand-by would be selling a door that is shut. */}
        {currentLevel < MAX_LEVEL_V1 && (
          <GlassCard
            variant="dark"
            style={styles.nextStepsCard}
          >
            <Text style={[styles.nextStepsTitle, { color: theme.textPrimary }]}>
              Next: L{currentLevel + 1}
            </Text>
            <Text style={[styles.nextStepsText, { color: theme.textSecondary }]}>
              Upload the documents below. VISP checks that they are complete and
              legible — we verify the paperwork, not your skill.
            </Text>
          </GlassCard>
        )}

        {/* Verification steps */}
        <Text style={[styles.sectionTitle, { color: theme.textPrimary }]}>Your documents</Text>
        {steps.map((step, index) => (
          <StepCard
            key={step.id}
            step={step}
            stepNumber={index + 1}
            isLast={index === steps.length - 1}
            onAction={handleStepAction}
          />
        ))}

        {isUploading && (
          <View style={styles.uploadingBanner}>
            <AnimatedSpinner size={20} color={Colors.primary} />
            <Text style={styles.uploadingText}>
              {t('profileScreen.uploadingPhoto')}
            </Text>
          </View>
        )}

        <View style={styles.bottomSpacer} />
      </ScrollView>
    </Screen>
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
    // Sin esto el último elemento queda debajo de la tab bar / barra
    // de acción y no se puede alcanzar.
    paddingBottom: 40,
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
  uploadingBanner: {
    marginHorizontal: 16,
    marginTop: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(120, 80, 255, 0.12)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(120, 80, 255, 0.30)',
  },
  uploadingText: {
    fontSize: 13,
    color: Colors.primary,
    fontWeight: '600',
  },
  bottomSpacer: {
    height: 32,
  },
});
