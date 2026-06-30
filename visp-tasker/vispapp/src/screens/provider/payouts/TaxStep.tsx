/**
 * VISP — Payouts onboarding · Tax ID step.
 *
 * Single field (SIN in Canada, SSN in the US). Stripe stores it encrypted.
 * Dashes / spaces are stripped client- and server-side.
 */

import React, { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { Screen } from '../../../components/visp';
import { useVispTheme, VispText, VispSpace } from '../../../theme/visp';
import { GlassButton, GlassInput } from '../../../components/glass';
import { useTranslation } from '../../../i18n';
import { payoutsV2Service } from '../../../services/payoutsV2Service';
import { advanceToStep } from './navigation';

export default function TaxStep(): React.JSX.Element {
  const t = useVispTheme();
  const { t: tr } = useTranslation();
  const navigation = useNavigation<any>();
  const [idNumber, setIdNumber] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async () => {
    const digits = idNumber.replace(/\D/g, '');
    if (digits.length < 9) {
      Alert.alert(tr('payoutsV2.taxInvalidTitle'), tr('payoutsV2.taxInvalidBody'));
      return;
    }
    setSubmitting(true);
    try {
      const res = await payoutsV2Service.submitTax({ id_number: digits });
      advanceToStep(navigation, res.onboardingStep);
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
        <Text style={[VispText.headlineMid, { color: t.text, flex: 1, marginLeft: 8 }]}>{tr('payoutsV2.taxTitle')}</Text>
      </View>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Text style={[VispText.body, { color: t.text2, marginBottom: VispSpace.section }]}>
            {tr('payoutsV2.taxSubtitle')}
          </Text>
          <GlassInput
            label={tr('payoutsV2.taxIdLabel')}
            value={idNumber}
            onChangeText={setIdNumber}
            keyboardType="number-pad"
            maxLength={15}
            placeholder="000-000-000"
          />
          <Text style={[VispText.body, { color: t.text3, marginTop: 8 }]}>
            {tr('payoutsV2.taxHelp')}
          </Text>
          <View style={{ height: VispSpace.section * 2 }} />
          <GlassButton title={tr('common.continue')} variant="glow" loading={submitting} onPress={onSubmit} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: VispSpace.gutter, paddingBottom: 40 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: VispSpace.gutter, paddingTop: 12, paddingBottom: VispSpace.section },
});
