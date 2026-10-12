/**
 * VISP — Screen wrapper.
 *
 * Pure flat background (no glass) using the new editorial palette.
 * Uses SafeAreaView from react-native-safe-area-context so screens
 * respect the notch and home indicator.
 */

import React from 'react';
import { Platform, StyleSheet, View, StatusBar } from 'react-native';
import { SafeAreaView, Edge } from 'react-native-safe-area-context';
import { useVispTheme } from '../../theme/visp';

interface ScreenProps {
  children: React.ReactNode;
  /**
   * Which device edges to inset for. Default `['bottom']` — top inset is
   * handled by the `TopBar` primitive (so legacy screens that already have
   * their own `paddingTop` don't double up).
   */
  edges?: Edge[];
  paddingTop?: number;
}

export function Screen({
  children,
  edges = ['bottom'],
  paddingTop,
}: ScreenProps): React.JSX.Element {
  const t = useVispTheme();
  // Android (targetSdk 36) dibuja siempre de borde a borde: sin el inset de
  // arriba, las pantallas sin TopBar metían su cabecera bajo la hora. Es seguro
  // añadirlo siempre: el SafeAreaView nativo mide contra su posición real, así
  // que un TopBar dentro o una cabecera nativa encima reciben 0 y no se duplica.
  if (Platform.OS === 'android' && !edges.includes('top')) {
    edges = ['top', ...edges];
  }
  return (
    <>
      <StatusBar barStyle={t.isDark ? 'light-content' : 'dark-content'} backgroundColor={t.bg} />
      <SafeAreaView
        edges={edges}
        style={[styles.root, { backgroundColor: t.bg, paddingTop }]}
      >
        <View style={styles.inner}>{children}</View>
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  inner: { flex: 1 },
});
