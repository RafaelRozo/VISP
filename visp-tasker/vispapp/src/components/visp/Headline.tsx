/**
 * VISP — Big editorial headline.
 */

import React from 'react';
import { Text, TextStyle } from 'react-native';
import { VispText, useVispTheme } from '../../theme/visp';

interface HeadlineProps {
  children: React.ReactNode;
  size?: 'lg' | 'md';
  color?: string;
  style?: TextStyle;
}

export function Headline({ children, size = 'lg', color, style }: HeadlineProps): React.JSX.Element {
  const t = useVispTheme();
  return (
    <Text style={[size === 'lg' ? VispText.headline : VispText.headlineMid, { color: color ?? t.text }, style]}>
      {children}
    </Text>
  );
}
