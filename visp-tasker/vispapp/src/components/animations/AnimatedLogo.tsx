/**
 * AnimatedLogo
 *
 * El logo de VISP con entrada animada: el anillo de fondo aparece, el tramo
 * blanco se dibuja desde las 12 en punto en sentido horario —como un progreso
 * que se completa— y la V entra mientras tanto. Una sola vez, sin bucle: es la
 * pantalla de login, no un indicador de carga.
 *
 * La geometría es la de `VispLogo` (una sola fuente). react-native-svg +
 * react-native-reanimated.
 */

import React, { useEffect } from 'react';
import { View, ViewStyle } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import Animated, {
  useSharedValue,
  useAnimatedProps,
  withTiming,
  withDelay,
  Easing,
  interpolate,
} from 'react-native-reanimated';

import { VISP_LOGO } from '../visp/VispLogo';

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

interface AnimatedLogoProps {
  size?: number;
  color?: string;
  style?: ViewStyle;
  animate?: boolean;
}

const AnimatedLogo: React.FC<AnimatedLogoProps> = ({
  size = 120,
  color = '#FFFFFF',
  style,
  animate = true,
}) => {
  const g = VISP_LOGO;
  const track = useSharedValue(animate ? 0 : 1);
  const draw = useSharedValue(animate ? 0 : 1);
  const mark = useSharedValue(animate ? 0 : 1);

  useEffect(() => {
    if (!animate) return;
    track.value = withTiming(1, { duration: 400 });
    draw.value = withDelay(
      150,
      withTiming(1, { duration: 1300, easing: Easing.bezier(0.25, 0.1, 0.25, 1) }),
    );
    mark.value = withDelay(350, withTiming(1, { duration: 700, easing: Easing.out(Easing.cubic) }));
    // Los shared values son estables; solo depende de `animate`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animate]);

  const trackProps = useAnimatedProps(() => ({
    strokeOpacity: g.trackOpacity * track.value,
  }));

  const arcProps = useAnimatedProps(() => ({
    strokeDashoffset: interpolate(draw.value, [0, 1], [g.arcLength, 0]),
    // Con el trazo a longitud cero, el extremo redondeado seguiría pintando un
    // punto en las 12 antes de empezar: se oculta hasta que arranca.
    strokeOpacity: draw.value > 0.001 ? 1 : 0,
  }));

  const markProps = useAnimatedProps(() => ({
    fillOpacity: mark.value,
  }));

  return (
    <View style={[{ width: size, height: size }, style]}>
      <Svg viewBox={g.viewBox} width={size} height={size} accessibilityLabel="VISP">
        <AnimatedCircle
          cx={g.cx}
          cy={g.cy}
          r={g.r}
          fill="none"
          stroke={color}
          strokeWidth={g.stroke}
          animatedProps={trackProps}
        />
        <AnimatedPath
          d={g.arc}
          fill="none"
          stroke={color}
          strokeWidth={g.stroke}
          strokeLinecap="round"
          strokeDasharray={g.arcLength}
          animatedProps={arcProps}
        />
        <AnimatedPath d={g.v} fill={color} animatedProps={markProps} />
      </Svg>
    </View>
  );
};

export default AnimatedLogo;
