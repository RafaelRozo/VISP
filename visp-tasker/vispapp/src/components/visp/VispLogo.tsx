/**
 * VispLogo — el logo de VISP en vector: una V dentro de un anillo abierto.
 *
 * La geometría se midió sobre `assets/icon.jpeg` (el logo oficial, 1280 px) y
 * coincide con él al 96 % píxel a píxel; el resto es el suavizado del JPEG. El
 * maestro exportable vive en `assets/brand/visp-logo-{light,dark}.svg` con las
 * mismas coordenadas: si cambia el logo, cambian los dos.
 *
 * Un solo `color`: el anillo de fondo es ese mismo color al 14 % —sobre negro da
 * el #232323 del original— y así el logo funciona igual en claro y en oscuro.
 */

import React from 'react';
import Svg, { Circle, Path } from 'react-native-svg';

/** Coordenadas del original (lienzo 1280). El viewBox recorta el margen. */
export const VISP_LOGO = {
  viewBox: '225 225 830 830',
  cx: 640,
  cy: 640,
  r: 390,
  stroke: 35,
  trackOpacity: 0.14,
  /** Tramo blanco: de las 12 en punto, en sentido horario, hasta ~148°. */
  arc: 'M 640 250 A 390 390 0 1 1 307.8 844.4',
  arcLength: 1623,
  v:
    'M 453 453 L 519 453 Q 547 453 556 479.5 L 640 728 L 722.7 479.5 ' +
    'Q 731.5 453 759.5 453 L 826 453 L 710.3 780.8 Q 693.6 828 643.6 828 ' +
    'L 587 828 Z',
} as const;

interface Props {
  size?: number;
  color?: string;
}

export function VispLogo({ size = 48, color = '#FFFFFF' }: Props): React.JSX.Element {
  const g = VISP_LOGO;
  return (
    <Svg viewBox={g.viewBox} width={size} height={size} accessibilityLabel="VISP">
      <Circle
        cx={g.cx}
        cy={g.cy}
        r={g.r}
        fill="none"
        stroke={color}
        strokeOpacity={g.trackOpacity}
        strokeWidth={g.stroke}
      />
      <Path d={g.arc} fill="none" stroke={color} strokeWidth={g.stroke} strokeLinecap="round" />
      <Path d={g.v} fill={color} />
    </Svg>
  );
}

export default VispLogo;
