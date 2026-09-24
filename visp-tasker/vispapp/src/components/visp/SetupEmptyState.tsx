/**
 * SetupEmptyState — la lista vacía que dice POR QUÉ está vacía.
 *
 * Plan: docs/plan-checklist-cuenta.md §5
 *
 * Un checklist en el Home no sirve de nada si el proveedor entra a la bolsa y
 * lee «No hay trabajos disponibles». Ese mensaje es mentira cuando el motivo es
 * que no ha puesto su dirección, y es el momento exacto en que abandona.
 *
 * Solo se monta cuando la lista está vacía —va dentro de `ListEmptyComponent`—,
 * así que la llamada no cuesta nada en el camino normal. Usa EL MISMO
 * diccionario `setup.*` que el checklist: un paso, un texto, un destino.
 */

import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Colors } from '../../theme/colors';
import { useTheme } from '../../theme/ThemeContext';
import { useTranslation } from '../../i18n';
import {
  Readiness,
  ReadinessStepKey,
  readinessService,
} from '../../services/readinessService';

interface Props {
  /** Qué pasos puede explicar ESTA pantalla, en orden de prioridad. La bolsa
   *  habla de dirección/servicios/precio; las ganancias, del banco. */
  watch: ReadinessStepKey[];
  /** Lo que se dice cuando no falta nada: entonces el vacío SÍ es verdad. */
  fallbackTitle: string;
  fallbackBody: string;
}

/** Texto y destino de cada paso cuando es él quien deja la lista vacía. */
const GUION: Record<string, { titulo: string; cuerpo: string; boton: string }> = {
  address: {
    titulo: 'setup.empty.noAddress',
    cuerpo: 'setup.empty.noAddressBody',
    boton: 'setup.empty.noAddressCta',
  },
  services: {
    titulo: 'setup.empty.noServices',
    cuerpo: 'setup.empty.noServicesBody',
    boton: 'setup.empty.noServicesCta',
  },
  rates: {
    titulo: 'setup.empty.noRates',
    cuerpo: 'setup.empty.noRatesBody',
    boton: 'setup.empty.noRatesCta',
  },
  payouts: {
    titulo: 'setup.empty.noPayouts',
    cuerpo: 'setup.empty.noPayoutsBody',
    boton: 'setup.empty.noPayoutsCta',
  },
};

export function SetupEmptyState({
  watch,
  fallbackTitle,
  fallbackBody,
}: Props): React.JSX.Element {
  const { t } = useTranslation();
  const theme = useTheme();
  const navigation = useNavigation<any>();
  const [datos, setDatos] = useState<Readiness | null>(null);

  useEffect(() => {
    let vivo = true;
    readinessService
      .get('provider')
      .then((r) => vivo && setDatos(r))
      .catch(() => vivo && setDatos(null));
    return () => {
      vivo = false;
    };
  }, []);

  // El primero de los que vigila esta pantalla que esté pendiente. `in_review`
  // no cuenta: el usuario no puede hacer nada con él, y ofrecerle un botón
  // sería mandarle a repetir algo que ya hizo.
  const culpable = datos
    ? watch.find((k) =>
        datos.steps.some((p) => p.key === k && p.status === 'action_required'),
      )
    : undefined;

  const paso = culpable
    ? datos!.steps.find((p) => p.key === culpable)
    : undefined;

  const ir = () => {
    switch (culpable) {
      case 'address':
        navigation.navigate('ProviderProfile', { screen: 'AddressEdit' });
        break;
      case 'services':
        navigation.navigate('ProviderProfile', { screen: 'ProviderOnboarding' });
        break;
      case 'rates':
        navigation.navigate('ProviderProfile', { screen: 'MyPrices' });
        break;
      case 'payouts':
        navigation.navigate('PayoutsOnboarding');
        break;
      default:
        break;
    }
  };

  if (!culpable || !paso) {
    // Nada pendiente: el vacío es real y se dice sin rodeos.
    return (
      <View style={styles.caja}>
        <Text style={[styles.titulo, { color: theme.textPrimary }]}>{fallbackTitle}</Text>
        <Text style={[styles.cuerpo, { color: theme.textSecondary }]}>{fallbackBody}</Text>
      </View>
    );
  }

  const guion = GUION[culpable];
  const faltan =
    culpable === 'rates'
      ? (paso.meta.total ?? 0) - (paso.meta.withRate ?? 0)
      : 0;

  return (
    <View style={styles.caja}>
      <Text style={[styles.titulo, { color: theme.textPrimary }]}>{t(guion.titulo)}</Text>
      <Text style={[styles.cuerpo, { color: theme.textSecondary }]}>
        {t(guion.cuerpo, { n: faltan })}
      </Text>
      <Pressable
        onPress={ir}
        accessibilityRole="button"
        accessibilityLabel={t(guion.boton)}
        style={[styles.boton, { backgroundColor: Colors.primary }]}
      >
        <Text style={styles.botonTexto}>{t(guion.boton)}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  caja: { paddingVertical: 36, paddingHorizontal: 24, alignItems: 'center' },
  titulo: { fontSize: 17, fontWeight: '700', textAlign: 'center', marginBottom: 8 },
  cuerpo: { fontSize: 14, lineHeight: 20, textAlign: 'center' },
  boton: {
    marginTop: 18,
    paddingVertical: 12,
    paddingHorizontal: 22,
    borderRadius: 12,
  },
  botonTexto: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
});

export default SetupEmptyState;
