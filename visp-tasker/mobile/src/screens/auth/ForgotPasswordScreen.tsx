/**
 * VISP/Tasker - Forgot Password Screen
 *
 * Collects the user's email and requests a password reset link.
 * Shows a success state after the request is sent.
 */

import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { Colors, Spacing, Typography, BorderRadius, Shadows } from '../../theme';
import { useAuthStore } from '../../stores/authStore';
import type { RootStackParamList } from '../../types';

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

type Props = NativeStackScreenProps<RootStackParamList, 'ForgotPassword'>;

// ──────────────────────────────────────────────
// Validation
// ──────────────────────────────────────────────

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ──────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────

function ForgotPasswordScreen({ navigation }: Props): React.JSX.Element {
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);

  const { forgotPassword, isLoading, error, clearError } = useAuthStore();

  // ── Handlers ─────────────────────────────

  const handleEmailChange = useCallback(
    (text: string) => {
      setEmail(text);
      if (error) clearError();
      if (emailError) setEmailError(null);
    },
    [error, emailError, clearError],
  );

  const handleSubmit = useCallback(async () => {
    Keyboard.dismiss();

    const trimmed = email.trim();
    if (!trimmed) {
      setEmailError('Email is required');
      return;
    }
    if (!EMAIL_REGEX.test(trimmed)) {
      setEmailError('Enter a valid email address');
      return;
    }

    try {
      await forgotPassword(trimmed.toLowerCase());
      setIsSuccess(true);
    } catch {
      // Error handled by the store
    }
  }, [email, forgotPassword]);

  const handleBackToLogin = useCallback(() => {
    navigation.navigate('Login');
  }, [navigation]);

  // ── Derived ──────────────────────────────

  const isFormValid = EMAIL_REGEX.test(email.trim());

  // ── Success State ────────────────────────

  if (isSuccess) {
    return (
      <View style={styles.container}>
        <View style={styles.successContainer}>
          <View style={styles.successIconContainer}>
            <Text style={styles.successIcon}>{'  '}</Text>
          </View>
          <Text style={styles.successTitle}>Check your email</Text>
          <Text style={styles.successMessage}>
            We sent a password reset link to{'\n'}
            <Text style={styles.successEmail}>{email.trim().toLowerCase()}</Text>
          </Text>
          <Text style={styles.successHint}>
            If you do not see the email, check your spam folder. The link
            expires in 30 minutes.
          </Text>

          <TouchableOpacity
            style={styles.backToLoginButton}
            onPress={handleBackToLogin}
            activeOpacity={0.8}
          >
            <Text style={styles.backToLoginText}>Back to Sign In</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.resendButton}
            onPress={() => {
              setIsSuccess(false);
            }}
          >
            <Text style={styles.resendText}>
              Did not receive it? Try again
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── Form State ───────────────────────────

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Back Button */}
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
          hitSlop={12}
          disabled={isLoading}
        >
          <Text style={styles.backButtonText}>Back</Text>
        </TouchableOpacity>

        {/* Header */}
        <Text style={styles.title}>Reset your password</Text>
        <Text style={styles.subtitle}>
          Enter the email address associated with your account, and we will send
          you a link to reset your password.
        </Text>

        {/* Server Error */}
        {error ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorBannerText}>{error}</Text>
          </View>
        ) : null}

        {/* Email Field */}
        <View style={styles.fieldContainer}>
          <Text style={styles.label}>Email</Text>
          <TextInput
            style={[styles.input, emailError ? styles.inputError : null]}
            value={email}
            onChangeText={handleEmailChange}
            placeholder="you@example.com"
            placeholderTextColor={Colors.inputPlaceholder}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            textContentType="emailAddress"
            returnKeyType="send"
            onSubmitEditing={handleSubmit}
            editable={!isLoading}
            autoFocus
          />
          {emailError ? (
            <Text style={styles.fieldError}>{emailError}</Text>
          ) : null}
        </View>

        {/* Submit Button */}
        <TouchableOpacity
          style={[
            styles.submitButton,
            (!isFormValid || isLoading) && styles.submitButtonDisabled,
          ]}
          onPress={handleSubmit}
          disabled={!isFormValid || isLoading}
          activeOpacity={0.8}
        >
          {isLoading ? (
            <ActivityIndicator color={Colors.white} size="small" />
          ) : (
            <Text style={styles.submitButtonText}>Send Reset Link</Text>
          )}
        </TouchableOpacity>

        {/* Back to Login */}
        <TouchableOpacity
          style={styles.loginLinkButton}
          onPress={handleBackToLogin}
          disabled={isLoading}
        >
          <Text style={styles.loginLinkText}>Back to Sign In</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ──────────────────────────────────────────────
// Styles
// ──────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: Spacing.xxl,
    paddingTop: Spacing.xxxl,
    paddingBottom: Spacing.xxxl,
  },

  // ── Back ───────────────────────────────
  backButton: {
    alignSelf: 'flex-start',
    marginBottom: Spacing.xxl,
  },
  backButtonText: {
    ...Typography.body,
    color: Colors.primary,
    fontWeight: '500',
  },

  // ── Header ────────────────────────────
  title: {
    ...Typography.title2,
    color: Colors.textPrimary,
    marginBottom: Spacing.sm,
  },
  subtitle: {
    ...Typography.body,
    color: Colors.textSecondary,
    marginBottom: Spacing.xxl,
    lineHeight: 22,
  },

  // ── Error Banner ──────────────────────
  errorBanner: {
    backgroundColor: 'rgba(231, 76, 60, 0.15)',
    borderWidth: 1,
    borderColor: Colors.error,
    borderRadius: BorderRadius.sm,
    padding: Spacing.md,
    marginBottom: Spacing.lg,
  },
  errorBannerText: {
    ...Typography.footnote,
    color: Colors.error,
    textAlign: 'center',
  },

  // ── Fields ────────────────────────────
  fieldContainer: {
    marginBottom: Spacing.xxl,
  },
  label: {
    ...Typography.footnote,
    color: Colors.textSecondary,
    marginBottom: Spacing.sm,
    fontWeight: '500',
  },
  input: {
    backgroundColor: Colors.inputBackground,
    borderWidth: 1,
    borderColor: Colors.inputBorder,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    color: Colors.inputText,
    fontSize: 16,
  },
  inputError: {
    borderColor: Colors.error,
  },
  fieldError: {
    ...Typography.caption,
    color: Colors.error,
    marginTop: Spacing.xs,
  },

  // ── Submit Button ─────────────────────
  submitButton: {
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.sm,
    paddingVertical: Spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 50,
    marginBottom: Spacing.lg,
    ...Shadows.md,
  },
  submitButtonDisabled: {
    backgroundColor: Colors.surfaceLight,
    ...Shadows.none,
  },
  submitButtonText: {
    ...Typography.buttonLarge,
    color: Colors.white,
  },

  // ── Login Link ────────────────────────
  loginLinkButton: {
    alignItems: 'center',
    paddingVertical: Spacing.sm,
  },
  loginLinkText: {
    ...Typography.body,
    color: Colors.primary,
    fontWeight: '500',
  },

  // ── Success State ─────────────────────
  successContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xxl,
  },
  successIconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(39, 174, 96, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.xxl,
  },
  successIcon: {
    fontSize: 36,
    color: Colors.success,
  },
  successTitle: {
    ...Typography.title2,
    color: Colors.textPrimary,
    marginBottom: Spacing.md,
    textAlign: 'center',
  },
  successMessage: {
    ...Typography.body,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginBottom: Spacing.md,
    lineHeight: 22,
  },
  successEmail: {
    color: Colors.textPrimary,
    fontWeight: '600',
  },
  successHint: {
    ...Typography.footnote,
    color: Colors.textTertiary,
    textAlign: 'center',
    marginBottom: Spacing.xxxl,
    lineHeight: 18,
  },
  backToLoginButton: {
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.sm,
    paddingVertical: Spacing.lg,
    paddingHorizontal: Spacing.xxxl,
    alignItems: 'center',
    marginBottom: Spacing.lg,
    minWidth: 200,
    ...Shadows.md,
  },
  backToLoginText: {
    ...Typography.buttonLarge,
    color: Colors.white,
  },
  resendButton: {
    paddingVertical: Spacing.sm,
  },
  resendText: {
    ...Typography.footnote,
    color: Colors.primary,
    fontWeight: '500',
  },
});

export default ForgotPasswordScreen;
