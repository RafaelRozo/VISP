/**
 * VISP — Payouts onboarding · Bank account step.
 *
 * Country-aware bank input. On CA, collect transit (5) + institution (3)
 * separately and concatenate before posting. On US, single 9-digit routing
 * number. Account number is always free-form digits.
 */

import React, { useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { Screen } from '../../../components/visp';
import { useVispTheme, VispText, VispSpace } from '../../../theme/visp';
import { GlassButton, GlassInput } from '../../../components/glass';
import { useTranslation } from '../../../i18n';
import { useAuthStore } from '../../../stores/authStore';
import { payoutsV2Service } from '../../../services/payoutsV2Service';
import { advanceToStep } from './navigation';

export default function BankStep(): React.JSX.Element {
  const t = useVispTheme();
  const { t: tr } = useTranslation();
  const navigation = useNavigation<any>();
  const user = useAuthStore((s) => s.user);

  const [country, setCountry] = useState<'CA' | 'US'>((user?.defaultAddress?.country?.toUpperCase() as any) === 'US' ? 'US' : 'CA');
  const [holder, setHolder] = useState(`${user?.firstName ?? ''} ${user?.lastName ?? ''}`.trim());
  const [transit, setTransit] = useState('');
  const [institution, setInstitution] = useState('');
  const [routing, setRouting] = useState('');
  const [account, setAccount] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Pull current onboarding country from status to be safe.
  useEffect(() => {
    let cancelled = false;
    payoutsV2Service.getStatus().then(() => {
      if (cancelled) return;
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const onSubmit = async () => {
    let routingNumber = '';
    if (country === 'CA') {
      const tr5 = transit.replace(/\D/g, '');
      const inst3 = institution.replace(/\D/g, '');
      if (tr5.length !== 5 || inst3.length !== 3) {
        Alert.alert(tr('payoutsV2.bankInvalidTitle'), tr('payoutsV2.bankCaInvalidBody'));
        return;
      }
      routingNumber = tr5 + inst3;
    } else {
      const r = routing.replace(/\D/g, '');
      if (r.length !== 9) {
        Alert.alert(tr('payoutsV2.bankInvalidTitle'), tr('payoutsV2.bankUsInvalidBody'));
        return;
      }
      routingNumber = r;
    }

    const acct = account.replace(/\D/g, '');
    if (acct.length < 4) {
      Alert.alert(tr('payoutsV2.bankInvalidTitle'), tr('payoutsV2.bankAccountInvalidBody'));
      return;
    }
    if (!holder.trim()) {
      Alert.alert(tr('payoutsV2.bankInvalidTitle'), tr('payoutsV2.bankHolderInvalidBody'));
      return;
    }

    setSubmitting(true);
    try {
      const res = await payoutsV2Service.submitBank({
        country,
        currency: country === 'CA' ? 'cad' : 'usd',
        account_holder_name: holder.trim(),
        routing_number: routingNumber,
        account_number: acct,
      });
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
        <Text style={[VispText.headlineMid, { color: t.text, flex: 1, marginLeft: 8 }]}>{tr('payoutsV2.bankTitle')}</Text>
      </View>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Text style={[VispText.body, { color: t.text2, marginBottom: VispSpace.section }]}>
            {tr('payoutsV2.bankSubtitle')}
          </Text>

          <View style={styles.countryRow}>
            {(['CA', 'US'] as const).map((c) => {
              const active = country === c;
              return (
                <TouchableOpacity
                  key={c}
                  onPress={() => setCountry(c)}
                  style={[
                    styles.countryPill,
                    {
                      backgroundColor: active ? t.violetDim : 'transparent',
                      borderColor: active ? t.violetLine : t.border,
                    },
                  ]}
                >
                  <Text style={[VispText.chip, { color: active ? t.violet : t.text2 }]}>{c}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <GlassInput label={tr('payoutsV2.bankHolder')} value={holder} onChangeText={setHolder} autoCapitalize="words" />

          {country === 'CA' ? (
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <GlassInput label={tr('payoutsV2.bankTransit')} value={transit} onChangeText={setTransit} keyboardType="number-pad" maxLength={5} placeholder="11000" />
              </View>
              <View style={{ flex: 1 }}>
                <GlassInput label={tr('payoutsV2.bankInstitution')} value={institution} onChangeText={setInstitution} keyboardType="number-pad" maxLength={3} placeholder="000" />
              </View>
            </View>
          ) : (
            <GlassInput label={tr('payoutsV2.bankRouting')} value={routing} onChangeText={setRouting} keyboardType="number-pad" maxLength={9} placeholder="110000000" />
          )}

          <GlassInput label={tr('payoutsV2.bankAccountNumber')} value={account} onChangeText={setAccount} keyboardType="number-pad" maxLength={20} placeholder="000123456789" />

          <Text style={[VispText.body, { color: t.text3, marginTop: 8 }]}>
            {country === 'CA' ? tr('payoutsV2.bankCaHelp') : tr('payoutsV2.bankUsHelp')}
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
  row: { flexDirection: 'row', gap: 10 },
  countryRow: { flexDirection: 'row', gap: 10, marginBottom: VispSpace.section },
  countryPill: { paddingVertical: 8, paddingHorizontal: 16, borderRadius: 999, borderWidth: 1 },
});
