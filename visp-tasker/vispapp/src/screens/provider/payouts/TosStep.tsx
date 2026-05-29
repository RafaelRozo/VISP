/**
 * VISP — Payouts onboarding · Terms of Service step.
 *
 * The provider taps a single "I accept" toggle. IP + UA come from the
 * request headers server-side so they cannot be spoofed by the client.
 */

import React, { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { Screen } from '../../../components/visp';
import { useVispTheme, VispText, VispSpace } from '../../../theme/visp';
import { GlassButton } from '../../../components/glass';
import { useTranslation } from '../../../i18n';
import { payoutsV2Service } from '../../../services/payoutsV2Service';

export default function TosStep(): React.JSX.Element {
  const t = useVispTheme();
  const { t: tr } = useTranslation();
  const navigation = useNavigation<any>();
  const [accepted, setAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async () => {
    if (!accepted) {
      Alert.alert(tr('payoutsV2.tosNotAcceptedTitle'), tr('payoutsV2.tosNotAcceptedBody'));
      return;
    }
    setSubmitting(true);
    try {
      await payoutsV2Service.acceptTos();
      // TOS is the last user-facing step. If Stripe still requires
      // identity proof_of_liveness, that's outside the user's flow
      // (needs the native Identity SDK or an admin approval). Exit the
      // wizard regardless — EarningsScreen will surface the right
      // "Verifying…" / "Continue setup" state from /v2/status.
      navigation.popToTop();
      navigation.goBack();
    } catch (err: any) {
      Alert.alert(tr('common.error'), err?.message ?? tr('payoutsV2.errorGeneric'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Screen edges={["top","bottom"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={12}>
          <Text style={[VispText.bodyStrong, { color: t.violet }]}>{'< '}</Text>
        </TouchableOpacity>
        <Text style={[VispText.headlineMid, { color: t.text, flex: 1, marginLeft: 8 }]}>{tr('payoutsV2.tosTitle')}</Text>
      </View>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={[VispText.body, { color: t.text2, marginBottom: VispSpace.section }]}>
          {tr('payoutsV2.tosSubtitle')}
        </Text>
        <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>
          <Text style={[VispText.body, { color: t.text2 }]}>
            {tr('payoutsV2.tosBody')}
          </Text>
        </View>

        <TouchableOpacity onPress={() => setAccepted((v) => !v)} style={styles.checkRow}>
          <View
            style={[
              styles.box,
              {
                backgroundColor: accepted ? t.violet : 'transparent',
                borderColor: accepted ? t.violet : t.border,
              },
            ]}
          >
            {accepted && <Text style={styles.check}>✓</Text>}
          </View>
          <Text style={[VispText.body, { color: t.text, flex: 1 }]}>
            {tr('payoutsV2.tosCheckLabel')}
          </Text>
        </TouchableOpacity>

        <View style={{ height: VispSpace.section * 2 }} />
        <GlassButton title={tr('payoutsV2.tosAcceptCta')} variant="glow" loading={submitting} onPress={onSubmit} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: VispSpace.gutter, paddingBottom: 40 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: VispSpace.gutter, paddingTop: 12, paddingBottom: VispSpace.section },
  card: { borderRadius: 14, borderWidth: 1, padding: VispSpace.card },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: VispSpace.section * 1.5 },
  box: { width: 26, height: 26, borderRadius: 6, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  check: { color: '#FFFFFF', fontWeight: '700' },
});
