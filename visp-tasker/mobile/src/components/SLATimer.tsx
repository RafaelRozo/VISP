/**
 * VISP - SLATimer Component
 *
 * Countdown timer for emergency SLA deadlines.
 * Color-coded based on remaining percentage:
 *   - Green: > 50% remaining
 *   - Yellow: 25-50% remaining
 *   - Red: < 25% remaining
 * Pulses when less than 5 minutes remain.
 * Takes a deadline timestamp as prop.
 */

import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  ViewStyle,
} from 'react-native';
import { Colors } from '../theme/colors';
import { Spacing } from '../theme/spacing';
import { FontSize, FontWeight } from '../theme/typography';
import { BorderRadius } from '../theme/borders';
import { GlassStyles } from '../theme/glass';

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

interface SLATimerProps {
  deadline: string;
  totalDurationMinutes: number;
  label?: string;
  style?: ViewStyle;
  compact?: boolean;
  onExpired?: () => void;
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function getRemainingSeconds(deadline: string): number {
  const deadlineMs = new Date(deadline).getTime();
  const nowMs = Date.now();
  const remainingMs = deadlineMs - nowMs;
  return Math.max(0, Math.floor(remainingMs / 1000));
}

function formatTime(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function getTimerColor(remainingPercent: number): string {
  if (remainingPercent > 0.5) {
    return Colors.success;
  }
  if (remainingPercent > 0.25) {
    return Colors.warning;
  }
  return Colors.emergencyRed;
}

// ──────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────

function SLATimer({
  deadline,
  totalDurationMinutes,
  label = 'SLA Deadline',
  style,
  compact = false,
  onExpired,
}: SLATimerProps): React.JSX.Element {
  const [remainingSeconds, setRemainingSeconds] = useState<number>(
    getRemainingSeconds(deadline),
  );
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const hasExpiredRef = useRef(false);

  const totalSeconds = totalDurationMinutes * 60;
  const remainingPercent =
    totalSeconds > 0 ? remainingSeconds / totalSeconds : 0;
  const timerColor = getTimerColor(remainingPercent);
  const shouldPulse = remainingSeconds > 0 && remainingSeconds < 300; // < 5 minutes
  const isExpired = remainingSeconds <= 0;

  // Countdown interval
  useEffect(() => {
    const interval = setInterval(() => {
      const remaining = getRemainingSeconds(deadline);
      setRemainingSeconds(remaining);

      if (remaining <= 0 && !hasExpiredRef.current) {
        hasExpiredRef.current = true;
        onExpired?.();
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [deadline, onExpired]);

  // Pulse animation
  useEffect(() => {
    if (shouldPulse) {
      const animation = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 0.6,
            duration: 500,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 500,
            useNativeDriver: true,
          }),
        ]),
      );
      animation.start();
      return () => animation.stop();
    } else {
      pulseAnim.setValue(1);
    }
  }, [shouldPulse, pulseAnim]);

  // Progress bar width
  const progressWidth = `${Math.min(remainingPercent * 100, 100)}%`;

  if (compact) {
    return (
      <Animated.View
        style={[
          styles.compactContainer,
          { opacity: pulseAnim },
          style,
        ]}
        accessibilityRole="timer"
        accessibilityLabel={
          isExpired
            ? 'SLA deadline expired'
            : `${label}: ${formatTime(remainingSeconds)} remaining`
        }
      >
        <View style={[styles.compactDot, { backgroundColor: timerColor }]} />
        <Text style={[styles.compactTime, { color: timerColor }]}>
          {isExpired ? 'EXPIRED' : formatTime(remainingSeconds)}
        </Text>
      </Animated.View>
    );
  }

  return (
    <Animated.View
      style={[
        styles.container,
        { borderColor: `${timerColor}40`, opacity: pulseAnim },
        style,
      ]}
      accessibilityRole="timer"
      accessibilityLabel={
        isExpired
          ? 'SLA deadline expired'
          : `${label}: ${formatTime(remainingSeconds)} remaining`
      }
    >
      <View style={styles.header}>
        <Text style={styles.label}>{label}</Text>
        <View style={[styles.statusDot, { backgroundColor: timerColor }]} />
      </View>

      <Text style={[styles.time, { color: timerColor }]}>
        {isExpired ? 'EXPIRED' : formatTime(remainingSeconds)}
      </Text>

      <View style={styles.progressBarContainer}>
        <View
          style={[
            styles.progressBar,
            {
              width: progressWidth as any,
              backgroundColor: timerColor,
            },
          ]}
        />
      </View>

      {isExpired && (
        <Text style={styles.expiredText}>
          SLA deadline has been exceeded
        </Text>
      )}
    </Animated.View>
  );
}

// ──────────────────────────────────────────────
// Styles
// ──────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    ...GlassStyles.card,
    padding: Spacing.lg,
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    marginBottom: Spacing.sm,
  },
  label: {
    fontSize: FontSize.footnote,
    fontWeight: FontWeight.medium,
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  time: {
    fontSize: 40,
    fontWeight: FontWeight.bold,
    fontVariant: ['tabular-nums'],
    marginBottom: Spacing.md,
  },
  progressBarContainer: {
    width: '100%',
    height: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.10)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressBar: {
    height: '100%',
    borderRadius: 2,
  },
  expiredText: {
    fontSize: FontSize.caption,
    color: Colors.emergencyRed,
    fontWeight: FontWeight.medium,
    marginTop: Spacing.sm,
  },
  compactContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  compactDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  compactTime: {
    fontSize: FontSize.footnote,
    fontWeight: FontWeight.semiBold,
    fontVariant: ['tabular-nums'],
  },
});

export default React.memo(SLATimer);
