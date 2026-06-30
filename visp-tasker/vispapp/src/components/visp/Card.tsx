/**
 * VISP — Card surface.
 * 1px border, radius 10, padding 18 by default.
 */

import React from 'react';
import { View, ViewStyle, StyleSheet } from 'react-native';
import { useVispTheme, VispRadius, VispSpace } from '../../theme/visp';

interface CardProps {
  children: React.ReactNode;
  padding?: number;
  accent?: boolean;
  highlighted?: boolean;
  style?: ViewStyle | ViewStyle[];
}

export function Card({ children, padding = VispSpace.card, accent, highlighted, style }: CardProps): React.JSX.Element {
  const t = useVispTheme();
  return (
    <View
      style={[
        styles.base,
        {
          backgroundColor: highlighted ? t.cardHi : t.card,
          borderColor: accent ? t.violetLine : t.border,
          padding,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: VispRadius.card,
    borderWidth: 1,
  },
});
