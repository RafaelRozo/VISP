/**
 * AnimatedSpinner
 *
 * Premium SVG loading spinner with rotating arc + pulsing glow.
 * Replaces plain ActivityIndicator throughout the app.
 * Pure code — no raster assets.
 */

import React, { useEffect } from 'react';
import { View, ViewStyle } from 'react-native';
import Svg, { Defs, LinearGradient, Stop, Circle, G } from 'react-native-svg';
import Animated, {
  useSharedValue,
  useAnimatedProps,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withSequence,
  Easing,
  interpolate,
} from 'react-native-reanimated';

const AnimatedG = Animated.createAnimatedComponent(G);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

interface AnimatedSpinnerProps {
  size?: number;
  color?: string;
  trackColor?: string;
  style?: ViewStyle;
}

const AnimatedSpinner: React.FC<AnimatedSpinnerProps> = ({
  size = 48,
  color = '#7850FF',
  trackColor = 'rgba(255, 255, 255, 0.08)',
  style,
}) => {
  const rotation = useSharedValue(0);
  const arcLength = useSharedValue(0);

  const RADIUS = 20;
  const CIRCUMFERENCE = 2 * Math.PI * RADIUS; // ~125.6

  useEffect(() => {
    // Continuous rotation
    rotation.value = withRepeat(
      withTiming(360, { duration: 1000, easing: Easing.linear }),
      -1,
      false,
    );

    // Arc length breathes: short → long → short
    arcLength.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 750, easing: Easing.bezier(0.4, 0, 0.2, 1) }),
        withTiming(0, { duration: 750, easing: Easing.bezier(0.4, 0, 0.2, 1) }),
      ),
      -1,
      false,
    );
  }, []);

  const animatedRotation = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  const animatedArcProps = useAnimatedProps(() => {
    const dashLen = interpolate(arcLength.value, [0, 1], [CIRCUMFERENCE * 0.15, CIRCUMFERENCE * 0.65]);
    const gapLen = CIRCUMFERENCE - dashLen;
    return {
      strokeDasharray: [dashLen, gapLen],
    };
  });

  return (
    <View style={[{ width: size, height: size }, style]}>
      <Animated.View style={[{ width: size, height: size }, animatedRotation]}>
        <Svg viewBox="0 0 50 50" width={size} height={size}>
          <Defs>
            <LinearGradient id="spinGrad" x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0%" stopColor={color} stopOpacity="1" />
              <Stop offset="100%" stopColor={color} stopOpacity="0.2" />
            </LinearGradient>
          </Defs>

          {/* Track */}
          <Circle
            cx="25"
            cy="25"
            r={RADIUS}
            fill="none"
            stroke={trackColor}
            strokeWidth={3}
          />

          {/* Animated arc */}
          <AnimatedCircle
            cx="25"
            cy="25"
            r={RADIUS}
            fill="none"
            stroke="url(#spinGrad)"
            strokeWidth={3}
            strokeLinecap="round"
            strokeDasharray={[CIRCUMFERENCE * 0.3, CIRCUMFERENCE * 0.7]}
            animatedProps={animatedArcProps}
          />
        </Svg>
      </Animated.View>
    </View>
  );
};

export default AnimatedSpinner;
