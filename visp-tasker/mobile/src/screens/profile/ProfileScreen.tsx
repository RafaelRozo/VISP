/**
 * VISP/Tasker - Profile Screen
 *
 * User profile view/edit with avatar upload, name/email/phone display,
 * role badges, provider level display with progress, settings link,
 * and logout button.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Colors, getLevelColor } from '../../theme/colors';
import LevelProgress from '../../components/LevelProgress';
import {
  LevelProgressInfo,
  ProfileStackParamList,
  ProviderProfile,
  ServiceLevel,
  User,
} from '../../types';
import { patch, upload } from '../../services/apiClient';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ProfileNav = NativeStackNavigationProp<ProfileStackParamList, 'ProfileMain'>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const LEVEL_NAMES: Record<number, string> = {
  1: 'Helper',
  2: 'Experienced',
  3: 'Certified Pro',
  4: 'Emergency',
};

const ROLE_LABELS: Record<string, string> = {
  customer: 'Customer',
  provider: 'Service Provider',
  both: 'Customer & Provider',
};

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
  const initials = `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();

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
        <Text style={avatarStyles.editBadgeText}>Edit</Text>
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
  },
  placeholder: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: Colors.primary,
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
    backgroundColor: Colors.surfaceElevated,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 2,
    borderColor: Colors.background,
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

// ... (existing imports)

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

const MOCK_LEVEL_PROGRESS: LevelProgressInfo = {
  currentLevel: 2 as ServiceLevel,
  nextLevel: 3 as ServiceLevel,
  progressPercent: 65,
  requirements: [
    {
      label: 'Complete 50 jobs',
      description: '47 of 50 completed',
      isMet: false,
    },
    {
      label: 'Trade license uploaded',
      description: 'Upload a valid trade license',
      isMet: false,
    },
    {
      label: 'Maintain 4.5+ rating',
      description: 'Current rating: 4.7',
      isMet: true,
    },
    {
      label: '$2M insurance certificate',
      description: 'Upload proof of $2M liability insurance',
      isMet: false,
    },
  ],
};

export default function ProfileScreen(): React.JSX.Element {
  const navigation = useNavigation<ProfileNav>();

  // Get real user data from stores
  const { user, setUser, logout } = useAuthStore();
  const { providerProfile } = useProviderStore();

  const [levelProgress] = useState<LevelProgressInfo>(MOCK_LEVEL_PROGRESS);
  const [isEditing, setIsEditing] = useState(false);

  // Initialize edit state with user data (safely handle null user)
  const [editFirstName, setEditFirstName] = useState('');
  const [editLastName, setEditLastName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [countryCode, setCountryCode] = useState('+52');
  const [isSaving, setIsSaving] = useState(false);

  // Update local edit state when user changes (e.g. after save)
  useEffect(() => {
    if (user) {
      setEditFirstName(user.firstName);
      setEditLastName(user.lastName);
      // Parse country code from stored phone (e.g. "+526142545794" or "+52 6142545794")
      const rawPhone = user.phone || '';
      const knownCodes = ['+52', '+57', '+54', '+44', '+34', '+1'];
      let foundCode = '+52'; // default
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

  const isProvider = user?.role === 'provider' || user?.role === 'both';

  if (!user) {
    return (
      <View style={[styles.container, styles.centerContent]}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  const handleChangeAvatar = useCallback(() => {
    Alert.alert('Change Photo', 'Choose a source for your profile photo.', [
      { text: 'Camera', onPress: () => { } },
      { text: 'Photo Library', onPress: () => { } },
      { text: 'Cancel', style: 'cancel' },
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
      // Update store
      setUser({
        ...user,
        firstName: editFirstName,
        lastName: editLastName,
        phone: fullPhone,
      });
      setIsEditing(false);
    } catch {
      Alert.alert('Error', 'Failed to update profile. Please try again.');
    } finally {
      setIsSaving(false);
    }
  }, [editFirstName, editLastName, editPhone, countryCode, user, setUser]);

  const handleLogout = useCallback(() => {
    Alert.alert('Logout', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Logout',
        style: 'destructive',
        onPress: () => {
          logout();
        },
      },
    ]);
  }, [logout]);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.contentContainer}
    >
      {/* Avatar */}
      <AvatarSection
        avatarUrl={user.avatarUrl}
        firstName={user.firstName}
        lastName={user.lastName}
        onChangeAvatar={handleChangeAvatar}
      />

      {/* Name display / edit */}
      <View style={styles.infoCard}>
        {isEditing ? (
          <View>
            <Text style={styles.fieldLabel}>First Name</Text>
            <TextInput
              style={styles.input}
              value={editFirstName}
              onChangeText={setEditFirstName}
              placeholder="First name"
              placeholderTextColor={Colors.inputPlaceholder}
              autoCapitalize="words"
            />
            <Text style={styles.fieldLabel}>Last Name</Text>
            <TextInput
              style={styles.input}
              value={editLastName}
              onChangeText={setEditLastName}
              placeholder="Last name"
              placeholderTextColor={Colors.inputPlaceholder}
              autoCapitalize="words"
            />
            <Text style={styles.fieldLabel}>Phone</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TouchableOpacity
                style={{
                  backgroundColor: Colors.inputBackground,
                  borderWidth: 1,
                  borderColor: Colors.inputBorder,
                  borderRadius: 10,
                  paddingHorizontal: 12,
                  paddingVertical: 12,
                  justifyContent: 'center',
                  minWidth: 90,
                }}
                onPress={() => {
                  const codes = [
                    { label: '🇲🇽 +52', value: '+52' },
                    { label: '🇺🇸 +1', value: '+1' },
                    { label: '🇨🇦 +1', value: '+1' },
                    { label: '🇬🇧 +44', value: '+44' },
                    { label: '🇪🇸 +34', value: '+34' },
                    { label: '🇨🇴 +57', value: '+57' },
                    { label: '🇦🇷 +54', value: '+54' },
                  ];
                  Alert.alert('Select Country Code', '', codes.map(c => ({
                    text: c.label,
                    onPress: () => setCountryCode(c.value),
                  })));
                }}
                accessibilityRole="button"
                accessibilityLabel="Select country code"
              >
                <Text style={{ fontSize: 15, color: Colors.textPrimary, fontWeight: '500' }}>
                  {countryCode}
                </Text>
              </TouchableOpacity>
              <TextInput
                style={[styles.input, { flex: 1, marginTop: 0 }]}
                value={editPhone}
                onChangeText={setEditPhone}
                placeholder="Phone number"
                placeholderTextColor={Colors.inputPlaceholder}
                keyboardType="phone-pad"
              />
            </View>
            <View style={styles.editActions}>
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={() => {
                  setIsEditing(false);
                  setEditFirstName(user.firstName);
                  setEditLastName(user.lastName);
                  setEditPhone(user.phone || '');
                }}
                accessibilityRole="button"
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.saveButton,
                  isSaving && styles.buttonDisabled,
                ]}
                onPress={handleSaveProfile}
                disabled={isSaving}
                accessibilityRole="button"
              >
                {isSaving ? (
                  <ActivityIndicator size="small" color={Colors.white} />
                ) : (
                  <Text style={styles.saveButtonText}>Save</Text>
                )}
              </TouchableOpacity>
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
              <View style={styles.roleBadge}>
                <Text style={styles.roleBadgeText}>
                  {ROLE_LABELS[user.role]}
                </Text>
              </View>
              {user.isVerified && (
                <View
                  style={[
                    styles.roleBadge,
                    { backgroundColor: `${Colors.success}20` },
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
      </View>

      {/* Contact info */}
      <View style={styles.infoCard}>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Email</Text>
          <Text style={styles.infoValue}>{user.email}</Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Phone</Text>
          <Text style={styles.infoValue}>
            {user.phone ?? 'Not provided'}
          </Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Member Since</Text>
          <Text style={styles.infoValue}>
            {new Date(user.createdAt).toLocaleDateString([], {
              year: 'numeric',
              month: 'long',
            })}
          </Text>
        </View>
      </View>

      {/* Provider level progress */}
      {isProvider && providerProfile && (
        <LevelProgress progressInfo={levelProgress} />
      )}

      {/* Navigation links */}
      {isProvider && (
        <View style={styles.linksCard}>
          <TouchableOpacity
            style={styles.linkRow}
            onPress={() => navigation.navigate('ProviderOnboarding')}
            accessibilityRole="button"
          >
            <Text style={styles.linkText}>My Services</Text>
            <Text style={styles.linkArrow}>{'\u203A'}</Text>
          </TouchableOpacity>
          <View style={styles.divider} />
          <TouchableOpacity
            style={styles.linkRow}
            onPress={() => navigation.navigate('Credentials')}
            accessibilityRole="button"
          >
            <Text style={styles.linkText}>Credentials & Documents</Text>
            <Text style={styles.linkArrow}>{'\u203A'}</Text>
          </TouchableOpacity>
          <View style={styles.divider} />
          <TouchableOpacity
            style={styles.linkRow}
            onPress={() => navigation.navigate('Verification')}
            accessibilityRole="button"
          >
            <Text style={styles.linkText}>Verification Status</Text>
            <Text style={styles.linkArrow}>{'\u203A'}</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.linksCard}>
        <TouchableOpacity
          style={styles.linkRow}
          onPress={() => navigation.navigate('Settings')}
          accessibilityRole="button"
        >
          <Text style={styles.linkText}>Settings</Text>
          <Text style={styles.linkArrow}>{'\u203A'}</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        style={styles.logoutButton}
        onPress={handleLogout}
        accessibilityRole="button"
      >
        <Text style={styles.logoutButtonText}>Logout</Text>
      </TouchableOpacity>

      <Text style={styles.versionText}>v1.0.0 (Build 42)</Text>
    </ScrollView>
  );
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
    paddingTop: 24,
  },
  centerContent: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  infoCard: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 16,
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
  roleBadge: {
    backgroundColor: `${Colors.primary}20`,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  roleBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.primary,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  infoLabel: {
    fontSize: 14,
    color: Colors.textSecondary,
  },
  infoValue: {
    fontSize: 14,
    fontWeight: '500',
    color: Colors.textPrimary,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Colors.border,
    marginVertical: 8,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textSecondary,
    marginBottom: 6,
    marginTop: 8,
  },
  input: {
    backgroundColor: Colors.inputBackground,
    borderWidth: 1,
    borderColor: Colors.inputBorder,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: Colors.inputText,
  },
  editActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 16,
  },
  cancelButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  cancelButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  saveButton: {
    backgroundColor: Colors.primary,
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 8,
  },
  saveButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.white,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  linksCard: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    marginHorizontal: 16,
    marginBottom: 12,
    overflow: 'hidden',
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
    color: Colors.textTertiary,
  },
  logoutButton: {
    marginHorizontal: 16,
    marginBottom: 24,
    paddingVertical: 16,
    borderRadius: 12,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.error,
    alignItems: 'center',
  },
  logoutButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.error,
  },
  versionText: {
    textAlign: 'center',
    fontSize: 12,
    color: Colors.textTertiary,
    marginBottom: 32,
  },
});
