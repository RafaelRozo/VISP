/**
 * VISP/Tasker - Emergency Button Component
 *
 * Large, prominent red button with a pulsing animation.
 * Displays a confirmation dialog before navigating to the emergency flow.
 */

import React, { useCallback, useEffect, useRef } from 'react';
import {
  Alert,
  Animated,
  Easing,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { Colors, Spacing, Typography, BorderRadius, Shadows } from '../theme';

// ──────────────────────────────────────────────
// Props
// ──────────────────────────────────────────────

interface EmergencyButtonProps {
  /** Called after the user confirms the emergency action. */
  onPress: () => void;
  /** If true, disables the pulsing animation (e.g. an emergency is already active). */
  hasActiveEmergency?: boolean;
  /** If true, the button is disabled. */
  disabled?: boolean;
}

// ──────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────

function EmergencyButton({
  onPress,
  hasActiveEmergency = false,
  disabled = false,
}: EmergencyButtonProps): React.JSX.Element {
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // ── Pulse Animation ──────────────────────
  useEffect(() => {
    if (hasActiveEmergency || disabled) {
      pulseAnim.stopAnimation();
      pulseAnim.setValue(1);
      return;
    }

    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.05,
          duration: 1000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );

    pulse.start();

    return () => {
      pulse.stop();
    };
  }, [pulseAnim, hasActiveEmergency, disabled]);

  // ── Confirmation Dialog ──────────────────
  const handlePress = useCallback(() => {
    Alert.alert(
      'Request Emergency Service',
      'This will immediately connect you with an on-call Level 4 provider. ' +
        'Emergency rates apply. Are you sure you want to proceed?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Yes, Request Now',
          style: 'destructive',
          onPress,
        },
      ],
      { cancelable: true },
    );
  }, [onPress]);

  // ── Render ───────────────────────────────
  return (
    <Animated.View
      style={[
        styles.wrapper,
        { transform: [{ scale: pulseAnim }] },
      ]}
    >
      <TouchableOpacity
        style={[
          styles.button,
          hasActiveEmergency && styles.buttonActive,
          disabled && styles.buttonDisabled,
        ]}
        onPress={handlePress}
        activeOpacity={0.85}
        disabled={disabled}
        accessibilityLabel="Request emergency service"
        accessibilityRole="button"
        accessibilityHint="Double tap to request an emergency service provider"
      >
        {/* Glow ring behind the button (decorative) */}
        <View style={styles.glowRing} />

        <View style={styles.content}>
          <Text style={styles.icon}>{'!!'}</Text>
          <Text style={styles.label}>
            {hasActiveEmergency ? 'EMERGENCY ACTIVE' : 'EMERGENCY'}
          </Text>
          <Text style={styles.sublabel}>
            {hasActiveEmergency
              ? 'Tap to view status'
              : '24/7 on-call providers'}
          </Text>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

// ──────────────────────────────────────────────
// Styles
// ──────────────────────────────────────────────

const styles = StyleSheet.create({
  wrapper: {
    alignSelf: 'stretch',
  },
  button: {
    backgroundColor: Colors.emergencyRed,
    borderRadius: BorderRadius.md,
    paddingVertical: Spacing.xl,
    paddingHorizontal: Spacing.xxl,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    overflow: 'hidden',
    ...Shadows.lg,
  },
  buttonActive: {
    backgroundColor: Colors.emergencyRedDark,
  },
  buttonDisabled: {
    backgroundColor: Colors.surfaceLight,
    opacity: 0.6,
  },
  glowRing: {
    position: 'absolute',
    top: -2,
    left: -2,
    right: -2,
    bottom: -2,
    borderRadius: BorderRadius.md + 2,
    borderWidth: 2,
    borderColor: 'rgba(231, 76, 60, 0.4)',
  },
  content: {
    alignItems: 'center',
    gap: Spacing.xs,
  },
  icon: {
    fontSize: 28,
    fontWeight: '900',
    color: Colors.white,
    marginBottom: Spacing.xs,
  },
  label: {
    ...Typography.headline,
    color: Colors.white,
    fontWeight: '800',
    letterSpacing: 2,
  },
  sublabel: {
    ...Typography.caption,
    color: 'rgba(255, 255, 255, 0.8)',
  },
});

export default React.memo(EmergencyButton);
