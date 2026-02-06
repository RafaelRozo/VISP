/**
 * VISP/Tasker - Active Job Card Component
 *
 * Compact card displaying an active job with provider info,
 * task name, color-coded status badge, and SLA countdown timer.
 * Used in a horizontal scroll list on the customer home screen.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import {
  Colors,
  Spacing,
  Typography,
  BorderRadius,
  Shadows,
  getLevelColor,
  getStatusColor,
} from '../theme';
import type { Job, JobStatus } from '../types';

// ──────────────────────────────────────────────
// Props
// ──────────────────────────────────────────────

interface ActiveJobCardProps {
  /** The job data to display. */
  job: Job;
  /** Called when the card is tapped. */
  onPress: (job: Job) => void;
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

const STATUS_LABELS: Record<JobStatus, string> = {
  pending: 'Pending',
  matched: 'Matched',
  accepted: 'Accepted',
  en_route: 'En Route',
  in_progress: 'In Progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
  disputed: 'Disputed',
};

function formatStatusLabel(status: JobStatus): string {
  return STATUS_LABELS[status] ?? status;
}

/**
 * Compute time remaining from now until a deadline string.
 * Returns a formatted string like "1h 23m" or "EXPIRED".
 */
function formatTimeRemaining(deadlineIso: string): string {
  const now = Date.now();
  const deadline = new Date(deadlineIso).getTime();
  const diff = deadline - now;

  if (diff <= 0) {
    return 'EXPIRED';
  }

  const totalMinutes = Math.floor(diff / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

function isTimeUrgent(deadlineIso: string): boolean {
  const now = Date.now();
  const deadline = new Date(deadlineIso).getTime();
  const diff = deadline - now;
  // Urgent if less than 30 minutes remain
  return diff > 0 && diff < 30 * 60 * 1000;
}

// ──────────────────────────────────────────────
// Provider Avatar
// ──────────────────────────────────────────────

interface AvatarProps {
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
}

function ProviderAvatar({
  firstName,
  lastName,
}: AvatarProps): React.JSX.Element {
  const initials = `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();

  // In production, this would render an <Image> if avatarUrl is provided.
  return (
    <View style={styles.avatar}>
      <Text style={styles.avatarText}>{initials}</Text>
    </View>
  );
}

// ──────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────

function ActiveJobCard({ job, onPress }: ActiveJobCardProps): React.JSX.Element {
  const [timeRemaining, setTimeRemaining] = useState<string | null>(null);
  const [isUrgent, setIsUrgent] = useState(false);

  // ── SLA Timer ────────────────────────────
  useEffect(() => {
    if (!job.slaDeadline) {
      setTimeRemaining(null);
      return;
    }

    function update(): void {
      if (job.slaDeadline) {
        setTimeRemaining(formatTimeRemaining(job.slaDeadline));
        setIsUrgent(isTimeUrgent(job.slaDeadline));
      }
    }

    update();
    const interval = setInterval(update, 30000); // Update every 30 seconds

    return () => clearInterval(interval);
  }, [job.slaDeadline]);

  // ── Handlers ─────────────────────────────
  const handlePress = useCallback(() => {
    onPress(job);
  }, [job, onPress]);

  // ── Derived ──────────────────────────────
  const statusColor = useMemo(() => getStatusColor(job.status), [job.status]);
  const levelColor = useMemo(() => getLevelColor(job.level), [job.level]);
  const statusLabel = formatStatusLabel(job.status);

  const providerName = job.provider
    ? `${job.provider.firstName} ${job.provider.lastName}`
    : 'Finding provider...';

  // ── Render ───────────────────────────────
  return (
    <TouchableOpacity
      style={styles.card}
      onPress={handlePress}
      activeOpacity={0.7}
      accessibilityLabel={`${job.taskName}, status: ${statusLabel}`}
      accessibilityRole="button"
    >
      {/* Level Accent Strip */}
      <View style={[styles.levelStrip, { backgroundColor: levelColor }]} />

      <View style={styles.cardContent}>
        {/* Top Row: Provider + Status */}
        <View style={styles.topRow}>
          <View style={styles.providerInfo}>
            {job.provider ? (
              <ProviderAvatar
                firstName={job.provider.firstName}
                lastName={job.provider.lastName}
                avatarUrl={job.provider.avatarUrl}
              />
            ) : (
              <View style={[styles.avatar, styles.avatarPlaceholder]}>
                <Text style={styles.avatarText}>?</Text>
              </View>
            )}
            <View style={styles.providerDetails}>
              <Text style={styles.providerName} numberOfLines={1}>
                {providerName}
              </Text>
              {job.provider ? (
                <Text style={styles.providerRating}>
                  {job.provider.rating.toFixed(1)} ({job.provider.completedJobs}{' '}
                  jobs)
                </Text>
              ) : null}
            </View>
          </View>

          {/* Status Badge */}
          <View
            style={[
              styles.statusBadge,
              { backgroundColor: `${statusColor}20` },
            ]}
          >
            <View
              style={[styles.statusDot, { backgroundColor: statusColor }]}
            />
            <Text style={[styles.statusText, { color: statusColor }]}>
              {statusLabel}
            </Text>
          </View>
        </View>

        {/* Task Name */}
        <Text style={styles.taskName} numberOfLines={1}>
          {job.taskName}
        </Text>
        <Text style={styles.categoryName} numberOfLines={1}>
          {job.categoryName}
        </Text>

        {/* Bottom Row: SLA Timer + Price */}
        <View style={styles.bottomRow}>
          {timeRemaining ? (
            <View
              style={[
                styles.slaContainer,
                isUrgent && styles.slaContainerUrgent,
              ]}
            >
              <Text
                style={[
                  styles.slaLabel,
                  isUrgent && styles.slaLabelUrgent,
                ]}
              >
                SLA:
              </Text>
              <Text
                style={[
                  styles.slaTime,
                  isUrgent && styles.slaTimeUrgent,
                ]}
              >
                {timeRemaining}
              </Text>
            </View>
          ) : (
            <View />
          )}

          <Text style={styles.priceEstimate}>
            ${(job.finalPrice ?? job.estimatedPrice).toFixed(2)}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

// ──────────────────────────────────────────────
// Styles
// ──────────────────────────────────────────────

const CARD_WIDTH = 280;

const styles = StyleSheet.create({
  card: {
    width: CARD_WIDTH,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
    ...Shadows.sm,
  },

  // ── Level Strip ───────────────────────
  levelStrip: {
    height: 3,
    width: '100%',
  },

  cardContent: {
    padding: Spacing.lg,
  },

  // ── Top Row ───────────────────────────
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: Spacing.md,
  },
  providerInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: Spacing.sm,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.primaryDark,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing.sm,
  },
  avatarPlaceholder: {
    backgroundColor: Colors.surfaceLight,
  },
  avatarText: {
    ...Typography.footnote,
    color: Colors.white,
    fontWeight: '600',
  },
  providerDetails: {
    flex: 1,
  },
  providerName: {
    ...Typography.footnote,
    color: Colors.textPrimary,
    fontWeight: '600',
  },
  providerRating: {
    ...Typography.caption,
    color: Colors.textTertiary,
  },

  // ── Status Badge ──────────────────────
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xxs,
    borderRadius: BorderRadius.full,
    gap: Spacing.xs,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusText: {
    ...Typography.caption,
    fontWeight: '600',
  },

  // ── Task Info ─────────────────────────
  taskName: {
    ...Typography.headline,
    color: Colors.textPrimary,
    marginBottom: Spacing.xxs,
  },
  categoryName: {
    ...Typography.caption,
    color: Colors.textTertiary,
    marginBottom: Spacing.md,
  },

  // ── Bottom Row ────────────────────────
  bottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  slaContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    backgroundColor: 'rgba(74, 144, 226, 0.1)',
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xxs,
    borderRadius: BorderRadius.xs,
  },
  slaContainerUrgent: {
    backgroundColor: 'rgba(231, 76, 60, 0.1)',
  },
  slaLabel: {
    ...Typography.caption,
    color: Colors.primary,
    fontWeight: '500',
  },
  slaLabelUrgent: {
    color: Colors.emergencyRed,
  },
  slaTime: {
    ...Typography.caption,
    color: Colors.primary,
    fontWeight: '700',
  },
  slaTimeUrgent: {
    color: Colors.emergencyRed,
  },
  priceEstimate: {
    ...Typography.headline,
    color: Colors.textPrimary,
    fontWeight: '700',
  },
});

export default React.memo(ActiveJobCard);
