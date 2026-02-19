/**
 * GlassButton
 *
 * Three variants:
 *  - 'glass' (default): translucent white button
 *  - 'glow': solid purple with glow shadow (primary CTA)
 *  - 'outline': transparent with glass border
 *
 * Usage:
 *   <GlassButton title="Continue" variant="glow" onPress={handlePress} />
 */

import React, { useCallback, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  ViewStyle,
} from 'react-native';
import { GlassStyles } from '../../theme/glass';
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

const variantMap: Record<GlassButtonVariant, ViewStyle> = {
  glass: GlassStyles.button,
  glow: GlassStyles.glowButton,
  outline: GlassStyles.outlineButton,
};

const GlassButton: React.FC<GlassButtonProps> = ({
  title,
  onPress,
  variant = 'glass',
  disabled = false,
  loading = false,
  style,
}) => {
  const [pressed, setPressed] = useState(false);

  const handlePressIn = useCallback(() => setPressed(true), []);
  const handlePressOut = useCallback(() => setPressed(false), []);

  return (
    <Pressable
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      disabled={disabled || loading}
      style={[
        variantMap[variant],
        styles.base,
        pressed && styles.pressed,
        disabled && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <AnimatedSpinner size={24} color="#FFFFFF" />
      ) : (
        <Text
          style={[
            styles.text,
            variant === 'outline' && styles.outlineText,
            disabled && styles.disabledText,
          ]}
        >
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
    color: '#FFFFFF',
    fontWeight: '700',
  },
  outlineText: {
    color: 'rgba(255, 255, 255, 0.85)',
  },
  pressed: {
    opacity: 0.75,
  },
  disabled: {
    opacity: 0.4,
  },
  disabledText: {
    color: 'rgba(255, 255, 255, 0.4)',
  },
});

export default GlassButton;
