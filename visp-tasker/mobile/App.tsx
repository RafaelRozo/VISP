/**
 * VISP/Tasker - Root Application Component
 *
 * Wraps the app in required providers (GestureHandler, SafeArea).
 * Navigation container is handled inside AppNavigator, so we do NOT
 * wrap with NavigationContainer here to avoid double-wrapping.
 */

import React, {useEffect} from 'react';
import {StatusBar, LogBox, StyleSheet} from 'react-native';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {GestureHandlerRootView} from 'react-native-gesture-handler';
import AppNavigator from './src/navigation/AppNavigator';
import {Colors} from './src/theme/colors';
import {useAuthStore} from './src/stores/authStore';

// Suppress non-critical serialization warnings in development
LogBox.ignoreLogs([
  'Non-serializable values were found in the navigation state',
]);

export default function App(): React.JSX.Element {
  const loadStoredAuth = useAuthStore(state => state.loadStoredAuth);

  useEffect(() => {
    // Attempt to restore user session from secure keychain on launch
    loadStoredAuth();
  }, [loadStoredAuth]);

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <StatusBar
          barStyle="light-content"
          backgroundColor={Colors.background}
          translucent={false}
        />
        <AppNavigator />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.background,
  },
});
