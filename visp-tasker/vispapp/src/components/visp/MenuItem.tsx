/**
 * VISP — Settings/menu row. Same anatomy as Row but with a bottom divider.
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useVispTheme } from '../../theme/visp';
import { Row } from './Row';
import { VispIconName } from './Icon';

interface MenuItemProps {
  icon?: VispIconName;
  title: string;
  sub?: string;
  trailing?: React.ReactNode;
  onPress?: () => void;
  danger?: boolean;
  accent?: boolean;
  last?: boolean;
}

export function MenuItem({ icon, title, sub, trailing, onPress, danger, accent, last }: MenuItemProps): React.JSX.Element {
  const t = useVispTheme();
  return (
    <View style={!last ? [styles.wrap, { borderBottomColor: t.border }] : undefined}>
      <Row
        icon={icon}
        title={title}
        sub={sub}
        trailing={trailing}
        chevron={!trailing}
        onPress={onPress}
        danger={danger}
        accent={accent}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
