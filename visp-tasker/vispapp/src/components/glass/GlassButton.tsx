/**
 * GlassButton — theme-aware.
 *
 * Three variants:
 *  - 'glass' (default): translucent surface, foreground = theme.textPrimary
 *  - 'glow': solid purple with glow (primary CTA) — always purple
 *  - 'outline': transparent with theme border
 */

import React, { useCallback, useState } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  ViewStyle,
} from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { Typography } from '../../theme/typography';
import { AnimatedSpinner } from '../animations';

type GlassButtonVariant = 'glass' | 'glow' | 'outline';

interface GlassButtonProps {
  title: string;
  onPress: () => void;
  variant?: GlassButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
}

function bgFor(variant: GlassButtonVariant, isDark: boolean): ViewStyle {
  if (variant === 'glow') {
    return {
      backgroundColor: isDark ? 'rgba(120, 80, 255, 0.85)' : '#7C3AED',
      borderWidth: 1,
      borderColor: isDark ? 'rgba(255, 255, 255, 0.30)' : 'rgba(124, 58, 237, 0.40)',
      borderRadius: 12,
      paddingVertical: 14,
      paddingHorizontal: 32,
      ...Platform.select({
        ios: {
          shadowColor: '#7850FF',
          shadowOffset: { width: 0, height: 0 },
          shadowOpacity: isDark ? 0.6 : 0.25,
          shadowRadius: 20,
        },
        android: { elevation: 8 },
      }),
    };
  }
  if (variant === 'outline') {
    return {
      backgroundColor: 'transparent',
      borderWidth: 1,
      borderColor: isDark ? 'rgba(255, 255, 255, 0.25)' : 'rgba(0, 0, 0, 0.18)',
      borderRadius: 12,
      paddingVertical: 12,
      paddingHorizontal: 28,
    };
  }
  return {
    backgroundColor: isDark ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.04)',
    borderWidth: 1,
    borderColor: isDark ? 'rgba(255, 255, 255, 0.25)' : 'rgba(0, 0, 0, 0.12)',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 28,
  };
}

const GlassButton: React.FC<GlassButtonProps> = ({
  title,
  onPress,
  variant = 'glass',
  disabled = false,
  loading = false,
  style,
}) => {
  const theme = useTheme();
  const [pressed, setPressed] = useState(false);

  const handlePressIn = useCallback(() => setPressed(true), []);
  const handlePressOut = useCallback(() => setPressed(false), []);

  // Foreground color rules:
  //  - glow: always white text on purple
  //  - outline / glass: theme.textPrimary (dark text in light mode, white in dark)
  const textColor =
    variant === 'glow' ? '#FFFFFF' : theme.textPrimary;

  const spinnerColor = variant === 'glow' ? '#FFFFFF' : theme.textPrimary;

  return (
    <Pressable
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      disabled={disabled || loading}
      style={[
        bgFor(variant, theme.isDark),
        styles.base,
        pressed && styles.pressed,
        disabled && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <AnimatedSpinner size={24} color={spinnerColor} />
      ) : (
        <Text style={[styles.text, { color: textColor }, disabled && styles.disabledText]}>
          {title}
        </Text>
      )}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    minHeight: 48,
  },
  text: {
    ...Typography.buttonLarge,
    fontWeight: '700',
  },
  pressed: { opacity: 0.75 },
  disabled: { opacity: 0.4 },
  disabledText: { opacity: 0.5 },
});

export default GlassButton;
