/**
 * VISP — Online indicator pill (provider status).
 */

import React from 'react';
import { TouchableOpacity, View, Text, StyleSheet } from 'react-native';
import { useVispTheme, VispRadius, VispText } from '../../theme/visp';

interface OnlinePillProps {
  online?: boolean;
  onPress?: () => void;
}

export function OnlinePill({ online = true, onPress }: OnlinePillProps): React.JSX.Element {
  const t = useVispTheme();
  const dot = online ? t.violet : t.text3;
  const border = online ? t.violetLine : t.border;
  return (
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={onPress}
      style={[styles.pill, { backgroundColor: t.card, borderColor: border }]}
    >
      <View style={[styles.dot, { backgroundColor: dot }]} />
      <Text style={[VispText.bodyStrong, { color: t.text, fontSize: 12 }]}>{online ? 'Online' : 'Offline'}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 7,
    paddingLeft: 8,
    paddingRight: 12,
    borderRadius: VispRadius.pill,
    borderWidth: 1,
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
});
