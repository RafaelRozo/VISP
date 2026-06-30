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
import { Colors } from '../../theme/colors';
import { GlassOrbs } from '../../theme/glass';

interface GlassBackgroundProps {
  children: React.ReactNode;
  style?: ViewStyle;
}

const GlassBackground: React.FC<GlassBackgroundProps> = ({ children, style }) => {
  return (
    <View style={[styles.container, style]}>
      {/* Purple orb — top left */}
      <View
        style={[
          styles.orb,
          {
            width: GlassOrbs.purple.size,
            height: GlassOrbs.purple.size,
            backgroundColor: GlassOrbs.purple.color,
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
            backgroundColor: GlassOrbs.blue.color,
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
    backgroundColor: Colors.background,
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
