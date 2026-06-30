/**
 * VISP — Stat tile (eyebrow label + big value).
 */

import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import { useVispTheme, VispRadius, FontSansBold } from '../../theme/visp';
import { Eyebrow } from './Eyebrow';

interface StatTileProps {
  label: string;
  value: string;
  accent?: boolean;
  style?: ViewStyle;
}

export function StatTile({ label, value, accent, style }: StatTileProps): React.JSX.Element {
  const t = useVispTheme();
  return (
    <View
      style={[
        styles.box,
        {
          backgroundColor: t.card,
          borderColor: accent ? t.violetLine : t.border,
        },
        style,
      ]}
    >
      <Eyebrow color={accent ? t.violet : t.text3}>{label}</Eyebrow>
      <Text
        style={{
          fontFamily: FontSansBold,
          fontSize: 18,
          fontWeight: '700',
          letterSpacing: -0.36,
          color: t.text,
          marginTop: 8,
        }}
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: VispRadius.card,
    borderWidth: 1,
  },
});
