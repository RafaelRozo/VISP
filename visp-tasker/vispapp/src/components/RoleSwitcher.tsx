/**
 * VISP - Role Switcher
 *
 * Animated segmented switch for 'both' users to flip between
 * Customer and Provider modes. Sliding violet thumb with spring
 * physics + label opacity crossfade. Native-driven for 60 fps.
 *
 * Used in the provider DashboardScreen and the customer HomeScreen.
 */

import React, { useEffect, useRef } from 'react';
import { Animated, Platform, StyleSheet, Text, TouchableWithoutFeedback, View } from 'react-native';
import { useTranslation } from '../i18n';
import { Colors } from '../theme/colors';
import type { ActiveMode } from '../stores/authStore';

interface Props {
  mode: ActiveMode;
  onChange: (mode: ActiveMode) => void;
  /** Optional explicit width override; defaults to fill the parent (max 320). */
  width?: number;
}

const TRACK_HEIGHT = 44;
const TRACK_PADDING = 4;
const DEFAULT_WIDTH = 280;

export default function RoleSwitcher({ mode, onChange, width }: Props): React.JSX.Element {
  const { t } = useTranslation();

  const trackWidth = width ?? DEFAULT_WIDTH;
  const thumbWidth = (trackWidth - TRACK_PADDING * 2) / 2;

  // 0 = customer, 1 = provider. Spring-animated.
  const anim = useRef(new Animated.Value(mode === 'provider' ? 1 : 0)).current;

  useEffect(() => {
    Animated.spring(anim, {
      toValue: mode === 'provider' ? 1 : 0,
      useNativeDriver: true,
      friction: 8,
      tension: 70,
    }).start();
  }, [mode, anim]);

  const thumbTranslateX = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, thumbWidth],
  });

  const customerOpacity = anim.interpolate({ inputRange: [0, 1], outputRange: [1, 0.5] });
  const providerOpacity = anim.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] });

  return (
    <View style={[styles.track, { width: trackWidth, height: TRACK_HEIGHT, padding: TRACK_PADDING }]}>
      {/* Sliding thumb */}
      <Animated.View
        style={[
          styles.thumb,
          {
            width: thumbWidth,
            height: TRACK_HEIGHT - TRACK_PADDING * 2,
            transform: [{ translateX: thumbTranslateX }],
          },
        ]}
      />

      {/* Touch targets + labels */}
      <View style={styles.labelsRow} pointerEvents="box-none">
        <TouchableWithoutFeedback
          onPress={() => mode !== 'customer' && onChange('customer')}
          accessibilityRole="button"
          accessibilityLabel={t('dashboard.modeCustomer')}
          accessibilityState={{ selected: mode === 'customer' }}
        >
          <View style={styles.labelHit}>
            <Animated.Text style={[styles.label, { opacity: customerOpacity }]}>
              <Text style={styles.icon}>👤</Text>  {t('dashboard.modeCustomer')}
            </Animated.Text>
          </View>
        </TouchableWithoutFeedback>

        <TouchableWithoutFeedback
          onPress={() => mode !== 'provider' && onChange('provider')}
          accessibilityRole="button"
          accessibilityLabel={t('dashboard.modeProvider')}
          accessibilityState={{ selected: mode === 'provider' }}
        >
          <View style={styles.labelHit}>
            <Animated.Text style={[styles.label, { opacity: providerOpacity }]}>
              <Text style={styles.icon}>🛠️</Text>  {t('dashboard.modeProvider')}
            </Animated.Text>
          </View>
        </TouchableWithoutFeedback>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    borderRadius: 999,
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.10)',
    overflow: 'hidden',
    position: 'relative',
  },
  thumb: {
    position: 'absolute',
    top: TRACK_PADDING,
    left: TRACK_PADDING,
    borderRadius: 999,
    backgroundColor: 'rgba(120, 80, 255, 0.95)',
    ...(Platform.OS === 'ios'
      ? {
          shadowColor: Colors.primary,
          shadowOffset: { width: 0, height: 0 },
          shadowOpacity: 0.6,
          shadowRadius: 10,
        }
      : {
          elevation: 6,
        }),
  },
  labelsRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  labelHit: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#FFFFFF',
    letterSpacing: 0.2,
  },
  icon: {
    fontSize: 13,
  },
});
