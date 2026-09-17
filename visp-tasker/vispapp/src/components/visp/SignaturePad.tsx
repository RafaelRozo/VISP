/**
 * VISP — SignaturePad.
 *
 * Lienzo de firma con el dedo. `PanResponder` acumula los puntos y
 * `react-native-svg` los pinta como `<Path>`.
 *
 * POR QUÉ A MANO Y NO UNA LIBRERÍA
 * --------------------------------
 * `react-native-svg` (15.15.3) y `PanResponder` YA están en el proyecto, así
 * que esto no añade ninguna dependencia. Con Expo 55 + prebuild, cada módulo
 * nativo nuevo es riesgo en cada build. La alternativa razonable,
 * `react-native-signature-canvas`, mete un WebView dentro de un ScrollView
 * (fricción de gestos conocida) y se estiliza inyectando CSS, lo que complica
 * el modo claro/oscuro.
 *
 * EL DATO QUE SALE ES VECTORIAL
 * -----------------------------
 * `onChange` entrega los puntos en crudo, no una imagen. El servidor los
 * guarda tal cual y rasteriza el PNG para el PDF: se puede re-generar a
 * cualquier resolución el día que haya que ampliar la firma para una disputa.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  GestureResponderEvent,
  Keyboard,
  LayoutChangeEvent,
  PanResponder,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useVispTheme } from '../../theme/visp';

export type SignatureStroke = number[][];

export interface SignatureValue {
  width: number;
  height: number;
  strokes: SignatureStroke[];
}

interface SignaturePadProps {
  onChange: (value: SignatureValue) => void;
  height?: number;
  /** Texto bajo la línea de firma (normalmente el nombre legal). */
  caption?: string;
  clearLabel?: string;
  hintLabel?: string;
  /**
   * Avisa cuando el dedo entra y sale del lienzo.
   *
   * Existe porque el lienzo va DENTRO del scroll del contrato y ese scroll
   * tiene que quedarse quieto mientras se firma: si el contenido se desplaza a
   * mitad del trazo, la firma sale partida. El padre lo usa para
   * `scrollEnabled={!drawing}` — ver `ContractSignScreen`.
   */
  onDrawStateChange?: (drawing: boolean) => void;
}

/**
 * Un trazo de dedo genera cientos de puntos por segundo. Guardarlos todos
 * engorda la petición sin que la firma se vea mejor, así que se descarta el
 * punto que no se ha movido lo suficiente desde el anterior.
 */
const MIN_DISTANCE = 1.4;

function toPath(stroke: SignatureStroke): string {
  if (stroke.length === 0) return '';
  if (stroke.length === 1) {
    // Un punto suelto (un toque) no tiene línea: se dibuja como un punto.
    const [x, y] = stroke[0];
    return `M ${x} ${y} L ${x + 0.1} ${y}`;
  }
  return stroke
    .map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`)
    .join(' ');
}

export function SignaturePad({
  onChange,
  height = 190,
  caption,
  clearLabel = 'Clear',
  hintLabel = 'Sign above',
  onDrawStateChange,
}: SignaturePadProps): React.JSX.Element {
  const t = useVispTheme();

  // El aviso al padre va por ref y no en las dependencias del `PanResponder`:
  // reconstruirlo a mitad de un trazo perdería el gesto.
  const drawStateRef = useRef(onDrawStateChange);
  drawStateRef.current = onDrawStateChange;

  // Los trazos cerrados viven en estado (repintan); el trazo en curso vive en
  // una ref y se refleja en `current` para que el dedo deje rastro inmediato.
  const strokesRef = useRef<SignatureStroke[]>([]);
  const currentRef = useRef<SignatureStroke>([]);
  const sizeRef = useRef({ width: 0, height });

  const [strokes, setStrokes] = useState<SignatureStroke[]>([]);
  const [current, setCurrent] = useState<SignatureStroke>([]);

  // ── El teclado y el primer toque ──────────────────────────────────────
  //
  // Si el teclado está abierto (se viene de escribir el nombre legal), el
  // primer toque sobre el lienzo SOLO lo cierra: no dibuja. Cerrarlo a mitad
  // del trazo no sirve —el `KeyboardAvoidingView` del padre quita su relleno,
  // el lienzo se recoloca y los puntos, que son relativos al lienzo, se van
  // 300 px—. Así que se sacrifica ese primer toque y se firma sobre una
  // pantalla ya quieta.
  const keyboardOpenRef = useRef(false);
  const swallowRef = useRef(false);

  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(showEvt, () => {
      keyboardOpenRef.current = true;
    });
    const hide = Keyboard.addListener(hideEvt, () => {
      keyboardOpenRef.current = false;
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  const emit = useCallback(() => {
    onChange({
      width: sizeRef.current.width,
      height: sizeRef.current.height,
      strokes: strokesRef.current,
    });
  }, [onChange]);

  const handleLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height: h } = e.nativeEvent.layout;
    sizeRef.current = { width, height: h };
  }, []);

  const addPoint = useCallback((e: GestureResponderEvent) => {
    const { locationX, locationY } = e.nativeEvent;
    const stroke = currentRef.current;
    const last = stroke[stroke.length - 1];
    if (last) {
      const dx = locationX - last[0];
      const dy = locationY - last[1];
      if (dx * dx + dy * dy < MIN_DISTANCE * MIN_DISTANCE) return;
    }
    stroke.push([locationX, locationY]);
    setCurrent([...stroke]);
  }, []);

  /** Cierra el trazo en curso y devuelve el scroll al padre. */
  const endStroke = useCallback(() => {
    if (swallowRef.current) {
      // Era el toque que cerró el teclado: no hay trazo que cerrar ni scroll
      // que devolver, porque nunca se bloqueó.
      swallowRef.current = false;
      return;
    }
    if (currentRef.current.length > 0) {
      strokesRef.current = [...strokesRef.current, currentRef.current];
      setStrokes(strokesRef.current);
    }
    currentRef.current = [];
    setCurrent([]);
    emit();
    drawStateRef.current?.(false);
  }, [emit]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        // Se reclama el gesto desde el primer contacto para que un ScrollView
        // padre no se lleve el arrastre a mitad de la firma.
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onShouldBlockNativeResponder: () => true,

        onPanResponderGrant: (e) => {
          // Teclado abierto: este toque solo lo cierra. Ver la nota de
          // `swallowRef` arriba.
          if (keyboardOpenRef.current) {
            swallowRef.current = true;
            Keyboard.dismiss();
            return;
          }
          swallowRef.current = false;
          drawStateRef.current?.(true);
          currentRef.current = [];
          addPoint(e);
        },
        onPanResponderMove: (e) => {
          if (swallowRef.current) return;
          addPoint(e);
        },
        onPanResponderRelease: () => endStroke(),
        // Sin esto el scroll del padre se quedaría bloqueado para siempre si el
        // gesto muere sin soltar (una llamada entrante, un modal): el usuario ya
        // no podría desplazarse por el contrato y la pantalla no tiene salida.
        onPanResponderTerminate: () => endStroke(),
      }),
    [addPoint, endStroke],
  );

  const handleClear = useCallback(() => {
    strokesRef.current = [];
    currentRef.current = [];
    setStrokes([]);
    setCurrent([]);
    emit();
  }, [emit]);

  const isEmpty = strokes.length === 0 && current.length === 0;
  const all = current.length > 0 ? [...strokes, current] : strokes;

  return (
    <View>
      <View
        onLayout={handleLayout}
        style={[
          styles.canvas,
          { height, backgroundColor: t.surface, borderColor: t.border },
        ]}
        {...panResponder.panHandlers}
      >
        <Svg style={StyleSheet.absoluteFill}>
          {all.map((stroke, i) => (
            <Path
              key={i}
              d={toPath(stroke)}
              stroke={t.text}
              strokeWidth={2.4}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          ))}
        </Svg>

        {/* Línea de firma, como en un contrato en papel. `pointerEvents=none`
            para que no se coma el gesto del dedo. */}
        <View pointerEvents="none" style={styles.baselineWrap}>
          <View style={[styles.baseline, { backgroundColor: t.border }]} />
          <Text style={[styles.caption, { color: t.text3 }]} numberOfLines={1}>
            {caption || hintLabel}
          </Text>
        </View>
      </View>

      <View style={styles.actions}>
        <Text style={[styles.hint, { color: t.text3 }]}>
          {isEmpty ? hintLabel : ' '}
        </Text>
        <TouchableOpacity
          onPress={handleClear}
          disabled={isEmpty}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Text
            style={[
              styles.clear,
              { color: isEmpty ? t.text4 : t.violet },
            ]}
          >
            {clearLabel}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  canvas: {
    borderWidth: 1,
    borderRadius: 14,
    overflow: 'hidden',
  },
  baselineWrap: {
    position: 'absolute',
    left: 18,
    right: 18,
    bottom: 16,
  },
  baseline: { height: 1, marginBottom: 6 },
  caption: { fontSize: 11 },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
    paddingHorizontal: 2,
  },
  hint: { fontSize: 12 },
  clear: { fontSize: 13, fontWeight: '600' },
});
