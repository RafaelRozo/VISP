/**
 * GlassNavBar
 *
 * Glass-themed navigation bar with SafeAreaView insets.
 *
 * Usage:
 *   <GlassNavBar
 *     title="Dashboard"
 *     leftButton={<BackButton />}
 *     rightButton={<SettingsIcon />}
 *   />
 */

import React from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GlassStyles } from '../../theme/glass';
import { Typography } from '../../theme/typography';
import { Spacing } from '../../theme/spacing';

interface GlassNavBarProps {
  title: string;
  leftButton?: React.ReactNode;
  rightButton?: React.ReactNode;
  style?: ViewStyle;
}

const GlassNavBar: React.FC<GlassNavBarProps> = ({
  title,
  leftButton,
  rightButton,
  style,
}) => {
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        GlassStyles.navbar,
        styles.container,
        { paddingTop: insets.top + Spacing.sm },
        style,
      ]}
    >
      <View style={styles.side}>{leftButton}</View>
      <Text style={styles.title} numberOfLines={1}>
        {title}
      </Text>
      <View style={styles.side}>{rightButton}</View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.md,
  },
  side: {
    width: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    ...Typography.headline,
    color: '#FFFFFF',
    flex: 1,
    textAlign: 'center',
    textShadowColor: 'rgba(0, 0, 0, 0.3)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 10,
  },
});

export default GlassNavBar;
