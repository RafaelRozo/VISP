/**
 * VISP — List row (icon + title + sub + chevron). Pressable.
 */

import React from 'react';
import { TouchableOpacity, View, Text, StyleSheet, ViewStyle } from 'react-native';
import { useVispTheme, VispText, VispRadius } from '../../theme/visp';
import { Icon, VispIconName } from './Icon';

interface RowProps {
  icon?: VispIconName;
  title: string;
  sub?: string;
  trailing?: React.ReactNode;
  chevron?: boolean;
  onPress?: () => void;
  danger?: boolean;
  accent?: boolean;
  style?: ViewStyle;
}

export function Row({
  icon,
  title,
  sub,
  trailing,
  chevron = true,
  onPress,
  danger,
  accent,
  style,
}: RowProps): React.JSX.Element {
  const t = useVispTheme();
  const titleColor = danger ? t.danger : accent ? t.violet : t.text;
  const iconColor = danger ? t.danger : accent ? t.violet : t.text2;
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7} style={[styles.row, style]}>
      {icon ? (
        <View
          style={[
            styles.iconBox,
            {
              backgroundColor: accent ? t.violetDim : t.deep,
              borderColor: accent ? t.violetLine : t.border,
            },
          ]}
        >
          <Icon name={icon} size={16} color={iconColor} />
        </View>
      ) : null}
      <View style={styles.body}>
        <Text style={[VispText.bodyStrong, { color: titleColor }]}>{title}</Text>
        {sub ? <Text style={[VispText.body, { color: t.text3, marginTop: 2 }]}>{sub}</Text> : null}
      </View>
      {trailing ? <View>{trailing}</View> : null}
      {chevron && !trailing ? <Icon name="chevron-right" size={16} color={t.text3} /> : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
  },
  iconBox: {
    width: 36,
    height: 36,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1, minWidth: 0 },
});
