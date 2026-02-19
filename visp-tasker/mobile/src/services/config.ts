/**
 * VISP - Application Configuration
 *
 * Environment-specific configuration values.
 * In production, these would be sourced from react-native-config or similar.
 *
 * Required environment variables (set in .env file):
 *   MAPBOX_ACCESS_TOKEN - Mapbox public access token
 */
import RNConfig from 'react-native-config';

const MAPBOX_TOKEN = RNConfig.MAPBOX_ACCESS_TOKEN ?? process.env.MAPBOX_ACCESS_TOKEN ?? '';

interface AppConfig {
  apiBaseUrl: string;
  wsBaseUrl: string;
  googleMapsApiKey: string;
  mapboxAccessToken: string;
  stripePublishableKey: string;
  termsVersion: string;
  privacyVersion: string;
  appStoreUrl: string;
  supportEmail: string;
  minPasswordLength: number;
  tokenRefreshThresholdMs: number;
}

const DEV_CONFIG: AppConfig = {
  apiBaseUrl: 'http://localhost:305/api/v1',
  wsBaseUrl: 'ws://localhost:305',
  googleMapsApiKey: '',
  mapboxAccessToken: MAPBOX_TOKEN,
  stripePublishableKey: '',
  termsVersion: '2026-01-01',
  privacyVersion: '2026-01-01',
  appStoreUrl: 'https://apps.apple.com/app/visp/id000000000',
  supportEmail: 'support@vispapp.com',
  minPasswordLength: 8,
  tokenRefreshThresholdMs: 5 * 60 * 1000, // 5 minutes before expiry
};

const STAGING_CONFIG: AppConfig = {
  ...DEV_CONFIG,
  apiBaseUrl: 'https://api.richieyanez.com/api/v1',
  wsBaseUrl: 'wss://api.richieyanez.com',
};

const PROD_CONFIG: AppConfig = {
  ...DEV_CONFIG,
  apiBaseUrl: 'https://api.richieyanez.com/api/v1',
  wsBaseUrl: 'wss://api.richieyanez.com',
};

function getConfig(): AppConfig {
  // In a real setup, __DEV__ is provided by React Native
  // and environment could come from react-native-config
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    return DEV_CONFIG;
  }
  // Default to production for non-dev builds
  return PROD_CONFIG;
}

export const Config = getConfig();

export { STAGING_CONFIG, PROD_CONFIG, DEV_CONFIG };
export type { AppConfig };
