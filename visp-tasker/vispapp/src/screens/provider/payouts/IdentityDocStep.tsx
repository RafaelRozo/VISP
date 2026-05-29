/**
 * VISP — Payouts onboarding · Identity document step.
 *
 * Opens the native Stripe Identity verification sheet (document + selfie
 * with liveness check) via @stripe/stripe-identity-react-native. The sheet
 * is fully native; we just provide the session/ephemeral key fetched from
 * /v2/identity-document and listen for the completion status.
 *
 * Outcomes:
 *  - FlowCompleted  → refresh status and advance to next step (TOS or exit)
 *  - FlowCanceled   → stay on screen, let the user retry
 *  - FlowFailed     → surface the error and let the user retry
 */

import React, { useCallback, useEffect } from 'react';
import { ActivityIndicator, Alert, Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useStripeIdentity } from '@stripe/stripe-identity-react-native';

import { Screen } from '../../../components/visp';
import { useVispTheme, VispText, VispSpace } from '../../../theme/visp';
import { GlassButton } from '../../../components/glass';
import { useTranslation } from '../../../i18n';
import { payoutsV2Service } from '../../../services/payoutsV2Service';
import { advanceToStep } from './navigation';

const brandLogo = Image.resolveAssetSource(require('../../../../assets/icon.png'));

export default function IdentityDocStep(): React.JSX.Element {
  const t = useVispTheme();
  const { t: tr } = useTranslation();
  const navigation = useNavigation<any>();

  const fetchOptions = useCallback(async () => {
    const session = await payoutsV2Service.startIdentityDocument();
    return {
      sessionId: session.sessionId,
      ephemeralKeySecret: session.ephemeralKeySecret,
      brandLogo,
    };
  }, []);

  const { present, status, loading, error } = useStripeIdentity(fetchOptions);

  useEffect(() => {
    if (status !== 'FlowCompleted') return;
    (async () => {
      try {
        const fresh = await payoutsV2Service.getStatus();
        const needsTos = (fresh.requirementsDue ?? []).some((r) =>
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
    })();
  }, [status, navigation, tr]);

  useEffect(() => {
    if (status === 'FlowFailed' && error) {
      Alert.alert(tr('payoutsV2.idDocFailedTitle'), error.localizedMessage || error.message);
    }
  }, [status, error, tr]);

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

        {status === 'FlowCanceled' && (
          <Text style={[VispText.body, { color: t.text3, marginTop: VispSpace.section, textAlign: 'center' }]}>
            {tr('payoutsV2.idDocCanceled')}
          </Text>
        )}

        {loading && (
          <View style={{ alignItems: 'center', marginTop: VispSpace.section }}>
            <ActivityIndicator size="large" color={t.violet} />
          </View>
        )}

        <View style={{ height: VispSpace.section * 2 }} />
        <GlassButton
          title={status === 'FlowCanceled' ? tr('payoutsV2.idDocRetry') : tr('payoutsV2.idDocStart')}
          variant="glow"
          loading={loading}
          onPress={() => { present(); }}
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
