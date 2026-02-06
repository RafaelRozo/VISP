/**
 * VISP/Tasker - JobCard Component
 *
 * Reusable card for provider views showing task name, customer area,
 * distance, price, time, and status indicator.
 */

import React from 'react';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Colors, getLevelColor, getStatusColor } from '../theme/colors';
import { JobStatus, ServiceLevel } from '../types';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface JobCardProps {
  taskName: string;
  categoryName: string;
  customerArea: string;
  distanceKm: number;
  estimatedPrice: number;
  level: ServiceLevel;
  status: JobStatus;
  scheduledAt: string | null;
  slaDeadline: string | null;
  onPress: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const LEVEL_LABELS: Record<number, string> = {
  1: 'Helper',
  2: 'Experienced',
  3: 'Certified Pro',
  4: 'Emergency',
};

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  matched: 'Matched',
  accepted: 'Accepted',
  en_route: 'En Route',
  in_progress: 'In Progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
  disputed: 'Disputed',
};

function formatTime(dateString: string | null): string {
  if (!dateString) return '--';
  const date = new Date(dateString);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDate(dateString: string | null): string {
  if (!dateString) return '';
  const date = new Date(dateString);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  if (isToday) return 'Today';
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (date.toDateString() === tomorrow.toDateString()) return 'Tomorrow';
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function JobCard({
  taskName,
  categoryName,
  customerArea,
  distanceKm,
  estimatedPrice,
  level,
  status,
  scheduledAt,
  slaDeadline,
  onPress,
}: JobCardProps): React.JSX.Element {
  const levelColor = getLevelColor(level);
  const statusColor = getStatusColor(status);

  return (
    <TouchableOpacity
      style={styles.container}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={`Job: ${taskName} in ${customerArea}`}
    >
      {/* Level indicator strip */}
      <View style={[styles.levelStrip, { backgroundColor: levelColor }]} />

      <View style={styles.content}>
        {/* Header row */}
        <View style={styles.headerRow}>
          <View style={styles.headerLeft}>
            <Text style={styles.taskName} numberOfLines={1}>
              {taskName}
            </Text>
            <Text style={styles.categoryName} numberOfLines={1}>
              {categoryName}
            </Text>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: statusColor }]}>
            <Text style={styles.statusText}>
              {STATUS_LABELS[status] ?? status}
            </Text>
          </View>
        </View>

        {/* Details row */}
        <View style={styles.detailsRow}>
          <View style={styles.detailItem}>
            <Text style={styles.detailLabel}>Location</Text>
            <Text style={styles.detailValue} numberOfLines={1}>
              {customerArea}
            </Text>
          </View>
          <View style={styles.detailItem}>
            <Text style={styles.detailLabel}>Distance</Text>
            <Text style={styles.detailValue}>
              {distanceKm.toFixed(1)} km
            </Text>
          </View>
          <View style={styles.detailItem}>
            <Text style={styles.detailLabel}>Price</Text>
            <Text style={styles.priceValue}>
              ${estimatedPrice.toFixed(2)}
            </Text>
          </View>
        </View>

        {/* Footer row */}
        <View style={styles.footerRow}>
          <View style={[styles.levelBadge, { borderColor: levelColor }]}>
            <Text style={[styles.levelText, { color: levelColor }]}>
              L{level} {LEVEL_LABELS[level]}
            </Text>
          </View>
          {scheduledAt ? (
            <Text style={styles.timeText}>
              {formatDate(scheduledAt)} at {formatTime(scheduledAt)}
            </Text>
          ) : slaDeadline ? (
            <Text style={[styles.timeText, { color: Colors.emergencyRed }]}>
              SLA: {formatTime(slaDeadline)}
            </Text>
          ) : null}
        </View>
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
    backgroundColor: Colors.surface,
    borderRadius: 12,
    marginHorizontal: 16,
    marginVertical: 6,
    overflow: 'hidden',
    shadowColor: Colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
  },
  levelStrip: {
    width: 4,
  },
  content: {
    flex: 1,
    padding: 14,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  headerLeft: {
    flex: 1,
    marginRight: 8,
  },
  taskName: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.textPrimary,
    marginBottom: 2,
  },
  categoryName: {
    fontSize: 13,
    color: Colors.textSecondary,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.white,
    textTransform: 'uppercase',
  },
  detailsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  detailItem: {
    flex: 1,
  },
  detailLabel: {
    fontSize: 11,
    color: Colors.textTertiary,
    marginBottom: 2,
  },
  detailValue: {
    fontSize: 14,
    color: Colors.textPrimary,
  },
  priceValue: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.success,
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  levelBadge: {
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  levelText: {
    fontSize: 11,
    fontWeight: '600',
  },
  timeText: {
    fontSize: 12,
    color: Colors.textSecondary,
  },
});

export default React.memo(JobCard);
