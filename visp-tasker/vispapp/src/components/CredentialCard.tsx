/**
 * VISP - CredentialCard Component
 *
 * Card showing credential status with document type icon, status badge,
 * expiry date, and tap action for view/upload.
 */

import React from 'react';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Colors } from '../theme/colors';
import { GlassStyles } from '../theme/glass';
import { Credential, CredentialStatus, CredentialType } from '../types';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface CredentialCardProps {
  credential: Credential;
  onPress: (credential: Credential) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CREDENTIAL_TYPE_LABELS: Record<CredentialType, string> = {
  criminal_record_check: 'Criminal Record Check',
  trade_license: 'Trade License',
  insurance_certificate: 'Insurance Certificate',
  portfolio: 'Portfolio',
  certification: 'Certification',
  drivers_license: "Driver's License",
};

const CREDENTIAL_TYPE_ICONS: Record<CredentialType, string> = {
  criminal_record_check: 'shield',
  trade_license: 'document',
  insurance_certificate: 'certificate',
  portfolio: 'images',
  certification: 'ribbon',
  drivers_license: 'car',
};

const STATUS_CONFIG: Record<
  CredentialStatus,
  { label: string; color: string; bgColor: string }
> = {
  awaiting_upload: {
    label: 'Upload Required',
    color: '#FF6B35',
    bgColor: 'rgba(255, 107, 53, 0.15)',
  },
  pending: {
    label: 'Pending Review',
    color: Colors.warning,
    bgColor: 'rgba(243, 156, 18, 0.15)',
  },
  approved: {
    label: 'Approved',
    color: Colors.success,
    bgColor: 'rgba(39, 174, 96, 0.15)',
  },
  expired: {
    label: 'Expired',
    color: Colors.emergencyRed,
    bgColor: 'rgba(231, 76, 60, 0.15)',
  },
  rejected: {
    label: 'Rejected',
    color: Colors.emergencyRed,
    bgColor: 'rgba(231, 76, 60, 0.15)',
  },
};

function formatDate(dateString: string | null): string {
  if (!dateString) return 'No expiry';
  const date = new Date(dateString);
  return date.toLocaleDateString([], {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function isExpiringSoon(dateString: string | null): boolean {
  if (!dateString) return false;
  const expiry = new Date(dateString);
  const now = new Date();
  const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  return expiry <= thirtyDaysFromNow && expiry > now;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function CredentialCard({
  credential,
  onPress,
}: CredentialCardProps): React.JSX.Element {
  const statusConfig = STATUS_CONFIG[credential.status];
  const typeLabel = CREDENTIAL_TYPE_LABELS[credential.type] ?? credential.type;
  const _iconName = CREDENTIAL_TYPE_ICONS[credential.type] ?? 'document';
  const expiringSoon = isExpiringSoon(credential.expiresAt);

  const needsAction =
    credential.status === 'awaiting_upload' ||
    credential.status === 'expired' ||
    credential.status === 'rejected';

  return (
    <TouchableOpacity
      style={[
        styles.container,
        credential.status === 'awaiting_upload' && styles.containerUpload,
        (credential.status === 'expired' || credential.status === 'rejected') && styles.containerAction,
      ]}
      onPress={() => onPress(credential)}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={`${typeLabel}, status: ${statusConfig.label}`}
    >
      {/* Icon placeholder */}
      <View style={styles.iconContainer}>
        <View style={styles.iconCircle}>
          <Text style={styles.iconText}>
            {typeLabel.charAt(0).toUpperCase()}
          </Text>
        </View>
      </View>

      {/* Content */}
      <View style={styles.content}>
        <Text style={styles.typeLabel} numberOfLines={1}>
          {typeLabel}
        </Text>

        {credential.expiresAt && (
          <Text
            style={[
              styles.expiryText,
              expiringSoon && styles.expiryWarning,
            ]}
          >
            {credential.status === 'expired'
              ? `Expired: ${formatDate(credential.expiresAt)}`
              : `Expires: ${formatDate(credential.expiresAt)}`}
          </Text>
        )}

        {credential.rejectionReason && (
          <Text style={styles.rejectionText} numberOfLines={2}>
            {credential.rejectionReason}
          </Text>
        )}

        {credential.uploadedAt && (
          <Text style={styles.uploadedText}>
            Uploaded: {formatDate(credential.uploadedAt)}
          </Text>
        )}
      </View>

      {/* Status badge */}
      <View
        style={[styles.statusBadge, { backgroundColor: statusConfig.bgColor }]}
      >
        <View
          style={[styles.statusDot, { backgroundColor: statusConfig.color }]}
        />
        <Text style={[styles.statusText, { color: statusConfig.color }]}>
          {statusConfig.label}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    ...GlassStyles.card,
    padding: 14,
    marginHorizontal: 16,
    marginVertical: 6,
  },
  containerAction: {
    borderColor: 'rgba(231, 76, 60, 0.4)',
  },
  containerUpload: {
    borderColor: 'rgba(255, 107, 53, 0.4)',
    borderStyle: 'dashed',
  },
  iconContainer: {
    marginRight: 12,
  },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(74, 144, 226, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(74, 144, 226, 0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconText: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.primary,
  },
  content: {
    flex: 1,
    marginRight: 8,
  },
  typeLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.textPrimary,
    marginBottom: 2,
  },
  expiryText: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  expiryWarning: {
    color: Colors.warning,
  },
  rejectionText: {
    fontSize: 12,
    color: Colors.emergencyRed,
    marginTop: 4,
  },
  uploadedText: {
    fontSize: 11,
    color: Colors.textTertiary,
    marginTop: 2,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.10)',
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 4,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '600',
  },
});

export default React.memo(CredentialCard);
