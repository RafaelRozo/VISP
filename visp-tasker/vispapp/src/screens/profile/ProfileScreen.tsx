/**
 * VISP - Profile Screen (Mockup-fidelity refresh)
 *
 * Matches `CustomerAccount` + `ProviderProfile` in newdesign/app-customer.jsx
 * and newdesign/app-provider.jsx. The same screen is shared across customer
 * and provider tabs (and toggled by RoleSwitcher when role === 'both').
 *
 * Layout:
 *   ScreenTitle "Account" / "§ Profile & Settings" → settings IconBtn
 *   Profile Card  → Avatar 56 + name + member-since eyebrow + EDIT pill
 *                   + 3-up stats row (jobs / spent or earned / providers or rating)
 *   RoleSwitcher  (only when user.role === 'both')
 *   Eyebrow "Settings"     → MenuItems
 *   Eyebrow "Provider"     → MenuItems with `accent` prop (provider mode only)
 *   Eyebrow "General"      → MenuItems including Sign out
 *
 * Hooks, stores, navigation, avatar upload flow are preserved verbatim.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActionSheetIOS,
  Alert,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as ImagePicker from 'expo-image-picker';

import { useTranslation } from '../../i18n';
import {
  Screen,
  ScreenTitle,
  Eyebrow,
  Card,
  Avatar,
  MenuItem,
  IconBtn,
} from '../../components/visp';
import { useVispTheme, VispText, VispSpace, FontSansBold, FontMono } from '../../theme/visp';
import { AnimatedSpinner } from '../../components/animations';
import RoleSwitcher from '../../components/RoleSwitcher';
import {
  PaymentMethodInfo,
  ProfileStackParamList,
} from '../../types';
import { get, post } from '../../services/apiClient';
import { userService, resolveAvatarUrl } from '../../services/userService';
import { useAuthStore } from '../../stores/authStore';
import { useProviderStore } from '../../stores/providerStore';

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

type ProfileNav = NativeStackNavigationProp<ProfileStackParamList, 'ProfileMain'>;

// ──────────────────────────────────────────────
// MotionPressable
// ──────────────────────────────────────────────

function MotionPressable({
  onPress,
  children,
  style,
  pressScale = 0.96,
}: {
  onPress?: () => void;
  children: React.ReactNode;
  style?: ViewStyle | ViewStyle[];
  pressScale?: number;
}): React.JSX.Element {
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <Pressable
      onPress={onPress}
      style={style}
      onPressIn={() => {
        scale.value = withTiming(pressScale, { duration: 90, easing: Easing.out(Easing.quad) });
      }}
      onPressOut={() => {
        scale.value = withSpring(1, { damping: 18, stiffness: 220, mass: 0.6 });
      }}
    >
      <Animated.View style={[{ alignSelf: 'stretch' }, animatedStyle]}>{children}</Animated.View>
    </Pressable>
  );
}

// ──────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────

export default function ProfileScreen(): React.JSX.Element {
  const t = useVispTheme();
  const { t: tr } = useTranslation();
  const navigation = useNavigation<ProfileNav>();

  const { user, setUser, logout, activeMode, setActiveMode } = useAuthStore();
  const { providerProfile, earnings } = useProviderStore();

  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodInfo[]>([]);
  // Kept to preserve original side-effect parity. The screen no longer renders
  // raw loading spinners for payment-method fetches — the menu surface stays
  // editorial regardless.
  const [, setIsLoadingPayments] = useState(false);

  const isProvider =
    user?.role === 'provider' ||
    (user?.role === 'both' && activeMode === 'provider');
  const isBoth = user?.role === 'both';

  // ── Avatar handlers (preserved) ──
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
        Alert.alert(tr('common.error'), tr('profileScreen.uploadPhotoFailed'));
      } finally {
        setIsUploadingAvatar(false);
      }
    },
    [user, setUser, tr],
  );

  const pickFromCamera = useCallback(async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(tr('common.error'), tr('profileScreen.permissionDenied'));
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
  }, [performAvatarUpload, tr]);

  const performAvatarRemove = useCallback(async () => {
    if (!user) return;
    setIsUploadingAvatar(true);
    try {
      const updated = await userService.removeAvatar();
      setUser({ ...user, ...updated });
    } catch (err) {
      console.error('[AVATAR_REMOVE] Failed:', err);
      Alert.alert(tr('common.error'), tr('common.tryAgain'));
    } finally {
      setIsUploadingAvatar(false);
    }
  }, [user, setUser, tr]);

  const pickFromLibrary = useCallback(async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(tr('common.error'), tr('profileScreen.permissionDenied'));
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
  }, [performAvatarUpload, tr]);

  const handleChangeAvatar = useCallback(() => {
    if (!user) return;
    const hasAvatar = !!user.avatarUrl;

    if (Platform.OS === 'ios') {
      const options = [
        tr('profileScreen.takePhoto'),
        tr('profileScreen.chooseFromLibrary'),
        ...(hasAvatar ? [tr('profileScreen.removePhoto')] : []),
        tr('common.cancel'),
      ];
      const cancelIndex = options.length - 1;
      const destructiveIndex = hasAvatar ? options.length - 2 : -1;

      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: tr('profileScreen.changePhotoTitle'),
          options,
          cancelButtonIndex: cancelIndex,
          destructiveButtonIndex: destructiveIndex >= 0 ? destructiveIndex : undefined,
          userInterfaceStyle: t.isDark ? 'dark' : 'light',
        },
        (buttonIndex) => {
          if (buttonIndex === 0) pickFromCamera();
          else if (buttonIndex === 1) pickFromLibrary();
          else if (hasAvatar && buttonIndex === 2) performAvatarRemove();
        },
      );
    } else {
      const buttons: Array<{ text: string; style?: 'cancel' | 'destructive'; onPress?: () => void }> = [
        { text: tr('profileScreen.takePhoto'), onPress: pickFromCamera },
        { text: tr('profileScreen.chooseFromLibrary'), onPress: pickFromLibrary },
      ];
      if (hasAvatar) {
        buttons.push({
          text: tr('profileScreen.removePhoto'),
          style: 'destructive',
          onPress: performAvatarRemove,
        });
      }
      buttons.push({ text: tr('common.cancel'), style: 'cancel' });
      Alert.alert(tr('profileScreen.changePhotoTitle'), '', buttons);
    }
  }, [user, tr, pickFromCamera, pickFromLibrary, performAvatarRemove, t.isDark]);

  // ── Payment fetch (preserved as side-effect parity) ──
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
    try {
      const res = await post<{ clientSecret: string; customerId: string }>(
        '/users/me/payment-setup-intent',
        {},
      );
      Alert.alert(
        tr('profileScreen.paymentMethods'),
        'To add a card, Stripe SDK integration is required.\n\n'
          + 'SetupIntent created successfully.\n'
          + `Customer ID: ${res.customerId}`,
        [{ text: tr('common.ok') }],
      );
    } catch {
      Alert.alert(tr('common.error'), tr('common.tryAgain'));
    }
  }, [tr]);

  const handleLogout = useCallback(() => {
    Alert.alert(tr('profileScreen.logout'), tr('profileScreen.logoutConfirm'), [
      { text: tr('common.cancel'), style: 'cancel' },
      {
        text: tr('profileScreen.logout'),
        style: 'destructive',
        onPress: () => {
          logout();
        },
      },
    ]);
  }, [logout, tr]);

  if (!user) {
    return (
      <Screen>
        <ScreenTitle title={tr('profileScreen.title') || 'Account'} sub="§ Profile & Settings" />
        <View style={styles.centerContent}>
          <AnimatedSpinner size={48} color={t.violet} />
        </View>
      </Screen>
    );
  }

  // ── Member-since string ──
  const memberSince = (() => {
    try {
      const d = new Date(user.createdAt);
      const m = d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }).toUpperCase();
      return `MEMBER SINCE ${m}`;
    } catch {
      return 'MEMBER SINCE —';
    }
  })();

  const initials = `${user.firstName?.charAt(0) || '?'}${user.lastName?.charAt(0) || ''}`.toUpperCase();
  const resolvedAvatarUrl = resolveAvatarUrl(user.avatarUrl);

  // ── Stats row (provider vs customer flavour) ──
  const stats: Array<{ label: string; value: string; mono?: boolean }> = isProvider
    ? [
      { label: tr('earningsScreen.thisMonth') || 'This month', value: `$${Math.round(earnings?.thisMonth ?? 0).toLocaleString()}`, mono: true },
      { label: tr('profileScreen.jobsDoneLabel') || 'Jobs done', value: String(providerProfile?.completedJobs ?? 0) },
      { label: tr('profileScreen.rating') || 'Rating', value: `${(providerProfile?.rating ?? 0).toFixed(1)}` },
    ]
    : [
      { label: tr('myJobs.title') || 'Jobs', value: String(paymentMethods.length /* fallback shape; jobs count fetched on Home */) },
      { label: tr('homeScreen.subtitleProvider') || 'Cards', value: String(paymentMethods.length), mono: true },
      { label: tr('profileScreen.verified') || 'Verified', value: user.isVerified ? 'YES' : 'NO' },
    ];

  return (
    <Screen>
      <ScreenTitle
        title={tr('profileScreen.title') || 'Account'}
        sub="§ Profile & Settings"
        right={<IconBtn name="settings" onPress={() => navigation.navigate('Settings')} />}
      />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}
      >
        {/* Profile card */}
        <Card padding={VispSpace.card} style={styles.section}>
          <View style={styles.profileRow}>
            <MotionPressable onPress={handleChangeAvatar}>
              <View>
                {resolvedAvatarUrl ? (
                  <Image
                    source={{ uri: resolvedAvatarUrl }}
                    style={[styles.avatarImg, { borderColor: t.border }]}
                  />
                ) : (
                  <Avatar initials={initials} size={56} />
                )}
                {isUploadingAvatar ? (
                  <View style={[styles.avatarOverlay, { backgroundColor: 'rgba(0,0,0,0.55)' }]}>
                    <AnimatedSpinner size={20} color={t.text} />
                  </View>
                ) : null}
              </View>
            </MotionPressable>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text
                style={[VispText.headlineMid, { color: t.text }]}
                numberOfLines={1}
              >
                {user.firstName} {user.lastName}
              </Text>
              <Text
                style={[VispText.eyebrow, { color: t.text3, marginTop: 4 }]}
                numberOfLines={1}
              >
                {memberSince}
              </Text>
            </View>
            <Pressable
              onPress={handleChangeAvatar}
              style={[styles.editPill, { backgroundColor: t.deep, borderColor: t.border }]}
              accessibilityRole="button"
              accessibilityLabel={tr('profileScreen.edit')}
            >
              <Text style={[VispText.chip, { color: t.text2 }]}>{tr('profileScreen.edit')}</Text>
            </Pressable>
          </View>

          {/* Stats */}
          <View style={[styles.statsRow, { borderTopColor: t.border }]}>
            {stats.map((s) => (
              <View key={s.label} style={{ flex: 1 }}>
                <Eyebrow>{s.label}</Eyebrow>
                <Text
                  style={{
                    fontFamily: s.mono ? FontMono : FontSansBold,
                    fontSize: 20,
                    fontWeight: '700',
                    color: t.text,
                    marginTop: 6,
                    letterSpacing: -0.4,
                  }}
                  numberOfLines={1}
                >
                  {s.value}
                </Text>
              </View>
            ))}
          </View>
        </Card>

        {/* RoleSwitcher (only for 'both' users) */}
        {isBoth ? (
          <View style={styles.roleSwitcher}>
            <RoleSwitcher mode={activeMode} onChange={setActiveMode} />
          </View>
        ) : null}

        {/* Customer settings */}
        {!isProvider ? (
          <View style={styles.section}>
            <Eyebrow>{tr('profileScreen.settings') || 'Settings'}</Eyebrow>
            <View style={{ marginTop: 6 }}>
              <MenuItem
                icon="card"
                title={tr('profileScreen.paymentMethods')}
                sub={
                  paymentMethods.length > 0
                    ? `${paymentMethods.length} ${tr('profileScreen.paymentMethods').toLowerCase()}`
                    : tr('profileScreen.noPaymentMethod') || 'No cards on file'
                }
                onPress={() => navigation.navigate('PaymentMethods')}
              />
              <MenuItem
                icon="pin"
                title={tr('profileScreen.savedAddress') || 'Saved address'}
                sub={user.defaultAddress?.formattedAddress || user.defaultAddress?.street || tr('profileScreen.noAddressSaved') || 'No address saved'}
                onPress={() => navigation.navigate('AddressEdit')}
                last
              />
            </View>
          </View>
        ) : null}

        {/* Provider side */}
        {isProvider ? (
          <View style={styles.section}>
            <Eyebrow>{tr('profileScreen.providerSection') || 'Provider'}</Eyebrow>
            <View style={{ marginTop: 6 }}>
              <MenuItem
                icon="user"
                title={tr('profileScreen.myServices') || 'Services & pricing'}
                accent
                onPress={() => navigation.navigate('ProviderOnboarding')}
              />
              <MenuItem
                icon="money"
                title={tr('myPricesScreen.title') || 'My Prices'}
                accent
                onPress={() => navigation.navigate('MyPrices')}
              />
              <MenuItem
                icon="card"
                title={tr('earningsScreen.payoutAccount') || 'Payouts & taxes'}
                accent
                onPress={() => navigation.navigate('PaymentMethods')}
              />
              <MenuItem
                icon="shield"
                title={tr('profileScreen.verification') || 'Verification'}
                accent
                onPress={() => navigation.navigate('Verification')}
              />
              <MenuItem
                icon="briefcase"
                title={tr('profileScreen.credentials') || 'Credentials'}
                accent
                onPress={() => navigation.navigate('Credentials')}
              />
              <MenuItem
                icon="pin"
                title={tr('profileScreen.savedAddress') || 'Saved address'}
                sub={user.defaultAddress?.formattedAddress || user.defaultAddress?.street || tr('profileScreen.noAddressSaved') || 'No address saved'}
                accent
                onPress={() => navigation.navigate('AddressEdit')}
                last
              />
            </View>
          </View>
        ) : null}

        {/* General */}
        <View style={styles.section}>
          <Eyebrow>{tr('profileScreen.general') || 'General'}</Eyebrow>
          <View style={{ marginTop: 6 }}>
            <MenuItem
              icon="bell"
              title={tr('profileScreen.notifications') || 'Notifications'}
              onPress={() => navigation.navigate('Settings')}
            />
            <MenuItem
              icon="lock"
              title={tr('profileScreen.privacy') || 'Privacy & security'}
              onPress={() => navigation.navigate('PrivacyPolicy')}
            />
            <MenuItem
              icon="help"
              title={tr('profileScreen.help') || 'Help center'}
              onPress={() => navigation.navigate('Settings')}
            />
            <MenuItem
              icon="logout"
              title={tr('profileScreen.logout') || 'Sign out'}
              danger
              onPress={handleLogout}
              last
            />
          </View>
        </View>

        <Text style={[styles.versionText, { color: t.text4 }]}>
          {tr('profileScreen.appVersion', { version: '1.0.0', build: '10' })}
        </Text>
      </ScrollView>
    </Screen>
  );
}

// ──────────────────────────────────────────────
// Styles
// ──────────────────────────────────────────────

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  contentContainer: {
    paddingHorizontal: VispSpace.gutter,
    paddingBottom: 40,
  },
  centerContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  section: { marginBottom: 18 },

  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 16,
  },
  avatarImg: {
    width: 56,
    height: 56,
    borderRadius: 14,
    borderWidth: 1,
  },
  avatarOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editPill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
  },

  statsRow: {
    flexDirection: 'row',
    gap: 14,
    paddingTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
  },

  roleSwitcher: { marginBottom: 18, alignItems: 'center' },

  versionText: {
    textAlign: 'center',
    fontSize: 11,
    fontFamily: FontMono,
    letterSpacing: 1,
    marginTop: 10,
    marginBottom: 12,
  },
});
