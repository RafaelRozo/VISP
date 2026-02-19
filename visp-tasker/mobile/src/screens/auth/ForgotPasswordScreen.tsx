/**
 * VISP - Forgot Password Screen
 *
 * Collects the user's email and requests a password reset link.
 * Shows a success state after the request is sent.
 *
 * Styled with dark glassmorphism design system.
 */

import React, { useCallback, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { Colors, Spacing, Typography, BorderRadius } from '../../theme';
import { GlassStyles } from '../../theme';
import { GlassBackground, GlassCard, GlassButton, GlassInput } from '../../components/glass';
import { AnimatedCheckmark } from '../../components/animations';
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
      <GlassBackground>
        <View style={styles.successContainer}>
          <GlassCard variant="dark" padding={32} style={styles.successCard}>
            <View style={styles.successIconContainer}>
              <AnimatedCheckmark size={64} />
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

            <GlassButton
              title="Back to Sign In"
              variant="glow"
              onPress={handleBackToLogin}
              style={styles.successBackButton}
            />

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
          </GlassCard>
        </View>
      </GlassBackground>
    );
  }

  // ── Form State ───────────────────────────

  return (
    <GlassBackground>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Back Button */}
          <GlassButton
            title="Back"
            variant="outline"
            onPress={() => navigation.goBack()}
            disabled={isLoading}
            style={styles.backButton}
          />

          {/* Header */}
          <Text style={styles.title}>Reset your password</Text>
          <Text style={styles.subtitle}>
            Enter the email address associated with your account, and we will send
            you a link to reset your password.
          </Text>

          {/* Form Card */}
          <GlassCard variant="dark" padding={24} style={styles.formCard}>
            {/* Server Error */}
            {error ? (
              <View style={styles.errorBanner}>
                <Text style={styles.errorBannerText}>{error}</Text>
              </View>
            ) : null}

            {/* Email Field */}
            <GlassInput
              label="Email"
              value={email}
              onChangeText={handleEmailChange}
              placeholder="you@example.com"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              textContentType="emailAddress"
              returnKeyType="send"
              onSubmitEditing={handleSubmit}
              editable={!isLoading}
              autoFocus
              error={emailError ?? undefined}
              containerStyle={styles.inputContainer}
            />

            {/* Submit Button */}
            <GlassButton
              title="Send Reset Link"
              variant="glow"
              onPress={handleSubmit}
              disabled={!isFormValid || isLoading}
              loading={isLoading}
              style={styles.submitButton}
            />
          </GlassCard>

          {/* Back to Login */}
          <GlassButton
            title="Back to Sign In"
            variant="outline"
            onPress={handleBackToLogin}
            disabled={isLoading}
            style={styles.loginLinkButton}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </GlassBackground>
  );
}

// ──────────────────────────────────────────────
// Styles
// ──────────────────────────────────────────────

const styles = StyleSheet.create({
  flex: {
    flex: 1,
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
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    minHeight: 36,
  },

  // ── Header ────────────────────────────
  title: {
    ...Typography.title2,
    color: '#FFFFFF',
    marginBottom: Spacing.sm,
  },
  subtitle: {
    ...Typography.body,
    color: 'rgba(255, 255, 255, 0.6)',
    marginBottom: Spacing.xxl,
    lineHeight: 22,
  },

  // ── Form Card ─────────────────────────
  formCard: {
    marginBottom: Spacing.lg,
  },

  // ── Error Banner ──────────────────────
  errorBanner: {
    backgroundColor: 'rgba(231, 76, 60, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(231, 76, 60, 0.4)',
    borderRadius: BorderRadius.sm,
    padding: Spacing.md,
    marginBottom: Spacing.lg,
  },
  errorBannerText: {
    ...Typography.footnote,
    color: Colors.error,
    textAlign: 'center',
  },

  // ── Input ─────────────────────────────
  inputContainer: {
    marginBottom: Spacing.xxl,
  },

  // ── Submit Button ─────────────────────
  submitButton: {
    width: '100%',
  },

  // ── Login Link ────────────────────────
  loginLinkButton: {
    alignSelf: 'center',
    marginTop: Spacing.sm,
  },

  // ── Success State ─────────────────────
  successContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xxl,
  },
  successCard: {
    alignItems: 'center',
    width: '100%',
  },
  successIconContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.xxl,
  },
  successTitle: {
    ...Typography.title2,
    color: '#FFFFFF',
    marginBottom: Spacing.md,
    textAlign: 'center',
  },
  successMessage: {
    ...Typography.body,
    color: 'rgba(255, 255, 255, 0.6)',
    textAlign: 'center',
    marginBottom: Spacing.md,
    lineHeight: 22,
  },
  successEmail: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  successHint: {
    ...Typography.footnote,
    color: 'rgba(255, 255, 255, 0.4)',
    textAlign: 'center',
    marginBottom: Spacing.xxl,
    lineHeight: 18,
  },
  successBackButton: {
    width: '100%',
    marginBottom: Spacing.lg,
  },
  resendButton: {
    paddingVertical: Spacing.sm,
  },
  resendText: {
    ...Typography.footnote,
    color: 'rgba(120, 80, 255, 0.9)',
    fontWeight: '500',
  },
});

export default ForgotPasswordScreen;
