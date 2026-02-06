/**
 * VISP/Tasker Design System - Shadow definitions
 *
 * Platform-aware shadows for iOS (shadowX) and Android (elevation).
 */

import { Platform, ViewStyle } from 'react-native';
import { Colors } from './colors';

export interface ShadowStyle {
  shadowColor: string;
  shadowOffset: { width: number; height: number };
  shadowOpacity: number;
  shadowRadius: number;
  elevation: number;
}

function createShadow(
  offsetY: number,
  radius: number,
  opacity: number,
  elevation: number,
): ViewStyle {
  return Platform.select({
    ios: {
      shadowColor: Colors.shadow,
      shadowOffset: { width: 0, height: offsetY },
      shadowOpacity: opacity,
      shadowRadius: radius,
    },
    android: {
      elevation,
    },
  }) as ViewStyle;
}

export const Shadows = {
  none: createShadow(0, 0, 0, 0),
  sm: createShadow(1, 2, 0.15, 2),
  md: createShadow(2, 4, 0.2, 4),
  lg: createShadow(4, 8, 0.25, 8),
  xl: createShadow(8, 16, 0.3, 12),
} as const;

export type ShadowKey = keyof typeof Shadows;
