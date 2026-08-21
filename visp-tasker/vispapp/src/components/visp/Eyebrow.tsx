/**
 * VISP — Eyebrow micro-label.
 * Mono, uppercase, 10px with 0.16em tracking. Used for section labels and meta.
 *
 * El color por defecto pasó de `text3` a `text2` el 2026-08-21. Medido sobre el
 * fondo de la app, `text3` da 3.7:1 en oscuro (#6A6A6A sobre #0A0A0A) y 3.5:1 en
 * claro (#8A8A8A sobre blanco): por debajo del 4.5:1 que exige WCAG AA. Y a 10px
 * con tracking ancho no cuenta como "texto grande", así que no hay excepción que
 * valga. Con `text2` sube a 8.2:1 y las etiquetas de sección por fin se leen.
 *
 * `text3` sigue estando bien para lo que es de verdad secundario —contadores,
 * placeholders— donde no perderse nada si no se lee.
 */

import React from 'react';
import { Text, TextStyle } from 'react-native';
import { VispText, useVispTheme } from '../../theme/visp';

interface EyebrowProps {
  children: React.ReactNode;
  color?: string;
  tight?: boolean;
  style?: TextStyle;
}

export function Eyebrow({ children, color, tight, style }: EyebrowProps): React.JSX.Element {
  const t = useVispTheme();
  return (
    <Text style={[tight ? VispText.eyebrowTight : VispText.eyebrow, { color: color ?? t.text2 }, style]}>
      {children}
    </Text>
  );
}
