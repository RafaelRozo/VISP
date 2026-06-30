import { create } from 'zustand';
import {
  AdminUser,
  adminService,
} from '@/services/adminService';
import {
  clearAdminTokens,
  getAdminAccessToken,
  setAdminTokens,
} from '@/services/apiClient';

interface AuthState {
  user: AdminUser | null;
  isAuthenticated: boolean;
  isHydrating: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  hydrate: () => Promise<void>;
  clearError: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  isHydrating: true,
  error: null,

  login: async (email, password) => {
    set({ error: null });
    try {
      const res = await adminService.login(email, password);
      setAdminTokens(res.tokens.accessToken, res.tokens.refreshToken);
      set({ user: res.user, isAuthenticated: true });
    } catch (err: any) {
      const detail =
        err?.response?.data?.detail ||
        err?.message ||
        'Could not sign in. Please check your credentials.';
      set({ error: typeof detail === 'string' ? detail : 'Sign-in failed.' });
      throw err;
    }
  },

  logout: () => {
    clearAdminTokens();
    set({ user: null, isAuthenticated: false });
  },

  hydrate: async () => {
    const token = getAdminAccessToken();
    if (!token) {
      set({ isHydrating: false });
      return;
    }
    try {
      const user = await adminService.me();
      set({ user, isAuthenticated: true, isHydrating: false });
    } catch {
      clearAdminTokens();
      set({ user: null, isAuthenticated: false, isHydrating: false });
    }
  },

  clearError: () => set({ error: null }),
}));
