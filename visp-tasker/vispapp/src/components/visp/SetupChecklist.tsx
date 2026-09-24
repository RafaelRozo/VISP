/**
 * SetupChecklist — «¿qué me falta para operar?»
 *
 * Plan: docs/plan-checklist-cuenta.md
 *
 * Una tarjeta bajo el nombre, en el Home de los dos roles. Tres reglas que son
 * el diseño entero:
 *
 *   1. SOLO UN PASO DESTACADO: el siguiente. Un checklist donde todo grita a la
 *      vez no guía, abruma. Los hechos van en gris con su ✓ y los que aún no
 *      tocan en gris apagado, sin poder tocarse.
 *   2. CUANDO ESTÁ TODO HECHO NO SE PINTA NADA. No se queda en verde: un muro
 *      de ✓ permanente es ruido en la pantalla de alguien que ya trabaja.
 *   3. EL TEXTO DICE LA CONSECUENCIA, NO EL REQUISITO. «Añade tu cuenta
 *      bancaria» es una tarea; «no puedes cobrar hasta que añadas tu cuenta
 *      bancaria» es un motivo.
 *
 * Los pasos `in_review` no se pueden tocar. Si se pudieran, el proveedor
 * volvería a subir el documento que ya subió y nos inundaría el admin.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  LayoutAnimation,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  UIManager,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Colors } from '../../theme/colors';
import { useTheme } from '../../theme/ThemeContext';
import { useTranslation } from '../../i18n';
import { GlassCard } from '../glass';
import { Icon, VispIconName } from './Icon';
import {
  Readiness,
  ReadinessStep,
  ReadinessStepKey,
  readinessService,
} from '../../services/readinessService';

if (
  Platform.OS === 'android' &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const ICONO: Record<ReadinessStepKey, VispIconName> = {
  contract: 'shield',
  address: 'pin',
  services: 'wrench',
  rates: 'money',
  payouts: 'bank',
  profile: 'user',
  customer_address: 'pin',
  payment_method: 'card',
  phone: 'phone',
};

interface Props {
  role: 'provider' | 'customer';
  /** Sube el resultado al padre: la bolsa y las ganancias pintan su estado
   *  vacío con el MISMO dato, para no decir dos cosas distintas. */
  onLoaded?: (readiness: Readiness | null) => void;
  /** Cambiar este valor fuerza una recarga (pull-to-refresh del Home). */
  reloadKey?: number;
  /** Pintarlo aunque no falte nada.
   *
   *  En el Home NO: allí es un empujón, y un muro de ✓ permanente es ruido para
   *  quien ya trabaja. Pero al desaparecer no quedaba NINGÚN sitio donde ver el
   *  estado de tu cuenta — Ricardo lo buscó como cliente y no estaba ni en el
   *  Home ni en Ajustes, porque tenía los 3 pasos hechos. El Perfil es el sitio
   *  durable: ahí se enseña siempre, y cuando está todo hecho lo dice. */
  alwaysShow?: boolean;
}

export function SetupChecklist({
  role,
  onLoaded,
  reloadKey,
  alwaysShow = false,
}: Props): React.JSX.Element | null {
  const { t } = useTranslation();
  const theme = useTheme();
  const navigation = useNavigation<any>();
  const [datos, setDatos] = useState<Readiness | null>(null);
  const [abierto, setAbierto] = useState(false);
  const [tocado, setTocado] = useState(false);

  useEffect(() => {
    let vivo = true;
    readinessService
      .get(role)
      .then((r) => {
        if (!vivo) return;
        setDatos(r);
        onLoaded?.(r);
        // Quien no ha empezado ve la lista ABIERTA: es su primer minuto en la
        // app y plegarla le esconde justo lo que tiene que hacer.
        //
        // «No ha empezado» NO es `doneCount === 0`. Se probó en el dispositivo
        // con un alta nueva y salía plegada: el contrato se firma en el REGISTRO
        // —la puerta lo obliga antes de que vea el Home— así que un proveedor
        // recién llegado siempre llega con 1 de 6. El contrato no es algo que
        // haga desde aquí, así que no cuenta como haber arrancado.
        const arrancado = r.steps.some(
          (p) => p.key !== 'contract' && p.status === 'done',
        );
        if (!tocado) setAbierto(!arrancado && !r.allDone);
      })
      .catch(() => {
        // El checklist NUNCA rompe el Home. Sin respuesta, no se pinta: es una
        // ayuda, no una puerta — la puerta de verdad está en el servidor.
        if (vivo) {
          setDatos(null);
          onLoaded?.(null);
        }
      });
    return () => {
      vivo = false;
    };
    // `tocado` a propósito fuera: no queremos recargar por abrir la tarjeta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, reloadKey]);

  const irA = useCallback(
    (clave: ReadinessStepKey) => {
      // El stack de perfil se monta con un nombre distinto por rol, pero las
      // pantallas de dentro son las mismas.
      const perfil = role === 'provider' ? 'ProviderProfile' : 'CustomerProfile';
      switch (clave) {
        case 'address':
        case 'customer_address':
          navigation.navigate(perfil, { screen: 'AddressEdit' });
          break;
        case 'services':
          navigation.navigate(perfil, { screen: 'ProviderOnboarding' });
          break;
        case 'rates':
          navigation.navigate(perfil, { screen: 'MyPrices' });
          break;
        case 'payouts':
          // Vive en el stack raíz, no en el de perfil.
          navigation.navigate('PayoutsOnboarding');
          break;
        case 'profile':
          // Al editor de la bio, abierto. Antes llevaba a Credentials, que es
          // donde están las licencias — ni siquiera el sitio de las fotos, que
          // viven en Verification. La fila prometía una cosa y llevaba a otra.
          navigation.navigate(perfil, { screen: 'ProfileMain', params: { openBio: true } });
          break;
        case 'payment_method':
          navigation.navigate(perfil, { screen: 'PaymentMethods' });
          break;
        case 'phone':
          navigation.navigate(perfil, { screen: 'ProfileMain' });
          break;
        default:
          break;
      }
    },
    [navigation, role],
  );

  if (!datos) return null;
  if (datos.allDone && !alwaysShow) return null;

  const alternar = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setTocado(true);
    setAbierto((v) => !v);
  };

  /** El texto de apoyo de cada paso, con sus números dentro. */
  const pista = (p: ReadinessStep): string => {
    const m = p.meta || {};
    switch (p.key) {
      case 'address':
        return p.status === 'done'
          ? [m.city, m.radiusKm ? `${m.radiusKm} km` : null].filter(Boolean).join(' · ')
          : t('setup.addressHint');
      case 'services':
        return p.status === 'done'
          ? t('setup.servicesDone', { n: m.count ?? 0 })
          : t('setup.servicesHint');
      case 'rates':
        if (p.status === 'done') return t('setup.ratesDone', { n: m.total ?? 0 });
        return (m.withRate ?? 0) > 0
          ? t('setup.ratesSome', { n: (m.total ?? 0) - (m.withRate ?? 0) })
          : t('setup.ratesHint');
      case 'payouts':
        if (p.status === 'in_review') return t('setup.payoutsReview');
        if (p.status === 'done') return t('setup.payoutsDone');
        return (m.done ?? 0) > 0
          ? t('setup.payoutsSome', { done: m.done ?? 0, total: m.total ?? 5 })
          : t('setup.payoutsHint');
      case 'profile':
        return p.status === 'done' ? t('setup.profileDone') : t('setup.profileHint');
      case 'customer_address':
        return p.status === 'done' ? (m.city ?? '') : t('setup.customerAddressHint');
      case 'payment_method':
        return p.status === 'done' ? t('setup.cardDone') : t('setup.cardHint');
      case 'phone':
        return t('setup.phoneHint');
      case 'contract':
        return p.status === 'done' ? t('setup.contractDone') : t('setup.contractHint');
      default:
        return '';
    }
  };

  const siguiente = datos.steps.find((p) => p.key === datos.nextKey);
  const pendientes = datos.totalCount - datos.doneCount;

  // Divisoria: los recomendados van SIEMPRE debajo de una línea, nunca
  // mezclados con los que impiden trabajar.
  const primerNoBloqueante = datos.steps.findIndex((p) => !p.blocking);

  return (
    <GlassCard variant="elevated" style={styles.card}>
      <Pressable
        onPress={alternar}
        accessibilityRole="button"
        accessibilityLabel={t('setup.title')}
        accessibilityState={{ expanded: abierto }}
        style={styles.cabecera}
      >
        <View style={styles.puntos}>
          {datos.steps.map((p, i) => (
            <View
              key={p.key}
              style={[
                styles.punto,
                {
                  backgroundColor:
                    p.status === 'done'
                      ? Colors.success
                      : p.status === 'in_review'
                      ? Colors.warning
                      : 'transparent',
                  borderColor:
                    p.status === 'done'
                      ? Colors.success
                      : p.status === 'in_review'
                      ? Colors.warning
                      : theme.textTertiary,
                  marginLeft: i === 0 ? 0 : 5,
                },
              ]}
            />
          ))}
        </View>
        <View style={styles.cabeceraTexto}>
          <Text style={[styles.titulo, { color: theme.textPrimary }]}>
            {datos.allDone
              ? `${t('setup.title')} · ${t('setup.allDone')}`
              : `${t('setup.title')} · ${t('setup.progress', {
                  done: datos.doneCount,
                  total: datos.totalCount,
                })}`}
          </Text>
          {siguiente ? (
            <Text style={[styles.subtitulo, { color: theme.textSecondary }]} numberOfLines={1}>
              {t('setup.next', { step: t(`setup.step.${siguiente.key}`) })}
            </Text>
          ) : null}
        </View>
        <Icon
          name={abierto ? 'chevron-down' : 'chevron-right'}
          size={18}
          color={theme.textSecondary}
        />
      </Pressable>

      {abierto ? (
        <View style={styles.lista}>
          {datos.steps.map((p, i) => {
            const hecho = p.status === 'done';
            const revisando = p.status === 'in_review';
            const destacado = p.key === datos.nextKey;
            const tocable = !hecho && !revisando;
            const color = hecho
              ? Colors.success
              : revisando
              ? Colors.warning
              : destacado
              ? Colors.primary
              : theme.textTertiary;

            return (
              <View key={p.key}>
                {primerNoBloqueante > 0 && i === primerNoBloqueante ? (
                  <View style={[styles.divisoria, { backgroundColor: theme.border }]} />
                ) : null}
                <Pressable
                  onPress={tocable ? () => irA(p.key) : undefined}
                  disabled={!tocable}
                  accessibilityRole={tocable ? 'button' : undefined}
                  accessibilityLabel={t(`setup.step.${p.key}`)}
                  style={[
                    styles.fila,
                    destacado
                      ? { backgroundColor: `${Colors.primary}12`, borderColor: `${Colors.primary}44` }
                      : null,
                  ]}
                >
                  <View style={[styles.casilla, { borderColor: color, backgroundColor: hecho ? Colors.success : 'transparent' }]}>
                    {hecho ? (
                      <Icon name="check" size={12} color="#FFFFFF" />
                    ) : (
                      <Icon name={ICONO[p.key]} size={12} color={color} />
                    )}
                  </View>
                  <View style={styles.filaTexto}>
                    <Text
                      style={[
                        styles.filaTitulo,
                        {
                          color: hecho || !destacado ? theme.textSecondary : theme.textPrimary,
                          fontWeight: destacado ? '700' : '600',
                        },
                      ]}
                    >
                      {t(`setup.step.${p.key}`)}
                    </Text>
                    {pista(p) ? (
                      <Text style={[styles.filaPista, { color: theme.textSecondary }]}>
                        {pista(p)}
                      </Text>
                    ) : null}
                  </View>
                  {tocable ? (
                    <Icon name="chevron-right" size={16} color={destacado ? Colors.primary : theme.textTertiary} />
                  ) : null}
                </Pressable>
              </View>
            );
          })}

          {pendientes > 0 ? (
            <Text style={[styles.pie, { color: theme.textSecondary }]}>
              {datos.blockingCount > 0
                ? t('setup.footerBlocking', { n: datos.blockingCount })
                : t('setup.footerOptional')}
            </Text>
          ) : null}
        </View>
      ) : null}
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  card: { padding: 14, marginBottom: 14 },
  cabecera: { flexDirection: 'row', alignItems: 'center' },
  puntos: { flexDirection: 'row', alignItems: 'center', marginRight: 12 },
  punto: { width: 8, height: 8, borderRadius: 4, borderWidth: 1.5 },
  cabeceraTexto: { flex: 1 },
  titulo: { fontSize: 14, fontWeight: '700' },
  subtitulo: { fontSize: 12, marginTop: 2 },
  lista: { marginTop: 12 },
  divisoria: { height: StyleSheet.hairlineWidth, marginVertical: 8 },
  fila: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 9,
    paddingHorizontal: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'transparent',
    marginBottom: 2,
  },
  casilla: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
    marginTop: 1,
  },
  filaTexto: { flex: 1 },
  filaTitulo: { fontSize: 14 },
  filaPista: { fontSize: 12, marginTop: 2, lineHeight: 16 },
  pie: { fontSize: 11, marginTop: 8, paddingHorizontal: 8, lineHeight: 15 },
});

export default SetupChecklist;
