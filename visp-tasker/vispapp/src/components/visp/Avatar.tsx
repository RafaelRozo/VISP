/**
 * VISP — Avatar (initials + optional remote image + optional badge dot).
 */

import React from 'react';
import { View, Text, Image, StyleSheet, ImageSourcePropType } from 'react-native';
import { useVispTheme, FontSansBold } from '../../theme/visp';

interface AvatarProps {
  initials: string;
  size?: number;
  source?: ImageSourcePropType | { uri: string };
  accent?: boolean;
  badge?: boolean | string;
}

export function Avatar({ initials, size = 38, source, accent, badge }: AvatarProps): React.JSX.Element {
  const t = useVispTheme();
  const radius = size === 38 ? 10 : Math.round(size * 0.25);
  const fontSize = size <= 32 ? 12 : size <= 44 ? 13 : 16;
  return (
    <View style={{ width: size, height: size }}>
      <View
        style={[
          styles.box,
          {
            width: size,
            height: size,
            borderRadius: radius,
            backgroundColor: accent ? t.violet : t.deep,
            borderColor: accent ? t.violetLine : t.border,
          },
        ]}
      >
        {source ? (
          <Image source={source as ImageSourcePropType} style={[styles.img, { borderRadius: radius }]} />
        ) : (
          <Text
            style={{
              fontFamily: FontSansBold,
              fontSize,
              fontWeight: '700',
              color: accent ? t.bg : t.text,
            }}
          >
            {initials.slice(0, 2).toUpperCase()}
          </Text>
        )}
      </View>
      {badge ? (
        <View
          style={[
            styles.badge,
            {
              backgroundColor: t.violet,
              borderColor: t.bg,
            },
          ]}
        >
          {typeof badge === 'string' ? (
            <Text style={{ color: t.bg, fontSize: 9, fontWeight: '700' }}>{badge}</Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  img: {
    width: '100%',
    height: '100%',
  },
  badge: {
    position: 'absolute',
    right: -2,
    top: -2,
    minWidth: 14,
    height: 14,
    paddingHorizontal: 4,
    borderRadius: 7,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
