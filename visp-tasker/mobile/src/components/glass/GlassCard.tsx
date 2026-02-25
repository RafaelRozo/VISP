/**
 * GlassCard
 *
 * Reusable glass surface with three variants:
 *  - 'standard' (default): translucent white glass
 *  - 'dark': frosted dark panel
 *  - 'elevated': brighter white glass with stronger shadow
 *
 * Usage:
 *   <GlassCard variant="dark" padding={24}>{content}</GlassCard>
 */

import React from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';
import { GlassStyles } from '../../theme/glass';
import { Spacing } from '../../theme/spacing';

type GlassCardVariant = 'standard' | 'dark' | 'elevated';

interface GlassCardProps {
  children: React.ReactNode;
  variant?: GlassCardVariant;
  padding?: number;
  style?: ViewStyle;
}

const variantMap: Record<GlassCardVariant, ViewStyle> = {
  standard: GlassStyles.card,
  dark: GlassStyles.darkPanel,
  elevated: GlassStyles.elevated,
};

const GlassCard: React.FC<GlassCardProps> = ({
  children,
  variant = 'standard',
  padding = Spacing.lg,
  style,
}) => {
  return (
    <View
      style={[
        variantMap[variant],
        GlassStyles.topHighlight,
        { padding },
        style,
      ]}
    >
      {children}
    </View>
  );
};

export default GlassCard;
