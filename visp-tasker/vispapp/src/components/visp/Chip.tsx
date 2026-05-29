/**
 * VISP — Mono uppercase chip.
 */

import React from 'react';
import { Text, View, StyleSheet, TouchableOpacity, ViewStyle } from 'react-native';
import { useVispTheme, VispText, VispRadius } from '../../theme/visp';

interface ChipProps {
  children: React.ReactNode;
  accent?: boolean;
  dark?: boolean;
  onPress?: () => void;
  style?: ViewStyle;
}

export function Chip({ children, accent, dark, onPress, style }: ChipProps): React.JSX.Element {
  const t = useVispTheme();
  const Wrapper: any = onPress ? TouchableOpacity : View;
  const bg = accent ? t.violetDim : dark ? t.deep : t.card;
  const border = accent ? t.violetLine : t.border;
  const color = accent ? t.violet : t.text2;
  return (
    <Wrapper
      onPress={onPress}
      activeOpacity={0.7}
      style={[styles.base, { backgroundColor: bg, borderColor: border }, style]}
    >
      <Text style={[VispText.chip, { color }]}>{children}</Text>
    </Wrapper>
  );
}

const styles = StyleSheet.create({
  base: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: VispRadius.chip,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
});
