/**
 * VISP - Push Notification Service (Expo Go)
 *
 * Uses expo-notifications + expo-device for push notifications.
 * Physical device required for push tokens; gracefully degrades on simulator.
 */

import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { post } from './apiClient';

// ──────────────────────────────────────────────
// Configure notification behavior
// ──────────────────────────────────────────────

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

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
let _notificationSubscription: Notifications.EventSubscription | null = null;
let _responseSubscription: Notifications.EventSubscription | null = null;

// ──────────────────────────────────────────────
// Permission
// ──────────────────────────────────────────────

async function requestPermission(): Promise<boolean> {
  try {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      console.warn('[Notifications] Permission not granted');
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[Notifications] Permission request failed:', err);
    return false;
  }
}

// ──────────────────────────────────────────────
// Device Token Registration
// ──────────────────────────────────────────────

async function registerDevice(): Promise<void> {
  if (!Device.isDevice) {
    console.log('[Notifications] Push tokens require a physical device');
    return;
  }

  try {
    const tokenData = await Notifications.getExpoPushTokenAsync();
    const token = tokenData.data;
    _currentToken = token;
    console.log('[Notifications] Expo push token:', token.substring(0, 30) + '...');

    try {
      await post('/notifications/register-device', {
        device_token: token,
        platform: Platform.OS,
        token_type: 'expo',
        app_version: '1.0.0',
      });
      console.log('[Notifications] Device registered with backend');
    } catch (error) {
      console.warn('[Notifications] Failed to register device:', error);
    }
  } catch (error) {
    console.warn('[Notifications] Failed to get push token:', error);
  }
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

function _handleNotificationResponse(response: Notifications.NotificationResponse): void {
  const data = response.notification.request.content.data as NotificationData | undefined;

  console.log(
    '[Notifications] User tapped notification:',
    response.notification.request.content.title,
  );

  if (data?.type && _onNotificationNavigation) {
    _onNotificationNavigation(data);
  }
}

// ──────────────────────────────────────────────
// Listener Setup
// ──────────────────────────────────────────────

function setupListeners(): void {
  // Foreground notification received
  _notificationSubscription = Notifications.addNotificationReceivedListener(
    (notification) => {
      console.log('[Notifications] Received in foreground:', notification.request.content.title);
    },
  );

  // User tapped on notification
  _responseSubscription = Notifications.addNotificationResponseReceivedListener(
    _handleNotificationResponse,
  );

  // Check if app was opened via notification
  Notifications.getLastNotificationResponseAsync().then((response) => {
    if (response) {
      _handleNotificationResponse(response);
    }
  });

  console.log('[Notifications] Listeners set up');
}

function teardownListeners(): void {
  if (_notificationSubscription) {
    _notificationSubscription.remove();
    _notificationSubscription = null;
  }
  if (_responseSubscription) {
    _responseSubscription.remove();
    _responseSubscription = null;
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

  const hasPermission = await requestPermission();
  if (!hasPermission) {
    console.warn('[Notifications] No permission, skipping initialization');
    return;
  }

  // Configure Android channel
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Default',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#4A90E2',
    });
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
  // Expo handles background notifications automatically
}

async function setBadgeCount(count: number): Promise<void> {
  await Notifications.setBadgeCountAsync(count);
}

async function clearBadge(): Promise<void> {
  await Notifications.setBadgeCountAsync(0);
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
