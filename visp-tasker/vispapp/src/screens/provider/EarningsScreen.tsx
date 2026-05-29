/**
 * VISP - Earnings Screen (Mockup-fidelity refresh)
 *
 * Matches `ProviderEarnings` in newdesign/app-provider.jsx:
 *   - ScreenTitle "Earnings" / "§ Wallet & payouts" with a download IconBtn
 *   - "Available to cash out" card with violet eyebrow, huge $X,XXX in mono,
 *     pending / in-escrow split, and a primary cash-out button.
 *   - Week/Month/Year TabPills.
 *   - Gross-this-month card with `↑ X% MoM` badge + `MiniBars` chart with
 *     WK01..WKN mono labels.
 *   - "Recent payouts" Eyebrow with rows: date / label / amount via Row.
 *   - Stripe Connect status surfaces (kept). The "Set Up Payments" CTA keeps
 *     GlassButton (the violet purple CTA is intentional per spec).
 *
 * Data fetching (paymentService / providerService / store) is preserved.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useFocusEffect, useNavigation } from '@react-navigation/native';

import { useTranslation } from '../../i18n';
import {
  Screen,
  ScreenTitle,
  Eyebrow,
  Card,
  Row,
  IconBtn,
  MiniBars,
} from '../../components/visp';
import { useVispTheme, VispText, VispSpace, VispRadius, FontSansBold, FontMono } from '../../theme/visp';
import { GlassButton } from '../../components/glass';
import { useProviderStore } from '../../stores/providerStore';
import { paymentService, ProviderBalance, PayoutInfo } from '../../services/paymentService';
import { providerService, PayoutsStatus } from '../../services/providerService';
import { payoutsV2Service } from '../../services/payoutsV2Service';
import { EarningsPayout } from '../../types';

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

type Period = 'week' | 'month' | 'all';

// ──────────────────────────────────────────────
// MotionPressable
// ──────────────────────────────────────────────

function MotionPressable({
  onPress,
  children,
  style,
  pressScale = 0.97,
}: {
  onPress?: () => void;
  children: React.ReactNode;
  style?: ViewStyle | ViewStyle[];
  pressScale?: number;
}): React.JSX.Element {
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <Pressable
      onPress={onPress}
      style={style}
      onPressIn={() => {
        scale.value = withTiming(pressScale, { duration: 90, easing: Easing.out(Easing.quad) });
      }}
      onPressOut={() => {
        scale.value = withSpring(1, { damping: 18, stiffness: 220, mass: 0.6 });
      }}
    >
      <Animated.View style={[{ alignSelf: 'stretch' }, animatedStyle]}>{children}</Animated.View>
    </Pressable>
  );
}

// ──────────────────────────────────────────────
// TabPills
// ──────────────────────────────────────────────

interface TabPillsProps {
  tabs: { key: Period; label: string }[];
  active: Period;
  onChange: (k: Period) => void;
}

function TabPills({ tabs, active, onChange }: TabPillsProps): React.JSX.Element {
  const t = useVispTheme();
  return (
    <View style={pillStyles.row}>
      {tabs.map((tab) => {
        const isActive = tab.key === active;
        return (
          <Pressable
            key={tab.key}
            onPress={() => onChange(tab.key)}
            style={[
              pillStyles.pill,
              {
                backgroundColor: isActive ? t.text : 'transparent',
                borderColor: isActive ? t.text : t.border,
              },
            ]}
          >
            <Text style={[VispText.chip, { color: isActive ? t.bg : t.text2 }]}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const pillStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
  },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: VispRadius.pill,
    borderWidth: 1,
  },
});

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function splitCurrency(amount: number): { dollars: string; cents: string } {
  const fixed = (Math.round(amount * 100) / 100).toFixed(2);
  const [d, c] = fixed.split('.');
  return { dollars: Number(d).toLocaleString(), cents: c };
}

function formatDateLabel(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase();
  } catch {
    return '—';
  }
}

// ──────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────

export default function EarningsScreen(): React.JSX.Element {
  const t = useVispTheme();
  const { t: tr } = useTranslation();
  const navigation = useNavigation<any>();

  const {
    earnings: rawEarnings,
    weeklyEarnings,
    payouts,
    providerProfile,
    isLoadingEarnings,
    fetchEarnings,
  } = useProviderStore();
  const earnings = rawEarnings ?? {
    today: 0,
    thisWeek: 0,
    thisMonth: 0,
    pendingPayout: 0,
    totalEarned: 0,
  };

  const [selectedPeriod, setSelectedPeriod] = useState<Period>('week');
  const isConnecting = false;
  const [stripeBalance, setStripeBalance] = useState<ProviderBalance | null>(null);
  const [stripePayouts, setStripePayouts] = useState<PayoutInfo[]>([]);
  const [livePayoutsStatus, setLivePayoutsStatus] = useState<PayoutsStatus | null>(null);

  // Reads the v2 onboarding status (the wizard updates this state, not the
  // legacy v1 setup endpoint), then maps it onto the existing PayoutsStatus
  // shape so the rest of this screen keeps working unchanged.
  const refreshPayoutsStatus = useCallback(async () => {
    try {
      const v2 = await payoutsV2Service.getStatus();
      setLivePayoutsStatus({
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
      console.warn('[EarningsScreen] v2 payouts status fetch failed:', err);
    }
  }, []);

  useEffect(() => {
    fetchEarnings();
    refreshPayoutsStatus();
  }, [fetchEarnings, refreshPayoutsStatus]);

  // Re-fetch whenever the screen regains focus (e.g. user returns from the
  // Payouts onboarding wizard) so the CTA disappears as soon as setup is done.
  useFocusEffect(
    useCallback(() => {
      refreshPayoutsStatus();
    }, [refreshPayoutsStatus]),
  );

  useEffect(() => {
    if (providerProfile?.stripeConnectStatus === 'active') {
      const accountId = providerProfile.stripeAccountId;
      if (accountId) {
        paymentService
          .getProviderBalance(accountId)
          .then(setStripeBalance)
          .catch((err) => console.warn('[EarningsScreen] Balance fetch failed:', err));
        paymentService
          .listProviderPayouts(accountId, 5)
          .then((res) => setStripePayouts(res.payouts ?? []))
          .catch((err) => console.warn('[EarningsScreen] Payouts fetch failed:', err));
      }
    }
  }, [providerProfile]);

  const handleConnectStripe = useCallback(() => {
    navigation.navigate('PayoutsOnboarding' as any);
  }, [navigation]);

  // ── Period-filtered payouts ──
  const filteredPayouts = useMemo(() => {
    const now = new Date();
    return (payouts || []).filter((payout) => {
      if (selectedPeriod === 'all') return true;
      const payoutDate = new Date(payout.createdAt);
      if (selectedPeriod === 'week') {
        const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        return payoutDate >= weekAgo;
      }
      const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      return payoutDate >= monthAgo;
    });
  }, [payouts, selectedPeriod]);

  const onRefresh = useCallback(() => {
    fetchEarnings();
    refreshPayoutsStatus();
  }, [fetchEarnings, refreshPayoutsStatus]);

  const effectiveStripeStatus: 'not_connected' | 'pending' | 'active' | 'restricted' = livePayoutsStatus
    ? !livePayoutsStatus.connected
      ? 'not_connected'
      : livePayoutsStatus.payoutsEnabled
        ? 'active'
        : livePayoutsStatus.requirementsDue.length > 0
          ? 'restricted'
          : 'pending'
    : providerProfile?.stripeConnectStatus ?? 'not_connected';

  // ── Available to cash out ──
  // The mockup is a single "available balance" hero. We prefer the live Stripe
  // balance (cents) when present, otherwise fall back to the legacy summary
  // (pendingPayout dollars).
  const availableAmount =
    stripeBalance != null
      ? (stripeBalance.available_cents ?? 0) / 100
      : earnings.pendingPayout;
  const pendingAmount =
    stripeBalance != null ? (stripeBalance.pending_cents ?? 0) / 100 : 0;
  const escrowAmount = earnings.thisWeek; // best proxy from our data shape

  const { dollars, cents } = splitCurrency(availableAmount);

  // ── Bars data + week labels (up to 10 weeks) ──
  const barData = (weeklyEarnings.slice(-10).map((w) => w.amount) as number[]);
  const peakIndex = barData.length
    ? barData.reduce((best, v, i) => (v > barData[best] ? i : best), 0)
    : undefined;
  const weekLabels =
    weeklyEarnings.length > 0
      ? weeklyEarnings.slice(-10).map((w) => w.weekLabel.toUpperCase())
      : Array.from({ length: 10 }, (_, i) => `WK${String(i + 1).padStart(2, '0')}`);

  // Month-over-month delta (compare last week to previous week as a proxy)
  const mom =
    weeklyEarnings.length >= 2
      ? (() => {
        const last = weeklyEarnings[weeklyEarnings.length - 1].amount;
        const prev = weeklyEarnings[weeklyEarnings.length - 2].amount || 1;
        const pct = Math.round(((last - prev) / prev) * 100);
        return pct;
      })()
      : null;

  const momLabel = mom != null ? `${mom >= 0 ? '↑' : '↓'} ${Math.abs(mom)}% MoM` : '';

  // ── Recent payouts rows (mix Stripe payouts + local payouts) ──
  const recentRows = useMemo(() => {
    const stripeRows = stripePayouts.map((p) => ({
      key: `s-${p.id}`,
      icon: 'bank' as const,
      title: `${tr('earningsScreen.payoutAccount')} · ${p.currency.toUpperCase()}`,
      sub: formatDateLabel(p.arrival_date || p.created_at || new Date().toISOString()),
      amount: `-$${(p.amount_cents / 100).toFixed(2)}`,
      out: true,
    }));
    const localRows = (filteredPayouts as EarningsPayout[]).slice(0, 8).map((p) => ({
      key: `p-${p.id}`,
      icon: 'briefcase' as const,
      title: `Job · ${p.taskName}`,
      sub: formatDateLabel(p.createdAt),
      amount: `+$${p.netAmount.toFixed(2)}`,
      out: false,
    }));
    return [...stripeRows, ...localRows];
  }, [stripePayouts, filteredPayouts, tr]);

  return (
    <Screen>
      <ScreenTitle
        title={tr('nav.earnings') || 'Earnings'}
        sub="§ Wallet & payouts"
        right={<IconBtn name="dots" />}
      />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.contentContainer}
        refreshControl={
          <RefreshControl refreshing={isLoadingEarnings} onRefresh={onRefresh} tintColor={t.text2} />
        }
        showsVerticalScrollIndicator={false}
      >
        {/* Available to cash out hero card */}
        <Card accent padding={20} style={styles.heroCard}>
          <Eyebrow color={t.violet}>{tr('earningsScreen.available') || 'Available to cash out'}</Eyebrow>
          <View style={styles.heroAmountRow}>
            <Text style={{ fontFamily: FontSansBold, fontSize: 20, color: t.text3, fontWeight: '700' }}>$</Text>
            <Text
              style={{
                fontFamily: FontSansBold,
                fontSize: 48,
                fontWeight: '700',
                color: t.text,
                letterSpacing: -1.7,
                lineHeight: 48,
              }}
            >
              {dollars}
            </Text>
            <Text
              style={{
                fontFamily: FontMono,
                fontSize: 15,
                marginLeft: 6,
                color: t.text3,
                letterSpacing: 0.9,
              }}
            >
              .{cents}
            </Text>
            {momLabel ? (
              <View style={[styles.momBadge, { borderColor: t.violetLine, backgroundColor: t.violetDim }]}>
                <Text style={{ fontFamily: FontMono, fontSize: 10, color: t.violet, letterSpacing: 0.6 }}>
                  {momLabel}
                </Text>
              </View>
            ) : null}
          </View>

          <View style={[styles.heroSplitRow, { borderTopColor: t.border }]}>
            <View style={{ flex: 1 }}>
              <Eyebrow>{tr('earningsScreen.pending') || 'Pending'}</Eyebrow>
              <Text
                style={{
                  fontFamily: FontMono,
                  fontSize: 15,
                  fontWeight: '700',
                  color: t.text,
                  marginTop: 4,
                }}
              >
                ${pendingAmount.toFixed(2)}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Eyebrow>{tr('earningsScreen.thisWeek') || 'In escrow'}</Eyebrow>
              <Text
                style={{
                  fontFamily: FontMono,
                  fontSize: 15,
                  fontWeight: '700',
                  color: t.text,
                  marginTop: 4,
                }}
              >
                ${escrowAmount.toFixed(2)}
              </Text>
            </View>
          </View>

          <MotionPressable onPress={() => void 0}>
            <View style={[styles.cashoutBtn, { backgroundColor: t.text }]}>
              <Text style={[VispText.bodyStrong, { color: t.bg, fontSize: 13 }]}>
                {tr('earningsScreen.cashOut') || 'Cash out to bank'}
              </Text>
            </View>
          </MotionPressable>
        </Card>

        {/* Period tabs */}
        <TabPills
          tabs={[
            { key: 'week', label: tr('earningsScreen.week') || 'Week' },
            { key: 'month', label: tr('earningsScreen.month') || 'Month' },
            { key: 'all', label: tr('earningsScreen.all') || 'All' },
          ]}
          active={selectedPeriod}
          onChange={setSelectedPeriod}
        />

        {/* Gross this period + chart */}
        <Card padding={VispSpace.card} style={{ marginBottom: 14 }}>
          <View style={styles.chartHeaderRow}>
            <View style={{ flex: 1 }}>
              <Eyebrow>
                {selectedPeriod === 'week'
                  ? tr('earningsScreen.thisWeek') || 'Gross this week'
                  : selectedPeriod === 'month'
                    ? tr('earningsScreen.thisMonth') || 'Gross this month'
                    : tr('earningsScreen.totalEarned') || 'Gross all-time'}
              </Eyebrow>
              <Text
                style={{
                  fontFamily: FontMono,
                  fontSize: 24,
                  fontWeight: '700',
                  letterSpacing: -0.6,
                  color: t.text,
                  marginTop: 6,
                }}
              >
                $
                {(selectedPeriod === 'week'
                  ? earnings.thisWeek
                  : selectedPeriod === 'month'
                    ? earnings.thisMonth
                    : earnings.totalEarned
                ).toLocaleString()}
              </Text>
            </View>
            {momLabel ? (
              <Text style={{ fontFamily: FontMono, fontSize: 11, color: t.violet, letterSpacing: 0.6 }}>
                {momLabel}
              </Text>
            ) : null}
          </View>

          {barData.length > 0 ? (
            <>
              <View style={{ marginTop: 12 }}>
                <MiniBars data={barData} peakIndex={peakIndex} height={42} />
              </View>
              <View style={styles.weekLabelsRow}>
                {weekLabels.map((w, i) => (
                  <Text
                    key={`${w}-${i}`}
                    style={{ fontFamily: FontMono, fontSize: 9, color: t.text4, letterSpacing: 1, flex: 1, textAlign: 'center' }}
                    numberOfLines={1}
                  >
                    {w}
                  </Text>
                ))}
              </View>
            </>
          ) : (
            <Text style={[VispText.body, { color: t.text3, marginTop: 12 }]}>
              {tr('earningsScreen.noPayoutsForPeriod') || 'No earnings data yet'}
            </Text>
          )}
        </Card>

        {/* Stripe connect status (compact) */}
        {effectiveStripeStatus === 'not_connected' ? (
          <Card accent padding={VispSpace.card} style={{ marginBottom: 14 }}>
            <Eyebrow color={t.violet}>{tr('earningsScreen.notConnected') || 'Payouts'}</Eyebrow>
            <Text style={[VispText.body, { color: t.text, marginTop: 6, marginBottom: 14 }]}>
              {tr('earningsScreen.connectBank') || 'Connect your bank to receive payouts from completed jobs.'}
            </Text>
            <GlassButton
              title={tr('earningsScreen.setUpPayments') || 'Set Up Payments'}
              variant="glow"
              onPress={handleConnectStripe}
              disabled={isConnecting}
              loading={isConnecting}
            />
          </Card>
        ) : effectiveStripeStatus === 'restricted' ? (
          <Card accent padding={VispSpace.card} style={{ marginBottom: 14 }}>
            <Eyebrow color={t.violet}>{tr('earningsScreen.restricted') || 'Action needed'}</Eyebrow>
            <Text style={[VispText.body, { color: t.text, marginTop: 6, marginBottom: 14 }]}>
              {tr('earningsScreen.accountRestricted') || 'Your payout account needs additional info.'}
            </Text>
            <GlassButton
              title={tr('profileScreen.stripeConnectContinueButton') || 'Continue setup'}
              variant="glow"
              onPress={handleConnectStripe}
              loading={isConnecting}
              disabled={isConnecting}
            />
          </Card>
        ) : effectiveStripeStatus === 'pending' ? (
          <Card padding={VispSpace.card} style={{ marginBottom: 14 }}>
            <Eyebrow>{tr('earningsScreen.pendingVerification') || 'Verifying account'}</Eyebrow>
            <Text style={[VispText.body, { color: t.text2, marginTop: 6 }]}>
              {tr('earningsScreen.accountBeingVerified') || 'We are verifying your payout account.'}
            </Text>
          </Card>
        ) : effectiveStripeStatus === 'active' ? (
          <Card padding={VispSpace.card} style={{ marginBottom: 14, borderColor: t.ok, borderWidth: 1 }}>
            <Eyebrow color={t.ok}>{tr('earningsScreen.payoutsActiveLabel') || 'Payouts active'}</Eyebrow>
            <Text style={[VispText.body, { color: t.text, marginTop: 6 }]}>
              {tr('earningsScreen.payoutsActiveBody') || '✓ Your bank account is connected. Completed jobs will be paid out automatically.'}
            </Text>
          </Card>
        ) : null}

        {/* Recent payouts */}
        <Eyebrow>{tr('earningsScreen.recentPayouts') || 'Recent payouts'}</Eyebrow>
        <View style={{ marginTop: 6, marginBottom: 14 }}>
          {recentRows.length === 0 ? (
            <Text style={[VispText.body, { color: t.text3, paddingVertical: 18 }]}>
              {tr('earningsScreen.noPayoutsForPeriod') || 'No payouts for this period'}
            </Text>
          ) : (
            recentRows.map((r, idx) => (
              <View
                key={r.key}
                style={idx === recentRows.length - 1 ? undefined : [styles.rowDivider, { borderBottomColor: t.border }]}
              >
                <Row
                  icon={r.icon}
                  title={r.title}
                  sub={r.sub}
                  chevron={false}
                  trailing={
                    <Text
                      style={{
                        fontFamily: FontMono,
                        fontSize: 13,
                        fontWeight: '700',
                        color: r.out ? t.text3 : t.text,
                      }}
                    >
                      {r.amount}
                    </Text>
                  }
                />
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </Screen>
  );
}

// ──────────────────────────────────────────────
// Styles
// ──────────────────────────────────────────────

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  contentContainer: {
    paddingHorizontal: VispSpace.gutter,
    paddingTop: 4,
    paddingBottom: 40,
  },

  heroCard: { marginBottom: 14 },
  heroAmountRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginTop: 10,
    gap: 4,
    flexWrap: 'wrap',
  },
  momBadge: {
    marginLeft: 'auto',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
  },
  heroSplitRow: {
    flexDirection: 'row',
    gap: 14,
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  cashoutBtn: {
    marginTop: 14,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },

  chartHeaderRow: { flexDirection: 'row', alignItems: 'flex-start' },
  weekLabelsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 6,
  },

  rowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
