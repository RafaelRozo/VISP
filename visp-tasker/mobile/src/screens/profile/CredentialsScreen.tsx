/**
 * VISP/Tasker - Credentials Screen
 *
 * List of provider credentials with status for each (pending, approved,
 * expired, rejected), upload new credential, document type selection,
 * expiry date display, and re-upload for expired credentials.
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
import { providerService } from '../../services/providerService';

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
// Main Component
// ---------------------------------------------------------------------------

export default function CredentialsScreen(): React.JSX.Element {
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [filter, setFilter] = useState<FilterOption>('all');

  // Fetch credentials
  const fetchCredentials = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await get<Credential[]>('/provider/credentials');
      setCredentials(data);
    } catch {
      // On error, show empty list -- error handling via store in production
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCredentials();
  }, [fetchCredentials]);

  // Filter credentials
  const filteredCredentials =
    filter === 'all'
      ? credentials
      : credentials.filter((c) => c.status === filter);

  // Handle credential tap
  const handleCredentialPress = useCallback(
    (credential: Credential) => {
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
        // In production, this would open a document viewer
        Alert.alert(
          credential.label,
          `Status: ${credential.status}\nUploaded: ${new Date(credential.uploadedAt).toLocaleDateString()}${credential.expiresAt
            ? `\nExpires: ${new Date(credential.expiresAt).toLocaleDateString()}`
            : ''
          }`,
        );
      }
    },
    [],
  );

  // Handle upload new credential
  const handleUploadDocument = useCallback(
    async (preselectedType?: CredentialType) => {
      // Helper to perform the actual upload
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
          fetchCredentials();
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

      // Show type picker
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
        // Android: use an Alert with buttons (or in production a bottom sheet)
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
    [fetchCredentials],
  );

  // Status counts for filter badges
  const statusCounts = credentials.reduce(
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
            { key: 'approved' as FilterOption, label: 'Approved' },
            { key: 'pending' as FilterOption, label: 'Pending' },
            { key: 'expired' as FilterOption, label: 'Expired' },
            { key: 'rejected' as FilterOption, label: 'Rejected' },
          ] as const
        ).map((tab) => {
          const count =
            tab.key === 'all'
              ? credentials.length
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
          Required documents depend on your target service level.
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
            onRefresh={fetchCredentials}
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
