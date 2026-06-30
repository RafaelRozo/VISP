/**
 * StaggeredBars
 *
 * Animated bar chart where bars rise up with staggered entrance.
 * Bars grow from bottom with spring-like overshoot easing.
 * Pure SVG code — used for earnings/stats displays.
 */

import React, { useEffect } from 'react';
import { View, ViewStyle } from 'react-native';
import Svg, { Rect, Defs, LinearGradient, Stop } from 'react-native-svg';
import Animated, {
  useSharedValue,
  useAnimatedProps,
  withDelay,
  withSpring,
  interpolate,
} from 'react-native-reanimated';

const AnimatedRect = Animated.createAnimatedComponent(Rect);

interface BarData {
  value: number; // 0-1 normalized
  color?: string;
}

interface StaggeredBarsProps {
  bars: BarData[];
  width?: number;
  height?: number;
  barRadius?: number;
  gap?: number;
  defaultColor?: string;
  staggerDelay?: number;
  style?: ViewStyle;
}

const Bar: React.FC<{
  x: number;
  barWidth: number;
  maxHeight: number;
  targetHeight: number;
  baseY: number;
  color: string;
  radius: number;
  delay: number;
  gradientId: string;
}> = ({ x, barWidth, maxHeight, targetHeight, baseY, color, radius, delay, gradientId }) => {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withDelay(
      delay,
      withSpring(1, {
        damping: 12,
        stiffness: 100,
        mass: 0.8,
      }),
    );
  }, []);

  const animatedProps = useAnimatedProps(() => {
    const h = interpolate(progress.value, [0, 1], [0, targetHeight]);
    return {
      y: baseY - h,
      height: Math.max(h, 0),
    };
  });

  return (
    <AnimatedRect
      x={x}
      width={barWidth}
      rx={radius}
      ry={radius}
      fill={`url(#${gradientId})`}
      animatedProps={animatedProps}
    />
  );
};

const StaggeredBars: React.FC<StaggeredBarsProps> = ({
  bars,
  width = 300,
  height = 150,
  barRadius = 6,
  gap = 8,
  defaultColor = '#7850FF',
  staggerDelay = 100,
  style,
}) => {
  const padding = 16;
  const chartWidth = width - padding * 2;
  const chartHeight = height - padding * 2;
  const barCount = bars.length;
  const barWidth = (chartWidth - gap * (barCount - 1)) / barCount;
  const baseY = height - padding;

  return (
    <View style={[{ width, height }, style]}>
      <Svg viewBox={`0 0 ${width} ${height}`} width={width} height={height}>
        <Defs>
          {bars.map((bar, i) => {
            const c = bar.color || defaultColor;
            return (
              <LinearGradient key={i} id={`barGrad${i}`} x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0%" stopColor={c} stopOpacity="1" />
                <Stop offset="100%" stopColor={c} stopOpacity="0.4" />
              </LinearGradient>
            );
          })}
        </Defs>

        {/* Track lines */}
        {[0.25, 0.5, 0.75, 1].map((pct, i) => (
          <Rect
            key={i}
            x={padding}
            y={baseY - chartHeight * pct}
            width={chartWidth}
            height={0.5}
            fill="rgba(255, 255, 255, 0.06)"
          />
        ))}

        {/* Animated bars */}
        {bars.map((bar, i) => (
          <Bar
            key={i}
            x={padding + i * (barWidth + gap)}
            barWidth={barWidth}
            maxHeight={chartHeight}
            targetHeight={chartHeight * bar.value}
            baseY={baseY}
            color={bar.color || defaultColor}
            radius={barRadius}
            delay={i * staggerDelay}
            gradientId={`barGrad${i}`}
          />
        ))}
      </Svg>
    </View>
  );
};

export default StaggeredBars;
