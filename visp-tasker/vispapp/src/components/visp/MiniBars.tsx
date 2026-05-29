/**
 * VISP — Mini bar chart (e.g. 7-day earnings).
 *
 * Renders an array of heights (0–100) as vertical bars.
 * `peakIndex` highlights one bar with the violet accent.
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useVispTheme } from '../../theme/visp';

interface MiniBarsProps {
  data: number[];
  peakIndex?: number;
  height?: number;
  gap?: number;
}

export function MiniBars({ data, peakIndex, height = 32, gap = 4 }: MiniBarsProps): React.JSX.Element {
  const t = useVispTheme();
  const max = Math.max(...data, 1);
  return (
    <View style={[styles.row, { height, gap }]}>
      {data.map((v, i) => {
        const pct = Math.max(0.05, v / max);
        return (
          <View
            key={i}
            style={[
              styles.bar,
              {
                height: `${pct * 100}%`,
                backgroundColor: i === peakIndex ? t.violet : t.borderStrong,
              },
            ]}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  bar: {
    flex: 1,
    minWidth: 3,
    borderRadius: 1,
  },
});
