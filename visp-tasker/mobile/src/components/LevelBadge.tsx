/**
 * VISP/Tasker - LevelBadge Component
 *
 * Colored badge that displays the provider/task service level.
 * Level 1: Green #27AE60 "Helper"
 * Level 2: Yellow #F39C12 "Experienced"
 * Level 3: Purple #9B59B6 "Certified Pro"
 * Level 4: Red #E74C3C "Emergency"
 *
 * Supports small, medium, and large size variants.
 */

import React from 'react';
import { View, Text, StyleSheet, ViewStyle, TextStyle } from 'react-native';
import { Colors, getLevelColor } from '../theme/colors';
import { Spacing } from '../theme/spacing';
import { FontSize, FontWeight } from '../theme/typography';
import { BorderRadius } from '../theme/borders';
import type { ServiceLevel } from '../types';

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

type BadgeSize = 'small' | 'medium' | 'large';

interface LevelBadgeProps {
  level: ServiceLevel;
  size?: BadgeSize;
  showLabel?: boolean;
  style?: ViewStyle;
}

// ──────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────

const LEVEL_LABELS: Record<ServiceLevel, string> = {
  1: 'Helper',
  2: 'Experienced',
  3: 'Certified Pro',
  4: 'Emergency',
};

const LEVEL_SHORT_LABELS: Record<ServiceLevel, string> = {
  1: 'L1',
  2: 'L2',
  3: 'L3',
  4: 'L4',
};

const SIZE_CONFIG: Record<
  BadgeSize,
  {
    paddingHorizontal: number;
    paddingVertical: number;
    fontSize: number;
    borderRadius: number;
    iconSize: number;
  }
> = {
  small: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xxs,
    fontSize: FontSize.caption,
    borderRadius: BorderRadius.xs,
    iconSize: 8,
  },
  medium: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    fontSize: FontSize.footnote,
    borderRadius: BorderRadius.sm,
    iconSize: 10,
  },
  large: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    fontSize: FontSize.body,
    borderRadius: BorderRadius.md,
    iconSize: 12,
  },
};

// ──────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────

function LevelBadge({
  level,
  size = 'medium',
  showLabel = true,
  style,
}: LevelBadgeProps): React.JSX.Element {
  const color = getLevelColor(level);
  const config = SIZE_CONFIG[size];
  const label = showLabel ? LEVEL_LABELS[level] : LEVEL_SHORT_LABELS[level];

  const containerStyle: ViewStyle = {
    paddingHorizontal: config.paddingHorizontal,
    paddingVertical: config.paddingVertical,
    borderRadius: config.borderRadius,
    backgroundColor: `${color}20`,
    borderWidth: 1,
    borderColor: `${color}60`,
  };

  const textStyle: TextStyle = {
    fontSize: config.fontSize,
    color,
    fontWeight: FontWeight.semiBold,
  };

  const dotStyle: ViewStyle = {
    width: config.iconSize,
    height: config.iconSize,
    borderRadius: config.iconSize / 2,
    backgroundColor: color,
    marginRight: Spacing.xs,
  };

  return (
    <View
      style={[styles.container, containerStyle, style]}
      accessibilityRole="text"
      accessibilityLabel={`Level ${level}: ${LEVEL_LABELS[level]}`}
    >
      <View style={dotStyle} />
      <Text style={textStyle} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

// ──────────────────────────────────────────────
// Styles
// ──────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
  },
});

export default React.memo(LevelBadge);
