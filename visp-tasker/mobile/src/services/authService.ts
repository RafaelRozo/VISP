/**
 * VISP - Authentication Service
 *
 * Handles all authentication-related API calls: login, register, social auth,
 * password reset, and secure token management via react-native-keychain.
 */

import * as Keychain from 'react-native-keychain';

import apiClient, { setTokens, clearTokens, post } from './apiClient';
import { Config } from './config';
import type {
  AuthResponse,
  AuthTokens,
  LoginCredentials,
  RegisterData,
  User,
} from '../types';

// ──────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────

const KEYCHAIN_SERVICE = 'com.visp.auth';
const KEYCHAIN_TOKEN_KEY = 'auth_tokens';
const KEYCHAIN_USER_KEY = 'auth_user';

// ──────────────────────────────────────────────
// Secure Storage Helpers
// ──────────────────────────────────────────────

async function storeTokensSecurely(tokens: AuthTokens): Promise<void> {
  await Keychain.setGenericPassword(
    KEYCHAIN_TOKEN_KEY,
    JSON.stringify(tokens),
    {
      service: `${KEYCHAIN_SERVICE}.tokens`,
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    },
  );
  // Also set in-memory for the API client
  setTokens(tokens.accessToken, tokens.refreshToken);
}

async function storeUserSecurely(user: User): Promise<void> {
  await Keychain.setGenericPassword(
    KEYCHAIN_USER_KEY,
    JSON.stringify(user),
    {
      service: `${KEYCHAIN_SERVICE}.user`,
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    },
  );
}

async function getStoredTokens(): Promise<AuthTokens | null> {
  try {
    const credentials = await Keychain.getGenericPassword({
      service: `${KEYCHAIN_SERVICE}.tokens`,
    });
    if (credentials && credentials.password) {
      return JSON.parse(credentials.password) as AuthTokens;
    }
    return null;
  } catch {
    return null;
  }
}

async function getStoredUser(): Promise<User | null> {
  try {
    const credentials = await Keychain.getGenericPassword({
      service: `${KEYCHAIN_SERVICE}.user`,
    });
    if (credentials && credentials.password) {
      return JSON.parse(credentials.password) as User;
    }
    return null;
  } catch {
    return null;
  }
}

async function clearSecureStorage(): Promise<void> {
  await Keychain.resetGenericPassword({
    service: `${KEYCHAIN_SERVICE}.tokens`,
  });
  await Keychain.resetGenericPassword({
    service: `${KEYCHAIN_SERVICE}.user`,
  });
  clearTokens();
}

// ──────────────────────────────────────────────
// Auth API Methods
// ──────────────────────────────────────────────

/**
 * Authenticate with email and password.
 */
async function login(credentials: LoginCredentials): Promise<AuthResponse> {
  const response = await post<AuthResponse>('/auth/login', credentials);
  await storeTokensSecurely(response.tokens);
  await storeUserSecurely(response.user);
  return response;
}

/**
 * Register a new account.
 */
async function register(data: RegisterData): Promise<AuthResponse> {
  const response = await post<AuthResponse>('/auth/register', {
    ...data,
    termsVersion: Config.termsVersion,
    privacyVersion: Config.privacyVersion,
  });
  await storeTokensSecurely(response.tokens);
  await storeUserSecurely(response.user);
  return response;
}

/**
 * Sign in with Apple. The identity token is obtained from the native
 * Apple Sign-In module and exchanged for VISP auth tokens.
 */
async function loginWithApple(identityToken: string): Promise<AuthResponse> {
  const response = await post<AuthResponse>('/auth/apple', {
    identityToken,
  });
  await storeTokensSecurely(response.tokens);
  await storeUserSecurely(response.user);
  return response;
}

/**
 * Sign in with Google. The server-auth-code is obtained from the Google
 * Sign-In SDK and exchanged for VISP auth tokens.
 */
async function loginWithGoogle(serverAuthCode: string): Promise<AuthResponse> {
  const response = await post<AuthResponse>('/auth/google', {
    serverAuthCode,
  });
  await storeTokensSecurely(response.tokens);
  await storeUserSecurely(response.user);
  return response;
}

/**
 * Sign in with phone number via OTP. Two-step flow:
 * 1. requestPhoneOtp() sends the code
 * 2. loginWithPhone() verifies it
 */
async function requestPhoneOtp(phone: string): Promise<void> {
  await post<void>('/auth/phone/request-otp', { phone });
}

async function loginWithPhone(
  phone: string,
  otpCode: string,
): Promise<AuthResponse> {
  const response = await post<AuthResponse>('/auth/phone/verify', {
    phone,
    otpCode,
  });
  await storeTokensSecurely(response.tokens);
  await storeUserSecurely(response.user);
  return response;
}

/**
 * Send a password-reset email.
 */
async function forgotPassword(email: string): Promise<void> {
  await post<void>('/auth/forgot-password', { email });
}

/**
 * Manually refresh the access token.
 */
async function refreshToken(): Promise<AuthTokens> {
  const tokens = await getStoredTokens();
  if (!tokens?.refreshToken) {
    throw new Error('No refresh token available');
  }

  const response = await apiClient.post<{ data: { tokens: AuthTokens } }>(
    '/auth/refresh',
    { refreshToken: tokens.refreshToken },
  );

  const newTokens = response.data.data.tokens;
  await storeTokensSecurely(newTokens);
  return newTokens;
}

/**
 * Fetch the current authenticated user profile from the server.
 */
async function fetchCurrentUser(): Promise<User> {
  const response = await apiClient.get<{ data: User }>('/auth/me');
  const user = response.data.data;
  await storeUserSecurely(user);
  return user;
}

/**
 * Log out: clear local tokens and notify the server.
 */
async function logout(): Promise<void> {
  try {
    await post<void>('/auth/logout', {});
  } catch {
    // Server-side logout is best-effort; we always clear local state
  }
  await clearSecureStorage();
}

/**
 * Attempt to restore a previously authenticated session from keychain.
 * Returns the stored user and tokens if valid, or null if no session exists.
 */
async function loadStoredAuth(): Promise<{
  user: User;
  tokens: AuthTokens;
} | null> {
  const [tokens, user] = await Promise.all([
    getStoredTokens(),
    getStoredUser(),
  ]);

  if (!tokens || !user) {
    await clearSecureStorage();
    return null;
  }

  // Check if token is expired or about to expire
  const now = Date.now();
  if (tokens.expiresAt <= now + Config.tokenRefreshThresholdMs) {
    try {
      const newTokens = await refreshToken();
      return { user, tokens: newTokens };
    } catch {
      await clearSecureStorage();
      return null;
    }
  }

  // Set tokens in memory for the API client
  setTokens(tokens.accessToken, tokens.refreshToken);
  return { user, tokens };
}

// ──────────────────────────────────────────────
// Export
// ──────────────────────────────────────────────

export const authService = {
  login,
  register,
  loginWithApple,
  loginWithGoogle,
  requestPhoneOtp,
  loginWithPhone,
  forgotPassword,
  refreshToken,
  fetchCurrentUser,
  logout,
  loadStoredAuth,
  getStoredTokens,
  getStoredUser,
  clearSecureStorage,
};

export default authService;
