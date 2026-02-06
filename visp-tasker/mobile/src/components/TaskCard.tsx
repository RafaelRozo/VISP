/**
 * VISP/Tasker - TaskCard Component
 *
 * Reusable card for displaying a service task in category lists.
 * Shows: task name, level badge, price range, duration estimate.
 * Supports tap handler for navigation to detail view.
 */

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ViewStyle,
} from 'react-native';
import { Colors } from '../theme/colors';
import { Spacing } from '../theme/spacing';
import { Typography, FontWeight } from '../theme/typography';
import { BorderRadius } from '../theme/borders';
import { Shadows } from '../theme/shadows';
import LevelBadge from './LevelBadge';
import type { ServiceLevel } from '../types';

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

interface TaskCardProps {
  id: string;
  name: string;
  description: string;
  level: ServiceLevel;
  estimatedDurationMinutes: number;
  basePrice: number;
  priceRangeMin?: number;
  priceRangeMax?: number;
  onPress: (taskId: string) => void;
  style?: ViewStyle;
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function formatDuration(minutes: number): string {
  if (minutes < 60) {
    return `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (remainingMinutes === 0) {
    return `${hours}h`;
  }
  return `${hours}h ${remainingMinutes}m`;
}

function formatPriceRange(
  basePrice: number,
  rangeMin?: number,
  rangeMax?: number,
): string {
  if (rangeMin !== undefined && rangeMax !== undefined) {
    return `$${rangeMin} - $${rangeMax}`;
  }
  return `From $${basePrice}`;
}

// ──────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────

function TaskCard({
  id,
  name,
  description,
  level,
  estimatedDurationMinutes,
  basePrice,
  priceRangeMin,
  priceRangeMax,
  onPress,
  style,
}: TaskCardProps): React.JSX.Element {
  const handlePress = React.useCallback(() => {
    onPress(id);
  }, [id, onPress]);

  return (
    <TouchableOpacity
      style={[styles.container, style]}
      onPress={handlePress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={`${name}, Level ${level}, ${formatPriceRange(basePrice, priceRangeMin, priceRangeMax)}, estimated ${formatDuration(estimatedDurationMinutes)}`}
      accessibilityHint="Double tap to view task details"
    >
      <View style={styles.header}>
        <Text style={styles.name} numberOfLines={2}>
          {name}
        </Text>
        <LevelBadge level={level} size="small" />
      </View>

      <Text style={styles.description} numberOfLines={2}>
        {description}
      </Text>

      <View style={styles.footer}>
        <View style={styles.footerItem}>
          <Text style={styles.footerIcon}>$</Text>
          <Text style={styles.priceText}>
            {formatPriceRange(basePrice, priceRangeMin, priceRangeMax)}
          </Text>
        </View>

        <View style={styles.footerItem}>
          <Text style={styles.footerIcon}>T</Text>
          <Text style={styles.durationText}>
            {formatDuration(estimatedDurationMinutes)}
          </Text>
        </View>
      </View>

      <View style={styles.chevronContainer}>
        <Text style={styles.chevron}>{'>'}</Text>
      </View>
    </TouchableOpacity>
  );
}

// ──────────────────────────────────────────────
// Styles
// ──────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    padding: Spacing.lg,
    marginBottom: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
    ...Shadows.sm,
    position: 'relative',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: Spacing.sm,
    paddingRight: Spacing.xl,
  },
  name: {
    ...Typography.headline,
    color: Colors.textPrimary,
    flex: 1,
    marginRight: Spacing.sm,
  },
  description: {
    ...Typography.footnote,
    color: Colors.textSecondary,
    marginBottom: Spacing.md,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.lg,
  },
  footerItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  footerIcon: {
    fontSize: 12,
    color: Colors.textTertiary,
    fontWeight: FontWeight.bold,
    marginRight: Spacing.xs,
    width: 16,
    textAlign: 'center',
  },
  priceText: {
    ...Typography.callout,
    color: Colors.primary,
    fontWeight: FontWeight.semiBold,
  },
  durationText: {
    ...Typography.footnote,
    color: Colors.textSecondary,
  },
  chevronContainer: {
    position: 'absolute',
    right: Spacing.lg,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
  },
  chevron: {
    fontSize: 18,
    color: Colors.textTertiary,
    fontWeight: FontWeight.bold,
  },
});

export default React.memo(TaskCard);
