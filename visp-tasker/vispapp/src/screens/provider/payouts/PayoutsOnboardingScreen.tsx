/**
 * VISP — Payouts Onboarding wrapper.
 *
 * Reads the current onboarding step from the backend on mount and routes
 * the provider into the right step screen. If everything is already
 * complete, kicks the provider back to Earnings.
 */

import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { Screen } from '../../../components/visp';
import { useVispTheme, VispText, VispSpace } from '../../../theme/visp';
import { GlassButton } from '../../../components/glass';
import { useTranslation } from '../../../i18n';
import { payoutsV2Service, PayoutOnboardingStep } from '../../../services/payoutsV2Service';

const STEP_ROUTE: Record<PayoutOnboardingStep, string | null> = {
  init: 'PayoutsPersonalInfo',
  identity: 'PayoutsPersonalInfo',
  tax: 'PayoutsTax',
  bank: 'PayoutsBank',
  identity_doc: 'PayoutsIdentityDoc',
  tos: 'PayoutsTos',
  complete: null,
};

export default function PayoutsOnboardingScreen(): React.JSX.Element {
  const t = useVispTheme();
  const { t: tr } = useTranslation();
  const navigation = useNavigation<any>();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Create the account if needed (idempotent), then fetch status.
        const status = await payoutsV2Service.init();
        if (cancelled) return;
        const route = STEP_ROUTE[status.onboardingStep];
        if (route) {
          navigation.replace(route);
        } else {
          // Already complete — bounce back.
          navigation.goBack();
        }
      } catch (err: any) {
        if (cancelled) return;
        setError(err?.message ?? tr('payoutsV2.errorGeneric'));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [navigation, tr]);

  return (
    <Screen edges={["top","bottom"]}>
      <View style={styles.center}>
        {error ? (
          <>
            <Text style={[VispText.body, { color: t.danger, textAlign: 'center', marginBottom: VispSpace.section }]}>
              {error}
            </Text>
            <GlassButton title={tr('common.tryAgain')} variant="outline" onPress={() => navigation.goBack()} />
          </>
        ) : (
          <ActivityIndicator size="large" color={t.violet} />
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: VispSpace.gutter },
});
