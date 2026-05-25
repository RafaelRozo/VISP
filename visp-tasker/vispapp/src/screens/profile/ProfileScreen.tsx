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
  ActionSheetIOS,
  Alert,
  Image,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as ImagePicker from 'expo-image-picker';
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
import { userService, resolveAvatarUrl } from '../../services/userService';

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
  isUploading: boolean;
}

function AvatarSection({
  avatarUrl,
  firstName,
  lastName,
  onChangeAvatar,
  isUploading,
}: AvatarSectionProps): React.JSX.Element {
  const { t } = useTranslation();
  const safeFirst = firstName || '?';
  const safeLast = lastName || '?';
  const initials = `${safeFirst.charAt(0)}${safeLast.charAt(0)}`.toUpperCase();
  const resolvedUrl = resolveAvatarUrl(avatarUrl);

  return (
    <TouchableOpacity
      style={avatarStyles.container}
      onPress={onChangeAvatar}
      activeOpacity={0.7}
      disabled={isUploading}
      accessibilityRole="button"
      accessibilityLabel={t('profileScreen.changePhotoTitle')}
    >
      {resolvedUrl ? (
        <Image source={{ uri: resolvedUrl }} style={avatarStyles.image} />
      ) : (
        <View style={avatarStyles.placeholder}>
          <Text style={avatarStyles.initials}>{initials}</Text>
        </View>
      )}
      {isUploading && (
        <View style={avatarStyles.uploadingOverlay}>
          <AnimatedSpinner size={32} color={Colors.white} />
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
  uploadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    alignItems: 'center',
    justifyContent: 'center',
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
  const { user, setUser, logout, activeMode } = useAuthStore();
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
          label: t('profileScreen.completeJobs', { count: threshold }),
          description: t('profileScreen.jobsCompleted', { done: completedJobs, total: threshold }),
          isMet: completedJobs >= threshold,
        },
        {
          label: t('profileScreen.maintainRating'),
          description: t('profileScreen.currentRating', { rating: rating.toFixed(1) }),
          isMet: rating >= 4.5,
        },
      ],
    };
  }, [providerProfile, t]);
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

  // Avatar upload state
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);

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

  // 'both' users see the provider section while in provider mode.
  const isProvider =
    user?.role === 'provider' ||
    (user?.role === 'both' && activeMode === 'provider');

  if (!user) {
    return (
      <GlassBackground>
        <View style={styles.centerContent}>
          <AnimatedSpinner size={48} color={Colors.primary} />
        </View>
      </GlassBackground>
    );
  }

  const performAvatarUpload = useCallback(
    async (asset: ImagePicker.ImagePickerAsset) => {
      if (!user) return;
      setIsUploadingAvatar(true);
      try {
        const updated = await userService.uploadAvatar({
          uri: asset.uri,
          mimeType: asset.mimeType,
          fileName: asset.fileName,
        });
        setUser({ ...user, ...updated });
      } catch (err) {
        console.error('[AVATAR_UPLOAD] Failed:', err);
        Alert.alert(t('common.error'), t('profileScreen.uploadPhotoFailed'));
      } finally {
        setIsUploadingAvatar(false);
      }
    },
    [user, setUser, t],
  );

  const pickFromCamera = useCallback(async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(t('common.error'), t('profileScreen.permissionDenied'));
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    });
    if (!result.canceled && result.assets?.[0]) {
      await performAvatarUpload(result.assets[0]);
    }
  }, [performAvatarUpload, t]);

  const performAvatarRemove = useCallback(async () => {
    if (!user) return;
    setIsUploadingAvatar(true);
    try {
      const updated = await userService.removeAvatar();
      setUser({ ...user, ...updated });
    } catch (err) {
      console.error('[AVATAR_REMOVE] Failed:', err);
      Alert.alert(t('common.error'), t('common.tryAgain'));
    } finally {
      setIsUploadingAvatar(false);
    }
  }, [user, setUser, t]);

  const pickFromLibrary = useCallback(async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(t('common.error'), t('profileScreen.permissionDenied'));
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    });
    if (!result.canceled && result.assets?.[0]) {
      await performAvatarUpload(result.assets[0]);
    }
  }, [performAvatarUpload, t]);

  const handleChangeAvatar = useCallback(() => {
    if (!user) return;
    const hasAvatar = !!user.avatarUrl;

    if (Platform.OS === 'ios') {
      const options = [
        t('profileScreen.takePhoto'),
        t('profileScreen.chooseFromLibrary'),
        ...(hasAvatar ? [t('profileScreen.removePhoto')] : []),
        t('common.cancel'),
      ];
      const cancelIndex = options.length - 1;
      const destructiveIndex = hasAvatar ? options.length - 2 : -1;

      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: t('profileScreen.changePhotoTitle'),
          options,
          cancelButtonIndex: cancelIndex,
          destructiveButtonIndex: destructiveIndex >= 0 ? destructiveIndex : undefined,
          userInterfaceStyle: 'dark',
        },
        (buttonIndex) => {
          if (buttonIndex === 0) pickFromCamera();
          else if (buttonIndex === 1) pickFromLibrary();
          else if (hasAvatar && buttonIndex === 2) performAvatarRemove();
        },
      );
    } else {
      const buttons: Array<{ text: string; style?: 'cancel' | 'destructive'; onPress?: () => void }> = [
        { text: t('profileScreen.takePhoto'), onPress: pickFromCamera },
        { text: t('profileScreen.chooseFromLibrary'), onPress: pickFromLibrary },
      ];
      if (hasAvatar) {
        buttons.push({
          text: t('profileScreen.removePhoto'),
          style: 'destructive',
          onPress: performAvatarRemove,
        });
      }
      buttons.push({ text: t('common.cancel'), style: 'cancel' });
      Alert.alert(t('profileScreen.changePhotoTitle'), '', buttons);
    }
  }, [user, t, pickFromCamera, pickFromLibrary, performAvatarRemove]);

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
          isUploading={isUploadingAvatar}
        />

        {/* Name display / edit */}
        <GlassCard variant="standard" style={styles.glassCardMargin}>
          {isEditing ? (
            <View>
              <GlassInput
                label={t('auth.firstName')}
                value={editFirstName}
                onChangeText={setEditFirstName}
                placeholder={t('profileScreen.firstNamePlaceholder')}
                autoCapitalize="words"
                containerStyle={{ marginBottom: 12 }}
              />
              <GlassInput
                label={t('auth.lastName')}
                value={editLastName}
                onChangeText={setEditLastName}
                placeholder={t('profileScreen.lastNamePlaceholder')}
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
                    placeholder={t('profileScreen.phoneNumberPlaceholder')}
                    keyboardType="phone-pad"
                  />
                </View>
              </View>
              <View style={styles.editActions}>
                <GlassButton
                  title={t('common.cancel')}
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
                  title={t('profileScreen.saveButton')}
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
                  accessibilityLabel={t('profileScreen.edit')}
                >
                  <Text style={styles.editLink}>{t('profileScreen.edit')}</Text>
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
                      {t('profileScreen.verified')}
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
            <Text style={[styles.infoLabel, { marginTop: 8 }]}>{t('profileScreen.noAddressSaved')}</Text>
          )}

          {isEditingAddress && (
            <View style={{ marginTop: 12 }}>
              <GlassInput
                value={addressInput}
                onChangeText={handleAddressSearch}
                placeholder={t('profileScreen.searchAddress')}
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

        <Text style={styles.versionText}>{t('profileScreen.appVersion', { version: '1.0.0', build: '8' })}</Text>
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
  modeSwitcherRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  modeSwitcherLabel: {
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 4,
  },
  modeSwitcherHint: {
    fontSize: 12,
    lineHeight: 16,
  },
  modeSwitcherButton: {
    minWidth: 130,
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
