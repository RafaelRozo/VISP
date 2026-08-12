/**
 * VISP - Settings Screen
 *
 * Notification preferences, payment methods management, language selection,
 * app theme (dark/light), privacy settings, terms of service links, and
 * about/version info.
 *
 * Dark glassmorphism redesign.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActionSheetIOS,
  Alert,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Colors } from '../../theme/colors';
import { useTheme } from '../../theme/ThemeContext';
import { GlassStyles } from '../../theme/glass';
import { GlassCard, GlassButton } from '../../components/glass';
import { Screen } from '../../components/visp';
import {
  NotificationPreferences,
  PaymentMethod,
} from '../../types';
import { get, patch, post } from '../../services/apiClient';
import { useAuthStore } from '../../stores/authStore';
import { useNavigation } from '@react-navigation/native';
import { useAppStore } from '../../stores/appStore';
import { useTranslation } from '../../i18n';
import { userService } from '../../services/userService';
import { Modal, TextInput } from 'react-native';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const APP_VERSION = '1.0.0';
const BUILD_NUMBER = '1';

const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'fr', label: 'French' },
];

const TERMS_URL = 'https://vispapp.com/terms';
const PRIVACY_URL = 'https://vispapp.com/privacy';

// ---------------------------------------------------------------------------
// SettingsRow sub-component
// ---------------------------------------------------------------------------

interface SettingsToggleProps {
  label: string;
  value: boolean;
  onToggle: (value: boolean) => void;
}

function SettingsToggle({
  label,
  value,
  onToggle,
}: SettingsToggleProps): React.JSX.Element {
  const theme = useTheme();
  return (
    <View style={rowStyles.container}>
      <Text style={[rowStyles.label, { color: theme.textPrimary }]}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onToggle}
        trackColor={{ false: 'rgba(255, 255, 255, 0.12)', true: 'rgba(120, 80, 255, 0.6)' }}
        thumbColor={Colors.white}
        ios_backgroundColor="rgba(255, 255, 255, 0.12)"
        accessibilityLabel={`Toggle ${label}`}
        accessibilityRole="switch"
      />
    </View>
  );
}

interface SettingsLinkProps {
  label: string;
  value?: string;
  onPress: () => void;
}

function SettingsLink({
  label,
  value,
  onPress,
}: SettingsLinkProps): React.JSX.Element {
  const theme = useTheme();
  return (
    <TouchableOpacity
      style={rowStyles.container}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
    >
      <Text style={[rowStyles.label, { color: theme.textPrimary }]}>{label}</Text>
      <View style={rowStyles.valueRow}>
        {value && <Text style={[rowStyles.value, { color: theme.textSecondary }]}>{value}</Text>}
        <Text style={[rowStyles.arrow, { color: theme.textTertiary }]}>{'\u203A'}</Text>
      </View>
    </TouchableOpacity>
  );
}

const rowStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  label: {
    fontSize: 15,
    color: Colors.textPrimary,
    flex: 1,
  },
  valueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  value: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.5)',
  },
  arrow: {
    fontSize: 20,
    color: 'rgba(255, 255, 255, 0.25)',
  },
});

// ---------------------------------------------------------------------------
// PaymentMethodCard sub-component
// ---------------------------------------------------------------------------

interface PaymentMethodCardProps {
  method: PaymentMethod;
  onRemove: (id: string) => void;
}

function PaymentMethodCard({
  method,
  onRemove,
}: PaymentMethodCardProps): React.JSX.Element {
  const theme = useTheme();
  return (
    <View style={paymentStyles.container}>
      <View style={paymentStyles.left}>
        <Text style={[paymentStyles.type, { color: theme.textPrimary }]}>
          {method.brand ?? method.type === 'card' ? 'Card' : 'Bank'}
        </Text>
        <Text style={[paymentStyles.last4, { color: theme.textSecondary }]}>
          {'\u2022\u2022\u2022\u2022'} {method.last4}
        </Text>
        {method.expiresAt && (
          <Text style={[paymentStyles.expiry, { color: theme.textTertiary }]}>
            Exp:{' '}
            {new Date(method.expiresAt).toLocaleDateString([], {
              month: '2-digit',
              year: '2-digit',
            })}
          </Text>
        )}
      </View>
      <View style={paymentStyles.right}>
        {method.isDefault && (
          <View style={paymentStyles.defaultBadge}>
            <Text style={paymentStyles.defaultBadgeText}>Default</Text>
          </View>
        )}
        <TouchableOpacity
          onPress={() => onRemove(method.id)}
          accessibilityRole="button"
          accessibilityLabel="Remove payment method"
        >
          <Text style={paymentStyles.removeText}>Remove</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const paymentStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  left: {
    flex: 1,
  },
  type: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textPrimary,
    marginBottom: 2,
  },
  last4: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.5)',
  },
  expiry: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.35)',
    marginTop: 2,
  },
  right: {
    alignItems: 'flex-end',
  },
  defaultBadge: {
    backgroundColor: `${Colors.success}20`,
    borderWidth: 1,
    borderColor: `${Colors.success}40`,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginBottom: 4,
  },
  defaultBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: Colors.success,
  },
  removeText: {
    fontSize: 13,
    color: Colors.emergencyRed,
  },
});

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function SettingsScreen(): React.JSX.Element {
  const theme = useTheme();
  const user = useAuthStore((s) => s.user);
  const userId = user?.id;
  const navigation = useNavigation<any>();

  // Notification preferences
  const [notifications, setNotifications] = useState<NotificationPreferences>({
    pushEnabled: true,
    jobOffers: true,
    jobUpdates: true,
    promotions: false,
    emergencyAlerts: true,
  });

  // App settings from global store
  const { language, darkMode, setLanguage, setDarkMode } = useAppStore();

  // Payment methods
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);

  // Recovery code modal
  const [recoveryModalOpen, setRecoveryModalOpen] = useState(false);
  const [recoveryPwd, setRecoveryPwd] = useState('');
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [recoveryLoading, setRecoveryLoading] = useState(false);

  const closeRecoveryModal = useCallback(() => {
    setRecoveryModalOpen(false);
    setRecoveryPwd('');
    setRecoveryCode(null);
    setRecoveryError(null);
  }, []);

  const fetchRecoveryCode = useCallback(async () => {
    if (recoveryPwd.length < 1) return;
    setRecoveryLoading(true);
    setRecoveryError(null);
    try {
      const code = await userService.getRecoveryCode(recoveryPwd);
      setRecoveryCode(code);
    } catch (err: any) {
      const msg =
        err?.response?.data?.detail ??
        err?.message ??
        'Could not retrieve recovery code.';
      setRecoveryError(msg);
    } finally {
      setRecoveryLoading(false);
    }
  }, [recoveryPwd]);

  const rotateRecoveryCode = useCallback(async () => {
    if (recoveryPwd.length < 1) return;
    setRecoveryLoading(true);
    setRecoveryError(null);
    try {
      const code = await userService.rotateRecoveryCode(recoveryPwd);
      setRecoveryCode(code);
    } catch (err: any) {
      const msg =
        err?.response?.data?.detail ??
        err?.message ??
        'Could not rotate recovery code.';
      setRecoveryError(msg);
    } finally {
      setRecoveryLoading(false);
    }
  }, [recoveryPwd]);

  // Fetch current notification preferences from backend on mount
  useEffect(() => {
    if (!userId) return;
    (async () => {
      try {
        const data = await get<any>(`/notifications/preferences/${userId}`);
        if (data) {
          setNotifications({
            pushEnabled: data.pushEnabled ?? data.job_updates ?? true,
            jobOffers: data.jobOffers ?? data.job_updates ?? true,
            jobUpdates: data.jobUpdates ?? data.job_updates ?? true,
            promotions: data.promotions ?? data.marketing ?? false,
            emergencyAlerts: data.emergencyAlerts ?? data.emergency_alerts ?? true,
          });
        }
      } catch {
        // Use defaults if fetch fails
      }
    })();
  }, [userId]);

  // Notification toggle handler
  const handleNotificationToggle = useCallback(
    async (key: keyof NotificationPreferences, value: boolean) => {
      if (!userId) return;
      const updated = { ...notifications, [key]: value };
      setNotifications(updated);
      try {
        await post(`/notifications/preferences/${userId}`, {
          job_updates: updated.jobUpdates,
          marketing: updated.promotions,
          emergency_alerts: updated.emergencyAlerts,
        });
      } catch {
        setNotifications(notifications);
      }
    },
    [notifications, userId],
  );

  const { t } = useTranslation();

  // Language picker
  const handleLanguagePicker = useCallback(() => {
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ['Cancel', ...LANGUAGES.map((l) => l.label)],
          cancelButtonIndex: 0,
        },
        (buttonIndex) => {
          if (buttonIndex > 0) {
            setLanguage(LANGUAGES[buttonIndex - 1].code as 'en' | 'fr');
          }
        },
      );
    } else {
      Alert.alert(
        'Select Language',
        undefined,
        [
          { text: 'Cancel', style: 'cancel' },
          ...LANGUAGES.map((lang) => ({
            text: lang.label,
            onPress: () => setLanguage(lang.code as 'en' | 'fr'),
          })),
        ],
      );
    }
  }, [setLanguage]);

  // Theme toggle
  const handleThemeToggle = useCallback((value: boolean) => {
    setDarkMode(value);
  }, [setDarkMode]);

  // Payment method removal
  const handleRemovePaymentMethod = useCallback(
    (id: string) => {
      Alert.alert(
        'Remove Payment Method',
        'Are you sure you want to remove this payment method?',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Remove',
            style: 'destructive',
            onPress: () => {
              setPaymentMethods((prev) => prev.filter((m) => m.id !== id));
            },
          },
        ],
      );
    },
    [],
  );

  // Add payment method
  const handleAddPaymentMethod = useCallback(() => {
    Alert.alert(
      'Add Payment Method',
      'In production, this will open the Stripe payment sheet to add a new card or bank account.',
      [{ text: 'OK' }],
    );
  }, []);

  // Open external URLs
  const openURL = useCallback((url: string) => {
    Linking.openURL(url).catch(() => {
      Alert.alert('Error', 'Could not open the link.');
    });
  }, []);

  const currentLanguageLabel =
    LANGUAGES.find((l) => l.code === language)?.label ?? 'English';

  return (
    <Screen>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}
      >
        {/* Notifications Section */}
        <Text style={[styles.sectionHeader, { color: theme.textTertiary }]}>{t('settings.notifications')}</Text>
        <GlassCard variant="dark" padding={0} style={styles.glassCardMargin}>
          <SettingsToggle
            label={t('settings.pushNotifications')}
            value={notifications.pushEnabled}
            onToggle={(v) => handleNotificationToggle('pushEnabled', v)}
          />
          <View style={styles.glassDivider} />
          <SettingsToggle
            label={t('settings.jobOffers')}
            value={notifications.jobOffers}
            onToggle={(v) => handleNotificationToggle('jobOffers', v)}
          />
          <View style={styles.glassDivider} />
          <SettingsToggle
            label={t('settings.jobUpdates')}
            value={notifications.jobUpdates}
            onToggle={(v) => handleNotificationToggle('jobUpdates', v)}
          />
          <View style={styles.glassDivider} />
          <SettingsToggle
            label={t('settings.emergencyAlerts')}
            value={notifications.emergencyAlerts}
            onToggle={(v) => handleNotificationToggle('emergencyAlerts', v)}
          />
        </GlassCard>

        {/* App Settings Section */}
        <Text style={[styles.sectionHeader, { color: theme.textTertiary }]}>{t('settings.appSettings')}</Text>
        <GlassCard variant="dark" padding={0} style={styles.glassCardMargin}>
          <SettingsLink
            label={t('settings.language')}
            value={currentLanguageLabel}
            onPress={handleLanguagePicker}
          />
          <View style={styles.glassDivider} />
          <SettingsToggle
            label={t('settings.darkMode')}
            value={darkMode}
            onToggle={handleThemeToggle}
          />
        </GlassCard>

        {/* Account / Recovery code */}
        <Text style={[styles.sectionHeader, { color: theme.textTertiary }]}>{t('settings.account')}</Text>
        <GlassCard variant="dark" padding={0} style={styles.glassCardMargin}>
          <SettingsLink
            label={t('settings.viewRecoveryCode')}
            onPress={() => {
              setRecoveryModalOpen(true);
              setRecoveryCode(null);
              setRecoveryPwd('');
              setRecoveryError(null);
            }}
          />
        </GlassCard>

        {/* Privacy & Legal Section */}
        <Text style={[styles.sectionHeader, { color: theme.textTertiary }]}>{t('settings.privacyLegal')}</Text>
        <GlassCard variant="dark" padding={0} style={styles.glassCardMargin}>
          <SettingsLink
            label={t('settings.privacySettings')}
            onPress={() => {
              Alert.alert(
                t('settings.privacySettings'),
                t('settings.managePrivacy'),
                [{ text: t('common.ok') }],
              );
            }}
          />
          <View style={styles.glassDivider} />
          <SettingsLink
            label={t('settings.termsOfService')}
            onPress={() => navigation.navigate('TermsOfService')}
          />
          <View style={styles.glassDivider} />
          <SettingsLink
            label={t('settings.privacyPolicy')}
            onPress={() => navigation.navigate('PrivacyPolicy')}
          />
        </GlassCard>

        {/* About Section */}
        <Text style={[styles.sectionHeader, { color: theme.textTertiary }]}>{t('settings.about')}</Text>
        <GlassCard variant="dark" padding={0} style={styles.glassCardMargin}>
          <TouchableOpacity
            activeOpacity={1}
            onLongPress={() => {
              if (__DEV__) {
                // Dev-only: long-press version label to open the design-system preview.
                navigation.navigate('__DesignSystem' as never);
              }
            }}
            delayLongPress={1200}
            style={styles.aboutRow}
          >
            <Text style={[styles.aboutLabel, { color: theme.textPrimary }]}>{t('settings.appVersion')}</Text>
            <Text style={[styles.aboutValue, { color: theme.textSecondary }]}>
              {APP_VERSION} ({BUILD_NUMBER})
            </Text>
          </TouchableOpacity>
          <View style={styles.glassDivider} />
          <SettingsLink
            label={t('settings.rateApp')}
            onPress={() => {
              Alert.alert(
                t('settings.thankYou'),
                t('settings.appreciateFeedback'),
              );
            }}
          />
          <View style={styles.glassDivider} />
          <SettingsLink
            label={t('settings.contactSupport')}
            onPress={() => {
              Linking.openURL('mailto:support@vispapp.com');
            }}
          />
        </GlassCard>

        <View style={styles.bottomSpacer} />
      </ScrollView>

      <Modal
        visible={recoveryModalOpen}
        transparent
        animationType="fade"
        onRequestClose={closeRecoveryModal}
      >
        <View style={recoveryStyles.backdrop}>
          <GlassCard variant="dark" padding={24} style={recoveryStyles.card}>
            <Text style={[recoveryStyles.title, { color: theme.textPrimary }]}>
              {t('settings.recoveryCodeTitle')}
            </Text>
            <Text style={[recoveryStyles.subtitle, { color: theme.textSecondary }]}>
              {recoveryCode
                ? t('settings.recoveryCodeShown')
                : t('settings.recoveryCodeEnterPassword')}
            </Text>

            {recoveryCode ? (
              <>
                <View style={recoveryStyles.codeBox}>
                  <Text selectable style={[recoveryStyles.codeText, { color: theme.textPrimary }]}>
                    {recoveryCode}
                  </Text>
                </View>
                <Text style={[recoveryStyles.hint, { color: theme.textSecondary }]}>
                  {t('settings.recoveryCodeWarning')}
                </Text>
                <View style={recoveryStyles.btnRow}>
                  <GlassButton
                    title={t('settings.recoveryCodeRotate')}
                    variant="outline"
                    onPress={rotateRecoveryCode}
                    loading={recoveryLoading}
                    style={recoveryStyles.btnFlex}
                  />
                  <GlassButton
                    title={t('common.close')}
                    variant="glow"
                    onPress={closeRecoveryModal}
                    style={recoveryStyles.btnFlex}
                  />
                </View>
              </>
            ) : (
              <>
                <TextInput
                  style={[recoveryStyles.input, { color: theme.inputText, backgroundColor: theme.inputBackground }]}
                  placeholder={t('settings.recoveryCodePasswordPlaceholder')}
                  placeholderTextColor={theme.inputPlaceholder}
                  secureTextEntry
                  autoCapitalize="none"
                  value={recoveryPwd}
                  onChangeText={setRecoveryPwd}
                  editable={!recoveryLoading}
                />
                {recoveryError ? (
                  <Text style={recoveryStyles.error}>{recoveryError}</Text>
                ) : null}
                <View style={recoveryStyles.btnRow}>
                  <GlassButton
                    title={t('common.cancel')}
                    variant="outline"
                    onPress={closeRecoveryModal}
                    style={recoveryStyles.btnFlex}
                  />
                  <GlassButton
                    title={t('settings.recoveryCodeReveal')}
                    variant="glow"
                    onPress={fetchRecoveryCode}
                    disabled={recoveryPwd.length < 1 || recoveryLoading}
                    loading={recoveryLoading}
                    style={recoveryStyles.btnFlex}
                  />
                </View>
              </>
            )}
          </GlassCard>
        </View>
      </Modal>
    </Screen>
  );
}

const recoveryStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  card: { width: '100%' },
  title: { fontSize: 20, fontWeight: '700', color: '#fff', marginBottom: 8 },
  subtitle: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.6)',
    marginBottom: 16,
    lineHeight: 20,
  },
  input: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: '#fff',
    fontSize: 15,
    marginBottom: 12,
  },
  error: {
    fontSize: 13,
    color: Colors.error,
    marginBottom: 12,
    textAlign: 'center',
  },
  codeBox: {
    backgroundColor: 'rgba(120,80,255,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(120,80,255,0.5)',
    borderRadius: 12,
    paddingVertical: 18,
    marginBottom: 12,
  },
  codeText: {
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
    fontSize: 22,
    color: '#fff',
    letterSpacing: 4,
    textAlign: 'center',
  },
  hint: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.5)',
    textAlign: 'center',
    marginBottom: 16,
    lineHeight: 18,
  },
  btnRow: { flexDirection: 'row', gap: 8 },
  btnFlex: { flex: 1 },
});

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
  glassCardMargin: {
    marginHorizontal: 16,
    marginBottom: 16,
  },
  sectionHeader: {
    fontSize: 13,
    fontWeight: '700',
    color: 'rgba(255, 255, 255, 0.35)',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingHorizontal: 16,
    marginBottom: 8,
    marginTop: 8,
  },
  glassDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    marginHorizontal: 16,
  },
  addPaymentButton: {
    padding: 14,
    alignItems: 'center',
  },
  addPaymentText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.primary,
  },
  aboutRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  aboutLabel: {
    fontSize: 15,
    color: Colors.textPrimary,
  },
  aboutValue: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.5)',
  },
  bottomSpacer: {
    height: 32,
  },
});
