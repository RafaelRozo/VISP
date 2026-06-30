/**
 * VISP — Screen title.
 *
 * Optional eyebrow line + big headline + optional right slot.
 * E.g. <ScreenTitle title="Browse" sub="§ Categories" right={<IconBtn name="sliders" />} />
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Eyebrow } from './Eyebrow';
import { Headline } from './Headline';
import { IconBtn } from './IconBtn';
import { VispSpace } from '../../theme/visp';

interface ScreenTitleProps {
  title: string;
  sub?: string;
  right?: React.ReactNode;
  /** When provided, shows a chevron-left back button on the left. */
  onBack?: () => void;
  /** When true, this title is the very first element of the screen and should
   *  apply the device safe-area top inset itself. Default true. */
  topInset?: boolean;
}

export function ScreenTitle({
  title,
  sub,
  right,
  onBack,
  topInset = true,
}: ScreenTitleProps): React.JSX.Element {
  const inner = (
    <View style={styles.wrap}>
      {onBack ? (
        <View style={styles.backRow}>
          <IconBtn name="chevron-left" onPress={onBack} />
        </View>
      ) : null}
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          {sub ? <Eyebrow style={{ marginBottom: 6 }}>{sub}</Eyebrow> : null}
          <Headline>{title}</Headline>
        </View>
        {right ? <View style={styles.right}>{right}</View> : null}
      </View>
    </View>
  );
  if (!topInset) return inner;
  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      {inner}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { backgroundColor: 'transparent' },
  wrap: {
    paddingHorizontal: VispSpace.gutter,
    paddingTop: 8,
    paddingBottom: 16,
  },
  backRow: { marginBottom: 14 },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  right: { marginLeft: 12 },
});
