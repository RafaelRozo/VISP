/**
 * VISP/Tasker - Push Notification Service
 *
 * Manages FCM token lifecycle, permission requests, foreground/background
 * notification handling, and deep-link navigation on notification tap.
 *
 * Uses @react-native-firebase/messaging for FCM integration and the
 * backend /notifications/* API for device registration.
 */

import { Platform, Alert } from 'react-native';
import messaging, {
    FirebaseMessagingTypes,
} from '@react-native-firebase/messaging';
import { post } from './apiClient';

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

export type NotificationData = {
    type?: string;
    job_id?: string;
    sender_name?: string;
    [key: string]: string | undefined;
};

type UnsubscribeFn = () => void;

// ──────────────────────────────────────────────
// State
// ──────────────────────────────────────────────

let _listeners: UnsubscribeFn[] = [];
let _currentToken: string | null = null;

// Navigation callback - set by the app to handle notification taps
let _onNotificationNavigation: ((data: NotificationData) => void) | null = null;

// ──────────────────────────────────────────────
// Permission
// ──────────────────────────────────────────────

/**
 * Request push notification permission from the user (iOS).
 * On Android, this is automatically granted.
 *
 * @returns true if permission was granted
 */
async function requestPermission(): Promise<boolean> {
    if (Platform.OS === 'ios') {
        const authStatus = await messaging().requestPermission();
        const enabled =
            authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
            authStatus === messaging.AuthorizationStatus.PROVISIONAL;

        if (!enabled) {
            console.warn('[Notifications] Permission not granted');
        }
        return enabled;
    }
    // Android: permission auto-granted for FCM
    return true;
}

// ──────────────────────────────────────────────
// Device Token Registration
// ──────────────────────────────────────────────

/**
 * Get FCM token and register it with the backend.
 * Call this after the user has successfully logged in.
 */
async function registerDevice(): Promise<void> {
    try {
        const token = await messaging().getToken();
        if (!token) {
            console.warn('[Notifications] Could not get FCM token');
            return;
        }

        _currentToken = token;

        await post('/notifications/register-device', {
            device_token: token,
            platform: Platform.OS === 'ios' ? 'ios' : 'android',
            app_version: '1.0.0',
        });

        console.log('[Notifications] Device registered with token:', token.substring(0, 20) + '...');
    } catch (error) {
        // Non-blocking: notification registration failure should not
        // prevent the user from using the app
        console.warn('[Notifications] Failed to register device:', error);
    }
}

/**
 * Unregister the current device token from the backend.
 * Call this when the user logs out.
 */
async function unregisterDevice(): Promise<void> {
    if (!_currentToken) {
        return;
    }

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

/**
 * Handle a notification received while the app is in the foreground.
 * Shows an in-app alert since the system banner may not appear on all devices.
 */
function _handleForegroundMessage(
    remoteMessage: FirebaseMessagingTypes.RemoteMessage,
): void {
    const { notification, data } = remoteMessage;

    console.log(
        '[Notifications] Foreground message:',
        notification?.title,
        data?.type,
    );

    // The iOS native layer (AppDelegate.mm) already shows the banner.
    // Optionally show an in-app alert for important notifications:
    if (notification?.title && data?.type !== 'chat_message') {
        // Chat messages are handled by the chat screen's WebSocket listener,
        // so we skip the alert for those when in-app.
        // Other notification types get a subtle foreground alert.
    }
}

/**
 * Handle notification tap — user tapped a notification from the system tray.
 * Routes the user to the appropriate screen based on notification data.
 */
function _handleNotificationTap(
    remoteMessage: FirebaseMessagingTypes.RemoteMessage | null,
): void {
    if (!remoteMessage?.data) {
        return;
    }

    const data = remoteMessage.data as NotificationData;
    console.log('[Notifications] Notification tapped:', data.type, data.job_id);

    if (_onNotificationNavigation) {
        _onNotificationNavigation(data);
    }
}

// ──────────────────────────────────────────────
// Listener Setup
// ──────────────────────────────────────────────

/**
 * Set up all notification listeners.
 * Call this once after login and permission is granted.
 */
function setupListeners(): void {
    // Clean up any existing listeners
    teardownListeners();

    // 1. Foreground messages
    const unsubForeground = messaging().onMessage(_handleForegroundMessage);
    _listeners.push(unsubForeground);

    // 2. Notification tap when app is in background (not killed)
    const unsubBackground = messaging().onNotificationOpenedApp(
        _handleNotificationTap,
    );
    _listeners.push(unsubBackground);

    // 3. Notification tap that launched the app (app was killed)
    messaging()
        .getInitialNotification()
        .then(_handleNotificationTap)
        .catch(console.warn);

    // 4. Token refresh — re-register with backend when FCM rotates the token
    const unsubTokenRefresh = messaging().onTokenRefresh(async (newToken) => {
        console.log('[Notifications] Token refreshed, re-registering...');
        _currentToken = newToken;
        try {
            await post('/notifications/register-device', {
                device_token: newToken,
                platform: Platform.OS === 'ios' ? 'ios' : 'android',
                app_version: '1.0.0',
            });
        } catch (error) {
            console.warn('[Notifications] Failed to re-register on token refresh:', error);
        }
    });
    _listeners.push(unsubTokenRefresh);

    console.log('[Notifications] Listeners set up');
}

/**
 * Remove all notification listeners.
 * Call this on logout.
 */
function teardownListeners(): void {
    _listeners.forEach((unsub) => unsub());
    _listeners = [];
}

// ──────────────────────────────────────────────
// Navigation Hook
// ──────────────────────────────────────────────

/**
 * Set the callback that handles navigation when a notification is tapped.
 * This should be called from the root navigator once navigation is ready.
 *
 * @param handler - receives notification data with `type` and `job_id`
 */
function setNavigationHandler(
    handler: (data: NotificationData) => void,
): void {
    _onNotificationNavigation = handler;
}

// ──────────────────────────────────────────────
// Lifecycle — called by authStore
// ──────────────────────────────────────────────

/**
 * Initialize notifications after successful login.
 * Requests permission, registers device, and sets up listeners.
 */
async function initialize(): Promise<void> {
    const hasPermission = await requestPermission();
    if (!hasPermission) {
        console.warn('[Notifications] No permission, skipping initialization');
        return;
    }

    await registerDevice();
    setupListeners();
}

/**
 * Clean up notifications on logout.
 * Unregisters device and removes all listeners.
 */
async function cleanup(): Promise<void> {
    teardownListeners();
    await unregisterDevice();
}

// ──────────────────────────────────────────────
// Background handler (must be called at module level, outside components)
// ──────────────────────────────────────────────

/**
 * Register the background message handler.
 * This MUST be called at the top level (e.g., index.js) before AppRegistry.
 */
function registerBackgroundHandler(): void {
    messaging().setBackgroundMessageHandler(async (remoteMessage) => {
        console.log(
            '[Notifications] Background message:',
            remoteMessage.notification?.title,
            remoteMessage.data?.type,
        );
        // Background messages are handled by the system notification tray.
        // No custom processing needed — the notification is automatically shown.
    });
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
};

export default notificationService;
