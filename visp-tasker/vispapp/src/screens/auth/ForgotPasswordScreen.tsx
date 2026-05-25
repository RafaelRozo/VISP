/**
 * VISP - Forgot Password Screen (offline recovery code flow).
 *
 * Step 1: user enters email + recovery code + new password.
 * Step 2: on success, shows the freshly-rotated recovery code.
 */

import React, { useCallback, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { Colors, Spacing, Typography, BorderRadius } from '../../theme';
import {
  GlassBackground,
  GlassCard,
  GlassButton,
  GlassInput,
} from '../../components/glass';
import { AnimatedCheckmark } from '../../components/animations';
import { userService } from '../../services/userService';
import { useAuthStore } from '../../stores/authStore';
import type { RootStackParamList } from '../../types';

type Props = NativeStackScreenProps<RootStackParamList, 'ForgotPassword'>;

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function ForgotPasswordScreen({ navigation }: Props): React.JSX.Element {
  const login = useAuthStore((s) => s.login);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [newCode, setNewCode] = useState<string | null>(null);
  const [resetEmail, setResetEmail] = useState('');
  const [resetPassword, setResetPassword] = useState('');
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);

  const handleSubmit = useCallback(async () => {
    Keyboard.dismiss();
    setError(null);

    const trimmedEmail = email.trim().toLowerCase();
    const trimmedCode = code.trim().toUpperCase();

    if (!EMAIL_REGEX.test(trimmedEmail)) {
      setError('Enter a valid email address.');
      return;
    }
    if (trimmedCode.length < 8) {
      setError('Recovery code is too short.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }

    setIsLoading(true);
    try {
      const rotated = await userService.recoverPassword(
        trimmedEmail,
        trimmedCode,
        password,
      );
      setResetEmail(trimmedEmail);
      setResetPassword(password);
      setNewCode(rotated);
    } catch (err: any) {
      const msg =
        err?.response?.data?.detail ??
        err?.message ??
        'Could not reset your password.';
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  }, [email, code, password, confirm]);

  const handleContinue = useCallback(async () => {
    setSignInError(null);
    setIsSigningIn(true);
    try {
      await login({ email: resetEmail, password: resetPassword });
      // The root navigator switches stacks automatically when auth state
      // becomes authenticated; no manual navigate() needed.
    } catch (err: any) {
      const msg =
        err?.response?.data?.detail ??
        err?.message ??
        'Could not sign in with the new password.';
      setSignInError(msg);
      setIsSigningIn(false);
    }
  }, [login, resetEmail, resetPassword]);

  if (newCode) {
    return (
      <GlassBackground>
        <View style={styles.successContainer}>
          <GlassCard variant="dark" padding={32} style={styles.successCard}>
            <View style={styles.successIconContainer}>
              <AnimatedCheckmark size={64} />
            </View>
            <Text style={styles.successTitle}>Password updated</Text>
            <Text style={styles.successMessage}>
              Save your new recovery code below. The old one no longer works.
            </Text>

            <View style={styles.codeBox}>
              <Text selectable style={styles.codeText}>{newCode}</Text>
            </View>

            <Text style={styles.copyHint}>Long-press the code to copy.</Text>

            {signInError ? (
              <View style={styles.errorBanner}>
                <Text style={styles.errorBannerText}>{signInError}</Text>
              </View>
            ) : null}

            <GlassButton
              title="Continue"
              variant="glow"
              onPress={handleContinue}
              loading={isSigningIn}
              disabled={isSigningIn}
              style={styles.successBackButton}
            />
          </GlassCard>
        </View>
      </GlassBackground>
    );
  }

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
          <GlassButton
            title="Back"
            variant="outline"
            onPress={() => navigation.goBack()}
            disabled={isLoading}
            style={styles.backButton}
          />

          <Text style={styles.title}>Reset your password</Text>
          <Text style={styles.subtitle}>
            Enter your email, the 12-character recovery code you saved when you
            signed up, and a new password.
          </Text>

          <GlassCard variant="dark" padding={24} style={styles.formCard}>
            {error ? (
              <View style={styles.errorBanner}>
                <Text style={styles.errorBannerText}>{error}</Text>
              </View>
            ) : null}

            <GlassInput
              label="Email"
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              textContentType="emailAddress"
              returnKeyType="next"
              editable={!isLoading}
              autoFocus
              containerStyle={styles.inputContainer}
            />

            <GlassInput
              label="Recovery code"
              value={code}
              onChangeText={(t) => setCode(t.toUpperCase())}
              placeholder="ABCDEFGH2345"
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={20}
              editable={!isLoading}
              containerStyle={styles.inputContainer}
            />

            <GlassInput
              label="New password"
              value={password}
              onChangeText={setPassword}
              placeholder="At least 8 characters"
              secureTextEntry
              autoCapitalize="none"
              autoComplete="new-password"
              textContentType="newPassword"
              editable={!isLoading}
              containerStyle={styles.inputContainer}
            />

            <GlassInput
              label="Confirm new password"
              value={confirm}
              onChangeText={setConfirm}
              placeholder="Repeat your new password"
              secureTextEntry
              autoCapitalize="none"
              autoComplete="new-password"
              textContentType="newPassword"
              editable={!isLoading}
              containerStyle={styles.inputContainer}
            />

            <GlassButton
              title="Reset password"
              variant="glow"
              onPress={handleSubmit}
              disabled={isLoading}
              loading={isLoading}
              style={styles.submitButton}
            />
          </GlassCard>
        </ScrollView>
      </KeyboardAvoidingView>
    </GlassBackground>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: Spacing.xxl,
    paddingTop: Spacing.xxxl,
    paddingBottom: Spacing.xxxl,
  },
  backButton: {
    alignSelf: 'flex-start',
    marginBottom: Spacing.xxl,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    minHeight: 36,
  },
  title: { ...Typography.title2, color: '#FFFFFF', marginBottom: Spacing.sm },
  subtitle: {
    ...Typography.body,
    color: 'rgba(255, 255, 255, 0.6)',
    marginBottom: Spacing.xxl,
    lineHeight: 22,
  },
  formCard: { marginBottom: Spacing.lg },
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
  inputContainer: { marginBottom: Spacing.xxl },
  submitButton: { width: '100%' },

  successContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xxl,
  },
  successCard: { alignItems: 'center', width: '100%' },
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
    marginBottom: Spacing.lg,
    lineHeight: 22,
  },
  codeBox: {
    backgroundColor: 'rgba(120, 80, 255, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(120, 80, 255, 0.5)',
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    marginBottom: Spacing.md,
  },
  codeText: {
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
    fontSize: 24,
    color: '#FFFFFF',
    letterSpacing: 4,
    textAlign: 'center',
  },
  copyHint: {
    ...Typography.footnote,
    color: 'rgba(255, 255, 255, 0.4)',
    textAlign: 'center',
    marginBottom: Spacing.xxl,
  },
  successBackButton: { width: '100%' },
});

export default ForgotPasswordScreen;
