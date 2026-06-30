/**
 * VISP - Auth Zustand Store
 *
 * Global authentication state: user session, tokens, loading flags.
 * Hydrates from secure keychain on app launch via loadStoredAuth().
 */

import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { setOnTokenRefreshFailed } from '../services/apiClient';
import { authService } from '../services/authService';
import { notificationService } from '../services/notificationService';
import type {
  AuthResponse,
  LoginCredentials,
  RegisterData,
  User,
  UserRole,
} from '../types';

export type ActiveMode = 'customer' | 'provider';
const ACTIVE_MODE_STORAGE_KEY = '@visp:activeMode';

function defaultModeForRole(role: UserRole): ActiveMode {
  // 'both' users default to customer mode until they switch
  return role === 'provider' ? 'provider' : 'customer';
}

// ──────────────────────────────────────────────
// State Shape
// ──────────────────────────────────────────────

interface AuthState {
  /** The currently authenticated user, or null if logged out. */
  user: User | null;

  /** The current access token (kept in sync with keychain). */
  token: string | null;

  /** True when user is fully authenticated and token is present. */
  isAuthenticated: boolean;

  /** True while any auth operation is in flight. */
  isLoading: boolean;

  /** True during initial session restoration from keychain. */
  isRestoring: boolean;

  /** Most recent auth error message, cleared on next action. */
  error: string | null;

  /**
   * For 'both' users, which side of the app is currently active.
   * For single-role users this mirrors their role.
   */
  activeMode: ActiveMode;

  /**
   * After a successful registration we hold the full auth response here
   * (instead of applying it immediately) so the screen can show the
   * recovery code modal before the navigator switches stacks. Call
   * `commitPendingRegistration()` once the user acknowledges the code.
   */
  pendingRegistration: AuthResponse | null;

  // ── Actions ──────────────────────────────
  login: (credentials: LoginCredentials) => Promise<void>;
  register: (data: RegisterData) => Promise<string | null>;
  commitPendingRegistration: () => void;
  loginWithApple: (identityToken: string) => Promise<void>;
  loginWithGoogle: (serverAuthCode: string) => Promise<void>;
  forgotPassword: (email: string) => Promise<void>;
  logout: () => Promise<void>;
  loadStoredAuth: () => Promise<void>;
  demoLogin: (role: UserRole) => void;
  setUser: (user: User) => void;
  setActiveMode: (mode: ActiveMode) => Promise<void>;
  clearError: () => void;
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function applyAuthResponse(
  set: (partial: Partial<AuthState>) => void,
  response: AuthResponse,
  storedMode: ActiveMode | null = null,
): void {
  const role = response.user.role;
  // Honor stored mode only if it's a valid choice for this user's role.
  const allowed: ActiveMode[] =
    role === 'both' ? ['customer', 'provider'] : [defaultModeForRole(role)];
  const mode: ActiveMode =
    storedMode && allowed.includes(storedMode)
      ? storedMode
      : defaultModeForRole(role);
  set({
    user: response.user,
    token: response.tokens.accessToken,
    isAuthenticated: true,
    isLoading: false,
    error: null,
    activeMode: mode,
  });
}

function extractErrorMessage(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) {
    return (err as { message: string }).message;
  }
  return 'An unexpected error occurred. Please try again.';
}

function extractStatusCode(err: unknown): number {
  if (err && typeof err === 'object' && 'statusCode' in err) {
    return (err as { statusCode: number }).statusCode;
  }
  return 0;
}

// ──────────────────────────────────────────────
// Store
// ──────────────────────────────────────────────

export const useAuthStore = create<AuthState>((set, get) => {
  // Wire up the API client callback so a failed token refresh
  // automatically logs the user out of the store.
  setOnTokenRefreshFailed(() => {
    set({
      user: null,
      token: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,
    });
  });

  return {
    // ── Initial State ──────────────────────
    user: null,
    token: null,
    isAuthenticated: false,
    isLoading: false,
    isRestoring: true,
    error: null,
    activeMode: 'customer',
    pendingRegistration: null,

    // ── Login ──────────────────────────────
    login: async (credentials: LoginCredentials) => {
      set({ isLoading: true, error: null });
      try {
        const response = await authService.login(credentials);
        applyAuthResponse(set, response);
        // Initialize push notifications after successful login
        notificationService.initialize().catch(console.warn);
      } catch (err) {
        set({
          isLoading: false,
          error: extractErrorMessage(err),
        });
        throw err;
      }
    },

    // ── Register ───────────────────────────
    register: async (data: RegisterData): Promise<string | null> => {
      set({ isLoading: true, error: null });
      try {
        const response = await authService.register(data);
        // Hold the response in pendingRegistration. The auth state is NOT
        // applied yet so the navigator stays on the auth stack while the
        // screen shows the recovery code modal. Once the user dismisses it,
        // commitPendingRegistration() applies the auth and the navigator
        // switches.
        set({ isLoading: false, pendingRegistration: response });
        return response.recoveryCode ?? null;
      } catch (err) {
        const statusCode = extractStatusCode(err);
        let errorMessage = extractErrorMessage(err);
        // Provide a user-friendly message for duplicate email/phone (409)
        if (statusCode === 409) {
          const detail = errorMessage.toLowerCase();
          if (detail.includes('phone')) {
            errorMessage = 'This phone number is already registered. Please use a different number or sign in.';
          } else if (detail.includes('email')) {
            errorMessage = 'This email is already registered. Please sign in with your existing account.';
          }
        }
        set({
          isLoading: false,
          error: errorMessage,
        });
        throw err;
      }
    },

    // ── Commit deferred registration ───────
    commitPendingRegistration: () => {
      const response = get().pendingRegistration;
      if (!response) return;
      applyAuthResponse(set, response);
      set({ pendingRegistration: null });
      notificationService.initialize().catch(console.warn);
    },

    // ── Apple Sign In ──────────────────────
    loginWithApple: async (identityToken: string) => {
      set({ isLoading: true, error: null });
      try {
        const response = await authService.loginWithApple(identityToken);
        applyAuthResponse(set, response);
        // Initialize push notifications after Apple sign-in
        notificationService.initialize().catch(console.warn);
      } catch (err) {
        set({
          isLoading: false,
          error: extractErrorMessage(err),
        });
        throw err;
      }
    },

    // ── Google Sign In ─────────────────────
    loginWithGoogle: async (serverAuthCode: string) => {
      set({ isLoading: true, error: null });
      try {
        const response = await authService.loginWithGoogle(serverAuthCode);
        applyAuthResponse(set, response);
        // Initialize push notifications after Google sign-in
        notificationService.initialize().catch(console.warn);
      } catch (err) {
        set({
          isLoading: false,
          error: extractErrorMessage(err),
        });
        throw err;
      }
    },

    // ── Forgot Password ────────────────────
    forgotPassword: async (email: string) => {
      set({ isLoading: true, error: null });
      try {
        await authService.forgotPassword(email);
        set({ isLoading: false });
      } catch (err) {
        set({
          isLoading: false,
          error: extractErrorMessage(err),
        });
        throw err;
      }
    },

    // ── Logout ─────────────────────────────
    logout: async () => {
      set({ isLoading: true });
      try {
        // Clean up push notifications before logging out
        await notificationService.cleanup();
        await authService.logout();
      } finally {
        set({
          user: null,
          token: null,
          isAuthenticated: false,
          isLoading: false,
          error: null,
        });
      }
    },

    // ── Restore Session from Keychain ──────
    loadStoredAuth: async () => {
      set({ isRestoring: true });
      try {
        const [stored, storedModeRaw] = await Promise.all([
          authService.loadStoredAuth(),
          AsyncStorage.getItem(ACTIVE_MODE_STORAGE_KEY).catch(() => null),
        ]);
        if (stored) {
          const role = stored.user.role;
          const allowed: ActiveMode[] =
            role === 'both' ? ['customer', 'provider'] : [defaultModeForRole(role)];
          const mode: ActiveMode =
            storedModeRaw && allowed.includes(storedModeRaw as ActiveMode)
              ? (storedModeRaw as ActiveMode)
              : defaultModeForRole(role);
          set({
            user: stored.user,
            token: stored.tokens.accessToken,
            isAuthenticated: true,
            isRestoring: false,
            error: null,
            activeMode: mode,
          });
          // Re-initialize push notifications on session restore
          notificationService.initialize().catch(console.warn);
        } else {
          set({
            user: null,
            token: null,
            isAuthenticated: false,
            isRestoring: false,
          });
        }
      } catch {
        set({
          user: null,
          token: null,
          isAuthenticated: false,
          isRestoring: false,
        });
      }
    },

    // ── Demo Login (MVP testing) ───────────
    demoLogin: (role: UserRole) => {
      const demoId =
        role === 'customer'
          ? 'demo-customer-001'
          : role === 'provider'
          ? 'demo-provider-001'
          : 'demo-both-001';
      const demoEmail =
        role === 'customer'
          ? 'jane@demo.com'
          : role === 'provider'
          ? 'mike@demo.com'
          : 'alex@demo.com';
      const demoFirst =
        role === 'customer' ? 'Jane' : role === 'provider' ? 'Mike' : 'Alex';
      const demoLast =
        role === 'customer' ? 'Smith' : role === 'provider' ? 'Johnson' : 'Garcia';
      const demoUser: User = {
        id: demoId,
        email: demoEmail,
        phone: null,
        firstName: demoFirst,
        lastName: demoLast,
        role,
        avatarUrl: null,
        isVerified: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      set({
        user: demoUser,
        token: 'demo-token',
        isAuthenticated: true,
        isLoading: false,
        isRestoring: false,
        error: null,
        activeMode: defaultModeForRole(role),
      });
    },

    // ── Set User (manual update) ───────────
    setUser: (user: User) => {
      set({ user });
    },

    // ── Set active mode (for 'both' users) ─
    setActiveMode: async (mode: ActiveMode) => {
      const role = get().user?.role;
      // No-op if user can't operate in that mode
      if (role && role !== 'both' && defaultModeForRole(role) !== mode) {
        return;
      }
      set({ activeMode: mode });
      try {
        await AsyncStorage.setItem(ACTIVE_MODE_STORAGE_KEY, mode);
      } catch {
        // best-effort persistence
      }
    },

    // ── Clear Error ────────────────────────
    clearError: () => {
      set({ error: null });
    },
  };
});

export default useAuthStore;
