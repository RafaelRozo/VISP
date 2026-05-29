/**
 * VISP — Eyebrow micro-label.
 * Mono, uppercase, 10px with 0.16em tracking. Used for section labels and meta.
 */

import React from 'react';
import { Text, TextStyle } from 'react-native';
import { VispText, useVispTheme } from '../../theme/visp';

interface EyebrowProps {
  children: React.ReactNode;
  color?: string;
  tight?: boolean;
  style?: TextStyle;
}

export function Eyebrow({ children, color, tight, style }: EyebrowProps): React.JSX.Element {
  const t = useVispTheme();
  return (
    <Text style={[tight ? VispText.eyebrowTight : VispText.eyebrow, { color: color ?? t.text3 }, style]}>
      {children}
    </Text>
  );
}
