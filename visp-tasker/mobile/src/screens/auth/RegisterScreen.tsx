/**
 * VISP/Tasker - Registration Screen
 *
 * Multi-step registration flow:
 *   Step 1: Email / Phone + Password
 *   Step 2: First Name / Last Name
 *   Step 3: Role Selection (Customer / Provider / Both) + Terms Acceptance
 *
 * Includes a progress indicator, inline validation, and password strength meter.
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Linking,
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
import { Config } from '../../services/config';
import type { RootStackParamList, UserRole } from '../../types';

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

type Props = NativeStackScreenProps<RootStackParamList, 'Register'>;

const TOTAL_STEPS = 3;

interface Step1Errors {
  email?: string;
  password?: string;
  confirmPassword?: string;
}

interface Step2Errors {
  firstName?: string;
  lastName?: string;
}

// ──────────────────────────────────────────────
// Validation Helpers
// ──────────────────────────────────────────────

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateStep1(
  email: string,
  password: string,
  confirmPassword: string,
): Step1Errors {
  const errors: Step1Errors = {};
  if (!email.trim()) {
    errors.email = 'Email is required';
  } else if (!EMAIL_REGEX.test(email.trim())) {
    errors.email = 'Enter a valid email address';
  }
  if (!password) {
    errors.password = 'Password is required';
  } else if (password.length < Config.minPasswordLength) {
    errors.password = `Password must be at least ${Config.minPasswordLength} characters`;
  }
  if (!confirmPassword) {
    errors.confirmPassword = 'Please confirm your password';
  } else if (password !== confirmPassword) {
    errors.confirmPassword = 'Passwords do not match';
  }
  return errors;
}

function validateStep2(firstName: string, lastName: string): Step2Errors {
  const errors: Step2Errors = {};
  if (!firstName.trim()) {
    errors.firstName = 'First name is required';
  } else if (firstName.trim().length < 2) {
    errors.firstName = 'First name must be at least 2 characters';
  }
  if (!lastName.trim()) {
    errors.lastName = 'Last name is required';
  } else if (lastName.trim().length < 2) {
    errors.lastName = 'Last name must be at least 2 characters';
  }
  return errors;
}

type PasswordStrength = 'weak' | 'fair' | 'good' | 'strong';

function getPasswordStrength(password: string): {
  strength: PasswordStrength;
  label: string;
  color: string;
  progress: number;
} {
  let score = 0;
  if (password.length >= 8) score += 1;
  if (password.length >= 12) score += 1;
  if (/[A-Z]/.test(password)) score += 1;
  if (/[a-z]/.test(password)) score += 1;
  if (/[0-9]/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;

  if (score <= 2) {
    return { strength: 'weak', label: 'Weak', color: Colors.error, progress: 0.25 };
  }
  if (score <= 3) {
    return { strength: 'fair', label: 'Fair', color: Colors.warning, progress: 0.5 };
  }
  if (score <= 4) {
    return { strength: 'good', label: 'Good', color: Colors.info, progress: 0.75 };
  }
  return { strength: 'strong', label: 'Strong', color: Colors.success, progress: 1.0 };
}

// ──────────────────────────────────────────────
// Role Option Data
// ──────────────────────────────────────────────

interface RoleOption {
  value: UserRole;
  title: string;
  description: string;
}

const ROLE_OPTIONS: RoleOption[] = [
  {
    value: 'customer',
    title: 'Customer',
    description: 'I need help with tasks around my home',
  },
  {
    value: 'provider',
    title: 'Service Provider',
    description: 'I want to earn money providing services',
  },
  {
    value: 'both',
    title: 'Both',
    description: 'I want to book and provide services',
  },
];

// ──────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────

function RegisterScreen({ navigation }: Props): React.JSX.Element {
  // ── Form State ───────────────────────────
  const [currentStep, setCurrentStep] = useState(1);

  // Step 1
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [step1Errors, setStep1Errors] = useState<Step1Errors>({});

  // Step 2
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [step2Errors, setStep2Errors] = useState<Step2Errors>({});

  // Step 3
  const [selectedRole, setSelectedRole] = useState<UserRole | null>(null);
  const [acceptedTerms, setAcceptedTerms] = useState(false);

  const passwordInputRef = useRef<TextInput>(null);
  const confirmPasswordRef = useRef<TextInput>(null);
  const lastNameRef = useRef<TextInput>(null);

  const { register, isLoading, error, clearError } = useAuthStore();

  // ── Password Strength ────────────────────
  const passwordStrengthInfo = useMemo(
    () => (password.length > 0 ? getPasswordStrength(password) : null),
    [password],
  );

  // ── Step Navigation ──────────────────────

  const handleNext = useCallback(() => {
    Keyboard.dismiss();
    if (error) clearError();

    if (currentStep === 1) {
      const errors = validateStep1(email, password, confirmPassword);
      setStep1Errors(errors);
      if (Object.keys(errors).length > 0) return;
      setCurrentStep(2);
    } else if (currentStep === 2) {
      const errors = validateStep2(firstName, lastName);
      setStep2Errors(errors);
      if (Object.keys(errors).length > 0) return;
      setCurrentStep(3);
    }
  }, [currentStep, email, password, confirmPassword, firstName, lastName, error, clearError]);

  const handleBack = useCallback(() => {
    if (error) clearError();
    if (currentStep > 1) {
      setCurrentStep((prev) => prev - 1);
    } else {
      navigation.goBack();
    }
  }, [currentStep, navigation, error, clearError]);

  // ── Submit ───────────────────────────────

  const handleRegister = useCallback(async () => {
    if (!selectedRole || !acceptedTerms) return;
    Keyboard.dismiss();

    try {
      await register({
        email: email.trim().toLowerCase(),
        password,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        role: selectedRole,
        acceptedTermsVersion: Config.termsVersion,
      });
      // On success, the auth store sets isAuthenticated = true,
      // and the navigator will redirect to the appropriate home screen.
    } catch {
      // Error is displayed by the store
    }
  }, [email, password, firstName, lastName, selectedRole, acceptedTerms, register]);

  // ── Legal Links ──────────────────────────

  const handleOpenTerms = useCallback(() => {
    Linking.openURL('https://taskerapp.com/legal/terms');
  }, []);

  const handleOpenPrivacy = useCallback(() => {
    Linking.openURL('https://taskerapp.com/legal/privacy');
  }, []);

  // ── Step Validity ────────────────────────

  const isStep1Valid =
    EMAIL_REGEX.test(email.trim()) &&
    password.length >= Config.minPasswordLength &&
    password === confirmPassword;

  const isStep2Valid = firstName.trim().length >= 2 && lastName.trim().length >= 2;

  const isStep3Valid = selectedRole !== null && acceptedTerms;

  // ── Render Helpers ───────────────────────

  function renderProgressBar(): React.JSX.Element {
    return (
      <View style={styles.progressContainer}>
        <View style={styles.progressBar}>
          {Array.from({ length: TOTAL_STEPS }, (_, i) => (
            <View
              key={i}
              style={[
                styles.progressSegment,
                i < currentStep
                  ? styles.progressSegmentActive
                  : styles.progressSegmentInactive,
                i === 0 && styles.progressSegmentFirst,
                i === TOTAL_STEPS - 1 && styles.progressSegmentLast,
              ]}
            />
          ))}
        </View>
        <Text style={styles.progressLabel}>
          Step {currentStep} of {TOTAL_STEPS}
        </Text>
      </View>
    );
  }

  function renderStep1(): React.JSX.Element {
    return (
      <View>
        <Text style={styles.stepTitle}>Create your account</Text>
        <Text style={styles.stepSubtitle}>
          Enter your email and create a secure password
        </Text>

        {/* Email */}
        <View style={styles.fieldContainer}>
          <Text style={styles.label}>Email</Text>
          <TextInput
            style={[styles.input, step1Errors.email ? styles.inputError : null]}
            value={email}
            onChangeText={(text) => {
              setEmail(text);
              if (step1Errors.email) {
                setStep1Errors((prev) => ({ ...prev, email: undefined }));
              }
            }}
            placeholder="you@example.com"
            placeholderTextColor={Colors.inputPlaceholder}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            textContentType="emailAddress"
            returnKeyType="next"
            onSubmitEditing={() => passwordInputRef.current?.focus()}
            editable={!isLoading}
          />
          {step1Errors.email ? (
            <Text style={styles.fieldError}>{step1Errors.email}</Text>
          ) : null}
        </View>

        {/* Password */}
        <View style={styles.fieldContainer}>
          <Text style={styles.label}>Password</Text>
          <View style={styles.passwordContainer}>
            <TextInput
              ref={passwordInputRef}
              style={[
                styles.input,
                styles.passwordInput,
                step1Errors.password ? styles.inputError : null,
              ]}
              value={password}
              onChangeText={(text) => {
                setPassword(text);
                if (step1Errors.password) {
                  setStep1Errors((prev) => ({ ...prev, password: undefined }));
                }
              }}
              placeholder="Minimum 8 characters"
              placeholderTextColor={Colors.inputPlaceholder}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              autoCorrect={false}
              textContentType="newPassword"
              returnKeyType="next"
              onSubmitEditing={() => confirmPasswordRef.current?.focus()}
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
          {step1Errors.password ? (
            <Text style={styles.fieldError}>{step1Errors.password}</Text>
          ) : null}

          {/* Password Strength Indicator */}
          {passwordStrengthInfo ? (
            <View style={styles.strengthContainer}>
              <View style={styles.strengthBarTrack}>
                <View
                  style={[
                    styles.strengthBarFill,
                    {
                      width: `${passwordStrengthInfo.progress * 100}%`,
                      backgroundColor: passwordStrengthInfo.color,
                    },
                  ]}
                />
              </View>
              <Text
                style={[
                  styles.strengthLabel,
                  { color: passwordStrengthInfo.color },
                ]}
              >
                {passwordStrengthInfo.label}
              </Text>
            </View>
          ) : null}
        </View>

        {/* Confirm Password */}
        <View style={styles.fieldContainer}>
          <Text style={styles.label}>Confirm Password</Text>
          <TextInput
            ref={confirmPasswordRef}
            style={[
              styles.input,
              step1Errors.confirmPassword ? styles.inputError : null,
            ]}
            value={confirmPassword}
            onChangeText={(text) => {
              setConfirmPassword(text);
              if (step1Errors.confirmPassword) {
                setStep1Errors((prev) => ({
                  ...prev,
                  confirmPassword: undefined,
                }));
              }
            }}
            placeholder="Re-enter your password"
            placeholderTextColor={Colors.inputPlaceholder}
            secureTextEntry={!showPassword}
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="newPassword"
            returnKeyType="done"
            onSubmitEditing={handleNext}
            editable={!isLoading}
          />
          {step1Errors.confirmPassword ? (
            <Text style={styles.fieldError}>
              {step1Errors.confirmPassword}
            </Text>
          ) : null}
        </View>
      </View>
    );
  }

  function renderStep2(): React.JSX.Element {
    return (
      <View>
        <Text style={styles.stepTitle}>What is your name?</Text>
        <Text style={styles.stepSubtitle}>
          This will be visible to other users on the platform
        </Text>

        {/* First Name */}
        <View style={styles.fieldContainer}>
          <Text style={styles.label}>First Name</Text>
          <TextInput
            style={[
              styles.input,
              step2Errors.firstName ? styles.inputError : null,
            ]}
            value={firstName}
            onChangeText={(text) => {
              setFirstName(text);
              if (step2Errors.firstName) {
                setStep2Errors((prev) => ({ ...prev, firstName: undefined }));
              }
            }}
            placeholder="Jane"
            placeholderTextColor={Colors.inputPlaceholder}
            autoCapitalize="words"
            autoCorrect={false}
            autoComplete="given-name"
            textContentType="givenName"
            returnKeyType="next"
            onSubmitEditing={() => lastNameRef.current?.focus()}
            editable={!isLoading}
          />
          {step2Errors.firstName ? (
            <Text style={styles.fieldError}>{step2Errors.firstName}</Text>
          ) : null}
        </View>

        {/* Last Name */}
        <View style={styles.fieldContainer}>
          <Text style={styles.label}>Last Name</Text>
          <TextInput
            ref={lastNameRef}
            style={[
              styles.input,
              step2Errors.lastName ? styles.inputError : null,
            ]}
            value={lastName}
            onChangeText={(text) => {
              setLastName(text);
              if (step2Errors.lastName) {
                setStep2Errors((prev) => ({ ...prev, lastName: undefined }));
              }
            }}
            placeholder="Smith"
            placeholderTextColor={Colors.inputPlaceholder}
            autoCapitalize="words"
            autoCorrect={false}
            autoComplete="family-name"
            textContentType="familyName"
            returnKeyType="done"
            onSubmitEditing={handleNext}
            editable={!isLoading}
          />
          {step2Errors.lastName ? (
            <Text style={styles.fieldError}>{step2Errors.lastName}</Text>
          ) : null}
        </View>
      </View>
    );
  }

  function renderStep3(): React.JSX.Element {
    return (
      <View>
        <Text style={styles.stepTitle}>How will you use Tasker?</Text>
        <Text style={styles.stepSubtitle}>
          You can change this later in your profile settings
        </Text>

        {/* Role Selection */}
        <View style={styles.roleContainer}>
          {ROLE_OPTIONS.map((option) => {
            const isSelected = selectedRole === option.value;
            return (
              <TouchableOpacity
                key={option.value}
                style={[
                  styles.roleCard,
                  isSelected && styles.roleCardSelected,
                ]}
                onPress={() => setSelectedRole(option.value)}
                activeOpacity={0.7}
                disabled={isLoading}
              >
                <View style={styles.roleCardContent}>
                  <View style={styles.roleCardHeader}>
                    <Text
                      style={[
                        styles.roleCardTitle,
                        isSelected && styles.roleCardTitleSelected,
                      ]}
                    >
                      {option.title}
                    </Text>
                    <View
                      style={[
                        styles.radioOuter,
                        isSelected && styles.radioOuterSelected,
                      ]}
                    >
                      {isSelected ? (
                        <View style={styles.radioInner} />
                      ) : null}
                    </View>
                  </View>
                  <Text style={styles.roleCardDescription}>
                    {option.description}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Terms Checkbox */}
        <TouchableOpacity
          style={styles.termsRow}
          onPress={() => setAcceptedTerms((prev) => !prev)}
          activeOpacity={0.7}
          disabled={isLoading}
        >
          <View
            style={[
              styles.checkbox,
              acceptedTerms && styles.checkboxChecked,
            ]}
          >
            {acceptedTerms ? (
              <Text style={styles.checkmark}>{'  '}</Text>
            ) : null}
          </View>
          <Text style={styles.termsText}>
            {'I agree to the '}
            <Text style={styles.termsLink} onPress={handleOpenTerms}>
              Terms of Service
            </Text>
            {' and '}
            <Text style={styles.termsLink} onPress={handleOpenPrivacy}>
              Privacy Policy
            </Text>
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Main Render ──────────────────────────

  const canProceed =
    (currentStep === 1 && isStep1Valid) ||
    (currentStep === 2 && isStep2Valid) ||
    (currentStep === 3 && isStep3Valid);

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
          onPress={handleBack}
          hitSlop={12}
          disabled={isLoading}
        >
          <Text style={styles.backButtonText}>Back</Text>
        </TouchableOpacity>

        {/* Progress Bar */}
        {renderProgressBar()}

        {/* Server Error */}
        {error ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorBannerText}>{error}</Text>
          </View>
        ) : null}

        {/* Step Content */}
        {currentStep === 1 && renderStep1()}
        {currentStep === 2 && renderStep2()}
        {currentStep === 3 && renderStep3()}

        {/* Spacer */}
        <View style={styles.spacer} />

        {/* Action Button */}
        <TouchableOpacity
          style={[
            styles.actionButton,
            (!canProceed || isLoading) && styles.actionButtonDisabled,
          ]}
          onPress={currentStep === TOTAL_STEPS ? handleRegister : handleNext}
          disabled={!canProceed || isLoading}
          activeOpacity={0.8}
        >
          {isLoading ? (
            <ActivityIndicator color={Colors.white} size="small" />
          ) : (
            <Text style={styles.actionButtonText}>
              {currentStep === TOTAL_STEPS ? 'Create Account' : 'Continue'}
            </Text>
          )}
        </TouchableOpacity>

        {/* Login Link */}
        <View style={styles.loginRow}>
          <Text style={styles.loginLabel}>Already have an account? </Text>
          <TouchableOpacity
            onPress={() => navigation.navigate('Login')}
            disabled={isLoading}
          >
            <Text style={styles.loginLink}>Sign In</Text>
          </TouchableOpacity>
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
    paddingTop: Spacing.xxxl,
    paddingBottom: Spacing.xxxl,
  },

  // ── Back ───────────────────────────────
  backButton: {
    alignSelf: 'flex-start',
    marginBottom: Spacing.lg,
  },
  backButtonText: {
    ...Typography.body,
    color: Colors.primary,
    fontWeight: '500',
  },

  // ── Progress ──────────────────────────
  progressContainer: {
    marginBottom: Spacing.xxl,
  },
  progressBar: {
    flexDirection: 'row',
    gap: Spacing.xs,
    marginBottom: Spacing.sm,
  },
  progressSegment: {
    flex: 1,
    height: 4,
    borderRadius: 2,
  },
  progressSegmentActive: {
    backgroundColor: Colors.primary,
  },
  progressSegmentInactive: {
    backgroundColor: Colors.surfaceLight,
  },
  progressSegmentFirst: {
    borderTopLeftRadius: 2,
    borderBottomLeftRadius: 2,
  },
  progressSegmentLast: {
    borderTopRightRadius: 2,
    borderBottomRightRadius: 2,
  },
  progressLabel: {
    ...Typography.caption,
    color: Colors.textTertiary,
  },

  // ── Step Header ───────────────────────
  stepTitle: {
    ...Typography.title2,
    color: Colors.textPrimary,
    marginBottom: Spacing.sm,
  },
  stepSubtitle: {
    ...Typography.body,
    color: Colors.textSecondary,
    marginBottom: Spacing.xxl,
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

  // ── Password Strength ─────────────────
  strengthContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: Spacing.sm,
    gap: Spacing.sm,
  },
  strengthBarTrack: {
    flex: 1,
    height: 4,
    backgroundColor: Colors.surfaceLight,
    borderRadius: 2,
    overflow: 'hidden',
  },
  strengthBarFill: {
    height: '100%',
    borderRadius: 2,
  },
  strengthLabel: {
    ...Typography.caption,
    fontWeight: '600',
    minWidth: 48,
  },

  // ── Role Selection ────────────────────
  roleContainer: {
    gap: Spacing.md,
    marginBottom: Spacing.xxl,
  },
  roleCard: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.md,
    padding: Spacing.lg,
  },
  roleCardSelected: {
    borderColor: Colors.primary,
    backgroundColor: 'rgba(74, 144, 226, 0.08)',
  },
  roleCardContent: {
    gap: Spacing.sm,
  },
  roleCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  roleCardTitle: {
    ...Typography.headline,
    color: Colors.textPrimary,
  },
  roleCardTitleSelected: {
    color: Colors.primary,
  },
  roleCardDescription: {
    ...Typography.footnote,
    color: Colors.textSecondary,
  },
  radioOuter: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOuterSelected: {
    borderColor: Colors.primary,
  },
  radioInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: Colors.primary,
  },

  // ── Terms ─────────────────────────────
  termsRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.md,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: BorderRadius.xs,
    borderWidth: 2,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  checkboxChecked: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  checkmark: {
    color: Colors.white,
    fontSize: 14,
    fontWeight: '700',
  },
  termsText: {
    ...Typography.footnote,
    color: Colors.textSecondary,
    flex: 1,
    lineHeight: 20,
  },
  termsLink: {
    color: Colors.primary,
    fontWeight: '500',
  },

  // ── Spacer ────────────────────────────
  spacer: {
    flex: 1,
    minHeight: Spacing.xxl,
  },

  // ── Action Button ─────────────────────
  actionButton: {
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.sm,
    paddingVertical: Spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 50,
    marginBottom: Spacing.lg,
    ...Shadows.md,
  },
  actionButtonDisabled: {
    backgroundColor: Colors.surfaceLight,
    ...Shadows.none,
  },
  actionButtonText: {
    ...Typography.buttonLarge,
    color: Colors.white,
  },

  // ── Login Link ────────────────────────
  loginRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loginLabel: {
    ...Typography.body,
    color: Colors.textSecondary,
  },
  loginLink: {
    ...Typography.body,
    color: Colors.primary,
    fontWeight: '600',
  },
});

export default RegisterScreen;
