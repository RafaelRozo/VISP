/**
 * VISP - Profile Screen
 *
 * User profile view/edit with avatar upload, name/email/phone display,
 * role badges, provider level display with progress, settings link,
 * and logout button.
 *
 * Dark glassmorphism redesign.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Colors, getLevelColor } from '../../theme/colors';
import { useTheme } from '../../theme/ThemeContext';
import { useTranslation } from '../../i18n';
import { GlassStyles } from '../../theme/glass';
import { GlassBackground, GlassCard, GlassButton, GlassInput } from '../../components/glass';
import { AnimatedSpinner } from '../../components/animations';
import LevelProgress from '../../components/LevelProgress';
import {
  LevelProgressInfo,
  PaymentMethodInfo,
  ProfileStackParamList,
  ProviderProfile,
  ServiceLevel,
  User,
  UserDefaultAddress,
} from '../../types';
import { get, patch, post } from '../../services/apiClient';
import { geolocationService } from '../../services/geolocationService';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ProfileNav = NativeStackNavigationProp<ProfileStackParamList, 'ProfileMain'>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getLevelNames(t: (k: string) => string): Record<number, string> {
  return {
    1: t('profileScreen.helper'),
    2: t('profileScreen.experienced'),
    3: t('profileScreen.certifiedPro'),
    4: t('profileScreen.emergency'),
  };
}

function getRoleLabels(t: (k: string) => string): Record<string, string> {
  return {
    customer: t('profileScreen.customer'),
    provider: t('profileScreen.serviceProvider'),
    both: t('profileScreen.customer') + ' & ' + t('profileScreen.serviceProvider'),
  };
}

// ---------------------------------------------------------------------------
// Avatar sub-component
// ---------------------------------------------------------------------------

interface AvatarSectionProps {
  avatarUrl: string | null;
  firstName: string;
  lastName: string;
  onChangeAvatar: () => void;
}

function AvatarSection({
  avatarUrl,
  firstName,
  lastName,
  onChangeAvatar,
}: AvatarSectionProps): React.JSX.Element {
  const { t } = useTranslation();
  const safeFirst = firstName || '?';
  const safeLast = lastName || '?';
  const initials = `${safeFirst.charAt(0)}${safeLast.charAt(0)}`.toUpperCase();

  return (
    <TouchableOpacity
      style={avatarStyles.container}
      onPress={onChangeAvatar}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel="Change profile photo"
    >
      {avatarUrl ? (
        <Image source={{ uri: avatarUrl }} style={avatarStyles.image} />
      ) : (
        <View style={avatarStyles.placeholder}>
          <Text style={avatarStyles.initials}>{initials}</Text>
        </View>
      )}
      <View style={avatarStyles.editBadge}>
        <Text style={avatarStyles.editBadgeText}>{t('profileScreen.edit')}</Text>
      </View>
    </TouchableOpacity>
  );
}

const avatarStyles = StyleSheet.create({
  container: {
    alignSelf: 'center',
    marginBottom: 16,
  },
  image: {
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.20)',
  },
  placeholder: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: 'rgba(120, 80, 255, 0.4)',
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.20)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  initials: {
    fontSize: 32,
    fontWeight: '700',
    color: Colors.white,
  },
  editBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    backgroundColor: 'rgba(10, 10, 30, 0.70)',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.20)',
  },
  editBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.primary,
  },
});

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

import { useAuthStore } from '../../stores/authStore';
import { useProviderStore } from '../../stores/providerStore';

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

const INITIAL_LEVEL_PROGRESS: LevelProgressInfo = {
  currentLevel: 1 as ServiceLevel,
  nextLevel: 2 as ServiceLevel,
  progressPercent: 0,
  requirements: [],
};

export default function ProfileScreen(): React.JSX.Element {
  const theme = useTheme();
  const { t } = useTranslation();
  const navigation = useNavigation<ProfileNav>();

  // Get real user data from stores
  const { user, setUser, logout } = useAuthStore();
  const { providerProfile } = useProviderStore();

  // Compute level progress from real profile data
  const levelProgress = React.useMemo<LevelProgressInfo>(() => {
    if (!providerProfile) return INITIAL_LEVEL_PROGRESS;
    const currentLevel = (providerProfile.level ?? 1) as ServiceLevel;
    const nextLevel = Math.min(currentLevel + 1, 4) as ServiceLevel;
    const completedJobs = providerProfile.completedJobs ?? 0;
    const rating = providerProfile.rating ?? 0;
    const jobThresholds: Record<number, number> = { 1: 25, 2: 50, 3: 100, 4: 999 };
    const threshold = jobThresholds[currentLevel] ?? 25;
    const progressPercent = Math.min(Math.round((completedJobs / threshold) * 100), 100);
    return {
      currentLevel,
      nextLevel,
      progressPercent,
      requirements: [
        {
          label: `Complete ${threshold} jobs`,
          description: `${completedJobs} of ${threshold} completed`,
          isMet: completedJobs >= threshold,
        },
        {
          label: t('profileScreen.edit'),
          description: `Current rating: ${rating.toFixed(1)}`,
          isMet: rating >= 4.5,
        },
      ],
    };
  }, [providerProfile]);
  const [isEditing, setIsEditing] = useState(false);

  // Initialize edit state with user data (safely handle null user)
  const [editFirstName, setEditFirstName] = useState('');
  const [editLastName, setEditLastName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [countryCode, setCountryCode] = useState('+52');
  const [isSaving, setIsSaving] = useState(false);

  // Address state
  const [isEditingAddress, setIsEditingAddress] = useState(false);
  const [addressInput, setAddressInput] = useState('');
  const [addressSuggestions, setAddressSuggestions] = useState<any[]>([]);
  const [isSavingAddress, setIsSavingAddress] = useState(false);

  // Payment state
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodInfo[]>([]);
  const [isLoadingPayments, setIsLoadingPayments] = useState(false);
  const [isAddingCard, setIsAddingCard] = useState(false);

  // Update local edit state when user changes (e.g. after save)
  useEffect(() => {
    if (user) {
      setEditFirstName(user.firstName);
      setEditLastName(user.lastName);
      const rawPhone = user.phone || '';
      const knownCodes = ['+52', '+57', '+54', '+44', '+34', '+1'];
      let foundCode = '+52';
      let phoneNumber = rawPhone;
      for (const code of knownCodes) {
        if (rawPhone.startsWith(code)) {
          foundCode = code;
          phoneNumber = rawPhone.slice(code.length).replace(/^\s+/, '');
          break;
        }
      }
      setCountryCode(foundCode);
      setEditPhone(phoneNumber);
    }
  }, [user]);

  const isProvider = user?.role === 'provider';

  if (!user) {
    return (
      <GlassBackground>
        <View style={styles.centerContent}>
          <AnimatedSpinner size={48} color={Colors.primary} />
        </View>
      </GlassBackground>
    );
  }

  const handleChangeAvatar = useCallback(() => {
    Alert.alert(t('profileScreen.edit'), t('profileScreen.edit'), [
      { text: t('profileScreen.edit'), onPress: () => { } },
      { text: t('profileScreen.edit'), onPress: () => { } },
      { text: t('common.cancel'), style: 'cancel' },
    ]);
  }, []);

  const handleSaveProfile = useCallback(async () => {
    if (!user) return;
    setIsSaving(true);
    try {
      const fullPhone = editPhone ? `${countryCode}${editPhone}` : '';
      await patch('/users/me', {
        firstName: editFirstName,
        lastName: editLastName,
        phone: fullPhone,
      });
      setUser({
        ...user,
        firstName: editFirstName,
        lastName: editLastName,
        phone: fullPhone,
      });
      setIsEditing(false);
    } catch {
      Alert.alert(t('common.error'), t('common.tryAgain'));
    } finally {
      setIsSaving(false);
    }
  }, [editFirstName, editLastName, editPhone, countryCode, user, setUser]);

  // -- Address handlers --
  const handleAddressSearch = useCallback(async (text: string) => {
    setAddressInput(text);
    if (text.length >= 4) {
      try {
        const result = await geolocationService.geocodeAddress(text);
        if (result && result.formatted_address) {
          const parsed = geolocationService.parseAddress(result.formatted_address);
          setAddressSuggestions([{
            formattedAddress: result.formatted_address,
            latitude: result.lat,
            longitude: result.lng,
            street: parsed.street,
            city: parsed.city,
            province: parsed.province,
            postalCode: parsed.postalCode,
            country: parsed.country || '',
          }]);
        } else {
          setAddressSuggestions([]);
        }
      } catch (err) {
        console.error('[ADDRESS_SEARCH] Geocoding error:', JSON.stringify(err, null, 2));
        setAddressSuggestions([]);
      }
    } else {
      setAddressSuggestions([]);
    }
  }, []);

  const handleSelectAddress = useCallback(async (addr: any) => {
    if (!user) return;
    setIsSavingAddress(true);
    try {
      const addressPayload: UserDefaultAddress = {
        street: addr.street || '',
        city: addr.city || '',
        province: addr.province || '',
        postalCode: addr.postalCode || '',
        country: addr.country || 'MX',
        latitude: addr.latitude,
        longitude: addr.longitude,
        formattedAddress: addr.formattedAddress,
      };
      await patch('/users/me', { defaultAddress: addressPayload });
      setUser({ ...user, defaultAddress: addressPayload });
      setIsEditingAddress(false);
      setAddressInput('');
      setAddressSuggestions([]);
    } catch (err: any) {
      console.error('[ADDRESS_SAVE] Error:', JSON.stringify(err?.response?.data || err?.message || err, null, 2));
      Alert.alert('Error', `Failed to save address: ${err?.response?.data?.detail || err?.message || 'Unknown error'}`);
    } finally {
      setIsSavingAddress(false);
    }
  }, [user, setUser]);

  // -- Payment handlers --
  const fetchPaymentMethods = useCallback(async () => {
    setIsLoadingPayments(true);
    try {
      const res = await get<{ methods: PaymentMethodInfo[] }>('/users/me/payment-methods');
      setPaymentMethods(res?.methods ?? []);
    } catch {
      // No payment methods
    } finally {
      setIsLoadingPayments(false);
    }
  }, []);

  useEffect(() => {
    fetchPaymentMethods();
  }, [fetchPaymentMethods]);

  const handleAddCard = useCallback(async () => {
    setIsAddingCard(true);
    try {
      const res = await post<{ clientSecret: string; customerId: string }>(
        '/users/me/payment-setup-intent',
        {},
      );
      Alert.alert(
        t('profileScreen.paymentMethods'),
        'To add a card, Stripe SDK integration is required.\n\n'
        + 'SetupIntent created successfully.\n'
        + `Customer ID: ${res.customerId}`,
        [{ text: t('common.ok') }],
      );
    } catch {
      Alert.alert(t('common.error'), t('common.tryAgain'));
    } finally {
      setIsAddingCard(false);
    }
  }, []);

  const handleLogout = useCallback(() => {
    Alert.alert(t('profileScreen.logout'), t('profileScreen.logoutConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('profileScreen.logout'),
        style: 'destructive',
        onPress: () => {
          logout();
        },
      },
    ]);
  }, [logout]);

  return (
    <GlassBackground>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}
      >
        {/* Avatar */}
        <AvatarSection
          avatarUrl={user.avatarUrl}
          firstName={user.firstName}
          lastName={user.lastName}
          onChangeAvatar={handleChangeAvatar}
        />

        {/* Name display / edit */}
        <GlassCard variant="standard" style={styles.glassCardMargin}>
          {isEditing ? (
            <View>
              <GlassInput
                label={t('auth.firstName')}
                value={editFirstName}
                onChangeText={setEditFirstName}
                placeholder="First name"
                autoCapitalize="words"
                containerStyle={{ marginBottom: 12 }}
              />
              <GlassInput
                label={t('auth.lastName')}
                value={editLastName}
                onChangeText={setEditLastName}
                placeholder="Last name"
                autoCapitalize="words"
                containerStyle={{ marginBottom: 12 }}
              />
              <Text style={[styles.fieldLabel, { color: theme.textSecondary }]}>{t('profileScreen.phone')}</Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TouchableOpacity
                  style={styles.countryCodeButton}
                  onPress={() => {
                    const codes = [
                      { label: '+52 MX', value: '+52' },
                      { label: '+1 US', value: '+1' },
                      { label: '+1 CA', value: '+1' },
                      { label: '+44 UK', value: '+44' },
                      { label: '+34 ES', value: '+34' },
                      { label: '+57 CO', value: '+57' },
                      { label: '+54 AR', value: '+54' },
                    ];
                    Alert.alert(t('auth.selectCountryCode'), '', codes.map(c => ({
                      text: c.label,
                      onPress: () => setCountryCode(c.value),
                    })));
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Select country code"
                >
                  <Text style={styles.countryCodeText}>
                    {countryCode}
                  </Text>
                </TouchableOpacity>
                <View style={{ flex: 1 }}>
                  <GlassInput
                    value={editPhone}
                    onChangeText={setEditPhone}
                    placeholder="Phone number"
                    keyboardType="phone-pad"
                  />
                </View>
              </View>
              <View style={styles.editActions}>
                <GlassButton
                  title="Cancel"
                  variant="outline"
                  onPress={() => {
                    setIsEditing(false);
                    setEditFirstName(user.firstName);
                    setEditLastName(user.lastName);
                    setEditPhone(user.phone || '');
                  }}
                  style={{ flex: 1 }}
                />
                <GlassButton
                  title="Save"
                  variant="glow"
                  onPress={handleSaveProfile}
                  disabled={isSaving}
                  loading={isSaving}
                  style={{ flex: 1 }}
                />
              </View>
            </View>
          ) : (
            <View>
              <View style={styles.nameRow}>
                <Text style={styles.userName}>
                  {user.firstName} {user.lastName}
                </Text>
                <TouchableOpacity
                  onPress={() => setIsEditing(true)}
                  accessibilityRole="button"
                  accessibilityLabel="Edit name"
                >
                  <Text style={styles.editLink}>Edit</Text>
                </TouchableOpacity>
              </View>

              {/* Role badges */}
              <View style={styles.roleBadgesRow}>
                <View style={[GlassStyles.badge]}>
                  <Text style={styles.roleBadgeText}>
                    {getRoleLabels(t)[user.role]}
                  </Text>
                </View>
                {user.isVerified && (
                  <View
                    style={[
                      GlassStyles.badge,
                      { backgroundColor: `${Colors.success}20`, borderColor: `${Colors.success}40` },
                    ]}
                  >
                    <Text
                      style={[
                        styles.roleBadgeText,
                        { color: Colors.success },
                      ]}
                    >
                      Verified
                    </Text>
                  </View>
                )}
              </View>
            </View>
          )}
        </GlassCard>

        {/* Contact info */}
        <GlassCard variant="standard" style={styles.glassCardMargin}>
          <View style={styles.infoRow}>
            <Text style={[styles.infoLabel, { color: theme.textSecondary }]}>{t('profileScreen.email')}</Text>
            <Text style={styles.infoValue}>{user.email}</Text>
          </View>
          <View style={styles.glassDivider} />
          <View style={styles.infoRow}>
            <Text style={[styles.infoLabel, { color: theme.textSecondary }]}>{t('profileScreen.phone')}</Text>
            <Text style={styles.infoValue}>
              {user.phone ?? t('profileScreen.noAddress')}
            </Text>
          </View>
          <View style={styles.glassDivider} />
          <View style={styles.infoRow}>
            <Text style={[styles.infoLabel, { color: theme.textSecondary }]}>{t('profileScreen.memberSince')}</Text>
            <Text style={styles.infoValue}>
              {new Date(user.createdAt).toLocaleDateString(t('common.ok') === 'OK' ? 'en-CA' : 'fr-CA', {
                year: 'numeric',
                month: 'long',
              })}
            </Text>
          </View>
        </GlassCard>

        {/* Saved Address */}
        <GlassCard variant="standard" style={styles.glassCardMargin}>
          <View style={styles.nameRow}>
            <Text style={styles.sectionLabel}>{t('profileScreen.savedAddress')}</Text>
            <TouchableOpacity
              onPress={() => setIsEditingAddress(!isEditingAddress)}
              accessibilityRole="button"
            >
              <Text style={styles.editLink}>
                {user.defaultAddress ? t('profileScreen.change') : t('profileScreen.edit')}
              </Text>
            </TouchableOpacity>
          </View>

          {user.defaultAddress ? (
            <View style={{ marginTop: 8 }}>
              <Text style={[styles.infoValue, { marginBottom: 2 }]}>
                {user.defaultAddress.formattedAddress || user.defaultAddress.street}
              </Text>
              <Text style={[styles.infoLabel, { color: theme.textSecondary }]}>
                {user.defaultAddress.city}{user.defaultAddress.province ? `, ${user.defaultAddress.province}` : ''}
                {user.defaultAddress.postalCode ? ` ${user.defaultAddress.postalCode}` : ''}
              </Text>
            </View>
          ) : (
            <Text style={[styles.infoLabel, { marginTop: 8 }]}>No address saved</Text>
          )}

          {isEditingAddress && (
            <View style={{ marginTop: 12 }}>
              <GlassInput
                value={addressInput}
                onChangeText={handleAddressSearch}
                placeholder="Search your address..."
                autoCapitalize="words"
                returnKeyType="search"
              />
              {isSavingAddress && (
                <AnimatedSpinner size={24} color={Colors.primary} style={{ marginTop: 8, alignSelf: 'center' }} />
              )}
              {addressSuggestions.length > 0 && (
                <View style={styles.suggestionsContainer}>
                  {addressSuggestions.map((s, i) => (
                    <TouchableOpacity
                      key={i}
                      style={[
                        styles.suggestionItem,
                        i < addressSuggestions.length - 1 && styles.suggestionBorder,
                      ]}
                      onPress={() => handleSelectAddress(s)}
                    >
                      <Text style={[styles.infoValue, { fontSize: 14 }]}>{s.formattedAddress}</Text>
                      <Text style={[styles.infoLabel, { fontSize: 12, marginTop: 2 }]}>
                        {s.city}, {s.province} {s.postalCode}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>
          )}
        </GlassCard>



        {/* Provider level progress */}
        {isProvider && providerProfile && (
          <LevelProgress progressInfo={levelProgress} />
        )}

        {/* Navigation links - provider */}
        {isProvider && (
          <GlassCard variant="dark" padding={0} style={styles.glassCardMargin}>
            <TouchableOpacity
              style={styles.linkRow}
              onPress={() => navigation.navigate('ProviderOnboarding')}
              accessibilityRole="button"
            >
              <Text style={styles.linkText}>{t('profileScreen.myServices')}</Text>
              <Text style={[styles.linkArrow, { color: theme.textSecondary }]}>{'\u203A'}</Text>
            </TouchableOpacity>
            <View style={styles.glassDivider} />
            <TouchableOpacity
              style={styles.linkRow}
              onPress={() => navigation.navigate('Credentials')}
              accessibilityRole="button"
            >
              <Text style={styles.linkText}>{t('profileScreen.credentials')}</Text>
              <Text style={[styles.linkArrow, { color: theme.textSecondary }]}>{'\u203A'}</Text>
            </TouchableOpacity>
            <View style={styles.glassDivider} />
            <TouchableOpacity
              style={styles.linkRow}
              onPress={() => navigation.navigate('Verification')}
              accessibilityRole="button"
            >
              <Text style={styles.linkText}>{t('profileScreen.verification')}</Text>
              <Text style={[styles.linkArrow, { color: theme.textSecondary }]}>{'\u203A'}</Text>
            </TouchableOpacity>
          </GlassCard>
        )}

        {/* Navigation links - common */}
        <GlassCard variant="dark" padding={0} style={styles.glassCardMargin}>
          <TouchableOpacity
            style={styles.linkRow}
            onPress={() => navigation.navigate('PaymentMethods')}
            accessibilityRole="button"
          >
            <Text style={styles.linkText}>{t('profileScreen.paymentMethods')}</Text>
            <Text style={[styles.linkArrow, { color: theme.textSecondary }]}>{'\u203A'}</Text>
          </TouchableOpacity>
          <View style={styles.glassDivider} />
          <TouchableOpacity
            style={styles.linkRow}
            onPress={() => navigation.navigate('Settings')}
            accessibilityRole="button"
          >
            <Text style={styles.linkText}>{t('profileScreen.settings')}</Text>
            <Text style={[styles.linkArrow, { color: theme.textSecondary }]}>{'\u203A'}</Text>
          </TouchableOpacity>
        </GlassCard>

        {/* Logout */}
        <GlassButton
          title={t('profileScreen.logout')}
          variant="outline"
          onPress={handleLogout}
          style={styles.logoutButton}
        />

        <Text style={styles.versionText}>v1.0.0 (Build 42)</Text>
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
    paddingTop: 24,
    paddingBottom: 32,
  },
  centerContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  glassCardMargin: {
    marginHorizontal: 16,
    marginBottom: 12,
  },
  nameRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  userName: {
    fontSize: 22,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  editLink: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.primary,
  },
  roleBadgesRow: {
    flexDirection: 'row',
    gap: 8,
  },
  roleBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.7)',
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  infoLabel: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.5)',
  },
  infoValue: {
    fontSize: 14,
    fontWeight: '500',
    color: Colors.textPrimary,
  },
  sectionLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.7)',
  },
  glassDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255, 255, 255, 0.10)',
    marginVertical: 8,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.55)',
    marginBottom: 6,
    marginTop: 4,
  },
  countryCodeButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.07)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 14,
    justifyContent: 'center',
    minWidth: 90,
  },
  countryCodeText: {
    fontSize: 15,
    color: Colors.textPrimary,
    fontWeight: '500',
  },
  editActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
  },
  suggestionsContainer: {
    marginTop: 8,
    backgroundColor: 'rgba(10, 10, 30, 0.55)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    overflow: 'hidden',
  },
  suggestionItem: {
    padding: 12,
  },
  suggestionBorder: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
  },
  cardIconContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(120, 80, 255, 0.2)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  cardIconText: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.primary,
  },
  linkRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
  },
  linkText: {
    fontSize: 15,
    fontWeight: '500',
    color: Colors.textPrimary,
  },
  linkArrow: {
    fontSize: 22,
    color: 'rgba(255, 255, 255, 0.35)',
  },
  logoutButton: {
    marginHorizontal: 16,
    marginBottom: 24,
    borderColor: 'rgba(231, 76, 60, 0.5)',
  },
  versionText: {
    textAlign: 'center',
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.25)',
    marginBottom: 32,
  },
});
