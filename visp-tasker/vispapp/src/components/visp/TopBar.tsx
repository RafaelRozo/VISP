/**
 * VISP — Top bar.
 *
 * Flex row with left / center? / right slots. Used for context headers like:
 *   left=<Pin + "BURLINGTON / Hey Alex">, right=<Bell + Avatar>
 *   left=<Avatar + "PRO·LV4 / Marcus R.">, right=<OnlinePill + Settings>
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { VispSpace } from '../../theme/visp';

interface TopBarProps {
  left?: React.ReactNode;
  center?: React.ReactNode;
  right?: React.ReactNode;
}

export function TopBar({ left, center, right }: TopBarProps): React.JSX.Element {
  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <View style={styles.row}>
        <View style={styles.left}>{left}</View>
        {center ? <View>{center}</View> : null}
        <View style={styles.right}>{right}</View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { backgroundColor: 'transparent' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: VispSpace.gutter,
    paddingTop: 8,
    paddingBottom: 14,
  },
  left: { flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 1, minWidth: 0 },
  right: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
