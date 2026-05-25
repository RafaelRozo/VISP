/**
 * Admin app config.
 *
 * In dev points to local backend; production should set
 *   VITE_API_BASE_URL=https://api.richieyanez.com/api/v1
 * via .env.production or the hosting provider.
 */

const fromEnv = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '';
const mediaFromEnv = (import.meta.env.VITE_MEDIA_ORIGIN as string | undefined) ?? '';

const apiBaseUrl =
  fromEnv && fromEnv.length > 0 ? fromEnv : 'https://api.richieyanez.com/api/v1';

// `mediaOrigin` resolves relative upload paths (e.g. `/uploads/...`) for the
// browser. In dev the api base is relative (proxied by Vite), so we need an
// absolute origin to load images / PDFs from the backend. In prod the api
// base is absolute and we derive the origin from it.
function deriveMediaOrigin(): string {
  if (mediaFromEnv) return mediaFromEnv.replace(/\/$/, '');
  if (/^https?:\/\//.test(apiBaseUrl)) {
    try {
      return new URL(apiBaseUrl).origin;
    } catch {
      // fall through
    }
  }
  // Dev fallback: hit the same origin so the Vite proxy forwards `/uploads`.
  if (typeof window !== 'undefined') return window.location.origin;
  return 'https://api.richieyanez.com';
}

export const Config = {
  apiBaseUrl,
  mediaOrigin: deriveMediaOrigin(),
  appStoreUrl: 'https://apps.apple.com/app/tasker/id000000000',
};
