/**
 * VISP - Root Application Component (Expo Go)
 *
 * Wraps the app in required providers (GestureHandler, SafeArea, Stripe).
 * Navigation container is handled inside AppNavigator, so we do NOT
 * wrap with NavigationContainer here to avoid double-wrapping.
 */

import React, {useEffect} from 'react';
import {StatusBar, LogBox, StyleSheet, View} from 'react-native';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {GestureHandlerRootView} from 'react-native-gesture-handler';
import {StripeProvider} from '@stripe/stripe-react-native';
import {useFonts as useManrope, Manrope_500Medium, Manrope_600SemiBold, Manrope_700Bold} from '@expo-google-fonts/manrope';
import {JetBrainsMono_500Medium} from '@expo-google-fonts/jetbrains-mono';
import AppNavigator from './src/navigation/AppNavigator';
import {Colors} from './src/theme/colors';
import {Config} from './src/services/config';
import {useAuthStore} from './src/stores/authStore';
import {useAppStore} from './src/stores/appStore';
import {ThemeProvider} from './src/theme/ThemeContext';

// Suppress non-critical serialization warnings in development
LogBox.ignoreLogs([
  'Non-serializable values were found in the navigation state',
  '@firebase/auth:', // Ignore React Native AsyncStorage warning for Firebase
  'Setting a timer', // Ignored long timer warning standard in RN Firebase apps
]);

export default function App(): React.JSX.Element {
  const loadStoredAuth = useAuthStore(state => state.loadStoredAuth);
  const loadSettings = useAppStore(state => state.loadSettings);
  const darkMode = useAppStore(state => state.darkMode);

  const [fontsLoaded] = useManrope({
    Manrope_500Medium,
    Manrope_600SemiBold,
    Manrope_700Bold,
    JetBrainsMono_500Medium,
  });

  useEffect(() => {
    loadStoredAuth();
    loadSettings();
  }, [loadStoredAuth, loadSettings]);

  // Hold render until fonts are ready so first paint has correct typography.
  if (!fontsLoaded) {
    return <View style={[styles.root, { backgroundColor: darkMode ? Colors.background : '#F2F4F8' }]} />;
  }

  return (
    <GestureHandlerRootView style={[styles.root, { backgroundColor: darkMode ? Colors.background : '#F2F4F8' }]}>
      <ThemeProvider>
        <StripeProvider
          publishableKey={Config.stripePublishableKey}
          merchantIdentifier="merchant.com.visp.tasker"
        >
          <SafeAreaProvider>
            <StatusBar
              barStyle={darkMode ? 'light-content' : 'dark-content'}
              backgroundColor={darkMode ? Colors.background : '#F2F4F8'}
              translucent={false}
            />
            <AppNavigator />
          </SafeAreaProvider>
        </StripeProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.background,
  },
});
