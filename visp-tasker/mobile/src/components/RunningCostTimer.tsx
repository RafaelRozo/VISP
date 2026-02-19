/**
 * VISP - RunningCostTimer Component
 *
 * Displays elapsed time, running cost, hourly rate, and estimated total
 * for TIME_BASED (L1/L2) jobs. Updates every second.
 *
 * Color coding:
 *   Green  (#27AE60) - under 80% of estimated duration
 *   Yellow (#F39C12) - 80-100% of estimated duration
 *   Red    (#E74C3C) - over estimated duration
 */

import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Colors } from '../theme/colors';
import { GlassStyles } from '../theme/glass';

interface RunningCostTimerProps {
  startedAt: string;
  hourlyRateCents: number;
  estimatedDurationMin: number;
}

function formatElapsed(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return (
    `${String(hours).padStart(2, '0')}:` +
    `${String(minutes).padStart(2, '0')}:` +
    `${String(seconds).padStart(2, '0')}`
  );
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function getTimerColor(elapsedMin: number, estimatedMin: number): string {
  if (estimatedMin <= 0) return Colors.success;
  const ratio = elapsedMin / estimatedMin;
  if (ratio < 0.8) return Colors.success;
  if (ratio <= 1.0) return Colors.warning;
  return Colors.emergencyRed;
}

export default function RunningCostTimer({
  startedAt,
  hourlyRateCents,
  estimatedDurationMin,
}: RunningCostTimerProps): React.JSX.Element {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const update = () => {
      const diff = Math.max(0, Date.now() - new Date(startedAt).getTime());
      setElapsedSeconds(Math.floor(diff / 1000));
    };

    update();
    intervalRef.current = setInterval(update, 1000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [startedAt]);

  const elapsedMinutes = elapsedSeconds / 60;
  const runningCostCents = (hourlyRateCents / 3600) * elapsedSeconds;
  const estimatedTotalCents = (hourlyRateCents / 60) * estimatedDurationMin;
  const timerColor = getTimerColor(elapsedMinutes, estimatedDurationMin);

  return (
    <View style={[styles.container, { borderColor: timerColor }]}>
      {/* Elapsed time */}
      <Text style={styles.timerLabel}>ELAPSED TIME</Text>
      <Text style={[styles.timerValue, { color: timerColor }]}>
        {formatElapsed(elapsedSeconds)}
      </Text>

      {/* Running cost */}
      <View style={styles.costRow}>
        <Text style={styles.costLabel}>Running Cost</Text>
        <Text style={[styles.costValue, { color: timerColor }]}>
          {formatCents(Math.round(runningCostCents))}
        </Text>
      </View>

      {/* Hourly rate and estimated total */}
      <View style={styles.infoRow}>
        <View style={styles.infoItem}>
          <Text style={styles.infoLabel}>Hourly Rate</Text>
          <Text style={styles.infoValue}>
            {formatCents(hourlyRateCents)}/hr
          </Text>
        </View>
        <View style={styles.infoSeparator} />
        <View style={styles.infoItem}>
          <Text style={styles.infoLabel}>Est. Total</Text>
          <Text style={styles.infoValue}>
            {formatCents(Math.round(estimatedTotalCents))}
          </Text>
        </View>
      </View>

      {/* Note */}
      <Text style={styles.note}>
        Cost continues until job is marked complete
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...GlassStyles.card,
    padding: 16,
    marginHorizontal: 16,
    marginBottom: 12,
    alignItems: 'center',
  },
  timerLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.textSecondary,
    letterSpacing: 1,
    marginBottom: 4,
  },
  timerValue: {
    fontSize: 36,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
    marginBottom: 12,
  },
  costRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255, 255, 255, 0.12)',
    marginBottom: 8,
  },
  costLabel: {
    fontSize: 14,
    color: Colors.textSecondary,
  },
  costValue: {
    fontSize: 22,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255, 255, 255, 0.12)',
  },
  infoItem: {
    flex: 1,
    alignItems: 'center',
  },
  infoSeparator: {
    width: 1,
    height: 28,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
  },
  infoLabel: {
    fontSize: 11,
    color: Colors.textTertiary,
    marginBottom: 2,
  },
  infoValue: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  note: {
    fontSize: 11,
    color: Colors.textTertiary,
    marginTop: 8,
    fontStyle: 'italic',
  },
});
