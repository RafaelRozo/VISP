/**
 * AnimatedLogo
 *
 * VISP "V" logo with stroke draw-on effect + glow pulse.
 * Pure code SVG animation — crisp at any scale, tiny file size.
 * Uses react-native-svg + react-native-reanimated.
 */

import React, { useEffect } from 'react';
import { View, ViewStyle } from 'react-native';
import Svg, { Defs, LinearGradient, Stop, Path, Circle } from 'react-native-svg';
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

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

interface AnimatedLogoProps {
  size?: number;
  color?: string;
  glowColor?: string;
  style?: ViewStyle;
  animate?: boolean;
}

const AnimatedLogo: React.FC<AnimatedLogoProps> = ({
  size = 120,
  color = '#7850FF',
  glowColor = 'rgba(120, 80, 255, 0.4)',
  style,
  animate = true,
}) => {
  const drawProgress = useSharedValue(0);
  const glowScale = useSharedValue(1);
  const glowOpacity = useSharedValue(0);

  useEffect(() => {
    if (!animate) return;

    // Stroke draw-on: 0 → 1 over 1.5s with ease-out
    drawProgress.value = withTiming(1, {
      duration: 1500,
      easing: Easing.bezier(0.25, 0.1, 0.25, 1),
    });

    // Glow pulse: starts after draw completes
    glowOpacity.value = withDelay(
      1400,
      withRepeat(
        withSequence(
          withTiming(0.6, { duration: 1200, easing: Easing.inOut(Easing.ease) }),
          withTiming(0.2, { duration: 1200, easing: Easing.inOut(Easing.ease) }),
        ),
        -1,
        true,
      ),
    );

    glowScale.value = withDelay(
      1400,
      withRepeat(
        withSequence(
          withTiming(1.15, { duration: 1200, easing: Easing.inOut(Easing.ease) }),
          withTiming(1.0, { duration: 1200, easing: Easing.inOut(Easing.ease) }),
        ),
        -1,
        true,
      ),
    );
  }, [animate]);

  // V path — total length ~200 units in a 100x100 viewBox
  const PATH_LENGTH = 200;

  const animatedPathProps = useAnimatedProps(() => {
    const offset = interpolate(drawProgress.value, [0, 1], [PATH_LENGTH, 0]);
    return {
      strokeDashoffset: offset,
    };
  });

  const animatedGlowProps = useAnimatedProps(() => {
    return {
      opacity: glowOpacity.value,
      r: interpolate(glowScale.value, [1, 1.15], [35, 42]),
    };
  });

  return (
    <View style={[{ width: size, height: size }, style]}>
      <Svg viewBox="0 0 100 100" width={size} height={size}>
        <Defs>
          <LinearGradient id="logoGrad" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0%" stopColor="#a78bfa" />
            <Stop offset="50%" stopColor={color} />
            <Stop offset="100%" stopColor="#4f46e5" />
          </LinearGradient>
        </Defs>

        {/* Glow circle behind the V */}
        <AnimatedCircle
          cx="50"
          cy="50"
          fill={glowColor}
          animatedProps={animatedGlowProps}
        />

        {/* The V shape — stroke draw-on */}
        <AnimatedPath
          d="M 20 20 L 50 80 L 80 20"
          fill="none"
          stroke="url(#logoGrad)"
          strokeWidth={6}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={PATH_LENGTH}
          animatedProps={animatedPathProps}
        />
      </Svg>
    </View>
  );
};

export default AnimatedLogo;
