/**
 * GlassCard
 *
 * Reusable glass surface with three variants:
 *  - 'standard' (default): translucent surface that inverts on light theme
 *  - 'dark': frosted dark panel — always dark (intentional)
 *  - 'elevated': brighter glass with stronger shadow
 *
 * Theme-aware: in light mode, 'standard' and 'elevated' switch to a
 * paper-light look so dark text inside reads correctly.
 */

import React from 'react';
import { Platform, View, ViewStyle } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { Spacing } from '../../theme/spacing';

type GlassCardVariant = 'standard' | 'dark' | 'elevated';

interface GlassCardProps {
  children: React.ReactNode;
  variant?: GlassCardVariant;
  padding?: number;
  style?: ViewStyle;
}

function styleFor(variant: GlassCardVariant, isDark: boolean): ViewStyle {
  if (variant === 'dark') {
    return {
      backgroundColor: isDark ? 'rgba(10, 10, 30, 0.55)' : 'rgba(245, 245, 250, 0.95)',
      borderWidth: 1,
      borderColor: isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.08)',
      borderRadius: 16,
      ...Platform.select({
        ios: {
          shadowColor: '#000',
          shadowOffset: { width: 0, height: isDark ? 20 : 4 },
          shadowOpacity: isDark ? 0.5 : 0.06,
          shadowRadius: isDark ? 60 : 14,
        },
        android: { elevation: isDark ? 12 : 3 },
      }),
    };
  }
  if (variant === 'elevated') {
    return {
      backgroundColor: isDark ? 'rgba(255, 255, 255, 0.18)' : '#FFFFFF',
      borderWidth: 1,
      borderColor: isDark ? 'rgba(255, 255, 255, 0.25)' : 'rgba(0, 0, 0, 0.10)',
      borderRadius: 20,
      ...Platform.select({
        ios: {
          shadowColor: '#000',
          shadowOffset: { width: 0, height: isDark ? 12 : 8 },
          shadowOpacity: isDark ? 0.4 : 0.10,
          shadowRadius: isDark ? 40 : 20,
        },
        android: { elevation: 10 },
      }),
    };
  }
  // standard
  return {
    backgroundColor: isDark ? 'rgba(255, 255, 255, 0.10)' : '#FFFFFF',
    borderWidth: 1,
    borderColor: isDark ? 'rgba(255, 255, 255, 0.20)' : 'rgba(0, 0, 0, 0.08)',
    borderRadius: 20,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: isDark ? 8 : 4 },
        shadowOpacity: isDark ? 0.3 : 0.06,
        shadowRadius: isDark ? 32 : 14,
      },
      android: { elevation: isDark ? 8 : 3 },
    }),
  };
}

const GlassCard: React.FC<GlassCardProps> = ({
  children,
  variant = 'standard',
  padding = Spacing.lg,
  style,
}) => {
  const theme = useTheme();
  const variantStyle = styleFor(variant, theme.isDark);
  return (
    <View style={[variantStyle, { padding }, style]}>
      {children}
    </View>
  );
};

export default GlassCard;
