/**
 * VISP — Bottom tab bar.
 *
 * Drop-in replacement for the React Navigation `tabBar` prop. Reads icons
 * from a name we encode in `options.tabBarLabel` (we keep the labels in
 * i18n and map name from the route name via a passed prop, not here).
 *
 * Usage:
 *   <Tab.Navigator tabBar={(props) => <VispTabBar {...props} iconMap={ICONS} />}>
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useVispTheme, VispText } from '../../theme/visp';
import { Icon, VispIconName } from './Icon';

interface VispTabBarProps extends BottomTabBarProps {
  iconMap: Record<string, VispIconName>;
  badgeMap?: Record<string, string | number | undefined>;
}

export function VispTabBar({ state, descriptors, navigation, iconMap, badgeMap }: VispTabBarProps): React.JSX.Element {
  const t = useVispTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.bar,
        {
          backgroundColor: t.bg,
          borderTopColor: t.border,
          paddingBottom: Math.max(insets.bottom, 6),
        },
      ]}
    >
      {state.routes.map((route, index) => {
        const focused = state.index === index;
        const { options } = descriptors[route.key];
        const label =
          typeof options.tabBarLabel === 'string'
            ? options.tabBarLabel
            : options.title ?? route.name;
        const icon = iconMap[route.name] ?? 'home';
        const badge = badgeMap?.[route.name];

        const onPress = () => {
          const event = navigation.emit({
            type: 'tabPress',
            target: route.key,
            canPreventDefault: true,
          });
          if (!focused && !event.defaultPrevented) {
            navigation.navigate(route.name as never);
          }
        };

        return (
          <TouchableOpacity
            key={route.key}
            onPress={onPress}
            accessibilityRole="button"
            activeOpacity={0.8}
            style={styles.tab}
          >
            <View>
              <Icon name={icon} size={20} color={focused ? t.text : t.text3} active={focused} />
              {badge ? (
                <View style={[styles.badge, { backgroundColor: t.violet, borderColor: t.bg }]}>
                  <Text style={{ color: t.bg, fontSize: 9, fontWeight: '700' }}>{String(badge)}</Text>
                </View>
              ) : null}
            </View>
            <Text
              style={[
                VispText.eyebrowTight,
                { color: focused ? t.text : t.text3, fontWeight: '500', marginTop: 4 },
              ]}
            >
              {String(label).toUpperCase()}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    paddingTop: 8,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingVertical: 6,
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: -10,
    minWidth: 14,
    height: 14,
    paddingHorizontal: 4,
    borderRadius: 7,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
