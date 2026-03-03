/**
 * AnimatedCheckmark
 *
 * Success checkmark that draws itself on with a stroke-dashoffset effect,
 * followed by a circle fill and glow pulse. Used for completion states.
 * Pure code SVG — no raster images.
 */

import React, { useEffect } from 'react';
import { View, ViewStyle } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import Animated, {
  useSharedValue,
  useAnimatedProps,
  withTiming,
  withDelay,
  withRepeat,
  withSequence,
  Easing,
  interpolate,
} from 'react-native-reanimated';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const AnimatedPath = Animated.createAnimatedComponent(Path);

interface AnimatedCheckmarkProps {
  size?: number;
  color?: string;
  backgroundColor?: string;
  style?: ViewStyle;
  delay?: number;
}

const AnimatedCheckmark: React.FC<AnimatedCheckmarkProps> = ({
  size = 80,
  color = '#27AE60',
  backgroundColor = 'rgba(39, 174, 96, 0.15)',
  style,
  delay = 0,
}) => {
  const circleProgress = useSharedValue(0);
  const checkProgress = useSharedValue(0);
  const fillOpacity = useSharedValue(0);
  const glowScale = useSharedValue(0);

  const CIRCLE_CIRCUMFERENCE = 2 * Math.PI * 36; // r=36
  const CHECK_LENGTH = 50;

  useEffect(() => {
    // Circle draws on first
    circleProgress.value = withDelay(
      delay,
      withTiming(1, { duration: 600, easing: Easing.bezier(0.25, 0.1, 0.25, 1) }),
    );

    // Fill fades in
    fillOpacity.value = withDelay(
      delay + 400,
      withTiming(1, { duration: 300, easing: Easing.ease }),
    );

    // Then checkmark draws
    checkProgress.value = withDelay(
      delay + 500,
      withTiming(1, { duration: 400, easing: Easing.bezier(0.4, 0, 0.2, 1) }),
    );

    // Subtle glow pulse after completion
    glowScale.value = withDelay(
      delay + 900,
      withRepeat(
        withSequence(
          withTiming(1.08, { duration: 1500, easing: Easing.inOut(Easing.ease) }),
          withTiming(1.0, { duration: 1500, easing: Easing.inOut(Easing.ease) }),
        ),
        -1,
        true,
      ),
    );
  }, []);

  const animatedCircleProps = useAnimatedProps(() => {
    const offset = interpolate(circleProgress.value, [0, 1], [CIRCLE_CIRCUMFERENCE, 0]);
    return {
      strokeDashoffset: offset,
    };
  });

  const animatedFillProps = useAnimatedProps(() => ({
    opacity: fillOpacity.value * 0.15,
    r: interpolate(glowScale.value, [1, 1.08], [36, 39]),
  }));

  const animatedCheckProps = useAnimatedProps(() => {
    const offset = interpolate(checkProgress.value, [0, 1], [CHECK_LENGTH, 0]);
    return {
      strokeDashoffset: offset,
    };
  });

  return (
    <View style={[{ width: size, height: size }, style]}>
      <Svg viewBox="0 0 80 80" width={size} height={size}>
        {/* Glow fill */}
        <AnimatedCircle
          cx="40"
          cy="40"
          fill={color}
          animatedProps={animatedFillProps}
        />

        {/* Circle outline — draw-on */}
        <AnimatedCircle
          cx="40"
          cy="40"
          r={36}
          fill="none"
          stroke={color}
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeDasharray={CIRCLE_CIRCUMFERENCE}
          animatedProps={animatedCircleProps}
        />

        {/* Checkmark — draw-on */}
        <AnimatedPath
          d="M 24 42 L 35 53 L 56 30"
          fill="none"
          stroke={color}
          strokeWidth={3.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={CHECK_LENGTH}
          animatedProps={animatedCheckProps}
        />
      </Svg>
    </View>
  );
};

export default AnimatedCheckmark;
