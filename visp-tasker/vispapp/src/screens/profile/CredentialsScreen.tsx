/**
 * VISP - Credentials Screen
 *
 * List of provider credentials with status for each (pending, approved,
 * expired, rejected), upload new credential, document type selection,
 * expiry date display, and re-upload for expired credentials.
 *
 * Pending service requirements are merged into the main list as "pending"
 * credential items.
 *
 * Dark glassmorphism redesign.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActionSheetIOS,
  Alert,
  FlatList,
  Platform,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Colors } from '../../theme/colors';
import { useTheme } from '../../theme/ThemeContext';
import { useTranslation, t } from '../../i18n';
import { GlassStyles } from '../../theme/glass';
import { GlassButton } from '../../components/glass';
import { Screen } from '../../components/visp';
import CredentialCard from '../../components/CredentialCard';
import {
  Credential,
  CredentialStatus,
  CredentialType,
} from '../../types';
import { get } from '../../services/apiClient';
import * as ImagePicker from 'expo-image-picker';
import { providerService, PendingCredential } from '../../services/providerService';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type FilterOption = 'all' | CredentialStatus;

const CREDENTIAL_TYPES: Array<{ value: CredentialType; label: string }> = [
  { value: 'criminal_record_check', label: t('credentials.criminalRecordCheck') },
  { value: 'trade_license', label: t('credentials.tradeLicense') },
  { value: 'insurance_certificate', label: t('credentials.insuranceCertificate') },
  { value: 'portfolio', label: t('credentials.portfolio') },
  { value: 'certification', label: t('credentials.certification') },
  { value: 'drivers_license', label: "Driver's License" },
];

// ---------------------------------------------------------------------------
// Helpers -- convert pending requirements into Credential-like objects
// ---------------------------------------------------------------------------

function pendingToCredential(item: PendingCredential): Credential {
  const credType: CredentialType =
    item.requiredType === 'license' ? 'trade_license' : 'certification';

  let status: CredentialStatus = 'pending';
  if (item.uploadStatus === 'not_uploaded') {
    status = 'awaiting_upload';
  } else if (item.uploadStatus === 'pending_review') {
    status = 'pending';
  } else if (item.uploadStatus === 'verified') {
    status = 'approved';
  } else if (item.uploadStatus === 'rejected') {
    status = 'rejected';
  } else if (item.uploadStatus === 'expired') {
    status = 'expired';
  }

  return {
    id: `pending-${item.taskId}`,
    type: credType,
    label: `${item.taskName} — ${item.badge}`,
    status,
    documentUrl: null,
    expiresAt: null,
    rejectionReason: null,
    uploadedAt: item.uploadStatus === 'not_uploaded' ? '' : new Date().toISOString(),
    reviewedAt: null,
  };
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function CredentialsScreen(): React.JSX.Element {
  const theme = useTheme();
  const { t } = useTranslation();
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [pendingReqs, setPendingReqs] = useState<PendingCredential[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [filter, setFilter] = useState<FilterOption>('all');

  // Fetch credentials + pending requirements
  const fetchAll = useCallback(async () => {
    setIsLoading(true);
    try {
      const [credsResponse, pending] = await Promise.all([
        get<any>('/provider/credentials').catch(() => ({ credentials: [] })),
        providerService.getPendingCredentials().catch(() => [] as PendingCredential[]),
      ]);
      // Backend returns { credentials: [...], insurances: [...], background_check: {...} }
      const creds: Credential[] = Array.isArray(credsResponse)
        ? credsResponse
        : (credsResponse?.credentials ?? []).map((c: any) => ({
            id: c.id,
            type: c.credentialType ?? c.credential_type ?? 'certification',
            label: c.name ?? t('credentials.document'),
            status: c.status === 'pending_review' ? 'pending' : c.status === 'verified' ? 'approved' : c.status,
            documentUrl: c.documentUrl ?? c.document_url ?? null,
            expiresAt: c.expiryDate ?? c.expiry_date ?? null,
            rejectionReason: c.rejectionReason ?? c.rejection_reason ?? null,
            uploadedAt: c.createdAt ?? c.created_at ?? '',
            reviewedAt: c.verifiedAt ?? c.verified_at ?? null,
          }));
      setCredentials(creds);
      setPendingReqs(pending);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // Merge pending requirements into the credential list
  const pendingAsCredentials = pendingReqs.map(pendingToCredential);
  const allCredentials = [...pendingAsCredentials, ...credentials];

  // Filter
  const filteredCredentials =
    filter === 'all'
      ? allCredentials
      : allCredentials.filter((c) => c.status === filter);

  // Handle credential or pending-requirement tap
  const handleCredentialPress = useCallback(
    (credential: Credential) => {
      if (credential.id.startsWith('pending-')) {
        const taskId = credential.id.replace('pending-', '');
        const pendingItem = pendingReqs.find((p) => p.taskId === taskId);

        if (pendingItem && (pendingItem.uploadStatus === 'not_uploaded' || pendingItem.uploadStatus === 'rejected')) {
          Alert.alert(
            t('credentials.uploadDocument'),
            `"${pendingItem.taskName}" requires a ${pendingItem.requiredType === 'license' ? 'license' : 'certificate'} to activate.\n\nWould you like to upload the document now?`,
            [
              { text: t('common.cancel'), style: 'cancel' },
              {
                text: t('credentials.upload'),
                onPress: () => handlePendingUpload(pendingItem),
              },
            ],
          );
        } else if (pendingItem && pendingItem.uploadStatus === 'pending_review') {
          Alert.alert(
            t('credentials.underReview'),
            `Your document for "${pendingItem.taskName}" is being reviewed. You'll be notified once it's approved.`,
          );
        }
        return;
      }

      if (
        credential.status === 'expired' ||
        credential.status === 'rejected'
      ) {
        Alert.alert(
          t('credentials.reUpload'),
          `Your ${credential.label} has been ${credential.status}. Would you like to upload a new document?`,
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: t('credentials.uploadNew'),
              onPress: () => handleUploadDocument(credential.type),
            },
          ],
        );
      } else if (credential.documentUrl) {
        Alert.alert(
          credential.label,
          `Status: ${credential.status}\nUploaded: ${new Date(credential.uploadedAt).toLocaleDateString()}${credential.expiresAt
            ? `\nExpires: ${new Date(credential.expiresAt).toLocaleDateString()}`
            : ''
          }`,
        );
      }
    },
    [pendingReqs],
  );

  // Handle upload for a pending requirement
  const handlePendingUpload = useCallback(
    async (item: PendingCredential) => {
      try {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) {
          Alert.alert(t('common.error'), t('profileScreen.permissionDenied'));
          return;
        }
        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          allowsMultipleSelection: false,
          quality: 0.8,
        });

        if (result.canceled || !result.assets || result.assets.length === 0) {
          return;
        }

        const asset = result.assets[0];
        setIsUploading(true);

        const credType = item.requiredType === 'license' ? 'trade_license' : 'certification';

        await providerService.uploadCredential(
          {
            uri: asset.uri,
            type: asset.mimeType,
            name: asset.fileName,
          },
          credType,
          { taskId: item.taskId },
        );

        Alert.alert(
          t('credentials.documentUploaded'),
          `Your document for "${item.taskName}" has been submitted for review. You'll be notified once it's approved.`,
        );
        fetchAll();
      } catch (error) {
        console.error('Upload failed:', error);
        Alert.alert(t('common.error'), t('credentials.uploadFailed'));
      } finally {
        setIsUploading(false);
      }
    },
    [fetchAll],
  );

  // Handle upload new credential (generic)
  const handleUploadDocument = useCallback(
    async (preselectedType?: CredentialType) => {
      const performUpload = async (type: CredentialType) => {
        try {
          const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
          if (!perm.granted) {
            Alert.alert(t('common.error'), t('profileScreen.permissionDenied'));
            return;
          }
          const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ['images'],
            allowsMultipleSelection: false,
            quality: 0.8,
          });

          if (result.canceled || !result.assets || result.assets.length === 0) {
            return;
          }

          const asset = result.assets[0];
          setIsUploading(true);

          await providerService.uploadCredential(
            {
              uri: asset.uri,
              type: asset.mimeType,
              name: asset.fileName,
            },
            type,
          );

          Alert.alert(t('common.success'), t('credentials.uploadSuccess'));
          fetchAll();
        } catch (error) {
          console.error('Upload failed:', error);
          Alert.alert('Error', 'Failed to upload document. Please try again.');
        } finally {
          setIsUploading(false);
        }
      };

      if (preselectedType) {
        await performUpload(preselectedType);
        return;
      }

      if (Platform.OS === 'ios') {
        ActionSheetIOS.showActionSheetWithOptions(
          {
            options: ['Cancel', ...CREDENTIAL_TYPES.map((t) => t.label)],
            cancelButtonIndex: 0,
          },
          (buttonIndex) => {
            if (buttonIndex > 0) {
              const selectedType = CREDENTIAL_TYPES[buttonIndex - 1];
              performUpload(selectedType.value);
            }
          },
        );
      } else {
        Alert.alert(
          'Select Document Type',
          'Choose the type of credential to upload.',
          [
            { text: 'Cancel', style: 'cancel' },
            ...CREDENTIAL_TYPES.map((t) => ({
              text: t.label,
              onPress: () => performUpload(t.value),
            })),
          ],
        );
      }
    },
    [fetchAll],
  );

  // Status counts for filter badges
  const statusCounts = allCredentials.reduce(
    (acc, c) => {
      acc[c.status] = (acc[c.status] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  const renderCredential = useCallback(
    ({ item }: { item: Credential }) => (
      <CredentialCard credential={item} onPress={handleCredentialPress} />
    ),
    [handleCredentialPress],
  );

  const keyExtractor = useCallback((item: Credential) => item.id, []);

  const renderHeader = () => (
    <View>
      {/* Filter tabs */}
      <View style={styles.filterRow}>
        {(
          [
            { key: 'all' as FilterOption, label: 'All' },
            { key: 'awaiting_upload' as FilterOption, label: 'Upload' },
            { key: 'pending' as FilterOption, label: 'Pending' },
            { key: 'approved' as FilterOption, label: 'Approved' },
            { key: 'expired' as FilterOption, label: 'Expired' },
            { key: 'rejected' as FilterOption, label: 'Rejected' },
          ] as const
        ).map((tab) => {
          const count =
            tab.key === 'all'
              ? allCredentials.length
              : statusCounts[tab.key] || 0;
          const isActive = filter === tab.key;

          return (
            <TouchableOpacity
              key={tab.key}
              style={[
                styles.filterTab,
                isActive && styles.filterTabActive,
              ]}
              onPress={() => setFilter(tab.key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: isActive }}
            >
              <Text
                style={[
                  styles.filterTabText,
                  { color: theme.textSecondary },
                  isActive && styles.filterTabTextActive,
                ]}
              >
                {tab.label}
                {count > 0 ? ` (${count})` : ''}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Upload button */}
      <View style={{ marginHorizontal: 16, marginBottom: 16 }}>
        <GlassButton
          title={isUploading ? 'Uploading...' : 'Upload New Credential'}
          variant="glow"
          onPress={() => handleUploadDocument()}
          disabled={isUploading}
          loading={isUploading}
        />
      </View>
    </View>
  );

  const renderEmpty = useCallback(() => {
    if (isLoading) return null;
    return (
      <View style={styles.emptyContainer}>
        <Text style={[styles.emptyTitle, { color: theme.textPrimary }]}>{t('credentials.noCredentials')}</Text>
        <Text style={[styles.emptySubtext, { color: theme.textSecondary }]}>
          Upload your credentials to get verified and start receiving jobs.
          Required documents depend on your selected services.
        </Text>
      </View>
    );
  }, [isLoading]);

  return (
    <Screen>
      <FlatList
        data={filteredCredentials}
        renderItem={renderCredential}
        keyExtractor={keyExtractor}
        ListHeaderComponent={renderHeader}
        ListEmptyComponent={renderEmpty}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={isLoading}
            onRefresh={fetchAll}
            tintColor={Colors.primary}
            colors={[Colors.primary]}
          />
        }
        showsVerticalScrollIndicator={false}
      />
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  listContent: {
    paddingTop: 16,
    paddingBottom: 32,
    flexGrow: 1,
  },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 16,
    marginBottom: 12,
    gap: 6,
  },
  filterTab: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.10)',
  },
  filterTabActive: {
    backgroundColor: 'rgba(120, 80, 255, 0.4)',
    borderColor: 'rgba(120, 80, 255, 0.6)',
  },
  filterTabText: {
    fontSize: 12,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.5)',
  },
  filterTabTextActive: {
    color: Colors.white,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    paddingTop: 60,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: Colors.textPrimary,
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.5)',
    textAlign: 'center',
    lineHeight: 20,
  },
});
