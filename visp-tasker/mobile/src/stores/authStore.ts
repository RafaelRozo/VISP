/**
 * VISP - Auth Zustand Store
 *
 * Global authentication state: user session, tokens, loading flags.
 * Hydrates from secure keychain on app launch via loadStoredAuth().
 */

import { create } from 'zustand';
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

  // ── Actions ──────────────────────────────
  login: (credentials: LoginCredentials) => Promise<void>;
  register: (data: RegisterData) => Promise<void>;
  loginWithApple: (identityToken: string) => Promise<void>;
  loginWithGoogle: (serverAuthCode: string) => Promise<void>;
  forgotPassword: (email: string) => Promise<void>;
  logout: () => Promise<void>;
  loadStoredAuth: () => Promise<void>;
  demoLogin: (role: UserRole) => void;
  setUser: (user: User) => void;
  clearError: () => void;
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function applyAuthResponse(
  set: (partial: Partial<AuthState>) => void,
  response: AuthResponse,
): void {
  set({
    user: response.user,
    token: response.tokens.accessToken,
    isAuthenticated: true,
    isLoading: false,
    error: null,
  });
}

function extractErrorMessage(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) {
    return (err as { message: string }).message;
  }
  return 'An unexpected error occurred. Please try again.';
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
    register: async (data: RegisterData) => {
      set({ isLoading: true, error: null });
      try {
        const response = await authService.register(data);
        applyAuthResponse(set, response);
      } catch (err) {
        set({
          isLoading: false,
          error: extractErrorMessage(err),
        });
        throw err;
      }
    },

    // ── Apple Sign In ──────────────────────
    loginWithApple: async (identityToken: string) => {
      set({ isLoading: true, error: null });
      try {
        const response = await authService.loginWithApple(identityToken);
        applyAuthResponse(set, response);
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
        const stored = await authService.loadStoredAuth();
        if (stored) {
          set({
            user: stored.user,
            token: stored.tokens.accessToken,
            isAuthenticated: true,
            isRestoring: false,
            error: null,
          });
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
      const demoUser: User = {
        id: role === 'customer' ? 'demo-customer-001' : 'demo-provider-001',
        email: role === 'customer' ? 'jane@demo.com' : 'mike@demo.com',
        phone: null,
        firstName: role === 'customer' ? 'Jane' : 'Mike',
        lastName: role === 'customer' ? 'Smith' : 'Johnson',
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
      });
    },

    // ── Set User (manual update) ───────────
    setUser: (user: User) => {
      set({ user });
    },

    // ── Clear Error ────────────────────────
    clearError: () => {
      set({ error: null });
    },
  };
});

export default useAuthStore;
