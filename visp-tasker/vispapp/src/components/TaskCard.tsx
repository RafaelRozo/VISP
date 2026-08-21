/**
 * VISP — TaskCard: un servicio del catálogo dentro de una categoría.
 *
 * REESCRITA el 2026-08-21. La versión anterior usaba la paleta `Colors`, que es
 * SOLO OSCURA (`textPrimary` estaba fijado a `#FFFFFF`), más los estilos "glass"
 * pensados para fondo negro. En modo claro eso dejaba los títulos blancos sobre
 * blanco y un velo lechoso sobre toda la lista. Ahora lee el tema como el resto
 * de la app y funciona en los dos modos.
 *
 * Tres decisiones de contenido, no solo de estilo:
 *
 * 1. **El precio es un RANGO con su unidad**, no "desde $45". El cliente compara
 *    servicios entre sí, y "45" no dice si es por hora, por mueble o por el
 *    trabajo entero. Es el mismo criterio que ya aplicamos en la reserva.
 *
 * 2. **Fuera la duración estimada.** Salía del catálogo —una media que no
 *    describe este trabajo— y bajo el modelo de ofertas quien dice cuánto tarda
 *    es el proveedor en su oferta. Enseñar un número nuestro al lado del suyo
 *    solo genera discusiones.
 *
 * 3. **Fuera el chevron**. Era un `>` escrito como texto, igual que el `$` y la
 *    `T` que hacían de iconos. Una fila entera pulsable no necesita una flecha
 *    para anunciarse, y esos caracteres se veían como lo que eran: caracteres.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';

import { useVispTheme, VispText, VispRadius } from '../theme/visp';
import LevelBadge from './LevelBadge';
import type { ServiceLevel } from '../types';

interface TaskCardProps {
  id: string;
  name: string;
  description: string;
  level: ServiceLevel;
  basePrice: number;
  priceRangeMin?: number;
  priceRangeMax?: number;
  pricingUnit?: string | null;
  onPress: (taskId: string) => void;
  style?: ViewStyle;
}

/** Sufijo de unidad para pegar al precio. Sin él, una cifra no significa nada. */
function unitSuffix(unit?: string | null): string {
  switch ((unit ?? '').toUpperCase()) {
    case 'HOURLY':
      return '/hr';
    case 'PER_UNIT':
      return '/item';
    case 'PER_AREA':
      return '/m²';
    case 'PER_LINEAR_M':
      return '/m';
    case 'PER_VISIT':
      return '/visit';
    case 'PER_CONTRACT':
      return '/hr';
    default:
      // FLAT_PACKAGE y cualquier unidad nueva: el importe ya es el total.
      return '';
  }
}

/** "$45 – $90" cuando hay rango; si min y max coinciden, una sola cifra. */
function priceLabel(min?: number, max?: number, base?: number): string {
  const lo = min ?? base ?? 0;
  const hi = max ?? base ?? 0;
  if (hi > lo) return `$${lo} – $${hi}`;
  return `$${lo}`;
}

function TaskCard({
  id,
  name,
  description,
  level,
  basePrice,
  priceRangeMin,
  priceRangeMax,
  pricingUnit,
  onPress,
  style,
}: TaskCardProps): React.JSX.Element {
  const t = useVispTheme();
  const precio = priceLabel(priceRangeMin, priceRangeMax, basePrice);
  const unidad = unitSuffix(pricingUnit);

  return (
    <Pressable
      onPress={() => onPress(id)}
      style={({ pressed }) => [
        styles.container,
        {
          backgroundColor: pressed ? t.cardHi : t.card,
          borderColor: t.border,
        },
        style,
      ]}
      accessibilityRole="button"
      accessibilityLabel={`${name}. ${precio}${unidad}.`}
      accessibilityHint="Opens the service details"
    >
      {/* Nombre y nivel en la misma línea: son las dos cosas que filtran la
          decisión antes de leer nada más. */}
      <View style={styles.header}>
        <Text style={[VispText.bodyStrong, styles.name, { color: t.text }]} numberOfLines={2}>
          {name}
        </Text>
        <LevelBadge level={level} size="small" />
      </View>

      <Text style={[VispText.body, { color: t.text2 }]} numberOfLines={2}>
        {description}
      </Text>

      {/* El precio es el ancla de la tarjeta: va solo, en su línea, y la unidad
          va apagada al lado para que la cifra siga siendo lo que se escanea. */}
      <View style={[styles.footer, { borderTopColor: t.border }]}>
        <Text style={[VispText.bodyStrong, { color: t.text }]}>
          {precio}
          {unidad ? <Text style={[VispText.body, { color: t.text3 }]}>{` ${unidad}`}</Text> : null}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    borderWidth: 1,
    borderRadius: VispRadius.card,
    padding: 16,
    marginBottom: 10,
    gap: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  // flex:1 para que el nombre largo se parta en dos líneas en vez de empujar
  // la insignia de nivel fuera de la tarjeta.
  name: { flex: 1 },
  footer: {
    marginTop: 4,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});

export default React.memo(TaskCard);
