/**
 * VISP - Role Switcher (editorial refresh, mockup #10 fidelity)
 *
 * Two-pane card: ACTIVE MODE pill on the active side (background = t.text,
 * text = t.bg) and SWITCH TO pill on the inactive side (transparent, text2).
 * A reanimated thumb slides between the two halves on toggle.
 *
 * Eyebrow text uses JetBrains Mono uppercase (9px, 0.14em tracking).
 * Active label uses Manrope 700 with -0.01em letter-spacing and a
 * monochrome 14px icon (plus for customer, briefcase for provider).
 *
 * Drop-in replacement: same prop signature (`mode`, `onChange`).
 */

import React, { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useTranslation } from '../i18n';
import { useVispTheme, VispText, VispRadius, VispSpace, FontSansBold } from '../theme/visp';
import { Icon } from './visp/Icon';
import type { ActiveMode } from '../stores/authStore';

interface Props {
  mode: ActiveMode;
  onChange: (mode: ActiveMode) => void;
  /** Optional explicit total width. Defaults to (screen width - 2 * gutter). */
  width?: number;
}

const PADDING = 4;
const INNER_GAP = 4;

export default function RoleSwitcher({ mode, onChange, width }: Props): React.JSX.Element {
  const t = useVispTheme();
  const { t: tr } = useTranslation();
  const { width: screenW } = useWindowDimensions();

  const trackWidth = width ?? screenW - VispSpace.gutter * 2;
  const innerWidth = trackWidth - PADDING * 2;
  const paneWidth = (innerWidth - INNER_GAP) / 2;

  // 0 = customer (left), 1 = provider (right)
  const target = mode === 'provider' ? 1 : 0;
  const progress = useSharedValue(target);

  useEffect(() => {
    progress.value = withTiming(target, {
      duration: 280,
      easing: Easing.out(Easing.cubic),
    });
  }, [target, progress]);

  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: progress.value * (paneWidth + INNER_GAP) }],
  }));

  // Press scale per pane for tactile feedback
  const leftScale = useSharedValue(1);
  const rightScale = useSharedValue(1);
  const leftStyle = useAnimatedStyle(() => ({ transform: [{ scale: leftScale.value }] }));
  const rightStyle = useAnimatedStyle(() => ({ transform: [{ scale: rightScale.value }] }));

  const isCustomerActive = mode === 'customer';
  const isProviderActive = mode === 'provider';

  return (
    <View
      style={[
        styles.track,
        {
          width: trackWidth,
          backgroundColor: t.card,
          borderColor: t.border,
          padding: PADDING,
        },
      ]}
    >
      {/* Sliding thumb — drawn behind the labels */}
      <Animated.View
        style={[
          styles.thumb,
          thumbStyle,
          {
            width: paneWidth,
            backgroundColor: t.text,
          },
        ]}
      />

      <View style={[styles.row, { gap: INNER_GAP }]}>
        {/* Customer pane */}
        <Pressable
          onPressIn={() => {
            leftScale.value = withTiming(0.97, { duration: 80 });
          }}
          onPressOut={() => {
            leftScale.value = withTiming(1, { duration: 140 });
          }}
          onPress={() => mode !== 'customer' && onChange('customer')}
          accessibilityRole="button"
          accessibilityState={{ selected: isCustomerActive }}
          accessibilityLabel={tr('dashboard.modeCustomer')}
          style={[styles.pane, { width: paneWidth }]}
        >
          <Animated.View style={leftStyle}>
            <Text
              style={[
                VispText.eyebrow,
                styles.eyebrow,
                { color: isCustomerActive ? t.text3 : t.text4 },
              ]}
            >
              {isCustomerActive ? 'ACTIVE MODE' : 'SWITCH TO'}
            </Text>
            <View style={styles.labelRow}>
              <Icon
                name="plus"
                size={14}
                color={isCustomerActive ? t.bg : t.text2}
                active={isCustomerActive}
              />
              <Text
                style={[
                  styles.label,
                  { color: isCustomerActive ? t.bg : t.text2 },
                ]}
              >
                {tr('dashboard.modeCustomer')}
              </Text>
            </View>
          </Animated.View>
        </Pressable>

        {/* Provider pane */}
        <Pressable
          onPressIn={() => {
            rightScale.value = withTiming(0.97, { duration: 80 });
          }}
          onPressOut={() => {
            rightScale.value = withTiming(1, { duration: 140 });
          }}
          onPress={() => mode !== 'provider' && onChange('provider')}
          accessibilityRole="button"
          accessibilityState={{ selected: isProviderActive }}
          accessibilityLabel={tr('dashboard.modeProvider')}
          style={[styles.pane, { width: paneWidth }]}
        >
          <Animated.View style={rightStyle}>
            <Text
              style={[
                VispText.eyebrow,
                styles.eyebrow,
                { color: isProviderActive ? t.text3 : t.text4 },
              ]}
            >
              {isProviderActive ? 'ACTIVE MODE' : 'SWITCH TO'}
            </Text>
            <View style={styles.labelRow}>
              <Icon
                name="briefcase"
                size={14}
                color={isProviderActive ? t.bg : t.text2}
                active={isProviderActive}
              />
              <Text
                style={[
                  styles.label,
                  { color: isProviderActive ? t.bg : t.text2 },
                ]}
              >
                {tr('dashboard.modeProvider')}
              </Text>
            </View>
          </Animated.View>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    borderRadius: VispRadius.card,
    borderWidth: 1,
    position: 'relative',
  },
  thumb: {
    position: 'absolute',
    top: PADDING,
    left: PADDING,
    bottom: PADDING,
    borderRadius: 7,
  },
  row: {
    flexDirection: 'row',
  },
  pane: {
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  eyebrow: {
    fontSize: 9,
    letterSpacing: 1.26, // 0.14em at 9px
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  label: {
    fontFamily: FontSansBold,
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: -0.14, // -0.01em at 14px
  },
});
