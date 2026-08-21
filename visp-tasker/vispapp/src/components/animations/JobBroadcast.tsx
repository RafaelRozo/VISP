/**
 * JobBroadcast — el trabajo saliendo hacia los proveedores.
 *
 * Hecha para la pantalla de "trabajo publicado" (2026-08-21). Sustituye a las
 * ondas concéntricas, que son el spinner de toda la vida: giran, no dicen nada,
 * y en un cuadro grande se leen como "esto no cargó".
 *
 * Aquí la animación ES el mensaje. En el centro está el trabajo. Alrededor se
 * encienden, uno a uno, los proveedores a los que llega — cada uno unido por una
 * línea que se dibuja desde el centro hacia fuera. Eso es literalmente lo que
 * ocurre por detrás: al crear el trabajo el backend lo difunde a los proveedores
 * cualificados de la zona.
 *
 * Y al terminar no se cambia una cosa por otra: el centro se vuelve verde con su
 * check y la constelación se queda encendida. La animación se completa en vez de
 * desaparecer, que es lo que hace que se sienta como un final y no como un corte.
 *
 * Todo es SVG dibujado en código — ni imágenes ni Lottie que descargar.
 */

import React, { useEffect } from 'react';
import { View, ViewStyle } from 'react-native';
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';
import Animated, {
  Easing,
  interpolate,
  useAnimatedProps,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

const ACircle = Animated.createAnimatedComponent(Circle);
const ALine = Animated.createAnimatedComponent(Line);
const APath = Animated.createAnimatedComponent(Path);
const ARect = Animated.createAnimatedComponent(Rect);

/**
 * Posiciones de los proveedores, en polares.
 *
 * A mano y no repartidos por igual: seis puntos perfectamente equidistantes
 * dibujan un hexágono, y un hexágono parece un diagrama. Con los ángulos y los
 * radios desiguales parece un mapa — que es la idea, son vecinos a distintas
 * distancias.
 */
const SATELITES: { ang: number; rad: number; delay: number }[] = [
  { ang: -18, rad: 0.96, delay: 0 },
  { ang: 46, rad: 0.78, delay: 130 },
  { ang: 112, rad: 0.94, delay: 260 },
  { ang: 168, rad: 0.72, delay: 90 },
  { ang: 214, rad: 0.9, delay: 350 },
  { ang: 292, rad: 0.8, delay: 200 },
];

interface SateliteProps {
  cx: number;
  cy: number;
  x: number;
  y: number;
  color: string;
  delay: number;
  estatico: boolean;
}

function Satelite({ cx, cy, x, y, color, delay, estatico }: SateliteProps): React.JSX.Element {
  // 0 = aún no ha salido; 1 = línea dibujada y punto dentro.
  const p = useSharedValue(estatico ? 1 : 0);

  useEffect(() => {
    if (estatico) return;
    p.value = withDelay(
      delay,
      withTiming(1, { duration: 620, easing: Easing.out(Easing.cubic) }),
    );
  }, [delay, estatico, p]);

  // La línea CRECE hacia el punto en vez de aparecer entera: es lo que da la
  // sensación de que algo viaja desde el centro hacia fuera.
  const lineaProps = useAnimatedProps(() => ({
    x2: cx + (x - cx) * Math.min(p.value / 0.72, 1),
    y2: cy + (y - cy) * Math.min(p.value / 0.72, 1),
    opacity: interpolate(p.value, [0, 0.15, 1], [0, 0.45, 0.28]),
  }));

  // El punto entra pasado de tamaño y se asienta. Ese rebote de 8→6 es la
  // diferencia entre "aparece un círculo" y "llega alguien".
  const puntoProps = useAnimatedProps(() => ({
    r: interpolate(p.value, [0, 0.7, 0.88, 1], [0, 0, 8, 6]),
    opacity: interpolate(p.value, [0, 0.7, 1], [0, 0, 1]),
  }));

  const haloProps = useAnimatedProps(() => ({
    r: interpolate(p.value, [0.7, 1], [6, 13]),
    opacity: interpolate(p.value, [0.7, 0.9, 1], [0, 0.35, 0]),
  }));

  return (
    <>
      <ALine x1={cx} y1={cy} stroke={color} strokeWidth={1} animatedProps={lineaProps} />
      <ACircle cx={x} cy={y} fill="none" stroke={color} strokeWidth={1} animatedProps={haloProps} />
      <ACircle cx={x} cy={y} fill={color} animatedProps={puntoProps} />
    </>
  );
}

interface JobBroadcastProps {
  size?: number;
  /** Color de la señal y de los proveedores. */
  color?: string;
  /** Color del centro una vez confirmado. */
  doneColor?: string;
  /** true = trabajo confirmado: el centro pasa a check verde. */
  done?: boolean;
  /**
   * Color del fondo de la pantalla. El check se recorta contra el disco, así que
   * tiene que ser el fondo y no un negro fijo: en modo claro el verde de `ok` es
   * oscuro (#15803D) y un check negro encima no se ve.
   */
  knockout?: string;
  /** Respeta "reducir movimiento": pinta el estado final sin animar. */
  reduceMotion?: boolean;
  style?: ViewStyle;
}

export default function JobBroadcast({
  size = 240,
  color = '#A78BFA',
  doneColor = '#9AE6B4',
  knockout = '#0A0A0A',
  done = false,
  reduceMotion = false,
  style,
}: JobBroadcastProps): React.JSX.Element {
  const c = size / 2;
  const alcance = size * 0.42;

  const puntos = SATELITES.map(({ ang, rad, delay }) => {
    const r = (ang * Math.PI) / 180;
    return {
      x: c + Math.cos(r) * alcance * rad,
      y: c + Math.sin(r) * alcance * rad,
      delay,
    };
  });

  // Latido del centro mientras se emite. Se para al confirmar: si siguiera
  // latiendo detrás del check, seguiría diciendo "esperando".
  const latido = useSharedValue(0);
  useEffect(() => {
    if (done || reduceMotion) {
      latido.value = withTiming(0, { duration: 220 });
      return;
    }
    // `reverse: false` reinicia al valor inicial en cada vuelta, que es justo el
    // latido. Encadenar un timing de 0 ms para "rebobinar" es un caso raro que
    // reanimated resuelve mal.
    latido.value = withRepeat(
      withTiming(1, { duration: 900, easing: Easing.out(Easing.ease) }),
      -1,
      false,
    );
  }, [done, reduceMotion, latido]);

  const latidoProps = useAnimatedProps(() => ({
    r: interpolate(latido.value, [0, 1], [22, 46]),
    opacity: interpolate(latido.value, [0, 0.4, 1], [0.28, 0.14, 0]),
  }));

  // El centro: una tarjeta (el trabajo) que al confirmarse se funde en el disco
  // verde del check.
  const paso = useSharedValue(done ? 1 : 0);
  useEffect(() => {
    paso.value = withTiming(done ? 1 : 0, {
      duration: reduceMotion ? 0 : 420,
      easing: Easing.out(Easing.cubic),
    });
  }, [done, reduceMotion, paso]);

  const tarjetaProps = useAnimatedProps(() => ({
    opacity: 1 - paso.value,
  }));
  // Los dos renglones llevan su propio tono dentro del valor animado. Poner
  // `opacity` como prop fija Y como prop animada deja ganar a la animada y se
  // pierde el matiz: los dos renglones acabarían igual de marcados.
  const renglon1Props = useAnimatedProps(() => ({ opacity: (1 - paso.value) * 0.9 }));
  const renglon2Props = useAnimatedProps(() => ({ opacity: (1 - paso.value) * 0.55 }));
  const discoProps = useAnimatedProps(() => ({
    r: interpolate(paso.value, [0, 1], [0, 26]),
    opacity: paso.value,
  }));
  const checkProps = useAnimatedProps(() => ({
    // El check se DIBUJA: la marca aparece de un trazo, no de golpe.
    strokeDashoffset: interpolate(paso.value, [0, 0.35, 1], [26, 26, 0]),
    opacity: paso.value,
  }));

  const lado = 30;

  return (
    <View style={[{ width: size, height: size }, style]}>
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {puntos.map((p, i) => (
          <Satelite
            key={i}
            cx={c}
            cy={c}
            x={p.x}
            y={p.y}
            color={color}
            delay={p.delay}
            estatico={reduceMotion}
          />
        ))}

        <ACircle cx={c} cy={c} fill={color} animatedProps={latidoProps} />

        {/* El trabajo: una tarjeta con dos renglones, no un logo. Lo que sale
            hacia los proveedores es la publicación, no la marca. */}
        <ARect
          x={c - lado / 2}
          y={c - lado / 2}
          width={lado}
          height={lado}
          rx={9}
          fill={color}
          animatedProps={tarjetaProps}
        />
        <ARect
          x={c - 8}
          y={c - 5}
          width={16}
          height={2}
          rx={1}
          fill="#FFFFFF"
          animatedProps={renglon1Props}
        />
        <ARect
          x={c - 8}
          y={c + 1}
          width={10}
          height={2}
          rx={1}
          fill="#FFFFFF"
          animatedProps={renglon2Props}
        />

        <ACircle cx={c} cy={c} fill={doneColor} animatedProps={discoProps} />
        <APath
          d={`M ${c - 9} ${c} L ${c - 2.5} ${c + 6.5} L ${c + 10} ${c - 6}`}
          stroke={knockout}
          strokeWidth={2.6}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
          strokeDasharray={26}
          animatedProps={checkProps}
        />
      </Svg>
    </View>
  );
}
