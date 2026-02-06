/**
 * VISP/Tasker - OnCallToggle Component
 *
 * Toggle switch for Level 4 on-call status with shift info display,
 * confirmation dialog, and visual indicator.
 */

import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { Colors } from '../theme/colors';
import { OnCallShift } from '../types';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface OnCallToggleProps {
  isOnCall: boolean;
  currentShift: OnCallShift | null;
  isLoading: boolean;
  onToggle: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatShiftTime(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatShiftDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function OnCallToggle({
  isOnCall,
  currentShift,
  isLoading,
  onToggle,
}: OnCallToggleProps): React.JSX.Element {
  const [isToggling, setIsToggling] = useState(false);

  const handleToggle = useCallback(() => {
    const action = isOnCall ? 'go off-call' : 'go on-call';
    const warningMessage = isOnCall
      ? 'You will stop receiving emergency job offers. Make sure there are no active SLA commitments.'
      : 'You will start receiving Level 4 emergency job offers. You must respond within the SLA window.';

    Alert.alert(
      `Confirm ${isOnCall ? 'Off-Call' : 'On-Call'}`,
      `Are you sure you want to ${action}?\n\n${warningMessage}`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: isOnCall ? 'Go Off-Call' : 'Go On-Call',
          style: isOnCall ? 'destructive' : 'default',
          onPress: async () => {
            setIsToggling(true);
            try {
              await onToggle();
            } finally {
              setIsToggling(false);
            }
          },
        },
      ],
    );
  }, [isOnCall, onToggle]);

  const indicatorColor = isOnCall ? Colors.success : Colors.textTertiary;
  const showSpinner = isLoading || isToggling;

  return (
    <View style={styles.container}>
      {/* Status indicator dot */}
      <View style={[styles.indicatorDot, { backgroundColor: indicatorColor }]} />

      <View style={styles.textContainer}>
        <Text style={styles.title}>On-Call Status</Text>
        <Text style={[styles.statusLabel, { color: indicatorColor }]}>
          {isOnCall ? 'Active' : 'Inactive'}
        </Text>

        {currentShift && (
          <View style={styles.shiftInfo}>
            <Text style={styles.shiftLabel}>Current Shift</Text>
            <Text style={styles.shiftTime}>
              {formatShiftDate(currentShift.startTime)}
              {' '}
              {formatShiftTime(currentShift.startTime)} -{' '}
              {formatShiftTime(currentShift.endTime)}
            </Text>
          </View>
        )}
      </View>

      <View style={styles.switchContainer}>
        {showSpinner ? (
          <ActivityIndicator size="small" color={Colors.primary} />
        ) : (
          <Switch
            value={isOnCall}
            onValueChange={handleToggle}
            trackColor={{
              false: Colors.border,
              true: Colors.success,
            }}
            thumbColor={Colors.white}
            ios_backgroundColor={Colors.border}
            accessibilityLabel="Toggle on-call status"
            accessibilityRole="switch"
          />
        )}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 16,
    marginHorizontal: 16,
    marginVertical: 6,
    shadowColor: Colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
  },
  indicatorDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 12,
  },
  textContainer: {
    flex: 1,
  },
  title: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textPrimary,
    marginBottom: 2,
  },
  statusLabel: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  shiftInfo: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
  },
  shiftLabel: {
    fontSize: 11,
    color: Colors.textTertiary,
    marginBottom: 2,
  },
  shiftTime: {
    fontSize: 13,
    color: Colors.textSecondary,
  },
  switchContainer: {
    marginLeft: 12,
  },
});

export default React.memo(OnCallToggle);
