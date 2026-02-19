/**
 * DrawOnPath
 *
 * Generic stroke draw-on animation component.
 * Pass any SVG path data and it animates from hidden → drawn.
 * The most iconic SVG animation technique.
 */

import React, { useEffect } from 'react';
import { View, ViewStyle } from 'react-native';
import Svg, { Path, Defs, LinearGradient, Stop } from 'react-native-svg';
import Animated, {
  useSharedValue,
  useAnimatedProps,
  withDelay,
  withTiming,
  Easing,
  interpolate,
} from 'react-native-reanimated';

const AnimatedPath = Animated.createAnimatedComponent(Path);

interface DrawOnPathProps {
  /** SVG path "d" attribute */
  path: string;
  /** SVG viewBox dimensions */
  viewBox?: string;
  width?: number;
  height?: number;
  /** Stroke color (can be a gradient ref like "url(#grad)") */
  strokeColor?: string;
  strokeWidth?: number;
  /** Approximate path length (overestimate is fine) */
  pathLength?: number;
  /** Animation duration in ms */
  duration?: number;
  /** Delay before starting in ms */
  delay?: number;
  /** Whether to use gradient */
  useGradient?: boolean;
  gradientColors?: [string, string];
  style?: ViewStyle;
}

const DrawOnPath: React.FC<DrawOnPathProps> = ({
  path,
  viewBox = '0 0 100 100',
  width = 100,
  height = 100,
  strokeColor = '#7850FF',
  strokeWidth = 2.5,
  pathLength = 500,
  duration = 1500,
  delay = 0,
  useGradient = false,
  gradientColors = ['#a78bfa', '#4f46e5'],
  style,
}) => {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withDelay(
      delay,
      withTiming(1, {
        duration,
        easing: Easing.bezier(0.4, 0, 0.2, 1),
      }),
    );
  }, []);

  const animatedProps = useAnimatedProps(() => {
    const offset = interpolate(progress.value, [0, 1], [pathLength, 0]);
    return {
      strokeDashoffset: offset,
    };
  });

  return (
    <View style={[{ width, height }, style]}>
      <Svg viewBox={viewBox} width={width} height={height}>
        {useGradient && (
          <Defs>
            <LinearGradient id="drawGrad" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0%" stopColor={gradientColors[0]} />
              <Stop offset="100%" stopColor={gradientColors[1]} />
            </LinearGradient>
          </Defs>
        )}

        <AnimatedPath
          d={path}
          fill="none"
          stroke={useGradient ? 'url(#drawGrad)' : strokeColor}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={pathLength}
          animatedProps={animatedProps}
        />
      </Svg>
    </View>
  );
};

export default DrawOnPath;
