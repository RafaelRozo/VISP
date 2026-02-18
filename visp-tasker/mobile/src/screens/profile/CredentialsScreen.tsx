/**
 * VISP/Tasker - Credentials Screen
 *
 * List of provider credentials with status for each (pending, approved,
 * expired, rejected), upload new credential, document type selection,
 * expiry date display, and re-upload for expired credentials.
 *
 * Pending service requirements are merged into the main list as "pending"
 * credential items — they appear under the "All" and "Pending" tabs with
 * an upload prompt when tapped.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActionSheetIOS,
  ActivityIndicator,
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
import CredentialCard from '../../components/CredentialCard';
import {
  Credential,
  CredentialStatus,
  CredentialType,
} from '../../types';
import { get } from '../../services/apiClient';
import { launchImageLibrary } from 'react-native-image-picker';
import { providerService, PendingCredential } from '../../services/providerService';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type FilterOption = 'all' | CredentialStatus;

const CREDENTIAL_TYPES: Array<{ value: CredentialType; label: string }> = [
  { value: 'criminal_record_check', label: 'Criminal Record Check' },
  { value: 'trade_license', label: 'Trade License' },
  { value: 'insurance_certificate', label: 'Insurance Certificate' },
  { value: 'portfolio', label: 'Portfolio' },
  { value: 'certification', label: 'Certification' },
  { value: 'drivers_license', label: "Driver's License" },
];

// ---------------------------------------------------------------------------
// Helpers — convert pending requirements into Credential-like objects
// ---------------------------------------------------------------------------

function pendingToCredential(item: PendingCredential): Credential {
  const credType: CredentialType =
    item.requiredType === 'license' ? 'trade_license' : 'certification';

  // Map upload status to credential status
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
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [pendingReqs, setPendingReqs] = useState<PendingCredential[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [filter, setFilter] = useState<FilterOption>('all');

  // Fetch credentials + pending requirements
  const fetchAll = useCallback(async () => {
    setIsLoading(true);
    try {
      const [creds, pending] = await Promise.all([
        get<Credential[]>('/provider/credentials').catch(() => [] as Credential[]),
        providerService.getPendingCredentials().catch(() => [] as PendingCredential[]),
      ]);
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
      // Check if this is a pending requirement (synthetic credential)
      if (credential.id.startsWith('pending-')) {
        const taskId = credential.id.replace('pending-', '');
        const pendingItem = pendingReqs.find((p) => p.taskId === taskId);

        if (pendingItem && (pendingItem.uploadStatus === 'not_uploaded' || pendingItem.uploadStatus === 'rejected')) {
          Alert.alert(
            'Upload Document',
            `"${pendingItem.taskName}" requires a ${pendingItem.requiredType === 'license' ? 'license' : 'certificate'} to activate.\n\nWould you like to upload the document now?`,
            [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Upload',
                onPress: () => handlePendingUpload(pendingItem),
              },
            ],
          );
        } else if (pendingItem && pendingItem.uploadStatus === 'pending_review') {
          Alert.alert(
            'Under Review',
            `Your document for "${pendingItem.taskName}" is being reviewed. You'll be notified once it's approved.`,
          );
        }
        return;
      }

      // Regular credential tap
      if (
        credential.status === 'expired' ||
        credential.status === 'rejected'
      ) {
        Alert.alert(
          'Re-upload Document',
          `Your ${credential.label} has been ${credential.status}. Would you like to upload a new document?`,
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Upload New',
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
        const result = await launchImageLibrary({
          mediaType: 'photo',
          selectionLimit: 1,
        });

        if (result.didCancel || !result.assets || result.assets.length === 0) {
          return;
        }

        const asset = result.assets[0];
        setIsUploading(true);

        const credType = item.requiredType === 'license' ? 'trade_license' : 'certification';

        await providerService.uploadCredential(
          {
            uri: asset.uri,
            type: asset.type,
            name: asset.fileName,
          },
          credType,
          item.taskId,
        );

        Alert.alert(
          'Document Uploaded',
          `Your document for "${item.taskName}" has been submitted for review. You'll be notified once it's approved.`,
        );
        fetchAll();
      } catch (error) {
        console.error('Upload failed:', error);
        Alert.alert('Error', 'Failed to upload document. Please try again.');
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
          const result = await launchImageLibrary({
            mediaType: 'photo',
            selectionLimit: 1,
          });

          if (result.didCancel || !result.assets || result.assets.length === 0) {
            return;
          }

          const asset = result.assets[0];
          setIsUploading(true);

          await providerService.uploadCredential(
            {
              uri: asset.uri,
              type: asset.type,
              name: asset.fileName,
            },
            type,
          );

          Alert.alert('Success', 'Document uploaded successfully for review.');
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

          return (
            <TouchableOpacity
              key={tab.key}
              style={[
                styles.filterTab,
                filter === tab.key && styles.filterTabActive,
              ]}
              onPress={() => setFilter(tab.key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: filter === tab.key }}
            >
              <Text
                style={[
                  styles.filterTabText,
                  filter === tab.key && styles.filterTabTextActive,
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
      <TouchableOpacity
        style={styles.uploadButton}
        onPress={() => handleUploadDocument()}
        disabled={isUploading}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel="Upload new credential"
      >
        {isUploading ? (
          <ActivityIndicator size="small" color={Colors.white} />
        ) : (
          <Text style={styles.uploadButtonText}>Upload New Credential</Text>
        )}
      </TouchableOpacity>
    </View>
  );

  const renderEmpty = useCallback(() => {
    if (isLoading) return null;
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyTitle}>No Credentials</Text>
        <Text style={styles.emptySubtext}>
          Upload your credentials to get verified and start receiving jobs.
          Required documents depend on your selected services.
        </Text>
      </View>
    );
  }, [isLoading]);

  return (
    <View style={styles.container}>
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
    </View>
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
    borderRadius: 6,
    backgroundColor: Colors.surface,
  },
  filterTabActive: {
    backgroundColor: Colors.primary,
  },
  filterTabText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  filterTabTextActive: {
    color: Colors.white,
  },
  uploadButton: {
    backgroundColor: Colors.primary,
    borderRadius: 8,
    paddingVertical: 12,
    marginHorizontal: 16,
    marginBottom: 16,
    alignItems: 'center',
  },
  uploadButtonText: {
    fontSize: 15,
    fontWeight: '600',
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
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
});
