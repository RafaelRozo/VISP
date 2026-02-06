/**
 * VISP/Tasker - Login Screen
 *
 * Email + password login with social sign-in (Apple, Google),
 * phone login option, forgot-password and registration links.
 */

import React, { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
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

type Props = NativeStackScreenProps<RootStackParamList, 'Login'>;

interface FormErrors {
  email?: string;
  password?: string;
}

// ──────────────────────────────────────────────
// Validation
// ──────────────────────────────────────────────

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateForm(email: string, password: string): FormErrors {
  const errors: FormErrors = {};
  if (!email.trim()) {
    errors.email = 'Email is required';
  } else if (!EMAIL_REGEX.test(email.trim())) {
    errors.email = 'Enter a valid email address';
  }
  if (!password) {
    errors.password = 'Password is required';
  } else if (password.length < 8) {
    errors.password = 'Password must be at least 8 characters';
  }
  return errors;
}

// ──────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────

function LoginScreen({ navigation }: Props): React.JSX.Element {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [formErrors, setFormErrors] = useState<FormErrors>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const passwordRef = useRef<TextInput>(null);

  const { login, loginWithApple, loginWithGoogle, demoLogin, isLoading, error, clearError } =
    useAuthStore();

  // ── Handlers ─────────────────────────────

  const handleEmailChange = useCallback(
    (text: string) => {
      setEmail(text);
      if (error) clearError();
      if (touched.email) {
        const errors = validateForm(text, password);
        setFormErrors((prev) => ({ ...prev, email: errors.email }));
      }
    },
    [password, touched.email, error, clearError],
  );

  const handlePasswordChange = useCallback(
    (text: string) => {
      setPassword(text);
      if (error) clearError();
      if (touched.password) {
        const errors = validateForm(email, text);
        setFormErrors((prev) => ({ ...prev, password: errors.password }));
      }
    },
    [email, touched.password, error, clearError],
  );

  const handleBlur = useCallback(
    (field: 'email' | 'password') => {
      setTouched((prev) => ({ ...prev, [field]: true }));
      const errors = validateForm(email, password);
      setFormErrors((prev) => ({ ...prev, [field]: errors[field] }));
    },
    [email, password],
  );

  const handleLogin = useCallback(async () => {
    Keyboard.dismiss();
    const errors = validateForm(email, password);
    setFormErrors(errors);
    setTouched({ email: true, password: true });

    if (Object.keys(errors).length > 0) return;

    try {
      await login({ email: email.trim().toLowerCase(), password });
    } catch {
      // Error is handled by the store
    }
  }, [email, password, login]);

  const handleAppleLogin = useCallback(async () => {
    try {
      // In production, this would call appleAuth.performRequest() first
      // to get the identity token from Apple's native SDK.
      // For now, we show a placeholder alert.
      Alert.alert(
        'Apple Sign In',
        'Apple Sign In will be configured with your Apple Developer account.',
      );
    } catch {
      // Error handled by store
    }
  }, []);

  const handleGoogleLogin = useCallback(async () => {
    try {
      // In production, this would call GoogleSignin.signIn() first
      // to get the server auth code from Google's SDK.
      Alert.alert(
        'Google Sign In',
        'Google Sign In will be configured with your Google Cloud project.',
      );
    } catch {
      // Error handled by store
    }
  }, []);

  const handlePhoneLogin = useCallback(() => {
    // Navigate to phone login flow (to be implemented)
    Alert.alert(
      'Phone Login',
      'Phone number login will be available once OTP service is configured.',
    );
  }, []);

  const handleForgotPassword = useCallback(() => {
    navigation.navigate('ForgotPassword');
  }, [navigation]);

  const handleCreateAccount = useCallback(() => {
    navigation.navigate('Register');
  }, [navigation]);

  // ── Derived State ────────────────────────

  const isFormValid =
    email.trim().length > 0 &&
    password.length >= 8 &&
    Object.keys(validateForm(email, password)).length === 0;

  // ── Render ───────────────────────────────

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
        {/* Logo / Brand */}
        <View style={styles.logoSection}>
          <View style={styles.logoPlaceholder}>
            <Text style={styles.logoText}>T</Text>
          </View>
          <Text style={styles.brandName}>Tasker</Text>
          <Text style={styles.tagline}>Home services, simplified</Text>
        </View>

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
            style={[
              styles.input,
              touched.email && formErrors.email ? styles.inputError : null,
            ]}
            value={email}
            onChangeText={handleEmailChange}
            onBlur={() => handleBlur('email')}
            placeholder="you@example.com"
            placeholderTextColor={Colors.inputPlaceholder}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            textContentType="emailAddress"
            returnKeyType="next"
            onSubmitEditing={() => passwordRef.current?.focus()}
            editable={!isLoading}
          />
          {touched.email && formErrors.email ? (
            <Text style={styles.fieldError}>{formErrors.email}</Text>
          ) : null}
        </View>

        {/* Password Field */}
        <View style={styles.fieldContainer}>
          <Text style={styles.label}>Password</Text>
          <View style={styles.passwordContainer}>
            <TextInput
              ref={passwordRef}
              style={[
                styles.input,
                styles.passwordInput,
                touched.password && formErrors.password
                  ? styles.inputError
                  : null,
              ]}
              value={password}
              onChangeText={handlePasswordChange}
              onBlur={() => handleBlur('password')}
              placeholder="Enter your password"
              placeholderTextColor={Colors.inputPlaceholder}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="password"
              textContentType="password"
              returnKeyType="go"
              onSubmitEditing={handleLogin}
              editable={!isLoading}
            />
            <Pressable
              style={styles.showPasswordButton}
              onPress={() => setShowPassword((prev) => !prev)}
              hitSlop={8}
            >
              <Text style={styles.showPasswordText}>
                {showPassword ? 'Hide' : 'Show'}
              </Text>
            </Pressable>
          </View>
          {touched.password && formErrors.password ? (
            <Text style={styles.fieldError}>{formErrors.password}</Text>
          ) : null}
        </View>

        {/* Forgot Password */}
        <TouchableOpacity
          style={styles.forgotPasswordButton}
          onPress={handleForgotPassword}
          disabled={isLoading}
        >
          <Text style={styles.forgotPasswordText}>Forgot Password?</Text>
        </TouchableOpacity>

        {/* Login Button */}
        <TouchableOpacity
          style={[
            styles.loginButton,
            (!isFormValid || isLoading) && styles.loginButtonDisabled,
          ]}
          onPress={handleLogin}
          disabled={!isFormValid || isLoading}
          activeOpacity={0.8}
        >
          {isLoading ? (
            <ActivityIndicator color={Colors.white} size="small" />
          ) : (
            <Text style={styles.loginButtonText}>Sign In</Text>
          )}
        </TouchableOpacity>

        {/* Divider */}
        <View style={styles.divider}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>or continue with</Text>
          <View style={styles.dividerLine} />
        </View>

        {/* Social Login Buttons */}
        <View style={styles.socialRow}>
          <TouchableOpacity
            style={styles.socialButton}
            onPress={handleAppleLogin}
            disabled={isLoading}
            activeOpacity={0.8}
          >
            <Text style={styles.socialIcon}>  </Text>
            <Text style={styles.socialButtonText}>Apple</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.socialButton}
            onPress={handleGoogleLogin}
            disabled={isLoading}
            activeOpacity={0.8}
          >
            <Text style={styles.socialIcon}>G</Text>
            <Text style={styles.socialButtonText}>Google</Text>
          </TouchableOpacity>
        </View>

        {/* Phone Login */}
        <TouchableOpacity
          style={styles.phoneLoginButton}
          onPress={handlePhoneLogin}
          disabled={isLoading}
          activeOpacity={0.8}
        >
          <Text style={styles.phoneLoginText}>Sign in with Phone Number</Text>
        </TouchableOpacity>

        {/* Create Account */}
        <View style={styles.createAccountRow}>
          <Text style={styles.createAccountLabel}>
            {"Don't have an account? "}
          </Text>
          <TouchableOpacity onPress={handleCreateAccount} disabled={isLoading}>
            <Text style={styles.createAccountLink}>Create Account</Text>
          </TouchableOpacity>
        </View>

        {/* Demo Login (MVP Testing) */}
        <View style={styles.demoSection}>
          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>demo access</Text>
            <View style={styles.dividerLine} />
          </View>
          <View style={styles.demoRow}>
            <TouchableOpacity
              style={[styles.demoButton, styles.demoCustomer]}
              onPress={() => demoLogin('customer')}
              activeOpacity={0.8}
            >
              <Text style={styles.demoButtonText}>Customer Demo</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.demoButton, styles.demoProvider]}
              onPress={() => demoLogin('provider')}
              activeOpacity={0.8}
            >
              <Text style={styles.demoButtonText}>Provider Demo</Text>
            </TouchableOpacity>
          </View>
        </View>
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
    paddingTop: Spacing.giant,
    paddingBottom: Spacing.xxxl,
  },

  // ── Logo ───────────────────────────────
  logoSection: {
    alignItems: 'center',
    marginBottom: Spacing.xxxl,
  },
  logoPlaceholder: {
    width: 72,
    height: 72,
    borderRadius: BorderRadius.lg,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.md,
    ...Shadows.lg,
  },
  logoText: {
    ...Typography.largeTitle,
    color: Colors.white,
  },
  brandName: {
    ...Typography.title1,
    color: Colors.textPrimary,
    marginBottom: Spacing.xs,
  },
  tagline: {
    ...Typography.body,
    color: Colors.textSecondary,
  },

  // ── Error Banner ───────────────────────
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

  // ── Fields ─────────────────────────────
  fieldContainer: {
    marginBottom: Spacing.lg,
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
  passwordContainer: {
    position: 'relative',
  },
  passwordInput: {
    paddingRight: 64,
  },
  showPasswordButton: {
    position: 'absolute',
    right: Spacing.lg,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
  },
  showPasswordText: {
    ...Typography.footnote,
    color: Colors.primary,
    fontWeight: '600',
  },

  // ── Forgot Password ───────────────────
  forgotPasswordButton: {
    alignSelf: 'flex-end',
    marginBottom: Spacing.xxl,
  },
  forgotPasswordText: {
    ...Typography.footnote,
    color: Colors.primary,
    fontWeight: '500',
  },

  // ── Login Button ──────────────────────
  loginButton: {
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.sm,
    paddingVertical: Spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 50,
    ...Shadows.md,
  },
  loginButtonDisabled: {
    backgroundColor: Colors.surfaceLight,
    ...Shadows.none,
  },
  loginButtonText: {
    ...Typography.buttonLarge,
    color: Colors.white,
  },

  // ── Divider ───────────────────────────
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: Spacing.xxl,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: Colors.divider,
  },
  dividerText: {
    ...Typography.caption,
    color: Colors.textTertiary,
    marginHorizontal: Spacing.md,
  },

  // ── Social Buttons ────────────────────
  socialRow: {
    flexDirection: 'row',
    gap: Spacing.md,
    marginBottom: Spacing.lg,
  },
  socialButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.sm,
    paddingVertical: Spacing.md,
    gap: Spacing.sm,
  },
  socialIcon: {
    fontSize: 18,
    color: Colors.textPrimary,
  },
  socialButtonText: {
    ...Typography.buttonSmall,
    color: Colors.textPrimary,
  },

  // ── Phone Login ───────────────────────
  phoneLoginButton: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.sm,
    paddingVertical: Spacing.md,
    alignItems: 'center',
    marginBottom: Spacing.xxl,
  },
  phoneLoginText: {
    ...Typography.buttonSmall,
    color: Colors.textSecondary,
  },

  // ── Create Account ────────────────────
  createAccountRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  createAccountLabel: {
    ...Typography.body,
    color: Colors.textSecondary,
  },
  createAccountLink: {
    ...Typography.body,
    color: Colors.primary,
    fontWeight: '600',
  },

  // ── Demo Section ───────────────────────
  demoSection: {
    marginTop: Spacing.xl,
  },
  demoRow: {
    flexDirection: 'row',
    gap: Spacing.md,
  },
  demoButton: {
    flex: 1,
    borderRadius: BorderRadius.sm,
    paddingVertical: Spacing.md,
    alignItems: 'center',
  },
  demoCustomer: {
    backgroundColor: '#27AE60',
  },
  demoProvider: {
    backgroundColor: '#9B59B6',
  },
  demoButtonText: {
    ...Typography.buttonSmall,
    color: Colors.white,
    fontWeight: '700',
  },
});

export default LoginScreen;
