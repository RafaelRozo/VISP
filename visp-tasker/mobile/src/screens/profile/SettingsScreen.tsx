/**
 * VISP - Settings Screen
 *
 * Notification preferences, payment methods management, language selection,
 * app theme (dark/light), privacy settings, terms of service links, and
 * about/version info.
 *
 * Dark glassmorphism redesign.
 */

import React, { useCallback, useState } from 'react';
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
import { GlassStyles } from '../../theme/glass';
import { GlassBackground, GlassCard, GlassButton } from '../../components/glass';
import {
  NotificationPreferences,
  PaymentMethod,
} from '../../types';
import { patch } from '../../services/apiClient';

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
  return (
    <View style={rowStyles.container}>
      <Text style={rowStyles.label}>{label}</Text>
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
  return (
    <TouchableOpacity
      style={rowStyles.container}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
    >
      <Text style={rowStyles.label}>{label}</Text>
      <View style={rowStyles.valueRow}>
        {value && <Text style={rowStyles.value}>{value}</Text>}
        <Text style={rowStyles.arrow}>{'\u203A'}</Text>
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
  return (
    <View style={paymentStyles.container}>
      <View style={paymentStyles.left}>
        <Text style={paymentStyles.type}>
          {method.brand ?? method.type === 'card' ? 'Card' : 'Bank'}
        </Text>
        <Text style={paymentStyles.last4}>
          {'\u2022\u2022\u2022\u2022'} {method.last4}
        </Text>
        {method.expiresAt && (
          <Text style={paymentStyles.expiry}>
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
  // Notification preferences
  const [notifications, setNotifications] = useState<NotificationPreferences>({
    pushEnabled: true,
    jobOffers: true,
    jobUpdates: true,
    promotions: false,
    emergencyAlerts: true,
  });

  // App settings
  const [language, setLanguage] = useState('en');
  const [darkMode, setDarkMode] = useState(true);

  // Payment methods
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([
    {
      id: 'pm_1',
      type: 'card',
      last4: '4242',
      brand: 'Visa',
      isDefault: true,
      expiresAt: '2027-03-01T00:00:00Z',
    },
  ]);

  // Notification toggle handler
  const handleNotificationToggle = useCallback(
    async (key: keyof NotificationPreferences, value: boolean) => {
      const updated = { ...notifications, [key]: value };
      setNotifications(updated);
      try {
        await patch('/users/me/notifications', updated);
      } catch {
        setNotifications(notifications);
      }
    },
    [notifications],
  );

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
            setLanguage(LANGUAGES[buttonIndex - 1].code);
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
            onPress: () => setLanguage(lang.code),
          })),
        ],
      );
    }
  }, []);

  // Theme toggle
  const handleThemeToggle = useCallback((value: boolean) => {
    setDarkMode(value);
  }, []);

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
    <GlassBackground>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}
      >
        {/* Notifications Section */}
        <Text style={styles.sectionHeader}>Notifications</Text>
        <GlassCard variant="dark" padding={0} style={styles.glassCardMargin}>
          <SettingsToggle
            label="Push Notifications"
            value={notifications.pushEnabled}
            onToggle={(v) => handleNotificationToggle('pushEnabled', v)}
          />
          <View style={styles.glassDivider} />
          <SettingsToggle
            label="Job Offers"
            value={notifications.jobOffers}
            onToggle={(v) => handleNotificationToggle('jobOffers', v)}
          />
          <View style={styles.glassDivider} />
          <SettingsToggle
            label="Job Updates"
            value={notifications.jobUpdates}
            onToggle={(v) => handleNotificationToggle('jobUpdates', v)}
          />
          <View style={styles.glassDivider} />
          <SettingsToggle
            label="Promotions"
            value={notifications.promotions}
            onToggle={(v) => handleNotificationToggle('promotions', v)}
          />
          <View style={styles.glassDivider} />
          <SettingsToggle
            label="Emergency Alerts"
            value={notifications.emergencyAlerts}
            onToggle={(v) => handleNotificationToggle('emergencyAlerts', v)}
          />
        </GlassCard>

        {/* Payment Methods Section */}
        <Text style={styles.sectionHeader}>Payment Methods</Text>
        <GlassCard variant="dark" padding={0} style={styles.glassCardMargin}>
          {paymentMethods.map((method, index) => (
            <React.Fragment key={method.id}>
              <PaymentMethodCard
                method={method}
                onRemove={handleRemovePaymentMethod}
              />
              {index < paymentMethods.length - 1 && (
                <View style={styles.glassDivider} />
              )}
            </React.Fragment>
          ))}
          <View style={styles.glassDivider} />
          <TouchableOpacity
            style={styles.addPaymentButton}
            onPress={handleAddPaymentMethod}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Add payment method"
          >
            <Text style={styles.addPaymentText}>+ Add Payment Method</Text>
          </TouchableOpacity>
        </GlassCard>

        {/* App Settings Section */}
        <Text style={styles.sectionHeader}>App Settings</Text>
        <GlassCard variant="dark" padding={0} style={styles.glassCardMargin}>
          <SettingsLink
            label="Language"
            value={currentLanguageLabel}
            onPress={handleLanguagePicker}
          />
          <View style={styles.glassDivider} />
          <SettingsToggle
            label="Dark Mode"
            value={darkMode}
            onToggle={handleThemeToggle}
          />
        </GlassCard>

        {/* Privacy & Legal Section */}
        <Text style={styles.sectionHeader}>Privacy & Legal</Text>
        <GlassCard variant="dark" padding={0} style={styles.glassCardMargin}>
          <SettingsLink
            label="Privacy Settings"
            onPress={() => {
              Alert.alert(
                'Privacy Settings',
                'Manage your data sharing and privacy preferences.',
                [{ text: 'OK' }],
              );
            }}
          />
          <View style={styles.glassDivider} />
          <SettingsLink
            label="Terms of Service"
            onPress={() => openURL(TERMS_URL)}
          />
          <View style={styles.glassDivider} />
          <SettingsLink
            label="Privacy Policy"
            onPress={() => openURL(PRIVACY_URL)}
          />
        </GlassCard>

        {/* About Section */}
        <Text style={styles.sectionHeader}>About</Text>
        <GlassCard variant="dark" padding={0} style={styles.glassCardMargin}>
          <View style={styles.aboutRow}>
            <Text style={styles.aboutLabel}>App Version</Text>
            <Text style={styles.aboutValue}>
              {APP_VERSION} ({BUILD_NUMBER})
            </Text>
          </View>
          <View style={styles.glassDivider} />
          <SettingsLink
            label="Rate the App"
            onPress={() => {
              Alert.alert('Thank you!', 'We appreciate your feedback.');
            }}
          />
          <View style={styles.glassDivider} />
          <SettingsLink
            label="Contact Support"
            onPress={() => {
              Linking.openURL('mailto:support@vispapp.com');
            }}
          />
        </GlassCard>

        <View style={styles.bottomSpacer} />
      </ScrollView>
    </GlassBackground>
  );
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
