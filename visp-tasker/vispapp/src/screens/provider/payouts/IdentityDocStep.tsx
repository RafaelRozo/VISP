/**
 * VISP — Payouts onboarding · Identity / verification step.
 *
 * Abre, en el navegador del sistema, UNA PÁGINA DE VISP que monta el
 * componente `account-onboarding` de Connect.
 *
 * Antes abría el alta ALOJADA de Stripe (`AccountLink`), y en live eso enseña
 * el registro de Stripe: correo y contraseña. Es la superficie de las cuentas
 * donde STRIPE recoge los requisitos; las nuestras declaran lo contrario
 * (`requirement_collection: application`, `dashboard: none`) porque VISP asume
 * las pérdidas y el KYC. Se le estaba pidiendo al proveedor una cuenta de
 * Stripe que por diseño nunca tendrá, y ahí abandonaban.
 *
 * Por qué el navegador y no un WebView dentro de la app: Stripe NO permite
 * montar los componentes integrados en un webview de una app móvil, y su
 * propia recomendación para ese caso es enlazar a un navegador que los
 * renderice. El SDK nativo de React Native existe y sería el paso siguiente
 * si se quiere todo dentro de la app.
 *
 * We use Linking (core RN, always available) rather than expo-web-browser
 * (not linked in this build). When the provider returns to the app, AppState
 * flips to 'active' and we refresh status: TOS due → TOS step; complete /
 * payouts enabled → exit; otherwise stay so they can retry.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { Screen } from '../../../components/visp';
import { useVispTheme, VispText, VispSpace } from '../../../theme/visp';
import { GlassButton } from '../../../components/glass';
import { useTranslation } from '../../../i18n';
import { payoutsV2Service } from '../../../services/payoutsV2Service';
import { advanceToStep } from './navigation';

// Naranja de aviso. No está en la paleta de VISP (que solo tiene `ok` y
// `danger`) y esto no es ninguna de las dos: el alta no ha fallado, falta un
// dato. Literal aquí en vez de ampliar la paleta por un solo uso.
const AVISO = '#E67E22';

export default function IdentityDocStep(): React.JSX.Element {
  const t = useVispTheme();
  const { t: tr } = useTranslation();
  const navigation = useNavigation<any>();
  const [busy, setBusy] = useState(false);
  const awaitingReturn = useRef(false);
  // Motivo por el que Stripe rechazó la identidad, si lo hay. Sin esto el
  // proveedor reintenta a ciegas: le pasó a una proveedora real cuyo documento
  // no coincidía con el nombre de la cuenta, y la app solo le decía "falta".
  const [problema, setProblema] = useState<{ code: string | null; message: string | null } | null>(null);
  // Llegar a esta pantalla en Canadá significa que la coincidencia de datos
  // falló: Stripe no pide documento cuando nombre, fecha y dirección cuadran.
  // Así que el camino principal aquí es CORREGIR, no subir una foto.
  const [porDatos, setPorDatos] = useState(false);

  const refreshAndRoute = useCallback(async () => {
    const fresh = await payoutsV2Service.getStatus();
    const needsTos = (fresh.requirementsDue ?? []).some(
      (r) => r === 'tos_acceptance.date' || r === 'tos_acceptance.ip',
    );
    if (fresh.onboardingStep === 'tos' || needsTos) {
      advanceToStep(navigation, 'tos');
    } else if (fresh.onboardingStep === 'complete' || fresh.payoutsEnabled) {
      navigation.popToTop();
      navigation.goBack();
    } else if (fresh.verificationCode || fresh.verificationMessage) {
      setProblema({ code: fresh.verificationCode, message: fresh.verificationMessage });
      setPorDatos(fresh.documentRequired);
    } else {
      setProblema(null);
      setPorDatos(fresh.documentRequired);
    }
    // else: still pending → stay on screen, let them retry / check again.
  }, [navigation]);

  // Al entrar, mirar si ya hay un rechazo pendiente de un intento anterior:
  // quien vuelve a esta pantalla días después tiene derecho a saber por qué.
  useEffect(() => {
    payoutsV2Service
      .getStatus()
      .then((s) => {
        if (s.verificationCode || s.verificationMessage) {
          setProblema({ code: s.verificationCode, message: s.verificationMessage });
        }
        setPorDatos(s.documentRequired);
      })
      .catch(() => { /* la pantalla funciona igual sin el motivo */ });
  }, []);

  // When the provider comes back from the hosted Stripe page, re-read status.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && awaitingReturn.current) {
        awaitingReturn.current = false;
        refreshAndRoute().catch(() => { /* leave them on the screen */ });
      }
    });
    return () => sub.remove();
  }, [refreshAndRoute]);

  const handleVerify = useCallback(async () => {
    setBusy(true);
    try {
      const { url } = await payoutsV2Service.embedUrl();
      if (!url) {
        Alert.alert(tr('common.error'), tr('payoutsV2.errorGeneric'));
        return;
      }
      awaitingReturn.current = true;
      await Linking.openURL(url);
    } catch (err: any) {
      awaitingReturn.current = false;
      Alert.alert(tr('common.error'), err?.message ?? tr('payoutsV2.errorGeneric'));
    } finally {
      setBusy(false);
    }
  }, [tr]);

  return (
    <Screen edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={12}>
          <Text style={[VispText.bodyStrong, { color: t.violet }]}>{'< '}</Text>
        </TouchableOpacity>
        <Text style={[VispText.headlineMid, { color: t.text, flex: 1, marginLeft: 8 }]}>{tr('payoutsV2.idDocTitle')}</Text>
      </View>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={[VispText.body, { color: t.text2, marginBottom: VispSpace.section }]}>
          {tr('payoutsV2.idDocSubtitle')}
        </Text>

        {/* El motivo de Stripe, traducido cuando conocemos el código y en sus
            palabras cuando no. `document_name_mismatch` se lleva además un
            botón: el arreglo no es volver a subir el documento, es corregir el
            nombre de la cuenta, y eso se hace en el primer paso. */}
        {problema && (
          <View style={[styles.card, styles.aviso, { backgroundColor: t.card, borderColor: AVISO, marginBottom: VispSpace.section }]}>
            <Text style={[VispText.caption, { color: AVISO, marginBottom: 6 }]}>
              {tr('payoutsV2.idDocRejectedTitle')}
            </Text>
            <Text style={[VispText.body, { color: t.text }]}>
              {problema.code === 'document_name_mismatch'
                ? tr('payoutsV2.idDocNameMismatch')
                : problema.message ?? tr('payoutsV2.idDocRejectedGeneric')}
            </Text>
            {problema.code === 'document_name_mismatch' && (
              <>
                <View style={{ height: 12 }} />
                <GlassButton
                  title={tr('payoutsV2.idDocFixName')}
                  variant="outline"
                  onPress={() => advanceToStep(navigation, 'identity')}
                />
              </>
            )}
          </View>
        )}

        {/* En Canadá Stripe verifica por coincidencia de datos y NO pide
            documento cuando cuadran. Si estamos aquí es porque no cuadraron, y
            corregir el nombre es más rápido y más probable que la foto. Se
            omite si ya hay una tarjeta de rechazo arriba diciendo lo mismo. */}
        {porDatos && !problema && (
          <View style={[styles.card, styles.aviso, { backgroundColor: t.card, borderColor: AVISO, marginBottom: VispSpace.section }]}>
            <Text style={[VispText.body, { color: t.text }]}>
              {tr('payoutsV2.idDocDataMismatchNote')}
            </Text>
          </View>
        )}

        <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>
          <Text style={[VispText.caption, { color: t.text3, marginBottom: 6 }]}>{tr('payoutsV2.idDocWhatYouNeed')}</Text>
          <Text style={[VispText.body, { color: t.text }]}>{tr('payoutsV2.idDocStep1')}</Text>
          <Text style={[VispText.body, { color: t.text, marginTop: 4 }]}>{tr('payoutsV2.idDocStep2')}</Text>
          <Text style={[VispText.body, { color: t.text, marginTop: 4 }]}>{tr('payoutsV2.idDocStep3')}</Text>
        </View>

        {/* El enlace de Stripe caduca en ~5 minutos y es de un solo uso. Quien
            lo abre tarde, o reabre la pestaña vieja, cae en la pantalla de
            inicio de sesión de Stripe y cree que necesita una cuenta — no la
            necesita. Decirlo ANTES de tocar el botón evita ese susto; el aviso
            de `idDocHostedNote` lo repite por si ya le pasó. */}
        <Text style={[VispText.caption, { color: t.text3, marginTop: 10 }]}>
          {tr('payoutsV2.idDocExpiry')}
        </Text>

        {busy && (
          <View style={{ alignItems: 'center', marginTop: VispSpace.section }}>
            <ActivityIndicator size="large" color={t.violet} />
          </View>
        )}

        <View style={{ height: VispSpace.section * 2 }} />
        {porDatos && (
          <>
            <GlassButton
              title={tr('payoutsV2.nameNotMatchedFix')}
              variant="glow"
              onPress={() => advanceToStep(navigation, 'identity')}
            />
            <View style={{ height: VispSpace.section }} />
          </>
        )}
        <GlassButton
          title={tr('payoutsV2.idDocStart')}
          variant={porDatos ? 'outline' : 'glow'}
          loading={busy}
          onPress={handleVerify}
        />
        <View style={{ height: VispSpace.section }} />
        <GlassButton
          title={tr('payoutsV2.idDocRefresh') || "I've finished — check status"}
          variant="outline"
          onPress={() => refreshAndRoute().catch(() => {})}
        />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: VispSpace.gutter, paddingBottom: 40 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: VispSpace.gutter, paddingTop: 12, paddingBottom: VispSpace.section },
  card: { borderRadius: 14, borderWidth: 1, padding: VispSpace.card },
  aviso: { borderWidth: 1.5 },
});
