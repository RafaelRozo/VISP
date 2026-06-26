/**
 * VISP for Business - Company Join Screen
 *
 * "Register with a company code" flow for collaborators invited by their
 * employer. Modeled on RegisterScreen (multi-step glass wizard, autofill-safe
 * handlers, recovery-code reveal), but it STARTS by entering the company invite
 * code, then collects the standard account fields.
 *
 *   Step 1: Company code (8-character invite from the employer)
 *   Step 2: Email + Password
 *   Step 3: First Name / Last Name + Phone
 *
 * On submit:
 *   a. register the user via the auth store (role 'provider'),
 *   b. POST /companies/redeem-invite with the entered code (Bearer = the
 *      just-obtained JWT, attached automatically by the API client),
 *   c. on success, reveal the recovery code then proceed into the app;
 *      on redeem error, surface the backend `detail` inline and keep the user
 *      on the screen so they can retry the code (the account already exists).
 *
 * SCOPE: this only handles registration + invite redemption. It does NOT touch
 * the provider job/offers/matching screens, service selection, or assignment —
 * those are a separate sub-task.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
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

import { Spacing, Typography } from '../../theme';
import { useTheme } from '../../theme/ThemeContext';
import { GlassStyles } from '../../theme/glass';
import { useAuthStore } from '../../stores/authStore';
import { useCompanyStore } from '../../stores/companyStore';
import { companyService } from '../../services/companyService';
import { Config } from '../../services/config';
import { GlassCard, GlassButton, GlassInput } from '../../components/glass';
import { Screen } from '../../components/visp';
import type { RootStackParamList } from '../../types';

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

type Props = NativeStackScreenProps<RootStackParamList, 'CompanyJoin'>;

const TOTAL_STEPS = 3;
const INVITE_CODE_LENGTH = 8;

interface Step1Errors {
  code?: string;
}

interface Step2Errors {
  email?: string;
  password?: string;
  confirmPassword?: string;
}

interface Step3Errors {
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

function normalizeCode(raw: string): string {
  // Codes are short alphanumeric tokens; uppercase + strip whitespace.
  return raw.replace(/\s/g, '').toUpperCase();
}

function validateStep1(code: string): Step1Errors {
  const errors: Step1Errors = {};
  const c = normalizeCode(code);
  if (!c) {
    errors.code = 'Enter the code your company gave you';
  } else if (c.length !== INVITE_CODE_LENGTH) {
    errors.code = `The company code is ${INVITE_CODE_LENGTH} characters`;
  }
  return errors;
}

function validateStep2(
  email: string,
  password: string,
  confirmPassword: string,
): Step2Errors {
  const errors: Step2Errors = {};
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

function validateStep3(
  firstName: string,
  lastName: string,
  phone: string,
  country: CountryCode,
): Step3Errors {
  const errors: Step3Errors = {};
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
// Component
// ──────────────────────────────────────────────

function CompanyJoinScreen({ navigation }: Props): React.JSX.Element {
  const theme = useTheme();

  // ── Form State ───────────────────────────
  const [currentStep, setCurrentStep] = useState(1);

  // Step 1
  const [code, setCode] = useState('');
  const [step1Errors, setStep1Errors] = useState<Step1Errors>({});

  // Step 2
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [step2Errors, setStep2Errors] = useState<Step2Errors>({});

  // Step 3
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [selectedCountry, setSelectedCountry] = useState<CountryCode>(COUNTRY_CODES[0]);
  const [showCountryPicker, setShowCountryPicker] = useState(false);
  const [step3Errors, setStep3Errors] = useState<Step3Errors>({});

  const codeInputRef = useRef<TextInput>(null);
  const emailInputRef = useRef<TextInput>(null);
  const passwordInputRef = useRef<TextInput>(null);
  const confirmPasswordRef = useRef<TextInput>(null);
  const firstNameRef = useRef<TextInput>(null);
  const lastNameRef = useRef<TextInput>(null);
  const phoneRef = useRef<TextInput>(null);

  const prevPasswordLenRef = useRef(0);

  // Autofill reconciliation: see RegisterScreen for the rationale. Password
  // managers / iOS AutoFill write to the native field and sometimes never fire
  // onChangeText, so we mirror every field here and reconcile ref -> state at
  // submit time.
  const fieldValuesRef = useRef<{
    code: string;
    email: string;
    password: string;
    confirmPassword: string;
    firstName: string;
    lastName: string;
    phone: string;
  }>({ code: '', email: '', password: '', confirmPassword: '', firstName: '', lastName: '', phone: '' });

  const { register, isLoading, error, clearError, commitPendingRegistration } =
    useAuthStore();
  const { refreshMembership } = useCompanyStore();

  // Local (non-store) error for the redeem step shown inline on the code step.
  const [redeemError, setRedeemError] = useState<string | null>(null);
  // True once the user's account exists (register succeeded) so we can show a
  // "retry the company code" affordance instead of re-registering.
  const [accountCreated, setAccountCreated] = useState(false);
  const [isRedeeming, setIsRedeeming] = useState(false);

  // Recovery code shown after a successful register+redeem.
  const [recoveryCodeToShow, setRecoveryCodeToShow] = useState<string | null>(null);

  // ── Entry Animation ──────────────────────
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;

  useEffect(() => {
    const entryAnim = Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 500, useNativeDriver: true }),
    ]);
    entryAnim.start();
    return () => entryAnim.stop();
  }, [fadeAnim, slideAnim]);

  // ── Auto-focus on step change to trigger iOS AutoFill bar ──
  useEffect(() => {
    const timer = setTimeout(() => {
      if (currentStep === 1) {
        codeInputRef.current?.focus();
      } else if (currentStep === 2) {
        emailInputRef.current?.focus();
      } else if (currentStep === 3) {
        firstNameRef.current?.focus();
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [currentStep]);

  // ── Field Handlers ───────────────────────

  const handleCodeChange = useCallback((text: string) => {
    const next = normalizeCode(text).slice(0, INVITE_CODE_LENGTH);
    fieldValuesRef.current.code = next;
    setCode(next);
    if (step1Errors.code) {
      setStep1Errors((prev) => ({ ...prev, code: undefined }));
    }
    if (redeemError) setRedeemError(null);
  }, [step1Errors.code, redeemError]);

  const handleCodeNativeChange = useCallback((e: { nativeEvent: { text?: string } }) => {
    const text = e?.nativeEvent?.text;
    if (typeof text !== 'string') return;
    const next = normalizeCode(text).slice(0, INVITE_CODE_LENGTH);
    if (next !== fieldValuesRef.current.code) handleCodeChange(next);
  }, [handleCodeChange]);

  const handlePasswordChange = useCallback((text: string) => {
    const wasAutoFilled = prevPasswordLenRef.current <= 1 && text.length >= 8;
    prevPasswordLenRef.current = text.length;

    fieldValuesRef.current.password = text;
    setPassword(text);
    if (step2Errors.password) {
      setStep2Errors((prev) => ({ ...prev, password: undefined }));
    }
    if (wasAutoFilled) {
      fieldValuesRef.current.confirmPassword = text;
      setConfirmPassword(text);
      if (step2Errors.confirmPassword) {
        setStep2Errors((prev) => ({ ...prev, confirmPassword: undefined }));
      }
    }
  }, [step2Errors.password, step2Errors.confirmPassword]);

  const handlePasswordNativeChange = useCallback((e: { nativeEvent: { text: string } }) => {
    const text = e.nativeEvent.text;
    if (text !== password) handlePasswordChange(text);
  }, [password, handlePasswordChange]);

  const handleConfirmPasswordChange = useCallback((text: string) => {
    fieldValuesRef.current.confirmPassword = text;
    setConfirmPassword(text);
    if (step2Errors.confirmPassword) {
      setStep2Errors((prev) => ({ ...prev, confirmPassword: undefined }));
    }
  }, [step2Errors.confirmPassword]);

  const handleConfirmPasswordNativeChange = useCallback((e: { nativeEvent: { text: string } }) => {
    const text = e.nativeEvent.text;
    if (text !== confirmPassword) handleConfirmPasswordChange(text);
  }, [confirmPassword, handleConfirmPasswordChange]);

  const handleEmailChange = useCallback((text: string) => {
    fieldValuesRef.current.email = text;
    setEmail(text);
    if (step2Errors.email) {
      setStep2Errors((prev) => ({ ...prev, email: undefined }));
    }
  }, [step2Errors.email]);

  const handleFirstNameChange = useCallback((text: string) => {
    fieldValuesRef.current.firstName = text;
    setFirstName(text);
    if (step3Errors.firstName) {
      setStep3Errors((prev) => ({ ...prev, firstName: undefined }));
    }
  }, [step3Errors.firstName]);

  const handleLastNameChange = useCallback((text: string) => {
    fieldValuesRef.current.lastName = text;
    setLastName(text);
    if (step3Errors.lastName) {
      setStep3Errors((prev) => ({ ...prev, lastName: undefined }));
    }
  }, [step3Errors.lastName]);

  const handlePhoneChange = useCallback((text: string) => {
    let digitsOnly = text.replace(/\D/g, '');
    const dialDigits = selectedCountry.dial.replace(/\D/g, '');
    if (
      digitsOnly.length > selectedCountry.maxDigits &&
      digitsOnly.startsWith(dialDigits)
    ) {
      digitsOnly = digitsOnly.slice(dialDigits.length);
    }
    const limited = digitsOnly.slice(0, selectedCountry.maxDigits);
    fieldValuesRef.current.phone = limited;
    setPhone(limited);
    if (step3Errors.phone) {
      setStep3Errors((prev) => ({ ...prev, phone: undefined }));
    }
  }, [selectedCountry, step3Errors.phone]);

  // Native-event fallback for autofill writes that bypass onChangeText.
  const captureNative = useCallback(
    (
      field: 'email' | 'firstName' | 'lastName' | 'phone',
      e: { nativeEvent: { text?: string } },
    ) => {
      const text = e?.nativeEvent?.text;
      if (typeof text !== 'string' || text.length === 0) return;
      switch (field) {
        case 'email':
          if (text !== fieldValuesRef.current.email) handleEmailChange(text);
          break;
        case 'firstName':
          if (text !== fieldValuesRef.current.firstName) handleFirstNameChange(text);
          break;
        case 'lastName':
          if (text !== fieldValuesRef.current.lastName) handleLastNameChange(text);
          break;
        case 'phone':
          if (text !== fieldValuesRef.current.phone) handlePhoneChange(text);
          break;
      }
    },
    [handleEmailChange, handleFirstNameChange, handleLastNameChange, handlePhoneChange],
  );

  // ── Password Strength ────────────────────
  const passwordStrengthInfo = useMemo(
    () => (password.length > 0 ? getPasswordStrength(password) : null),
    [password],
  );

  // ── Redeem helper (shared by submit + retry) ──
  const redeemCode = useCallback(
    async (rawCode: string): Promise<boolean> => {
      setIsRedeeming(true);
      setRedeemError(null);
      try {
        await companyService.redeemInvite(rawCode);
        // Best-effort membership detection so the app knows the company.
        await refreshMembership();
        setIsRedeeming(false);
        return true;
      } catch (err) {
        const message =
          err && typeof err === 'object' && 'message' in err
            ? (err as { message: string }).message
            : 'We could not redeem that code. Please try again.';
        setRedeemError(message);
        setIsRedeeming(false);
        return false;
      }
    },
    [refreshMembership],
  );

  // ── Step Navigation ──────────────────────

  const handleNext = useCallback(() => {
    Keyboard.dismiss();
    if (error) clearError();
    const v = fieldValuesRef.current;

    if (currentStep === 1) {
      const c = v.code || code;
      if (c !== code) setCode(c);
      const errors = validateStep1(c);
      setStep1Errors(errors);
      if (Object.keys(errors).length > 0) return;
      setCurrentStep(2);
    } else if (currentStep === 2) {
      const e = v.email || email;
      const p = v.password || password;
      const cp = v.confirmPassword || confirmPassword;
      if (e !== email) setEmail(e);
      if (p !== password) setPassword(p);
      if (cp !== confirmPassword) setConfirmPassword(cp);

      const errors = validateStep2(e, p, cp);
      setStep2Errors(errors);
      if (Object.keys(errors).length > 0) return;
      setCurrentStep(3);
    }
  }, [currentStep, code, email, password, confirmPassword, error, clearError]);

  const handleBack = useCallback(() => {
    if (error) clearError();
    if (currentStep > 1) {
      setCurrentStep((prev) => prev - 1);
    } else {
      navigation.goBack();
    }
  }, [currentStep, navigation, error, clearError]);

  // ── Submit (register provider, then redeem invite) ──

  const handleSubmit = useCallback(async () => {
    Keyboard.dismiss();
    if (error) clearError();

    const v = fieldValuesRef.current;
    const fn = v.firstName || firstName;
    const ln = v.lastName || lastName;
    const ph = v.phone || phone;
    if (fn !== firstName) setFirstName(fn);
    if (ln !== lastName) setLastName(ln);
    if (ph !== phone) setPhone(ph);

    const step3 = validateStep3(fn, ln, ph, selectedCountry);
    setStep3Errors(step3);
    if (Object.keys(step3).length > 0) return;

    const inviteCode = normalizeCode(v.code || code);

    let code3: string | null = null;
    try {
      // The auth store defers applying the auth response (pendingRegistration),
      // but authService.register() sets the API client's Bearer token
      // synchronously, so the redeem call below is authenticated.
      code3 = await register({
        email: email.trim().toLowerCase(),
        phone: `${selectedCountry.dial}${ph.replace(/\D/g, '')}`,
        password,
        firstName: fn.trim(),
        lastName: ln.trim(),
        role: 'provider',
        acceptedTermsVersion: Config.termsVersion,
      });
      setAccountCreated(true);
    } catch {
      // Registration error is surfaced by the auth store (error banner).
      return;
    }

    // Account now exists. Try to redeem the invite. If it fails, we keep the
    // user here with an inline message + retry affordance instead of stranding
    // them; their account is already created.
    const ok = await redeemCode(inviteCode);
    if (!ok) {
      // Bounce back to the code step so they can fix it.
      setCurrentStep(1);
      return;
    }

    // Success: reveal the recovery code, then commit the deferred auth so the
    // navigator switches into the app.
    if (code3) {
      setRecoveryCodeToShow(code3);
    } else {
      commitPendingRegistration();
    }
  }, [
    error,
    clearError,
    firstName,
    lastName,
    phone,
    selectedCountry,
    code,
    email,
    password,
    register,
    redeemCode,
    commitPendingRegistration,
  ]);

  // Retry redeeming the code after the account already exists (registration
  // succeeded but the first redeem failed, e.g. wrong/expired code).
  const handleRetryRedeem = useCallback(async () => {
    Keyboard.dismiss();
    const v = fieldValuesRef.current;
    const c = normalizeCode(v.code || code);
    const errors = validateStep1(c);
    setStep1Errors(errors);
    if (Object.keys(errors).length > 0) return;

    const ok = await redeemCode(c);
    if (ok) {
      // We can't re-read the recovery code (the register call already
      // consumed it), so just enter the app.
      commitPendingRegistration();
    }
  }, [code, redeemCode, commitPendingRegistration]);

  // ── Step Validity ────────────────────────
  const phoneDigits = phone.replace(/\D/g, '');

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
        <Text style={[styles.progressLabel, { color: theme.textTertiary }]}>
          Step {currentStep} of {TOTAL_STEPS}
        </Text>
      </View>
    );
  }

  function renderStep1(): React.JSX.Element {
    return (
      <GlassCard variant="dark" padding={24} style={styles.stepCard}>
        <Text style={[styles.stepTitle, { color: theme.textPrimary }]}>Join your company</Text>
        <Text style={[styles.stepSubtitle, { color: theme.textSecondary }]}>
          Enter the {INVITE_CODE_LENGTH}-character code your employer gave you to
          register as a collaborator.
        </Text>

        <GlassInput
          ref={codeInputRef}
          label="COMPANY CODE"
          value={code}
          onChangeText={handleCodeChange}
          onChange={handleCodeNativeChange}
          onEndEditing={handleCodeNativeChange}
          placeholder="ABCD1234"
          autoCapitalize="characters"
          autoCorrect={false}
          autoComplete="off"
          maxLength={INVITE_CODE_LENGTH}
          returnKeyType={accountCreated ? 'done' : 'next'}
          onSubmitEditing={accountCreated ? handleRetryRedeem : handleNext}
          editable={!isLoading && !isRedeeming}
          error={step1Errors.code}
          containerStyle={styles.fieldSpacing}
        />

        {/* Redeem error (e.g. wrong/expired code, or email mismatch). */}
        {redeemError ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorBannerText}>{redeemError}</Text>
          </View>
        ) : null}

        {accountCreated ? (
          <Text style={[styles.helperNote, { color: theme.textTertiary }]}>
            Your account was created. Enter your company code to finish joining.
          </Text>
        ) : null}
      </GlassCard>
    );
  }

  function renderStep2(): React.JSX.Element {
    return (
      <GlassCard variant="dark" padding={24} style={styles.stepCard}>
        <Text style={[styles.stepTitle, { color: theme.textPrimary }]}>Create your account</Text>
        <Text style={[styles.stepSubtitle, { color: theme.textSecondary }]}>
          Use the same email your company invited, then create a secure password.
        </Text>

        {/* Email */}
        <GlassInput
          ref={emailInputRef}
          label="EMAIL"
          value={email}
          onChangeText={handleEmailChange}
          onChange={(e) => captureNative('email', e)}
          onEndEditing={(e) => captureNative('email', e)}
          placeholder="you@company.com"
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          textContentType="emailAddress"
          returnKeyType="next"
          onSubmitEditing={() => passwordInputRef.current?.focus()}
          editable={!isLoading}
          error={step2Errors.email}
          containerStyle={styles.fieldSpacing}
        />

        {/* Password */}
        <View style={styles.fieldSpacing}>
          <Text style={[styles.inputLabel, { color: theme.textSecondary }]}>PASSWORD</Text>
          <View
            style={[
              GlassStyles.input,
              styles.passwordRow,
              step2Errors.password ? GlassStyles.inputError : undefined,
            ]}
          >
            <TextInput
              ref={passwordInputRef}
              style={[styles.passwordTextInput, { color: theme.inputText }]}
              value={password}
              onChangeText={handlePasswordChange}
              onChange={handlePasswordNativeChange}
              placeholder="Minimum 8 characters"
              placeholderTextColor={theme.inputPlaceholder}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="new-password"
              textContentType="newPassword"
              passwordRules="minlength: 8; required: lower; required: upper; required: digit; required: special;"
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
          {step2Errors.password ? (
            <Text style={styles.fieldError}>{step2Errors.password}</Text>
          ) : null}

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
                  style={[styles.strengthLabel, { color: passwordStrengthInfo.color }]}
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
          onChangeText={handleConfirmPasswordChange}
          onChange={handleConfirmPasswordNativeChange}
          placeholder="Re-enter your password"
          secureTextEntry={!showPassword}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="new-password"
          textContentType="newPassword"
          returnKeyType="done"
          onSubmitEditing={handleNext}
          editable={!isLoading}
          error={step2Errors.confirmPassword}
          containerStyle={styles.fieldSpacing}
        />
      </GlassCard>
    );
  }

  function renderStep3(): React.JSX.Element {
    return (
      <GlassCard variant="dark" padding={24} style={styles.stepCard}>
        <Text style={[styles.stepTitle, { color: theme.textPrimary }]}>What is your name?</Text>
        <Text style={[styles.stepSubtitle, { color: theme.textSecondary }]}>
          This will be visible to your company and other users on the platform.
        </Text>

        {/* First Name */}
        <GlassInput
          ref={firstNameRef}
          label="FIRST NAME"
          value={firstName}
          onChangeText={handleFirstNameChange}
          onChange={(e) => captureNative('firstName', e)}
          onEndEditing={(e) => captureNative('firstName', e)}
          placeholder="Jane"
          autoCapitalize="words"
          autoCorrect={false}
          autoComplete="given-name"
          textContentType="givenName"
          returnKeyType="next"
          onSubmitEditing={() => lastNameRef.current?.focus()}
          editable={!isLoading}
          error={step3Errors.firstName}
          containerStyle={styles.fieldSpacing}
        />

        {/* Last Name */}
        <GlassInput
          ref={lastNameRef}
          label="LAST NAME"
          value={lastName}
          onChangeText={handleLastNameChange}
          onChange={(e) => captureNative('lastName', e)}
          onEndEditing={(e) => captureNative('lastName', e)}
          placeholder="Smith"
          autoCapitalize="words"
          autoCorrect={false}
          autoComplete="family-name"
          textContentType="familyName"
          returnKeyType="next"
          onSubmitEditing={() => phoneRef.current?.focus()}
          editable={!isLoading}
          error={step3Errors.lastName}
          containerStyle={styles.fieldSpacing}
        />

        {/* Phone Number */}
        <View style={styles.fieldSpacing}>
          <Text style={[styles.inputLabel, { color: theme.textSecondary }]}>PHONE NUMBER</Text>
          <View style={styles.phoneRow}>
            <TouchableOpacity
              style={[
                GlassStyles.input,
                styles.countryCodeButton,
                step3Errors.phone ? GlassStyles.inputError : undefined,
              ]}
              onPress={() => setShowCountryPicker(true)}
              activeOpacity={0.7}
              disabled={isLoading}
            >
              <Text style={styles.countryFlag}>{selectedCountry.flag}</Text>
              <Text style={[styles.countryDial, { color: theme.textPrimary }]}>{selectedCountry.dial}</Text>
              <Text style={[styles.countryArrow, { color: theme.textTertiary }]}>{'>'}</Text>
            </TouchableOpacity>

            <GlassInput
              ref={phoneRef}
              value={phone}
              onChangeText={handlePhoneChange}
              onChange={(e) => captureNative('phone', e)}
              onEndEditing={(e) => captureNative('phone', e)}
              placeholder={`${'0'.repeat(selectedCountry.maxDigits)}`}
              keyboardType="phone-pad"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="tel"
              textContentType="telephoneNumber"
              maxLength={selectedCountry.maxDigits + 5}
              returnKeyType="done"
              onSubmitEditing={handleSubmit}
              editable={!isLoading}
              error={step3Errors.phone}
              containerStyle={styles.phoneInputContainer}
            />
          </View>
          <Text style={[styles.phoneHint, { color: theme.textTertiary }]}>
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
              <Text style={[styles.modalTitle, { color: theme.textPrimary }]}>Select Country Code</Text>
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
                  <Text style={[styles.countryRowName, { color: theme.textPrimary }]}>{item.name}</Text>
                  <Text style={[styles.countryRowDial, { color: theme.textSecondary }]}>{item.dial}</Text>
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

  // ── Main Render ──────────────────────────

  const busy = isLoading || isRedeeming;

  // Primary action label + handler depend on the step and whether the account
  // already exists (post-register redeem retry).
  let primaryTitle = 'Continue';
  let primaryAction: () => void = handleNext;
  if (currentStep === 1 && accountCreated) {
    primaryTitle = 'Join company';
    primaryAction = handleRetryRedeem;
  } else if (currentStep === TOTAL_STEPS) {
    primaryTitle = 'Create account & join';
    primaryAction = handleSubmit;
  }

  return (
    <Screen>
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
            style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}
          >
            {/* Back Button */}
            <GlassButton
              title="Back"
              variant="outline"
              onPress={handleBack}
              disabled={busy}
              style={styles.backButton}
            />

            {/* Progress Bar */}
            {renderProgressBar()}

            {/* Server Error (registration) */}
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
                  disabled={busy}
                  style={styles.backActionButton}
                />
              )}
              <GlassButton
                title={primaryTitle}
                variant="glow"
                onPress={primaryAction}
                disabled={busy}
                loading={busy}
                style={StyleSheet.flatten([
                  styles.continueButton,
                  currentStep === 1 && styles.continueButtonFull,
                ])}
              />
            </View>

            {/* Login Link */}
            <View style={styles.loginRow}>
              <Text style={[styles.loginLabel, { color: theme.textSecondary }]}>Already have an account? </Text>
              <TouchableOpacity onPress={() => navigation.navigate('Login')} disabled={busy}>
                <Text style={styles.loginLink}>Sign In</Text>
              </TouchableOpacity>
            </View>
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Recovery code reveal after a successful register + redeem */}
      <Modal
        visible={recoveryCodeToShow !== null}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setRecoveryCodeToShow(null);
          commitPendingRegistration();
        }}
      >
        <View style={recoveryModalStyles.backdrop}>
          <View style={recoveryModalStyles.card}>
            <Text style={recoveryModalStyles.title}>Save your recovery code</Text>
            <Text style={recoveryModalStyles.subtitle}>
              This is the ONLY way to reset your password if you forget it.
              Write it down or take a screenshot. You can view it again later
              from Settings.
            </Text>
            <View style={recoveryModalStyles.codeBox}>
              <Text selectable style={recoveryModalStyles.codeText}>
                {recoveryCodeToShow}
              </Text>
            </View>
            <Text style={recoveryModalStyles.hint}>Long-press the code to copy.</Text>
            <TouchableOpacity
              onPress={() => {
                setRecoveryCodeToShow(null);
                commitPendingRegistration();
              }}
              style={recoveryModalStyles.btn}
            >
              <Text style={recoveryModalStyles.btnText}>I have saved it</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

const recoveryModalStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  card: {
    backgroundColor: 'rgba(20,20,40,0.95)',
    borderRadius: 20,
    padding: 24,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  title: { fontSize: 22, fontWeight: '700', color: '#fff', marginBottom: 12 },
  subtitle: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.65)',
    lineHeight: 20,
    marginBottom: 20,
  },
  codeBox: {
    backgroundColor: 'rgba(120,80,255,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(120,80,255,0.5)',
    borderRadius: 14,
    paddingVertical: 20,
    marginBottom: 10,
  },
  codeText: {
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
    fontSize: 24,
    color: '#fff',
    letterSpacing: 5,
    textAlign: 'center',
  },
  hint: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.45)',
    textAlign: 'center',
    marginBottom: 20,
  },
  btn: {
    backgroundColor: 'rgba(120,80,255,0.9)',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});

// ──────────────────────────────────────────────
// Styles (mirrors RegisterScreen)
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
  helperNote: {
    ...Typography.caption,
    color: 'rgba(255, 255, 255, 0.45)',
    marginTop: Spacing.sm,
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

export default CompanyJoinScreen;
