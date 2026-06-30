/**
 * VISP — Screen wrapper.
 *
 * Pure flat background (no glass) using the new editorial palette.
 * Uses SafeAreaView from react-native-safe-area-context so screens
 * respect the notch and home indicator.
 */

import React from 'react';
import { StyleSheet, View, StatusBar } from 'react-native';
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
