/**
 * GlassInput
 *
 * Glass-themed text input with optional label, error state, and icon.
 * Supports ref forwarding for focus management.
 *
 * Usage:
 *   <GlassInput
 *     ref={inputRef}
 *     label="Email"
 *     placeholder="you@example.com"
 *     value={email}
 *     onChangeText={setEmail}
 *     error="Invalid email"
 *   />
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
import { GlassStyles } from '../../theme/glass';
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

    // iOS Contact AutoFill fills the native TextInput but doesn't always fire
    // `onChangeText`, leaving the React state empty while the field looks
    // populated. Listening to `onChange` (which Apple fires reliably for
    // autofill) and forwarding the value through `onChangeText` makes the
    // controlled input mirror the autofilled text. We compare against the
    // current `value` prop to avoid re-emitting when both events fire for
    // a user-typed character.
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

    return (
      <View style={containerStyle}>
        {label && <Text style={styles.label}>{label}</Text>}
        <View
          style={[
            GlassStyles.input,
            styles.row,
            focused && GlassStyles.inputFocused,
            !!error && GlassStyles.inputError,
            style,
          ]}
        >
          {icon && <View style={styles.icon}>{icon}</View>}
          <TextInput
            ref={ref}
            {...rest}
            value={value}
            onChange={handleChange}
            onChangeText={onChangeText}
            style={styles.textInput}
            placeholderTextColor="rgba(255, 255, 255, 0.35)"
            onFocus={handleFocus}
            onBlur={handleBlur}
          />
        </View>
        {!!error && <Text style={styles.error}>{error}</Text>}
      </View>
    );
  },
);

GlassInput.displayName = 'GlassInput';

const styles = StyleSheet.create({
  label: {
    ...Typography.label,
    color: 'rgba(255, 255, 255, 0.55)',
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
    color: '#FFFFFF',
    fontSize: 16,
    padding: 0,
  },
  error: {
    ...Typography.caption,
    color: '#E74C3C',
    marginTop: Spacing.xs,
  },
});

export default GlassInput;
