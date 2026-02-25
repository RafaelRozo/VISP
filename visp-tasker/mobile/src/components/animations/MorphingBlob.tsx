/**
 * MorphingBlob
 *
 * Smooth organic blob that continuously morphs between shapes via
 * animated rotation + scale on the outer View. The blob shape is an
 * SVG path — pure code, no raster images, crisp at any scale.
 */

import React, { useEffect } from 'react';
import { ViewStyle } from 'react-native';
import Svg, { Defs, RadialGradient, Stop, Path } from 'react-native-svg';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  Easing,
} from 'react-native-reanimated';

interface MorphingBlobProps {
  size?: number;
  color?: string;
  opacity?: number;
  duration?: number;
  style?: ViewStyle;
}

const BLOB_PATH =
  'M60,-30 C90,0 90,30 60,60 C30,90 -30,90 -60,60 C-90,30 -90,-30 -60,-60 C-30,-90 30,-90 60,-30Z';

const MorphingBlob: React.FC<MorphingBlobProps> = ({
  size = 300,
  color = '#7850FF',
  opacity = 0.3,
  duration = 8000,
  style,
}) => {
  const rotation = useSharedValue(0);
  const scale = useSharedValue(1);
  const blobOpacity = useSharedValue(opacity);

  useEffect(() => {
    // Slow continuous rotation
    rotation.value = withRepeat(
      withTiming(360, { duration: duration * 2, easing: Easing.linear }),
      -1,
      false,
    );

    // Breathing scale
    scale.value = withRepeat(
      withSequence(
        withTiming(1.15, { duration: duration / 2, easing: Easing.inOut(Easing.ease) }),
        withTiming(0.85, { duration: duration / 2, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
      true,
    );

    // Subtle opacity pulse
    blobOpacity.value = withRepeat(
      withSequence(
        withTiming(opacity * 1.2, { duration: duration / 3, easing: Easing.inOut(Easing.ease) }),
        withTiming(opacity * 0.7, { duration: duration / 3, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
      true,
    );
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    width: size,
    height: size,
    transform: [
      { rotate: `${rotation.value}deg` },
      { scale: scale.value },
    ],
    opacity: blobOpacity.value,
  }));

  return (
    <Animated.View style={[animatedStyle, style]}>
      <Svg viewBox="-100 -100 200 200" width={size} height={size}>
        <Defs>
          <RadialGradient id="blobGrad" cx="0" cy="0" r="80" gradientUnits="userSpaceOnUse">
            <Stop offset="0%" stopColor={color} stopOpacity="0.9" />
            <Stop offset="60%" stopColor={color} stopOpacity="0.4" />
            <Stop offset="100%" stopColor={color} stopOpacity="0" />
          </RadialGradient>
        </Defs>

        <Path d={BLOB_PATH} fill="url(#blobGrad)" />
      </Svg>
    </Animated.View>
  );
};

export default MorphingBlob;
