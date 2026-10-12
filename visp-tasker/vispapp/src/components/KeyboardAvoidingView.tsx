/**
 * KeyboardAvoidingView que funciona en Android con edge-to-edge.
 *
 * Con targetSdk 35+ Android dibuja la app de borde a borde y `adjustResize`
 * deja de encoger la ventana al abrir el teclado. El KeyboardAvoidingView de
 * React Native con `behavior={undefined}` (lo que tenían 10 pantallas en
 * Android) no hacía nada, y el teclado tapaba los campos.
 *
 * - iOS: el de React Native tal cual, con las mismas props. Nada cambia.
 * - Android: el de react-native-keyboard-controller, que lee los insets reales
 *   del teclado. Siempre `padding`: el `height` que pasaban algunas pantallas
 *   era para el viejo `adjustResize` y aquí duplicaría el hueco.
 *
 * Necesita <KeyboardProvider> en la raíz (App.tsx, solo Android).
 */

import React from 'react';
import {
  KeyboardAvoidingView as RNKeyboardAvoidingView,
  KeyboardAvoidingViewProps,
  Platform,
} from 'react-native';
import {KeyboardAvoidingView as KCKeyboardAvoidingView} from 'react-native-keyboard-controller';

export default function KeyboardAvoidingView({
  behavior,
  ...rest
}: KeyboardAvoidingViewProps): React.JSX.Element {
  if (Platform.OS === 'ios') {
    return <RNKeyboardAvoidingView behavior={behavior} {...rest} />;
  }
  const {contentContainerStyle: _ignored, ...androidProps} = rest;
  return <KCKeyboardAvoidingView behavior="padding" {...androidProps} />;
}
