/**
 * PulseRing
 *
 * Expanding concentric rings that pulse outward — used for
 * matching screens, emergency searching, and location pings.
 * Pure SVG code animation.
 */

import React, { useEffect } from 'react';
import { View, ViewStyle } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import Animated, {
  useSharedValue,
  useAnimatedProps,
  withRepeat,
  withTiming,
  withDelay,
  Easing,
  interpolate,
} from 'react-native-reanimated';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

interface PulseRingProps {
  size?: number;
  color?: string;
  ringCount?: number;
  duration?: number;
  centerRadius?: number;
  maxRadius?: number;
  style?: ViewStyle;
}

const Ring: React.FC<{
  cx: number;
  cy: number;
  color: string;
  startRadius: number;
  endRadius: number;
  duration: number;
  delay: number;
}> = ({ cx, cy, color, startRadius, endRadius, duration, delay }) => {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withDelay(
      delay,
      withRepeat(
        withTiming(1, { duration, easing: Easing.out(Easing.ease) }),
        -1,
        false,
      ),
    );
  }, []);

  const animatedProps = useAnimatedProps(() => {
    return {
      r: interpolate(progress.value, [0, 1], [startRadius, endRadius]),
      strokeWidth: interpolate(progress.value, [0, 0.5, 1], [3, 2, 0]),
      opacity: interpolate(progress.value, [0, 0.3, 1], [0.7, 0.5, 0]),
    };
  });

  return (
    <AnimatedCircle
      cx={cx}
      cy={cy}
      fill="none"
      stroke={color}
      animatedProps={animatedProps}
    />
  );
};

const PulseRing: React.FC<PulseRingProps> = ({
  size = 200,
  color = '#7850FF',
  ringCount = 3,
  duration = 2000,
  centerRadius = 16,
  maxRadius = 80,
  style,
}) => {
  const center = size / 2;
  const viewSize = size;

  const rings = Array.from({ length: ringCount }, (_, i) => ({
    key: i,
    delay: (duration / ringCount) * i,
  }));

  return (
    <View style={[{ width: size, height: size }, style]}>
      <Svg viewBox={`0 0 ${viewSize} ${viewSize}`} width={size} height={size}>
        {/* Expanding rings */}
        {rings.map(({ key, delay }) => (
          <Ring
            key={key}
            cx={center}
            cy={center}
            color={color}
            startRadius={centerRadius}
            endRadius={maxRadius}
            duration={duration}
            delay={delay}
          />
        ))}

        {/* Solid center dot */}
        <Circle cx={center} cy={center} r={centerRadius} fill={color} opacity={0.9} />
        <Circle cx={center} cy={center} r={centerRadius * 0.5} fill="white" opacity={0.8} />
      </Svg>
    </View>
  );
};

export default PulseRing;
