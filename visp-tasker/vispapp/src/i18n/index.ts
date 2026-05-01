/**
 * VISP - Internationalization (i18n)
 *
 * Uses i18n-js for EN/FR translations.
 * Language is synced from appStore (persisted via AsyncStorage).
 */

import { I18n } from 'i18n-js';
import en from './en.json';
import fr from './fr.json';
import { useAppStore } from '../stores/appStore';

const i18n = new I18n({ en, fr });
i18n.defaultLocale = 'en';
i18n.locale = 'en';
i18n.enableFallback = true;

/**
 * Translate a key. Supports interpolation: t('hello', { name: 'John' })
 */
export function t(key: string, options?: Record<string, any>): string {
  // Sync locale from store on every call
  const lang = useAppStore.getState().language;
  if (i18n.locale !== lang) {
    i18n.locale = lang;
  }
  return i18n.t(key, options);
}

/**
 * React hook that returns a translate function.
 * Re-renders the component when language changes.
 */
export function useTranslation() {
  const language = useAppStore((s) => s.language);

  // Keep i18n in sync
  if (i18n.locale !== language) {
    i18n.locale = language;
  }

  return {
    t: (key: string, options?: Record<string, any>) => i18n.t(key, options),
    language,
  };
}

export default i18n;
