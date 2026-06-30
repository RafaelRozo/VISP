/**
 * VISP — Square icon button (38×38 by default).
 */

import React from 'react';
import { TouchableOpacity, StyleSheet, ViewStyle } from 'react-native';
import { useVispTheme, VispRadius } from '../../theme/visp';
import { Icon, VispIconName } from './Icon';

interface IconBtnProps {
  name: VispIconName;
  size?: number;
  iconSize?: number;
  active?: boolean;
  onPress?: () => void;
  style?: ViewStyle;
}

export function IconBtn({ name, size = 38, iconSize = 20, active, onPress, style }: IconBtnProps): React.JSX.Element {
  const t = useVispTheme();
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={[
        styles.base,
        {
          width: size,
          height: size,
          backgroundColor: active ? t.cardHi : t.card,
          borderColor: active ? t.borderStrong : t.border,
        },
        style,
      ]}
    >
      <Icon name={name} size={iconSize} color={t.text2} active={active} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: VispRadius.card,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
