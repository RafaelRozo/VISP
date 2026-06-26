/**
 * Business auth store — standard-user session for "VISP for Business".
 *
 * Kept fully isolated from the admin `authStore` (different localStorage
 * keys, different axios instance) so an admin-console session and a
 * business-owner session never overwrite each other.
 */
import { create } from 'zustand';
import { businessService, BizUser } from '@/services/businessService';
import {
  clearBizTokens,
  getBizAccessToken,
  setBizTokens,
} from '@/services/businessApi';

interface BusinessState {
  user: BizUser | null;
  isAuthenticated: boolean;
  isHydrating: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  register: (body: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    phone?: string;
  }) => Promise<void>;
  logout: () => void;
  hydrate: () => Promise<void>;
  clearError: () => void;
}

function extractError(err: any, fallback: string): string {
  const detail = err?.response?.data?.detail ?? err?.message ?? fallback;
  if (typeof detail === 'string') return detail;
  // FastAPI validation errors come back as an array of {msg, loc}
  if (Array.isArray(detail) && detail.length > 0 && detail[0]?.msg) {
    return detail.map((d: any) => d.msg).join(' · ');
  }
  return fallback;
}

export const useBusinessStore = create<BusinessState>((set) => ({
  user: null,
  isAuthenticated: false,
  isHydrating: true,
  error: null,

  login: async (email, password) => {
    set({ error: null });
    try {
      const res = await businessService.login(email, password);
      setBizTokens(res.tokens.accessToken, res.tokens.refreshToken);
      set({ user: res.user, isAuthenticated: true });
    } catch (err: any) {
      set({ error: extractError(err, 'Could not sign in. Check your credentials.') });
      throw err;
    }
  },

  register: async (body) => {
    set({ error: null });
    try {
      const res = await businessService.register({ ...body, role: 'provider' });
      setBizTokens(res.tokens.accessToken, res.tokens.refreshToken);
      set({ user: res.user, isAuthenticated: true });
    } catch (err: any) {
      set({ error: extractError(err, 'Could not create the account.') });
      throw err;
    }
  },

  logout: () => {
    clearBizTokens();
    set({ user: null, isAuthenticated: false });
  },

  hydrate: async () => {
    const token = getBizAccessToken();
    if (!token) {
      set({ isHydrating: false });
      return;
    }
    try {
      const { user } = await businessService.me();
      set({ user, isAuthenticated: true, isHydrating: false });
    } catch {
      clearBizTokens();
      set({ user: null, isAuthenticated: false, isHydrating: false });
    }
  },

  clearError: () => set({ error: null }),
}));
