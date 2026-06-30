/**
 * GlassInput — theme-aware text input.
 *
 * Reads `useTheme()` for input background, border, text and placeholder.
 * Listens to native `onChange` and forwards through `onChangeText` so iOS
 * Contact AutoFill works with controlled inputs (see feedback memory).
 */

import React, { forwardRef, useState, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
} from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { Typography } from '../../theme/typography';
import { Spacing } from '../../theme/spacing';

interface GlassInputProps extends TextInputProps {
  label?: string;
  error?: string;
  icon?: React.ReactNode;
  containerStyle?: ViewStyle;
}

const GlassInput = forwardRef<TextInput, GlassInputProps>(
  (
    {
      label,
      error,
      icon,
      containerStyle,
      style,
      onFocus,
      onBlur,
      onChange,
      onChangeText,
      value,
      ...rest
    },
    ref,
  ) => {
    const theme = useTheme();
    const [focused, setFocused] = useState(false);

    const handleFocus = useCallback(
      (e: any) => {
        setFocused(true);
        onFocus?.(e);
      },
      [onFocus],
    );

    const handleBlur = useCallback(
      (e: any) => {
        setFocused(false);
        onBlur?.(e);
      },
      [onBlur],
    );

    // iOS Contact AutoFill — see feedback_stripe_onboarding_pattern memory
    const handleChange = useCallback(
      (e: any) => {
        const text = e?.nativeEvent?.text;
        if (typeof text === 'string' && text !== value) {
          onChangeText?.(text);
        }
        onChange?.(e);
      },
      [onChange, onChangeText, value],
    );

    const wrapStyle = {
      backgroundColor: theme.inputBackground,
      borderWidth: 1,
      borderColor: focused
        ? theme.isDark ? 'rgba(120, 80, 255, 0.6)' : 'rgba(124, 58, 237, 0.6)'
        : error
          ? theme.isDark ? 'rgba(231, 76, 60, 0.8)' : 'rgba(185, 28, 28, 0.7)'
          : theme.inputBorder,
      borderRadius: 12,
      paddingVertical: 14,
      paddingHorizontal: 16,
    };

    return (
      <View style={containerStyle}>
        {label && (
          <Text style={[styles.label, { color: theme.textSecondary }]}>{label}</Text>
        )}
        <View style={[wrapStyle, styles.row, style]}>
          {icon && <View style={styles.icon}>{icon}</View>}
          <TextInput
            ref={ref}
            {...rest}
            value={value}
            onChange={handleChange}
            onChangeText={onChangeText}
            style={[styles.textInput, { color: theme.inputText }]}
            placeholderTextColor={theme.inputPlaceholder}
            onFocus={handleFocus}
            onBlur={handleBlur}
          />
        </View>
        {!!error && (
          <Text style={[styles.error, { color: theme.isDark ? '#FC8181' : '#B91C1C' }]}>
            {error}
          </Text>
        )}
      </View>
    );
  },
);

GlassInput.displayName = 'GlassInput';

const styles = StyleSheet.create({
  label: {
    ...Typography.label,
    marginBottom: Spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  icon: {
    marginRight: Spacing.sm,
  },
  textInput: {
    flex: 1,
    fontSize: 16,
    padding: 0,
  },
  error: {
    ...Typography.caption,
    marginTop: Spacing.xs,
  },
});

export default GlassInput;
