/**
 * VISP — "Job posted" (antes MatchingScreen).
 *
 * REESCRITA el 2026-08-21. Lo que había venía del modelo viejo y se notaba:
 *
 *  - Una GlassCard de 280×280 casi vacía con el logo "V" pulsando en medio. Un
 *    cuadro grande y vacío se lee como algo que no cargó, no como una animación.
 *  - Paleta `Colors` + `GlassButton`, que son SOLO OSCUROS (blancos y rgba
 *    fijos). En modo claro esta pantalla se rompía como se rompían las tarjetas.
 *  - El texto repetía "Job Posted" dos veces —en el epígrafe y de estado— y no
 *    contaba en ningún sitio lo único que el cliente necesita saber ahora: que
 *    no elige proveedor, que le van a llegar ofertas, y que no se le cobra nada
 *    hasta que acepte una.
 *
 * AHORA manda `JobBroadcast`: el trabajo en el centro y los proveedores
 * encendiéndose alrededor uno a uno, unidos por una línea que se dibuja. Eso es
 * literalmente lo que ocurre por detrás —al crear el trabajo el backend lo
 * difunde a los proveedores cualificados de la zona (jobs.py, "Broadcast N
 * offers for job")—, así que la animación informa en vez de entretener.
 * Al confirmarse, el centro se vuelve verde y aparece el recorrido de tres
 * pasos, que enseña el modelo nuevo sin gastar un párrafo en explicarlo.
 *
 * El trabajo YA está creado cuando se llega aquí (lo crea BookingScreen). Esta
 * pantalla confirma, no espera: por eso la transición es corta.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { Screen, Eyebrow } from '../../components/visp';
import { JobBroadcast } from '../../components/animations';
import { useVispTheme, VispText, VispSpace, VispRadius } from '../../theme/visp';
import { useTranslation } from '../../i18n';
import type { CustomerFlowParamList } from '../../types';

type MatchingRouteProp = RouteProp<CustomerFlowParamList, 'Matching'>;
type MatchingNavProp = NativeStackNavigationProp<CustomerFlowParamList, 'Matching'>;

/**
 * Lo justo para que la emisión se vea como una emisión y no como un parpadeo.
 * Antes eran 1800 ms de "Posting your job…" sobre un trabajo que ya estaba
 * posteado: una espera fingida, y encima larga.
 */
const POSTING_MS = 1200;

/** Debe coincidir con `default_close_at` del backend (offerService). */
const OFFER_WINDOW_HOURS = 48;

// ─────────────────────────────────────────────────────────────
// Recorrido de tres pasos
// ─────────────────────────────────────────────────────────────

interface StepsProps {
  /** 0 = posteando, 1 = posteado y esperando ofertas. */
  active: number;
}

/**
 * Posted → Offers → You choose.
 *
 * Existe para responder de un vistazo a "¿y ahora qué?". Con el modelo anterior
 * el cliente salía de aquí con un proveedor asignado; ahora sale con un trabajo
 * publicado y una espera por delante, y sin esta línea esa espera parece que
 * algo salió mal.
 */
function Steps({ active }: StepsProps): React.JSX.Element {
  const t = useVispTheme();
  const { t: tr } = useTranslation();

  const pasos = [
    tr('posted.step1') || 'Posted',
    tr('posted.step2') || 'Offers arrive',
    tr('posted.step3') || 'You choose',
  ];

  return (
    <View style={styles.steps}>
      {pasos.map((label, i) => {
        const hecho = i < active;
        const actual = i === active;
        const color = hecho ? t.ok : actual ? t.violet : t.text3;
        return (
          <React.Fragment key={label}>
            {i > 0 ? (
              <View style={[styles.stepLine, { backgroundColor: t.border }]} />
            ) : null}
            <View style={styles.step}>
              <View
                style={[
                  styles.stepDot,
                  {
                    borderColor: color,
                    backgroundColor: hecho || actual ? color : 'transparent',
                  },
                ]}
              />
              <Text
                style={[
                  VispText.eyebrowTight,
                  { color: hecho || actual ? t.text2 : t.text3 },
                ]}
                numberOfLines={1}
              >
                {label.toUpperCase()}
              </Text>
            </View>
          </React.Fragment>
        );
      })}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────
// Pantalla
// ─────────────────────────────────────────────────────────────

function MatchingScreen(): React.JSX.Element {
  const t = useVispTheme();
  const { t: tr } = useTranslation();
  const route = useRoute<MatchingRouteProp>();
  const navigation = useNavigation<MatchingNavProp>();
  const { taskName } = route.params;

  const [posted, setPosted] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const contentOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    navigation.setOptions({ headerShown: false });
  }, [navigation]);

  useEffect(() => {
    let vivo = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const revelar = () => {
      if (!vivo) return;
      setPosted(true);
      Animated.timing(contentOpacity, {
        toValue: 1,
        duration: 420,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }).start();
    };

    // Con "reducir movimiento" activado no hay ondas que mirar, así que esperar
    // por ellas es esperar por nada: se va directo a la confirmación.
    AccessibilityInfo.isReduceMotionEnabled()
      .then((reducido) => {
        if (!vivo) return;
        setReduceMotion(reducido);
        if (reducido) revelar();
        else timer = setTimeout(revelar, POSTING_MS);
      })
      .catch(() => {
        timer = setTimeout(revelar, POSTING_MS);
      });

    return () => {
      vivo = false;
      if (timer) clearTimeout(timer);
    };
  }, [contentOpacity]);

  const handleViewMyJobs = useCallback(() => {
    const rootNav = navigation.getParent();
    if (rootNav) {
      rootNav.reset({
        index: 0,
        routes: [{ name: 'CustomerHome', params: { screen: 'MyJobs' } } as any],
      });
    } else {
      navigation.navigate('MyJobs' as any);
    }
  }, [navigation]);

  const handleBackToHome = useCallback(() => {
    const rootNav = navigation.getParent();
    if (rootNav) {
      rootNav.reset({ index: 0, routes: [{ name: 'CustomerHome' as any }] });
    } else {
      navigation.goBack();
    }
  }, [navigation]);

  return (
    <Screen>
      <View style={styles.container}>
        {/* Cabecera */}
        <View style={styles.top}>
          <Eyebrow>
            {posted
              ? `§ ${(tr('posted.eyebrowDone') || 'Job posted').toUpperCase()}`
              : `§ ${(tr('posted.eyebrowSending') || 'Posting').toUpperCase()}`}
          </Eyebrow>
          <Text style={[VispText.headline, styles.taskName, { color: t.text }]}>
            {taskName}
          </Text>
        </View>

        {/* Sin caja: la constelación necesita aire alrededor, y el marco solo la
            encerraba en un rectángulo medio vacío. */}
        <View style={styles.stage}>
          <JobBroadcast
            size={250}
            color={t.violet}
            doneColor={t.ok}
            knockout={t.bg}
            done={posted}
            reduceMotion={reduceMotion}
          />

          <Text style={[VispText.body, styles.stageText, { color: t.text2 }]}>
            {posted
              ? tr('posted.reachHint') ||
                'Providers who do this service can see it now.'
              : tr('posted.sending') ||
                'Sending it to providers in your area…'}
          </Text>
        </View>

        {/* Qué pasa ahora */}
        <Animated.View style={[styles.bottom, { opacity: contentOpacity }]}>
          <Steps active={posted ? 1 : 0} />

          <Text style={[VispText.body, styles.explain, { color: t.text2 }]}>
            {tr('posted.explain') ||
              'Each one sends an offer with their price and how long they need. You compare them and pick the one you want.'}
          </Text>

          {/* Las dos cosas que quitan ansiedad en la espera: que hay un plazo, y
              que esperar no cuesta nada. Iban perdidas en un párrafo gris. */}
          <View style={[styles.facts, { borderColor: t.border, backgroundColor: t.surface }]}>
            <View style={styles.fact}>
              <Text style={[VispText.chip, { color: t.violet }]}>
                {`${OFFER_WINDOW_HOURS}H`}
              </Text>
              <Text style={[VispText.body, styles.factText, { color: t.text2 }]}>
                {tr('posted.window') || 'Offers stay open for two days.'}
              </Text>
            </View>
            <View style={[styles.factDivider, { backgroundColor: t.border }]} />
            <View style={styles.fact}>
              <Text style={[VispText.chip, { color: t.ok }]}>$0</Text>
              <Text style={[VispText.body, styles.factText, { color: t.text2 }]}>
                {tr('posted.noCharge') ||
                  'Nothing is charged until you accept an offer.'}
              </Text>
            </View>
          </View>

          <Pressable
            onPress={handleViewMyJobs}
            style={[styles.cta, { backgroundColor: t.violet }]}
            accessibilityRole="button"
          >
            <Text style={[VispText.bodyStrong, { color: '#FFFFFF' }]}>
              {tr('posted.viewJobs') || 'View my jobs'}
            </Text>
          </Pressable>

          <Pressable
            onPress={handleBackToHome}
            style={[styles.ctaGhost, { borderColor: t.border }]}
            accessibilityRole="button"
          >
            <Text style={[VispText.bodyStrong, { color: t.text2 }]}>
              {tr('posted.backHome') || 'Back to home'}
            </Text>
          </Pressable>

          <Text style={[VispText.eyebrowTight, styles.footer, { color: t.text3 }]}>
            {tr('posted.disclaimer') ||
              'VISP acts as a platform intermediary only. Providers are independent service professionals.'}
          </Text>
        </Animated.View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: VispSpace.gutter,
    justifyContent: 'space-between',
    paddingBottom: 20,
  },
  top: { alignItems: 'center', paddingTop: 28, gap: 6 },
  taskName: { textAlign: 'center' },

  stage: { alignItems: 'center', justifyContent: 'center', gap: 18 },
  stageText: { textAlign: 'center', paddingHorizontal: 20 },

  bottom: { gap: 16 },

  // Recorrido
  steps: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  step: { alignItems: 'center', gap: 6 },
  stepDot: { width: 10, height: 10, borderRadius: 5, borderWidth: 1.5 },
  // flex:1 para que la línea ocupe el hueco entre pasos sea cual sea el ancho
  // del texto; con un ancho fijo, "OFFERS ARRIVE" desplazaba el último paso.
  stepLine: { flex: 1, height: StyleSheet.hairlineWidth, marginBottom: 18 },

  explain: { textAlign: 'center' },

  // Los dos datos de la espera
  facts: {
    borderWidth: 1,
    borderRadius: VispRadius.cardLg,
    paddingVertical: 4,
  },
  fact: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  factText: { flex: 1 },
  factDivider: { height: StyleSheet.hairlineWidth, marginHorizontal: 14 },

  cta: {
    height: 52,
    borderRadius: VispRadius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaGhost: {
    height: 52,
    borderRadius: VispRadius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: { textAlign: 'center', lineHeight: 15, marginTop: 4 },
});

export default MatchingScreen;
