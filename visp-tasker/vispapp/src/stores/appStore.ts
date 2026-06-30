/**
 * VISP - App Settings Store (Zustand)
 *
 * Global app preferences: language, dark mode.
 * Persisted via AsyncStorage.
 */

import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

type Language = 'en' | 'fr';

interface AppState {
  language: Language;
  darkMode: boolean;
  setLanguage: (lang: Language) => void;
  setDarkMode: (enabled: boolean) => void;
  loadSettings: () => Promise<void>;
}

const STORAGE_KEY = '@visp_app_settings';

export const useAppStore = create<AppState>((set, get) => ({
  language: 'en',
  darkMode: true,

  setLanguage: (lang: Language) => {
    set({ language: lang });
    _persist(get());
  },

  setDarkMode: (enabled: boolean) => {
    set({ darkMode: enabled });
    _persist(get());
  },

  loadSettings: async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        set({
          language: parsed.language ?? 'en',
          darkMode: parsed.darkMode ?? true,
        });
      }
    } catch {
      // Use defaults
    }
  },
}));

async function _persist(state: AppState) {
  try {
    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ language: state.language, darkMode: state.darkMode }),
    );
  } catch {
    // Silent fail
  }
}
