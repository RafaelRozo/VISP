/**
 * VISP - Earnings Screen
 *
 * Rehecha el 2026-10-23. La versión anterior estaba pensada para dinero
 * RETENIDO en VISP ("Available to cash out", "Pending", botón "Cash out to
 * bank"), pero el cobro es destination charge: Stripe le paga al proveedor en
 * el momento de capturar y lo manda solo a su banco. Esos números salían
 * siempre a $0 y el botón no hacía nada.
 *
 * Ahora responde a lo que el proveedor quiere saber:
 *   - Cuánto ganó en el periodo (semana / mes / todo) y cuántos trabajos.
 *   - De dónde sale: su trabajo − comisión de VISP + propinas + impuesto +
 *     material reembolsado. El mismo cálculo que Stripe.
 *   - Cada trabajo pagado, con su liquidación en PDF al tocarlo.
 *   - El estado de su cuenta de cobros (se mantiene).
 */

import React, { useCallback, useState } from 'react';
import {
  Alert,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { useTranslation } from '../../i18n';
import { Screen, ScreenTitle, Eyebrow, Card, Row } from '../../components/visp';
import { useVispTheme, VispText, VispSpace, VispRadius, FontSansBold, FontMono } from '../../theme/visp';
import { GlassButton } from '../../components/glass';
import { providerService, PayoutsStatus, ProviderEarnings } from '../../services/providerService';
import { payoutsV2Service } from '../../services/payoutsV2Service';
import { taskService } from '../../services/taskService';
import { useFocusRefresh } from '../../hooks/useFocusRefresh';

type Period = 'week' | 'month' | 'all';

const money = (cents: number): string => `$${(cents / 100).toFixed(2)}`;

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase();
  } catch {
    return '—';
  }
}

function TabPills({ active, onChange }: { active: Period; onChange: (k: Period) => void }) {
  const t = useVispTheme();
  const { t: tr } = useTranslation();
  const tabs: { key: Period; label: string }[] = [
    { key: 'week', label: tr('earningsScreen.week') || 'Week' },
    { key: 'month', label: tr('earningsScreen.month') || 'Month' },
    { key: 'all', label: tr('earningsScreen.all') || 'All' },
  ];
  return (
    <View style={styles.pillRow}>
      {tabs.map((tab) => {
        const isActive = tab.key === active;
        return (
          <Pressable
            key={tab.key}
            onPress={() => onChange(tab.key)}
            style={[
              styles.pill,
              { backgroundColor: isActive ? t.text : 'transparent', borderColor: isActive ? t.text : t.border },
            ]}
          >
            <Text style={[VispText.chip, { color: isActive ? t.bg : t.text2 }]}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function EarningsScreen(): React.JSX.Element {
  const t = useVispTheme();
  const { t: tr } = useTranslation();
  const navigation = useNavigation<any>();

  const [period, setPeriod] = useState<Period>('week');
  const [data, setData] = useState<ProviderEarnings | null>(null);
  const [loading, setLoading] = useState(true);
  const [pulling, setPulling] = useState(false);
  const [payouts, setPayouts] = useState<PayoutsStatus | null>(null);

  const loadEarnings = useCallback(async (p: Period) => {
    try {
      setData(await providerService.getEarnings(p));
    } catch (err) {
      console.warn('[EarningsScreen] earnings fetch failed:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Estado de la cuenta de cobros (v2), mapeado a PayoutsStatus como antes.
  const loadPayouts = useCallback(async () => {
    try {
      const v2 = await payoutsV2Service.getStatus();
      setPayouts({
        connected: v2.accountId != null,
        accountId: v2.accountId,
        detailsSubmitted: v2.detailsSubmitted,
        chargesEnabled: false,
        payoutsEnabled: v2.payoutsEnabled,
        transfersCapability: ((v2.capabilities as any)?.transfers ?? 'unknown') as PayoutsStatus['transfersCapability'],
        disabledReason: null,
        requirementsDue: v2.requirementsDue ?? [],
      });
    } catch (err) {
      console.warn('[EarningsScreen] payouts status fetch failed:', err);
    }
  }, []);

  // Al volver a la pestaña (p. ej. tras terminar un trabajo o el alta de cobros).
  const refreshAll = useCallback(() => {
    loadEarnings(period);
    loadPayouts();
  }, [loadEarnings, loadPayouts, period]);
  useFocusRefresh(refreshAll);

  const onChangePeriod = useCallback(
    (p: Period) => {
      setPeriod(p);
      loadEarnings(p);
    },
    [loadEarnings],
  );

  const onRefresh = useCallback(async () => {
    setPulling(true);
    await Promise.all([loadEarnings(period), loadPayouts()]);
    setPulling(false);
  }, [loadEarnings, loadPayouts, period]);

  const openReceipt = useCallback(
    async (jobId: string) => {
      const url = await taskService.getInvoiceUrl(jobId);
      if (!url) {
        Alert.alert(
          tr('earningsScreen.receiptPendingTitle') || 'Receipt not ready',
          tr('earningsScreen.receiptPendingBody') || 'Your receipt is issued once the payment is finalised.',
        );
        return;
      }
      Linking.openURL(url).catch(() => undefined);
    },
    [tr],
  );

  const stripeStatus: 'not_connected' | 'pending' | 'active' | 'restricted' | null = payouts
    ? !payouts.connected
      ? 'not_connected'
      : payouts.payoutsEnabled
        ? 'active'
        : payouts.requirementsDue.length > 0
          ? 'restricted'
          : 'pending'
    : null;

  const periodLabel =
    period === 'week'
      ? tr('earningsScreen.earnedThisWeek') || 'Earned this week'
      : period === 'month'
        ? tr('earningsScreen.earnedThisMonth') || 'Earned this month'
        : tr('earningsScreen.earnedAllTime') || 'Earned all time';

  const received = data?.receivedCents ?? 0;
  const [dollars, cents] = (received / 100).toFixed(2).split('.');
  const jobCount = data?.jobCount ?? 0;

  const breakdown: { label: string; value: string; strong?: boolean }[] = data
    ? [
        { label: tr('earningsScreen.yourWork') || 'Your work', value: money(data.laborCents) },
        {
          label: tr('earningsScreen.vispFee') || 'VISP fee',
          value: `−${money(data.commissionCents)}`,
        },
        ...(data.tipsCents ? [{ label: tr('earningsScreen.tips') || 'Tips', value: `+${money(data.tipsCents)}` }] : []),
        ...(data.taxCents ? [{ label: tr('earningsScreen.taxCollected') || 'Tax collected', value: `+${money(data.taxCents)}` }] : []),
        ...(data.materialsCents
          ? [{ label: tr('earningsScreen.materials') || 'Materials reimbursed', value: `+${money(data.materialsCents)}` }]
          : []),
        { label: tr('earningsScreen.youEarned') || 'You earned', value: money(received), strong: true },
      ]
    : [];

  return (
    <Screen>
      <ScreenTitle title={tr('nav.earnings') || 'Earnings'} sub="§ Wallet & payouts" />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.contentContainer}
        refreshControl={<RefreshControl refreshing={pulling} onRefresh={onRefresh} tintColor={t.text2} />}
        showsVerticalScrollIndicator={false}
      >
        <TabPills active={period} onChange={onChangePeriod} />

        {/* Lo ganado en el periodo */}
        <Card accent padding={20} style={styles.block}>
          <Eyebrow color={t.violet}>{periodLabel.toUpperCase()}</Eyebrow>
          <View style={styles.heroAmountRow}>
            <Text style={{ fontFamily: FontSansBold, fontSize: 20, color: t.text3, fontWeight: '700' }}>$</Text>
            <Text style={{ fontFamily: FontSansBold, fontSize: 48, fontWeight: '700', color: t.text, letterSpacing: -1.7, lineHeight: 48 }}>
              {Number(dollars).toLocaleString()}
            </Text>
            <Text style={{ fontFamily: FontMono, fontSize: 15, marginLeft: 6, color: t.text3, letterSpacing: 0.9 }}>.{cents}</Text>
          </View>
          <Text style={[VispText.body, { color: t.text2, marginTop: 8 }]}>
            {loading
              ? '…'
              : `${jobCount} ${jobCount === 1 ? tr('earningsScreen.jobDone') || 'job completed' : tr('earningsScreen.jobsDone') || 'jobs completed'}`}
          </Text>
          <Text style={[VispText.body, { color: t.text3, marginTop: 2, fontSize: 12 }]}>
            {tr('earningsScreen.paidAutomatically') || 'Paid automatically to your bank account by Stripe.'}
          </Text>
        </Card>

        {/* De dónde sale */}
        {jobCount > 0 ? (
          <Card padding={VispSpace.card} style={styles.block}>
            <Eyebrow>{tr('earningsScreen.breakdown') || 'Breakdown'}</Eyebrow>
            {breakdown.map((b, i) => (
              <View
                key={b.label}
                style={[
                  styles.breakdownRow,
                  b.strong && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.border, marginTop: 6, paddingTop: 10 },
                  i === 0 && { marginTop: 10 },
                ]}
              >
                <Text style={[VispText.body, { color: b.strong ? t.text : t.text2 }]}>{b.label}</Text>
                <Text style={{ fontFamily: FontMono, fontSize: b.strong ? 15 : 13, fontWeight: '700', color: t.text }}>
                  {b.value}
                </Text>
              </View>
            ))}
          </Card>
        ) : null}

        {/* Cuenta de cobros */}
        {stripeStatus === 'not_connected' ? (
          <Card accent padding={VispSpace.card} style={styles.block}>
            <Eyebrow color={t.violet}>{tr('earningsScreen.notConnected') || 'Payouts'}</Eyebrow>
            <Text style={[VispText.body, { color: t.text, marginTop: 6, marginBottom: 14 }]}>
              {tr('earningsScreen.connectBank') || 'Connect your bank to receive payouts from completed jobs.'}
            </Text>
            <GlassButton
              title={tr('earningsScreen.setUpPayments') || 'Set Up Payments'}
              variant="glow"
              onPress={() => navigation.navigate('PayoutsOnboarding' as any)}
            />
          </Card>
        ) : stripeStatus === 'restricted' ? (
          <Card accent padding={VispSpace.card} style={styles.block}>
            <Eyebrow color={t.violet}>{tr('earningsScreen.restricted') || 'Action needed'}</Eyebrow>
            <Text style={[VispText.body, { color: t.text, marginTop: 6, marginBottom: 14 }]}>
              {tr('earningsScreen.accountRestricted') || 'Your payout account needs additional info.'}
            </Text>
            <GlassButton
              title={tr('profileScreen.stripeConnectContinueButton') || 'Continue setup'}
              variant="glow"
              onPress={() => navigation.navigate('PayoutsOnboarding' as any)}
            />
          </Card>
        ) : stripeStatus === 'pending' ? (
          <Card padding={VispSpace.card} style={styles.block}>
            <Eyebrow>{tr('earningsScreen.pendingVerification') || 'Verifying account'}</Eyebrow>
            <Text style={[VispText.body, { color: t.text2, marginTop: 6 }]}>
              {tr('earningsScreen.accountBeingVerified') || 'We are verifying your payout account.'}
            </Text>
          </Card>
        ) : stripeStatus === 'active' ? (
          <Card padding={VispSpace.card} style={[styles.block, { borderColor: t.ok, borderWidth: 1 }]}>
            <Eyebrow color={t.ok}>{tr('earningsScreen.payoutsActiveLabel') || 'Payouts active'}</Eyebrow>
            <Text style={[VispText.body, { color: t.text, marginTop: 6 }]}>
              {tr('earningsScreen.payoutsActiveBody') || '✓ Your bank account is connected. Completed jobs will be paid out automatically.'}
            </Text>
          </Card>
        ) : null}

        {/* Trabajos pagados, cada uno con su liquidación */}
        <Eyebrow>{tr('earningsScreen.paidJobs') || 'Paid jobs'}</Eyebrow>
        <View style={{ marginTop: 6, marginBottom: 14 }}>
          {!loading && (data?.jobs.length ?? 0) === 0 ? (
            <Text style={[VispText.body, { color: t.text3, paddingVertical: 18 }]}>
              {tr('earningsScreen.noJobsForPeriod') || 'No paid jobs in this period yet.'}
            </Text>
          ) : (
            (data?.jobs ?? []).map((j, idx, all) => (
              <Pressable
                key={j.jobId}
                onPress={() => openReceipt(j.jobId)}
                style={idx === all.length - 1 ? undefined : [styles.rowDivider, { borderBottomColor: t.border }]}
              >
                <Row
                  icon="briefcase"
                  title={j.taskName || j.referenceNumber}
                  sub={[formatDate(j.completedAt), j.serviceCity, tr('earningsScreen.viewReceipt') || 'View receipt']
                    .filter(Boolean)
                    .join(' · ')
                    .toUpperCase()}
                  chevron
                  trailing={
                    <Text style={{ fontFamily: FontMono, fontSize: 13, fontWeight: '700', color: t.text }}>
                      +{money(j.receivedCents ?? 0)}
                    </Text>
                  }
                />
              </Pressable>
            ))
          )}
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  contentContainer: {
    paddingHorizontal: VispSpace.gutter,
    paddingTop: 4,
    paddingBottom: 40,
  },
  block: { marginBottom: 14 },
  pillRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: VispRadius.pill,
    borderWidth: 1,
  },
  heroAmountRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginTop: 10,
    gap: 4,
  },
  breakdownRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  rowDivider: { borderBottomWidth: StyleSheet.hairlineWidth },
});
