/**
 * VISP - Registration Screen
 *
 * Multi-step registration flow:
 *   Step 1: Email / Phone + Password
 *   Step 2: First Name / Last Name
 *   Step 3: Role Selection (Customer / Provider / Both) + Terms Acceptance
 *
 * Includes a progress indicator, inline validation, and password strength meter.
 * Dark glassmorphism design with animated transitions.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  Modal,
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
import { Config } from '../../services/config';
import { GlassBackground, GlassCard, GlassButton, GlassInput } from '../../components/glass';
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
  phone?: string;
}

interface CountryCode {
  code: string;
  dial: string;
  flag: string;
  name: string;
  maxDigits: number;
}

const COUNTRY_CODES: CountryCode[] = [
  { code: 'CA', dial: '+1', flag: '\u{1F1E8}\u{1F1E6}', name: 'Canada', maxDigits: 10 },
  { code: 'US', dial: '+1', flag: '\u{1F1FA}\u{1F1F8}', name: 'United States', maxDigits: 10 },
  { code: 'MX', dial: '+52', flag: '\u{1F1F2}\u{1F1FD}', name: 'Mexico', maxDigits: 10 },
  { code: 'CO', dial: '+57', flag: '\u{1F1E8}\u{1F1F4}', name: 'Colombia', maxDigits: 10 },
  { code: 'AR', dial: '+54', flag: '\u{1F1E6}\u{1F1F7}', name: 'Argentina', maxDigits: 10 },
  { code: 'CL', dial: '+56', flag: '\u{1F1E8}\u{1F1F1}', name: 'Chile', maxDigits: 9 },
  { code: 'PE', dial: '+51', flag: '\u{1F1F5}\u{1F1EA}', name: 'Peru', maxDigits: 9 },
  { code: 'EC', dial: '+593', flag: '\u{1F1EA}\u{1F1E8}', name: 'Ecuador', maxDigits: 9 },
  { code: 'VE', dial: '+58', flag: '\u{1F1FB}\u{1F1EA}', name: 'Venezuela', maxDigits: 10 },
  { code: 'GT', dial: '+502', flag: '\u{1F1EC}\u{1F1F9}', name: 'Guatemala', maxDigits: 8 },
  { code: 'CR', dial: '+506', flag: '\u{1F1E8}\u{1F1F7}', name: 'Costa Rica', maxDigits: 8 },
  { code: 'PA', dial: '+507', flag: '\u{1F1F5}\u{1F1E6}', name: 'Panama', maxDigits: 8 },
  { code: 'DO', dial: '+1', flag: '\u{1F1E9}\u{1F1F4}', name: 'Rep. Dominicana', maxDigits: 10 },
  { code: 'ES', dial: '+34', flag: '\u{1F1EA}\u{1F1F8}', name: 'Spain', maxDigits: 9 },
  { code: 'BR', dial: '+55', flag: '\u{1F1E7}\u{1F1F7}', name: 'Brasil', maxDigits: 11 },
];

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

function validateStep2(firstName: string, lastName: string, phone: string, country: CountryCode): Step2Errors {
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
  const digits = phone.replace(/\D/g, '');
  if (!phone.trim()) {
    errors.phone = 'Phone number is required';
  } else if (digits.length !== country.maxDigits) {
    errors.phone = `Enter ${country.maxDigits} digits for ${country.name} (${country.dial})`;
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
    return { strength: 'weak', label: 'Weak', color: '#E74C3C', progress: 0.25 };
  }
  if (score <= 3) {
    return { strength: 'fair', label: 'Fair', color: '#F39C12', progress: 0.5 };
  }
  if (score <= 4) {
    return { strength: 'good', label: 'Good', color: '#3498DB', progress: 0.75 };
  }
  return { strength: 'strong', label: 'Strong', color: '#27AE60', progress: 1.0 };
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
  const [phone, setPhone] = useState('');
  const [selectedCountry, setSelectedCountry] = useState<CountryCode>(COUNTRY_CODES[0]);
  const [showCountryPicker, setShowCountryPicker] = useState(false);
  const [step2Errors, setStep2Errors] = useState<Step2Errors>({});

  // Step 3
  const [selectedRole, setSelectedRole] = useState<UserRole | null>(null);
  const [acceptedTerms, setAcceptedTerms] = useState(false);

  const passwordInputRef = useRef<TextInput>(null);
  const confirmPasswordRef = useRef<TextInput>(null);
  const lastNameRef = useRef<TextInput>(null);
  const phoneRef = useRef<TextInput>(null);

  const { register, isLoading, error, clearError } = useAuthStore();

  // ── Entry Animation ────────────────────────
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 500,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 500,
        useNativeDriver: true,
      }),
    ]).start();
  }, [fadeAnim, slideAnim]);

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
      const errors = validateStep2(firstName, lastName, phone, selectedCountry);
      setStep2Errors(errors);
      if (Object.keys(errors).length > 0) return;
      setCurrentStep(3);
    }
  }, [currentStep, email, password, confirmPassword, firstName, lastName, phone, selectedCountry, error, clearError]);

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
        phone: `${selectedCountry.dial}${phone.replace(/\D/g, '')}`,
        password,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        role: selectedRole,
        acceptedTermsVersion: Config.termsVersion,
      });
      if (selectedRole === 'provider' || selectedRole === 'both') {
        navigation.reset({
          index: 0,
          routes: [{ name: 'Auth', params: { screen: 'ProviderOnboarding' } }],
        });
      }
      // On success, the auth store sets isAuthenticated = true,
      // and the navigator will redirect to the appropriate home screen.
    } catch {
      // Error is displayed by the store
    }
  }, [email, password, phone, selectedCountry, firstName, lastName, selectedRole, acceptedTerms, register, navigation]);

  // ── Legal Links ──────────────────────────

  const handleOpenTerms = useCallback(() => {
    Linking.openURL('https://vispapp.com/legal/terms');
  }, []);

  const handleOpenPrivacy = useCallback(() => {
    Linking.openURL('https://vispapp.com/legal/privacy');
  }, []);

  // ── Step Validity ────────────────────────

  const isStep1Valid =
    EMAIL_REGEX.test(email.trim()) &&
    password.length >= Config.minPasswordLength &&
    password === confirmPassword;
  const phoneDigits = phone.replace(/\D/g, '');
  const isStep2Valid = firstName.trim().length >= 2 && lastName.trim().length >= 2 && phoneDigits.length === selectedCountry.maxDigits;

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
      <GlassCard variant="dark" padding={24} style={styles.stepCard}>
        <Text style={styles.stepTitle}>Create your account</Text>
        <Text style={styles.stepSubtitle}>
          Enter your email and create a secure password
        </Text>

        {/* Email */}
        <GlassInput
          label="EMAIL"
          value={email}
          onChangeText={(text) => {
            setEmail(text);
            if (step1Errors.email) {
              setStep1Errors((prev) => ({ ...prev, email: undefined }));
            }
          }}
          placeholder="you@example.com"
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          textContentType="emailAddress"
          returnKeyType="next"
          onSubmitEditing={() => passwordInputRef.current?.focus()}
          editable={!isLoading}
          error={step1Errors.email}
          containerStyle={styles.fieldSpacing}
        />

        {/* Password */}
        <View style={styles.fieldSpacing}>
          <Text style={styles.inputLabel}>PASSWORD</Text>
          <View
            style={[
              GlassStyles.input,
              styles.passwordRow,
              step1Errors.password ? GlassStyles.inputError : undefined,
            ]}
          >
            <TextInput
              ref={passwordInputRef}
              style={styles.passwordTextInput}
              value={password}
              onChangeText={(text) => {
                setPassword(text);
                if (step1Errors.password) {
                  setStep1Errors((prev) => ({ ...prev, password: undefined }));
                }
              }}
              placeholder="Minimum 8 characters"
              placeholderTextColor="rgba(255, 255, 255, 0.35)"
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              autoCorrect={false}
              textContentType="newPassword"
              returnKeyType="next"
              onSubmitEditing={() => confirmPasswordRef.current?.focus()}
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
              <View
                style={[
                  styles.strengthBadge,
                  { borderColor: passwordStrengthInfo.color },
                ]}
              >
                <Text
                  style={[
                    styles.strengthLabel,
                    { color: passwordStrengthInfo.color },
                  ]}
                >
                  {passwordStrengthInfo.label}
                </Text>
              </View>
            </View>
          ) : null}
        </View>

        {/* Confirm Password */}
        <GlassInput
          ref={confirmPasswordRef}
          label="CONFIRM PASSWORD"
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
          secureTextEntry={!showPassword}
          autoCapitalize="none"
          autoCorrect={false}
          textContentType="newPassword"
          returnKeyType="done"
          onSubmitEditing={handleNext}
          editable={!isLoading}
          error={step1Errors.confirmPassword}
          containerStyle={styles.fieldSpacing}
        />
      </GlassCard>
    );
  }

  function renderStep2(): React.JSX.Element {
    return (
      <GlassCard variant="dark" padding={24} style={styles.stepCard}>
        <Text style={styles.stepTitle}>What is your name?</Text>
        <Text style={styles.stepSubtitle}>
          This will be visible to other users on the platform
        </Text>

        {/* First Name */}
        <GlassInput
          label="FIRST NAME"
          value={firstName}
          onChangeText={(text) => {
            setFirstName(text);
            if (step2Errors.firstName) {
              setStep2Errors((prev) => ({ ...prev, firstName: undefined }));
            }
          }}
          placeholder="Jane"
          autoCapitalize="words"
          autoCorrect={false}
          autoComplete="given-name"
          textContentType="givenName"
          returnKeyType="next"
          onSubmitEditing={() => lastNameRef.current?.focus()}
          editable={!isLoading}
          error={step2Errors.firstName}
          containerStyle={styles.fieldSpacing}
        />

        {/* Last Name */}
        <GlassInput
          ref={lastNameRef}
          label="LAST NAME"
          value={lastName}
          onChangeText={(text) => {
            setLastName(text);
            if (step2Errors.lastName) {
              setStep2Errors((prev) => ({ ...prev, lastName: undefined }));
            }
          }}
          placeholder="Smith"
          autoCapitalize="words"
          autoCorrect={false}
          autoComplete="family-name"
          textContentType="familyName"
          returnKeyType="next"
          onSubmitEditing={() => phoneRef.current?.focus()}
          editable={!isLoading}
          error={step2Errors.lastName}
          containerStyle={styles.fieldSpacing}
        />

        {/* Phone Number */}
        <View style={styles.fieldSpacing}>
          <Text style={styles.inputLabel}>PHONE NUMBER</Text>
          <View style={styles.phoneRow}>
            {/* Country code selector */}
            <TouchableOpacity
              style={[
                GlassStyles.input,
                styles.countryCodeButton,
                step2Errors.phone ? GlassStyles.inputError : undefined,
              ]}
              onPress={() => setShowCountryPicker(true)}
              activeOpacity={0.7}
              disabled={isLoading}
            >
              <Text style={styles.countryFlag}>{selectedCountry.flag}</Text>
              <Text style={styles.countryDial}>{selectedCountry.dial}</Text>
              <Text style={styles.countryArrow}>{'>'}</Text>
            </TouchableOpacity>

            {/* Phone input */}
            <GlassInput
              ref={phoneRef}
              value={phone}
              onChangeText={(text) => {
                const digitsOnly = text.replace(/\D/g, '');
                const limited = digitsOnly.slice(0, selectedCountry.maxDigits);
                setPhone(limited);
                if (step2Errors.phone) {
                  setStep2Errors((prev) => ({ ...prev, phone: undefined }));
                }
              }}
              placeholder={`${'0'.repeat(selectedCountry.maxDigits)}`}
              keyboardType="number-pad"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="tel"
              textContentType="telephoneNumber"
              maxLength={selectedCountry.maxDigits}
              returnKeyType="done"
              onSubmitEditing={handleNext}
              editable={!isLoading}
              error={step2Errors.phone}
              containerStyle={styles.phoneInputContainer}
            />
          </View>
          <Text style={styles.phoneHint}>
            {phoneDigits.length}/{selectedCountry.maxDigits} digits
          </Text>
        </View>

        {/* Country Code Picker Modal */}
        <Modal
          visible={showCountryPicker}
          animationType="slide"
          presentationStyle="pageSheet"
          onRequestClose={() => setShowCountryPicker(false)}
        >
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select Country Code</Text>
              <TouchableOpacity
                onPress={() => setShowCountryPicker(false)}
                style={styles.modalCloseButton}
              >
                <Text style={styles.modalCloseText}>Done</Text>
              </TouchableOpacity>
            </View>
            <FlatList
              data={COUNTRY_CODES}
              keyExtractor={(item) => item.code}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[
                    styles.countryRow,
                    item.code === selectedCountry.code && styles.countryRowSelected,
                  ]}
                  onPress={() => {
                    setSelectedCountry(item);
                    const digits = phone.replace(/\D/g, '');
                    if (digits.length > item.maxDigits) {
                      setPhone(digits.slice(0, item.maxDigits));
                    }
                    setShowCountryPicker(false);
                  }}
                  activeOpacity={0.7}
                >
                  <Text style={styles.countryRowFlag}>{item.flag}</Text>
                  <Text style={styles.countryRowName}>{item.name}</Text>
                  <Text style={styles.countryRowDial}>{item.dial}</Text>
                  {item.code === selectedCountry.code && (
                    <Text style={styles.countryRowCheck}>{'>'}</Text>
                  )}
                </TouchableOpacity>
              )}
              ItemSeparatorComponent={() => <View style={styles.countryRowSeparator} />}
              contentContainerStyle={styles.countryListContent}
            />
          </View>
        </Modal>
      </GlassCard>
    );
  }

  function renderStep3(): React.JSX.Element {
    return (
      <GlassCard variant="dark" padding={24} style={styles.stepCard}>
        <Text style={styles.stepTitle}>How will you use VISP?</Text>
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
                onPress={() => setSelectedRole(option.value)}
                activeOpacity={0.7}
                disabled={isLoading}
              >
                <GlassCard
                  variant="standard"
                  padding={Spacing.lg}
                  style={StyleSheet.flatten([
                    styles.roleCard,
                    isSelected && styles.roleCardSelected,
                  ])}
                >
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
                </GlassCard>
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
      </GlassCard>
    );
  }

  // ── Main Render ──────────────────────────

  const canProceed =
    (currentStep === 1 && isStep1Valid) ||
    (currentStep === 2 && isStep2Valid) ||
    (currentStep === 3 && isStep3Valid);

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
            style={{
              opacity: fadeAnim,
              transform: [{ translateY: slideAnim }],
            }}
          >
            {/* Back Button */}
            <GlassButton
              title="Back"
              variant="outline"
              onPress={handleBack}
              disabled={isLoading}
              style={styles.backButton}
            />

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

            {/* Action Buttons */}
            <View style={styles.actionRow}>
              {currentStep > 1 && (
                <GlassButton
                  title="Back"
                  variant="outline"
                  onPress={handleBack}
                  disabled={isLoading}
                  style={styles.backActionButton}
                />
              )}
              <GlassButton
                title={currentStep === TOTAL_STEPS ? 'Create Account' : 'Continue'}
                variant="glow"
                onPress={currentStep === TOTAL_STEPS ? handleRegister : handleNext}
                disabled={!canProceed || isLoading}
                loading={isLoading}
                style={StyleSheet.flatten([
                  styles.continueButton,
                  currentStep === 1 && styles.continueButtonFull,
                ])}
              />
            </View>

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
    paddingTop: Spacing.xxxl,
    paddingBottom: Spacing.xxxl,
  },

  // ── Back ───────────────────────────────
  backButton: {
    alignSelf: 'flex-start',
    marginBottom: Spacing.lg,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    minHeight: 36,
  },

  // ── Progress ──────────────────────────
  progressContainer: {
    marginBottom: Spacing.xxl,
  },
  progressBar: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  progressSegment: {
    flex: 1,
    height: 4,
    borderRadius: 2,
  },
  progressSegmentActive: {
    backgroundColor: 'rgba(120, 80, 255, 0.8)',
    ...Platform.select({
      ios: {
        shadowColor: 'rgba(120, 80, 255, 0.6)',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 1,
        shadowRadius: 6,
      },
      android: {},
    }),
  },
  progressSegmentInactive: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  progressLabel: {
    ...Typography.caption,
    color: 'rgba(255, 255, 255, 0.4)',
  },

  // ── Step Card ─────────────────────────
  stepCard: {
    marginBottom: Spacing.xxl,
  },

  // ── Step Header ───────────────────────
  stepTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: Spacing.sm,
  },
  stepSubtitle: {
    ...Typography.body,
    color: 'rgba(255, 255, 255, 0.5)',
    marginBottom: Spacing.xxl,
  },

  // ── Error Banner ──────────────────────
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

  // ── Fields ────────────────────────────
  fieldSpacing: {
    marginBottom: Spacing.lg,
  },
  inputLabel: {
    ...Typography.label,
    color: 'rgba(255, 255, 255, 0.55)',
    marginBottom: Spacing.xs,
  },
  fieldError: {
    ...Typography.caption,
    color: '#E74C3C',
    marginTop: Spacing.xs,
  },

  // ── Password ──────────────────────────
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
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  strengthBarFill: {
    height: '100%',
    borderRadius: 2,
  },
  strengthBadge: {
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 2,
    paddingHorizontal: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  strengthLabel: {
    ...Typography.caption,
    fontWeight: '600',
  },

  // ── Role Selection ────────────────────
  roleContainer: {
    gap: Spacing.md,
    marginBottom: Spacing.xxl,
  },
  roleCard: {
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  roleCardSelected: {
    borderColor: 'rgba(120, 80, 255, 0.6)',
    backgroundColor: 'rgba(120, 80, 255, 0.1)',
    ...Platform.select({
      ios: {
        shadowColor: 'rgba(120, 80, 255, 0.4)',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 1,
        shadowRadius: 12,
      },
      android: { elevation: 4 },
    }),
  },
  roleCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  roleCardTitle: {
    ...Typography.headline,
    color: '#FFFFFF',
  },
  roleCardTitleSelected: {
    color: 'rgba(160, 130, 255, 1)',
  },
  roleCardDescription: {
    ...Typography.footnote,
    color: 'rgba(255, 255, 255, 0.5)',
  },
  radioOuter: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOuterSelected: {
    borderColor: 'rgba(120, 80, 255, 0.8)',
  },
  radioInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: 'rgba(120, 80, 255, 0.8)',
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
    borderRadius: 6,
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  checkboxChecked: {
    backgroundColor: 'rgba(120, 80, 255, 0.8)',
    borderColor: 'rgba(120, 80, 255, 0.8)',
  },
  checkmark: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  termsText: {
    ...Typography.footnote,
    color: 'rgba(255, 255, 255, 0.5)',
    flex: 1,
    lineHeight: 20,
  },
  termsLink: {
    color: 'rgba(120, 80, 255, 0.9)',
    fontWeight: '500',
  },

  // ── Spacer ────────────────────────────
  spacer: {
    flex: 1,
    minHeight: Spacing.xxl,
  },

  // ── Action Buttons ────────────────────
  actionRow: {
    flexDirection: 'row',
    gap: Spacing.md,
    marginBottom: Spacing.lg,
  },
  backActionButton: {
    flex: 0,
    paddingHorizontal: Spacing.xxl,
    minHeight: 52,
  },
  continueButton: {
    flex: 1,
    minHeight: 52,
  },
  continueButtonFull: {
    flex: 1,
  },

  // ── Login Link ────────────────────────
  loginRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loginLabel: {
    ...Typography.body,
    color: 'rgba(255, 255, 255, 0.5)',
  },
  loginLink: {
    ...Typography.body,
    color: 'rgba(120, 80, 255, 0.9)',
    fontWeight: '600',
  },

  // ── Phone + Country Code ──────────────
  phoneRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  countryCodeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: Spacing.md,
  },
  countryFlag: {
    fontSize: 20,
  },
  countryDial: {
    ...Typography.body,
    color: '#FFFFFF',
    fontWeight: '600',
  },
  countryArrow: {
    fontSize: 10,
    color: 'rgba(255, 255, 255, 0.4)',
    marginLeft: 2,
  },
  phoneInputContainer: {
    flex: 1,
  },
  phoneHint: {
    ...Typography.caption,
    color: 'rgba(255, 255, 255, 0.35)',
    marginTop: Spacing.xxs,
    textAlign: 'right',
  },

  // ── Country Picker Modal ──────────────
  modalContainer: {
    flex: 1,
    backgroundColor: '#0a0a1a',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.xxl,
    paddingVertical: Spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
    backgroundColor: 'rgba(10, 10, 30, 0.8)',
  },
  modalTitle: {
    ...Typography.title3,
    color: '#FFFFFF',
  },
  modalCloseButton: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  modalCloseText: {
    ...Typography.body,
    color: 'rgba(120, 80, 255, 0.9)',
    fontWeight: '600',
  },
  countryListContent: {
    paddingHorizontal: Spacing.xxl,
    paddingVertical: Spacing.md,
  },
  countryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.md,
    gap: Spacing.md,
  },
  countryRowSelected: {
    backgroundColor: 'rgba(120, 80, 255, 0.1)',
    marginHorizontal: -Spacing.md,
    paddingHorizontal: Spacing.md,
    borderRadius: 12,
  },
  countryRowFlag: {
    fontSize: 24,
  },
  countryRowName: {
    ...Typography.body,
    color: '#FFFFFF',
    flex: 1,
  },
  countryRowDial: {
    ...Typography.body,
    color: 'rgba(255, 255, 255, 0.5)',
    fontWeight: '600',
  },
  countryRowCheck: {
    fontSize: 14,
    color: 'rgba(120, 80, 255, 0.9)',
    fontWeight: '700',
  },
  countryRowSeparator: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
  },
});

export default RegisterScreen;
