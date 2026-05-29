/**
 * VISP — Bordered search input.
 */

import React from 'react';
import { View, TextInput, StyleSheet, TouchableOpacity } from 'react-native';
import { useVispTheme, VispText, VispRadius } from '../../theme/visp';
import { Icon } from './Icon';

interface SearchInputProps {
  placeholder?: string;
  value?: string;
  onChangeText?: (s: string) => void;
  onSubmit?: () => void;
  trailing?: React.ReactNode;
}

export function SearchInput({ placeholder = 'Search', value, onChangeText, onSubmit, trailing }: SearchInputProps): React.JSX.Element {
  const t = useVispTheme();
  return (
    <View style={[styles.wrap, { backgroundColor: t.card, borderColor: t.border }]}>
      <Icon name="search" size={16} color={t.text3} />
      <TextInput
        placeholder={placeholder}
        placeholderTextColor={t.text3}
        value={value}
        onChangeText={onChangeText}
        onSubmitEditing={onSubmit}
        returnKeyType="search"
        style={[styles.input, VispText.body, { color: t.text }]}
      />
      {trailing ? <TouchableOpacity activeOpacity={0.7}>{trailing}</TouchableOpacity> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: VispRadius.card,
    borderWidth: 1,
  },
  input: { flex: 1, padding: 0 },
});
