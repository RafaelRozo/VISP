/**
 * VISP — Payouts onboarding · Identity document step.
 *
 * Opens a Stripe Identity verification session (document + selfie). The
 * native UI is rendered by @stripe/stripe-identity-react-native — that
 * package is NOT yet installed (requires `npx expo install
 * @stripe/stripe-identity-react-native && cd ios && pod install` + a
 * native rebuild). Until then this screen calls the backend to provision
 * the session, surfaces the session ID, and lets the user skip ahead so
 * the rest of onboarding can be tested end-to-end.
 */

import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { Screen } from '../../../components/visp';
import { useVispTheme, VispText, VispSpace } from '../../../theme/visp';
import { GlassButton } from '../../../components/glass';
import { useTranslation } from '../../../i18n';
import { IdentitySessionOut, payoutsV2Service } from '../../../services/payoutsV2Service';
import { advanceToStep } from './navigation';

export default function IdentityDocStep(): React.JSX.Element {
  const t = useVispTheme();
  const { t: tr } = useTranslation();
  const navigation = useNavigation<any>();
  const [session, setSession] = useState<IdentitySessionOut | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await payoutsV2Service.startIdentityDocument();
        if (!cancelled) setSession(s);
      } catch (err: any) {
        if (!cancelled) setError(err?.message ?? tr('payoutsV2.errorGeneric'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [tr]);

  const onSkip = async () => {
    // Without the native Identity SDK installed, `proof_of_liveness`
    // cannot be completed from the app — it requires either the camera
    // sheet (Option B, pending) or an admin approval from the Stripe
    // Dashboard. Bounce the user to TOS if it's still pending, otherwise
    // exit to Earnings so they don't get stuck in a re-mount loop here.
    try {
      const status = await payoutsV2Service.getStatus();
      const needsTos = (status.requirementsDue ?? []).some((r) =>
        r === 'tos_acceptance.date' || r === 'tos_acceptance.ip',
      );
      if (needsTos) {
        advanceToStep(navigation, 'tos');
      } else {
        navigation.popToTop();
        navigation.goBack();
      }
    } catch (err: any) {
      Alert.alert(tr('common.error'), err?.message ?? tr('payoutsV2.errorGeneric'));
    }
  };

  return (
    <Screen edges={["top","bottom"]}>
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

        {loading && <ActivityIndicator size="large" color={t.violet} />}
        {error && <Text style={[VispText.body, { color: t.danger }]}>{error}</Text>}

        {session && (
          <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>
            <Text style={[VispText.caption, { color: t.text3, marginBottom: 6 }]}>{tr('payoutsV2.idDocSessionLabel')}</Text>
            <Text style={[VispText.label, { color: t.text }]} numberOfLines={1}>{session.sessionId}</Text>
            <Text style={[VispText.body, { color: t.text3, marginTop: VispSpace.section }]}>
              {tr('payoutsV2.idDocSdkNote')}
            </Text>
          </View>
        )}

        <View style={{ height: VispSpace.section * 2 }} />
        <GlassButton title={tr('payoutsV2.idDocSkip')} variant="outline" onPress={onSkip} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: VispSpace.gutter, paddingBottom: 40 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: VispSpace.gutter, paddingTop: 12, paddingBottom: VispSpace.section },
  card: { borderRadius: 14, borderWidth: 1, padding: VispSpace.card, marginTop: VispSpace.section },
});
