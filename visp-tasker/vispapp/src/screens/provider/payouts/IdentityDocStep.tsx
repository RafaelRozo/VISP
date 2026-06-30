/**
 * VISP — Payouts onboarding · Identity / verification step.
 *
 * Opens Stripe's HOSTED account-onboarding flow (document + selfie + liveness)
 * in the system browser via Linking. This is required because a connected
 * account's `individual.verification.proof_of_liveness` can only be cleared
 * through Stripe's hosted verification — the native Identity sheet verifies the
 * standalone session but never satisfies the account's liveness requirement, so
 * the wizard used to loop on "Continue setup". In test mode the hosted page
 * completes with test data and clears the requirement.
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

export default function IdentityDocStep(): React.JSX.Element {
  const t = useVispTheme();
  const { t: tr } = useTranslation();
  const navigation = useNavigation<any>();
  const [busy, setBusy] = useState(false);
  const awaitingReturn = useRef(false);

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
    }
    // else: still pending → stay on screen, let them retry / check again.
  }, [navigation]);

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
      const { url } = await payoutsV2Service.onboardingLink();
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

        <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>
          <Text style={[VispText.caption, { color: t.text3, marginBottom: 6 }]}>{tr('payoutsV2.idDocWhatYouNeed')}</Text>
          <Text style={[VispText.body, { color: t.text }]}>{tr('payoutsV2.idDocStep1')}</Text>
          <Text style={[VispText.body, { color: t.text, marginTop: 4 }]}>{tr('payoutsV2.idDocStep2')}</Text>
          <Text style={[VispText.body, { color: t.text, marginTop: 4 }]}>{tr('payoutsV2.idDocStep3')}</Text>
        </View>

        {busy && (
          <View style={{ alignItems: 'center', marginTop: VispSpace.section }}>
            <ActivityIndicator size="large" color={t.violet} />
          </View>
        )}

        <View style={{ height: VispSpace.section * 2 }} />
        <GlassButton
          title={tr('payoutsV2.idDocStart')}
          variant="glow"
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
});
