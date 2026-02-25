/**
 * VISP - Push Notification Service (Native APNs)
 *
 * Uses @react-native-community/push-notification-ios for native APNs
 * integration — no Firebase dependency required.
 *
 * Gracefully degrades if the native module is unavailable (e.g., simulator
 * or app running without a native rebuild).
 */

import { Platform, NativeModules } from 'react-native';
import { post } from './apiClient';

// ──────────────────────────────────────────────
// Safe PushNotificationIOS import
// ──────────────────────────────────────────────

// Lazy-load to avoid crash if native module isn't linked yet
let PushNotificationIOS: any = null;

function getPushModule(): any {
  if (PushNotificationIOS) return PushNotificationIOS;

  try {
    // Check if the native module exists before importing
    if (!NativeModules.RNCPushNotificationIOS) {
      console.warn('[Notifications] Native push module not available — rebuild required');
      return null;
    }
    PushNotificationIOS = require('@react-native-community/push-notification-ios').default;
    return PushNotificationIOS;
  } catch (e) {
    console.warn('[Notifications] Failed to load push module:', e);
    return null;
  }
}

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

export type NotificationData = {
  type?: string;
  job_id?: string;
  sender_name?: string;
  [key: string]: string | undefined;
};

// ──────────────────────────────────────────────
// State
// ──────────────────────────────────────────────

let _currentToken: string | null = null;
let _isInitialized = false;
let _onNotificationNavigation: ((data: NotificationData) => void) | null = null;

// ──────────────────────────────────────────────
// Permission
// ──────────────────────────────────────────────

async function requestPermission(): Promise<boolean> {
  const PushModule = getPushModule();
  if (!PushModule) return false;

  try {
    const permissions = await PushModule.requestPermissions({
      alert: true,
      badge: true,
      sound: true,
    });
    const granted = permissions.alert || permissions.badge || permissions.sound;
    if (!granted) {
      console.warn('[Notifications] Permission not granted');
    }
    return granted;
  } catch (err) {
    console.warn('[Notifications] Permission request failed:', err);
    return false;
  }
}

// ──────────────────────────────────────────────
// Device Token Registration
// ──────────────────────────────────────────────

async function registerDevice(): Promise<void> {
  const PushModule = getPushModule();
  if (!PushModule) return;

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      console.warn('[Notifications] Token registration timed out');
      resolve();
    }, 10000);

    PushModule.addEventListener('register', async (deviceToken: string) => {
      clearTimeout(timeout);
      _currentToken = deviceToken;
      console.log('[Notifications] APNs token:', deviceToken.substring(0, 20) + '...');

      try {
        await post('/notifications/register-device', {
          device_token: deviceToken,
          platform: 'ios',
          token_type: 'apns',
          app_version: '1.0.0',
        });
        console.log('[Notifications] Device registered with backend');
      } catch (error) {
        console.warn('[Notifications] Failed to register device:', error);
      }
      resolve();
    });

    PushModule.addEventListener('registrationError', (error: any) => {
      clearTimeout(timeout);
      console.warn('[Notifications] APNs registration failed:', error);
      resolve();
    });

    // Trigger APNs registration
    PushModule.requestPermissions({
      alert: true,
      badge: true,
      sound: true,
    }).catch(() => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

async function unregisterDevice(): Promise<void> {
  if (!_currentToken) return;

  try {
    await post('/notifications/unregister-device', {
      device_token: _currentToken,
    });
    console.log('[Notifications] Device unregistered');
  } catch (error) {
    console.warn('[Notifications] Failed to unregister device:', error);
  } finally {
    _currentToken = null;
  }
}

// ──────────────────────────────────────────────
// Notification Handlers
// ──────────────────────────────────────────────

function _handleNotification(notification: any): void {
  const data = notification?.getData?.() ?? {};
  const isUserInteraction = data.userInteraction === true;

  console.log(
    '[Notifications] Received:',
    notification?.getTitle?.(),
    'interaction:', isUserInteraction,
  );

  if (isUserInteraction && _onNotificationNavigation && data.type) {
    _onNotificationNavigation(data as NotificationData);
  }

  // Signal iOS that we finished processing
  const PushModule = getPushModule();
  if (PushModule) {
    notification?.finish?.(PushModule.FetchResult?.NewData);
  }
}

// ──────────────────────────────────────────────
// Listener Setup
// ──────────────────────────────────────────────

function setupListeners(): void {
  const PushModule = getPushModule();
  if (!PushModule) return;

  PushModule.addEventListener('notification', _handleNotification);
  PushModule.addEventListener('localNotification', _handleNotification);

  PushModule.getInitialNotification().then((notification: any) => {
    if (notification) {
      _handleNotification(notification);
    }
  });

  console.log('[Notifications] Listeners set up');
}

function teardownListeners(): void {
  const PushModule = getPushModule();
  if (!PushModule) return;

  try {
    PushModule.removeEventListener('notification');
    PushModule.removeEventListener('localNotification');
    PushModule.removeEventListener('register');
    PushModule.removeEventListener('registrationError');
  } catch {
    // Ignore if listeners weren't set up
  }
}

// ──────────────────────────────────────────────
// Navigation Hook
// ──────────────────────────────────────────────

function setNavigationHandler(
  handler: (data: NotificationData) => void,
): void {
  _onNotificationNavigation = handler;
}

// ──────────────────────────────────────────────
// Lifecycle
// ──────────────────────────────────────────────

async function initialize(): Promise<void> {
  if (_isInitialized) return;
  if (Platform.OS !== 'ios') return;

  const PushModule = getPushModule();
  if (!PushModule) {
    console.log('[Notifications] Native module not available, skipping');
    return;
  }

  const hasPermission = await requestPermission();
  if (!hasPermission) {
    console.warn('[Notifications] No permission, skipping initialization');
    return;
  }

  await registerDevice();
  setupListeners();
  _isInitialized = true;
}

async function cleanup(): Promise<void> {
  teardownListeners();
  await unregisterDevice();
  _isInitialized = false;
}

function registerBackgroundHandler(): void {
  // Native APNs background notifications are handled by AppDelegate.
}

function setBadgeCount(count: number): void {
  getPushModule()?.setApplicationIconBadgeNumber(count);
}

function clearBadge(): void {
  getPushModule()?.setApplicationIconBadgeNumber(0);
}

// ──────────────────────────────────────────────
// Export
// ──────────────────────────────────────────────

export const notificationService = {
  requestPermission,
  registerDevice,
  unregisterDevice,
  initialize,
  cleanup,
  setupListeners,
  teardownListeners,
  setNavigationHandler,
  registerBackgroundHandler,
  setBadgeCount,
  clearBadge,
};

export default notificationService;
