/**
 * VISP - Login Screen
 *
 * Email + password login with forgot-password and registration links.
 * Dark glassmorphism design with animated entry.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
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

import { Colors, Spacing, Typography } from '../../theme';
import { GlassStyles } from '../../theme/glass';
import { useAuthStore } from '../../stores/authStore';
import { GlassBackground, GlassCard, GlassButton, GlassInput } from '../../components/glass';
import { AnimatedLogo, MorphingBlob } from '../../components/animations';
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

  const { login, isLoading, error, clearError } = useAuthStore();

  // ── Entry Animation ────────────────────────
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 600,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 600,
        useNativeDriver: true,
      }),
    ]).start();
  }, [fadeAnim, slideAnim]);

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
          <Animated.View
            style={[
              styles.animatedContent,
              {
                opacity: fadeAnim,
                transform: [{ translateY: slideAnim }],
              },
            ]}
          >
            {/* Logo / Brand */}
            <View style={styles.logoSection}>
              <MorphingBlob
                size={250}
                color="#7850FF"
                opacity={0.15}
                style={styles.morphingBlob}
              />
              <AnimatedLogo size={100} />
              <Text style={styles.brandName}>VISP</Text>
              <Text style={styles.tagline}>Home services, simplified</Text>
            </View>

            {/* Server Error */}
            {error ? (
              <View style={styles.errorBanner}>
                <Text style={styles.errorBannerText}>{error}</Text>
              </View>
            ) : null}

            {/* Login Form Card */}
            <GlassCard variant="dark" padding={24} style={styles.formCard}>
              {/* Email Field */}
              <GlassInput
                label="EMAIL"
                value={email}
                onChangeText={handleEmailChange}
                onBlur={() => handleBlur('email')}
                placeholder="you@example.com"
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                textContentType="emailAddress"
                returnKeyType="next"
                onSubmitEditing={() => passwordRef.current?.focus()}
                editable={!isLoading}
                error={touched.email ? formErrors.email : undefined}
                containerStyle={styles.fieldSpacing}
              />

              {/* Password Field */}
              <View style={styles.fieldSpacing}>
                <Text style={styles.inputLabel}>PASSWORD</Text>
                <View
                  style={[
                    GlassStyles.input,
                    styles.passwordRow,
                    touched.password && formErrors.password
                      ? GlassStyles.inputError
                      : undefined,
                  ]}
                >
                  <TextInput
                    ref={passwordRef}
                    style={styles.passwordTextInput}
                    value={password}
                    onChangeText={handlePasswordChange}
                    onBlur={() => handleBlur('password')}
                    placeholder="Enter your password"
                    placeholderTextColor="rgba(255, 255, 255, 0.35)"
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
                    onPress={() => setShowPassword((prev) => !prev)}
                    hitSlop={8}
                    style={styles.showPasswordButton}
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
            </GlassCard>

            {/* Sign In Button */}
            <GlassButton
              title="Sign In"
              variant="glow"
              onPress={handleLogin}
              disabled={!isFormValid || isLoading}
              loading={isLoading}
              style={styles.signInButton}
            />

            {/* Create Account */}
            <View style={styles.createAccountRow}>
              <Text style={styles.createAccountLabel}>
                {"Don't have an account? "}
              </Text>
              <TouchableOpacity onPress={handleCreateAccount} disabled={isLoading}>
                <Text style={styles.createAccountLink}>Create Account</Text>
              </TouchableOpacity>
            </View>
          </Animated.View>
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
    paddingTop: Spacing.giant,
    paddingBottom: Spacing.xxxl,
    justifyContent: 'center',
  },
  animatedContent: {
    flex: 0,
  },

  // ── Logo ───────────────────────────────
  logoSection: {
    alignItems: 'center',
    marginBottom: Spacing.huge,
  },
  morphingBlob: {
    position: 'absolute',
    top: -60,
    left: -60,
    zIndex: -1,
  },
  brandName: {
    fontSize: 32,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 2,
    marginBottom: Spacing.xs,
  },
  tagline: {
    ...Typography.body,
    color: 'rgba(255, 255, 255, 0.5)',
  },

  // ── Error Banner ───────────────────────
  errorBanner: {
    backgroundColor: 'rgba(231, 76, 60, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(231, 76, 60, 0.4)',
    borderRadius: 12,
    padding: Spacing.md,
    marginBottom: Spacing.lg,
  },
  errorBannerText: {
    ...Typography.footnote,
    color: '#E74C3C',
    textAlign: 'center',
  },

  // ── Form Card ──────────────────────────
  formCard: {
    marginBottom: Spacing.xxl,
  },
  fieldSpacing: {
    marginBottom: Spacing.lg,
  },
  inputLabel: {
    ...Typography.label,
    color: 'rgba(255, 255, 255, 0.55)',
    marginBottom: Spacing.xs,
  },

  // ── Password ───────────────────────────
  passwordRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  passwordTextInput: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 16,
    padding: 0,
  },
  showPasswordButton: {
    paddingLeft: Spacing.sm,
  },
  showPasswordText: {
    ...Typography.footnote,
    color: 'rgba(120, 80, 255, 0.9)',
    fontWeight: '600',
  },
  fieldError: {
    ...Typography.caption,
    color: '#E74C3C',
    marginTop: Spacing.xs,
  },

  // ── Forgot Password ───────────────────
  forgotPasswordButton: {
    alignSelf: 'flex-end',
    marginTop: Spacing.sm,
  },
  forgotPasswordText: {
    ...Typography.footnote,
    color: 'rgba(255, 255, 255, 0.5)',
    fontWeight: '500',
  },

  // ── Sign In Button ─────────────────────
  signInButton: {
    marginBottom: Spacing.xxl,
    minHeight: 52,
  },

  // ── Create Account ─────────────────────
  createAccountRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  createAccountLabel: {
    ...Typography.body,
    color: 'rgba(255, 255, 255, 0.5)',
  },
  createAccountLink: {
    ...Typography.body,
    color: 'rgba(120, 80, 255, 0.9)',
    fontWeight: '600',
  },
});

export default LoginScreen;
