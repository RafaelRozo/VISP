/**
 * GlassBackground
 *
 * Full-screen wrapper that renders the dark base (#0a0a1a) and two gradient
 * orbs (purple top-left, blue bottom-right). Wrap any screen content:
 *
 *   <GlassBackground>{children}</GlassBackground>
 */

import React from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';
import { GlassOrbs } from '../../theme/glass';
import { useTheme } from '../../theme/ThemeContext';

interface GlassBackgroundProps {
  children: React.ReactNode;
  style?: ViewStyle;
}

const GlassBackground: React.FC<GlassBackgroundProps> = ({ children, style }) => {
  const theme = useTheme();

  return (
    <View style={[styles.container, { backgroundColor: theme.background }, style]}>
      {/* Purple orb — top left */}
      <View
        style={[
          styles.orb,
          {
            width: GlassOrbs.purple.size,
            height: GlassOrbs.purple.size,
            backgroundColor: theme.orbPurple,
            ...GlassOrbs.purple.position,
          },
        ]}
      />
      {/* Blue orb — bottom right */}
      <View
        style={[
          styles.orb,
          {
            width: GlassOrbs.blue.size,
            height: GlassOrbs.blue.size,
            backgroundColor: theme.orbBlue,
            ...GlassOrbs.blue.position,
          },
        ]}
      />
      {/* Content layer */}
      <View style={styles.content}>{children}</View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    position: 'relative',
    overflow: 'hidden',
  },
  orb: {
    position: 'absolute',
    borderRadius: 9999,
    opacity: 0.8,
  },
  content: {
    flex: 1,
    position: 'relative',
    zIndex: 1,
  },
});

export default GlassBackground;
