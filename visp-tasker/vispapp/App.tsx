/**
 * VISP - Root Application Component (Expo Go)
 *
 * Wraps the app in required providers (GestureHandler, SafeArea, Stripe).
 * Navigation container is handled inside AppNavigator, so we do NOT
 * wrap with NavigationContainer here to avoid double-wrapping.
 */

import React, {useEffect} from 'react';
import {StatusBar, LogBox, Platform, StyleSheet, View} from 'react-native';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {KeyboardProvider} from 'react-native-keyboard-controller';
import {GestureHandlerRootView} from 'react-native-gesture-handler';
import {StripeProvider} from '@stripe/stripe-react-native';
import {useFonts as useManrope, Manrope_500Medium, Manrope_600SemiBold, Manrope_700Bold} from '@expo-google-fonts/manrope';
import {JetBrainsMono_500Medium} from '@expo-google-fonts/jetbrains-mono';
import AppNavigator from './src/navigation/AppNavigator';
import {Colors} from './src/theme/colors';
import MapboxGL from '@rnmapbox/maps';
import {Config} from './src/services/config';
import {useAuthStore} from './src/stores/authStore';
import {useAppStore} from './src/stores/appStore';
import {ThemeProvider} from './src/theme/ThemeContext';
import {ActionSheetHost} from './src/components/ActionSheet';

// Suppress non-critical serialization warnings in development
LogBox.ignoreLogs([
  'Non-serializable values were found in the navigation state',
]);

// Mapbox manda telemetría anónima de uso y ubicación por defecto. Se apaga una
// vez aquí, antes de pintar ningún mapa: así la etiqueta de privacidad de la App
// Store no tiene que declarar "Location → Analytics" (ver
// docs/app-store-submission.md §3).
MapboxGL.setTelemetryEnabled(false);

// Teclado en Android con edge-to-edge: ver src/components/KeyboardAvoidingView.
// En iOS no se monta, así que su comportamiento no cambia. La app ya dibuja
// bajo las barras del sistema (edgeToEdgeEnabled), de ahí las tres props.
function KeyboardRoot({children}: {children: React.ReactNode}): React.JSX.Element {
  if (Platform.OS !== 'android') {
    return <>{children}</>;
  }
  return (
    <KeyboardProvider statusBarTranslucent navigationBarTranslucent preserveEdgeToEdge>
      {children}
    </KeyboardProvider>
  );
}

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
      <KeyboardRoot>
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
            <ActionSheetHost />
          </SafeAreaProvider>
        </StripeProvider>
      </ThemeProvider>
      </KeyboardRoot>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.background,
  },
});
