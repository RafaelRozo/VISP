/**
 * VISP - Earnings Screen
 *
 * Earnings breakdown by period with charts for weekly/monthly earnings,
 * individual job payouts list, commission breakdown per job, pending vs
 * paid payouts, and bank account / Stripe Connect status.
 *
 * Redesigned with dark glassmorphism.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  Linking,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Colors } from '../../theme/colors';
import { useTheme } from '../../theme/ThemeContext';
import { useTranslation } from '../../i18n';
import { GlassStyles } from '../../theme/glass';
import { GlassBackground, GlassCard, GlassButton } from '../../components/glass';
import { StaggeredBars } from '../../components/animations';
import { useProviderStore } from '../../stores/providerStore';
import { useAuthStore } from '../../stores/authStore';
import { paymentService, ProviderBalance, PayoutInfo } from '../../services/paymentService';
import { providerService, PayoutsStatus } from '../../services/providerService';
import { EarningsPayout, WeeklyEarnings } from '../../types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Period = 'week' | 'month' | 'all';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatCurrency(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// ---------------------------------------------------------------------------
// AnimatedBarChart sub-component (StaggeredBars with labels)
// ---------------------------------------------------------------------------

interface BarChartProps {
  data: WeeklyEarnings[];
  containerWidth: number;
}

function AnimatedBarChart({ data, containerWidth }: BarChartProps): React.JSX.Element {
  const maxAmount = useMemo(
    () => Math.max(...data.map((d) => d.amount), 1),
    [data],
  );

  const bars = useMemo(
    () =>
      data.map((item) => ({
        value: item.amount / maxAmount,
        color: '#7850FF',
      })),
    [data, maxAmount],
  );

  // Chart width = container width minus card padding (16*2 horizontal margin + 16*2 card padding)
  const chartWidth = Math.max(containerWidth - 64, 200);

  return (
    <View style={chartStyles.container}>
      <StaggeredBars
        bars={bars}
        width={chartWidth}
        height={160}
        barRadius={6}
        gap={8}
        defaultColor="#7850FF"
        staggerDelay={80}
      />
      <View style={chartStyles.labelsRow}>
        {data.map((item, index) => (
          <View key={index} style={chartStyles.labelColumn}>
            <Text style={chartStyles.barLabel}>{item.weekLabel}</Text>
            <Text style={chartStyles.barValue}>
              {item.amount > 0 ? `$${Math.round(item.amount)}` : ''}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const chartStyles = StyleSheet.create({
  container: {
    marginTop: 12,
  },
  labelsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    marginTop: 4,
  },
  labelColumn: {
    flex: 1,
    alignItems: 'center',
  },
  barLabel: {
    fontSize: 10,
    color: 'rgba(255, 255, 255, 0.4)',
    textAlign: 'center',
  },
  barValue: {
    fontSize: 10,
    color: 'rgba(255, 255, 255, 0.6)',
    fontWeight: '600',
    marginTop: 2,
    textAlign: 'center',
  },
});

// ---------------------------------------------------------------------------
// PayoutItem sub-component
// ---------------------------------------------------------------------------

interface PayoutItemProps {
  payout: EarningsPayout;
}

function PayoutItem({ payout }: PayoutItemProps): React.JSX.Element {
  const { t } = useTranslation();
  const statusColor =
    payout.status === 'paid'
      ? Colors.success
      : payout.status === 'pending'
        ? Colors.warning
        : Colors.emergencyRed;

  const statusLabel =
    payout.status === 'paid'
      ? t('earningsScreen.paid')
      : payout.status === 'pending'
        ? t('earningsScreen.pending')
        : t('earningsScreen.failed');

  return (
    <GlassCard variant="dark" padding={14} style={payoutStyles.container}>
      <View style={payoutStyles.row}>
        <View style={payoutStyles.left}>
          <Text style={payoutStyles.taskName} numberOfLines={1}>
            {payout.taskName}
          </Text>
          <Text style={payoutStyles.date}>{formatDate(payout.createdAt)}</Text>
        </View>
        <View style={payoutStyles.right}>
          <Text style={payoutStyles.netAmount}>
            {formatCurrency(payout.netAmount)}
          </Text>
          <View style={payoutStyles.commissionRow}>
            <Text style={payoutStyles.commissionText}>
              {formatCurrency(payout.grossAmount)} - {formatCurrency(payout.commissionAmount)} (
              {(payout.commissionRate * 100).toFixed(0)}%)
            </Text>
          </View>
          <View
            style={[
              payoutStyles.statusBadge,
              { backgroundColor: `${statusColor}20` },
            ]}
          >
            <Text style={[payoutStyles.statusText, { color: statusColor }]}>
              {statusLabel}
            </Text>
          </View>
        </View>
      </View>
    </GlassCard>
  );
}

const payoutStyles = StyleSheet.create({
  container: {
    marginHorizontal: 16,
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  left: {
    flex: 1,
    marginRight: 12,
  },
  taskName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  date: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.4)',
  },
  right: {
    alignItems: 'flex-end',
  },
  netAmount: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.success,
    marginBottom: 2,
  },
  commissionRow: {
    marginBottom: 4,
  },
  commissionText: {
    fontSize: 10,
    color: 'rgba(255, 255, 255, 0.4)',
  },
  statusBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  statusText: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
});

// ---------------------------------------------------------------------------
// Stripe Status sub-component
// ---------------------------------------------------------------------------

interface StripeStatusProps {
  status: 'not_connected' | 'pending' | 'active' | 'restricted';
  onConnect?: () => void;
  isConnecting?: boolean;
  balance?: ProviderBalance | null;
  recentPayouts?: PayoutInfo[];
}

function StripeStatus({ status, onConnect, isConnecting, balance, recentPayouts }: StripeStatusProps): React.JSX.Element {
  const { t } = useTranslation();
  const config = {
    not_connected: {
      label: t('earningsScreen.notConnected'),
      color: Colors.textTertiary,
      message: t('earningsScreen.connectBank'),
    },
    pending: {
      label: t('earningsScreen.pendingVerification'),
      color: Colors.warning,
      message: t('earningsScreen.accountBeingVerified'),
    },
    active: {
      label: t('earningsScreen.active'),
      color: Colors.success,
      message: t('earningsScreen.payoutsSentToAccount'),
    },
    restricted: {
      label: t('earningsScreen.restricted'),
      color: Colors.emergencyRed,
      message:
        t('earningsScreen.accountRestricted'),
    },
  };

  const { label, color, message } = config[status];

  return (
    <GlassCard variant="standard" style={stripeStyles.container}>
      <View style={stripeStyles.header}>
        <Text style={stripeStyles.title}>{t('earningsScreen.payoutAccount')}</Text>
        <View
          style={[
            stripeStyles.statusBadge,
            { backgroundColor: `${color}20` },
          ]}
        >
          <View
            style={[stripeStyles.statusDot, { backgroundColor: color }]}
          />
          <Text style={[stripeStyles.statusText, { color }]}>{label}</Text>
        </View>
      </View>
      <Text style={stripeStyles.message}>{message}</Text>
      {status === 'not_connected' && (
        <GlassButton
          title={t('earningsScreen.setUpPayments')}
          variant="glow"
          onPress={onConnect ?? (() => {})}
          disabled={isConnecting}
          loading={isConnecting}
          style={stripeStyles.connectButton}
        />
      )}
      {(status === 'active' || status === 'pending') && balance && (
        <View style={stripeStyles.balanceRow}>
          <View style={stripeStyles.balanceItem}>
            <Text style={stripeStyles.balanceLabel}>{t('earningsScreen.available')}</Text>
            <Text style={[stripeStyles.balanceValue, { color: Colors.success }]}>
              ${(balance.available_cents / 100).toFixed(2)}
            </Text>
          </View>
          <View style={stripeStyles.balanceItem}>
            <Text style={stripeStyles.balanceLabel}>{t('earningsScreen.pending')}</Text>
            <Text style={[stripeStyles.balanceValue, { color: Colors.warning }]}>
              ${(balance.pending_cents / 100).toFixed(2)}
            </Text>
          </View>
        </View>
      )}
      {(status === 'active') && recentPayouts && recentPayouts.length > 0 && (
        <View style={stripeStyles.payoutsSection}>
          <Text style={stripeStyles.payoutsSectionTitle}>{t('earningsScreen.recentPayouts')}</Text>
          {recentPayouts.slice(0, 3).map((p) => (
            <View key={p.id} style={stripeStyles.payoutRow}>
              <Text style={stripeStyles.payoutAmount}>
                ${(p.amount_cents / 100).toFixed(2)} {p.currency.toUpperCase()}
              </Text>
              <Text style={stripeStyles.payoutStatus}>{p.status}</Text>
            </View>
          ))}
        </View>
      )}
    </GlassCard>
  );
}

const stripeStyles = StyleSheet.create({
  container: {
    marginHorizontal: 16,
    marginBottom: 12,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  title: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 4,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '600',
  },
  message: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.6)',
    lineHeight: 18,
  },
  connectButton: {
    marginTop: 12,
  },
  balanceRow: {
    flexDirection: 'row',
    marginTop: 12,
    gap: 12,
  },
  balanceItem: {
    flex: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    padding: 10,
    alignItems: 'center',
  },
  balanceLabel: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.4)',
    marginBottom: 4,
  },
  balanceValue: {
    fontSize: 16,
    fontWeight: '700',
  },
  payoutsSection: {
    marginTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255, 255, 255, 0.12)',
    paddingTop: 10,
  },
  payoutsSectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.6)',
    marginBottom: 6,
  },
  payoutRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  payoutAmount: {
    fontSize: 13,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  payoutStatus: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.4)',
    textTransform: 'capitalize',
  },
});

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function EarningsScreen(): React.JSX.Element {
  const theme = useTheme();
  const { t } = useTranslation();
  const { width: screenWidth } = useWindowDimensions();
  const {
    earnings: rawEarnings,
    weeklyEarnings,
    payouts,
    providerProfile,
    isLoadingEarnings,
    fetchEarnings,
  } = useProviderStore();

  const earnings = rawEarnings ?? { today: 0, thisWeek: 0, thisMonth: 0, pendingPayout: 0, totalEarned: 0 };

  const user = useAuthStore((s) => s.user);
  const navigation = useNavigation<any>();

  const [selectedPeriod, setSelectedPeriod] = useState<Period>('week');
  const [isConnecting, setIsConnecting] = useState(false);
  const [stripeBalance, setStripeBalance] = useState<ProviderBalance | null>(null);
  const [stripePayouts, setStripePayouts] = useState<PayoutInfo[]>([]);
  const [livePayoutsStatus, setLivePayoutsStatus] = useState<PayoutsStatus | null>(null);

  const refreshPayoutsStatus = useCallback(async () => {
    try {
      const s = await providerService.getPayoutsStatus();
      setLivePayoutsStatus(s);
    } catch (err) {
      console.warn('[EarningsScreen] Payouts status fetch failed:', err);
    }
  }, []);

  useEffect(() => {
    fetchEarnings();
    refreshPayoutsStatus();
  }, [fetchEarnings, refreshPayoutsStatus]);

  // Fetch Stripe balance and payouts when provider is connected
  useEffect(() => {
    if (providerProfile?.stripeConnectStatus === 'active') {
      // The stripeAccountId would come from the provider profile on the backend.
      // For now we use the provider profile id as identifier.
      const accountId = (providerProfile as any).stripeAccountId;
      if (accountId) {
        paymentService.getProviderBalance(accountId)
          .then(setStripeBalance)
          .catch((err) => console.warn('[EarningsScreen] Balance fetch failed:', err));
        paymentService.listProviderPayouts(accountId, 5)
          .then((res) => setStripePayouts(res.payouts ?? []))
          .catch((err) => console.warn('[EarningsScreen] Payouts fetch failed:', err));
      }
    }
  }, [providerProfile]);

  /**
   * Inner step that actually hits the backend and opens the Stripe hosted
   * onboarding URL. Wrapped by `handleConnectStripe` which shows a heads-up
   * explainer first so the user knows what Stripe will ask for.
   */
  const doConnectStripe = useCallback(async () => {
    setIsConnecting(true);
    try {
      const res = await providerService.setupPayouts();
      const canOpen = await Linking.canOpenURL(res.onboardingUrl);
      if (!canOpen) {
        throw new Error('Cannot open onboarding URL');
      }
      await Linking.openURL(res.onboardingUrl);
    } catch (err: any) {
      console.error('[EarningsScreen] Stripe connect failed:', err);
      const detail = err?.response?.data?.detail ?? err?.data?.detail;

      // Backend tells us the VISP profile is missing required fields. Surface
      // them to the user and offer to jump to the Profile screen instead of
      // forcing them to figure out what's wrong.
      if (detail && typeof detail === 'object' && detail.code === 'profile_incomplete') {
        const missing: string[] = Array.isArray(detail.missing) ? detail.missing : [];
        const friendly = missing
          .map((f) => t(`payouts.field${f.charAt(0).toUpperCase() + f.slice(1)}` as any) || f)
          .join(', ');
        Alert.alert(
          t('payouts.incompleteTitle'),
          t('payouts.incompleteBody', { missing: friendly }),
          [
            { text: t('common.cancel'), style: 'cancel' },
            {
              text: t('payouts.openProfile'),
              onPress: () => navigation.navigate('ProfileTab' as any),
            },
          ],
        );
        return;
      }

      // Country isn't on the Stripe Connect supported list for VISP's
      // transfers-only model (e.g., MX requires card_payments capability).
      if (detail && typeof detail === 'object' && detail.code === 'unsupported_country') {
        const country = (detail.country as string) || '';
        const supported = Array.isArray(detail.supportedCountries)
          ? detail.supportedCountries.join(', ')
          : 'CA, US';
        Alert.alert(
          t('payouts.unsupportedCountryTitle'),
          t('payouts.unsupportedCountryBody', { country, supported }),
          [
            { text: t('common.cancel'), style: 'cancel' },
            {
              text: t('payouts.openProfile'),
              onPress: () => navigation.navigate('ProfileTab' as any),
            },
          ],
        );
        return;
      }

      const apiDetail = typeof detail === 'string' ? detail : err?.message;
      const message = apiDetail
        ? `${t('profileScreen.stripeConnectError')}\n\n${apiDetail}`
        : t('profileScreen.stripeConnectError');
      Alert.alert(t('common.error'), message);
    } finally {
      setIsConnecting(false);
    }
  }, [t, navigation]);

  const handleConnectStripe = useCallback(() => {
    // Heads-up explainer so the provider knows what Stripe will require BEFORE
    // they leave the app for the hosted form. This dramatically reduces drop-off
    // in the Stripe Connect funnel (industry pattern — Uber Eats does this).
    Alert.alert(
      t('payouts.confirmTitle'),
      t('payouts.confirmBody'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('payouts.continue'), onPress: () => void doConnectStripe() },
      ],
    );
  }, [t, doConnectStripe]);

  const filteredPayouts = useMemo(() => {
    const now = new Date();
    return (payouts || []).filter((payout) => {
      if (selectedPeriod === 'all') return true;
      const payoutDate = new Date(payout.createdAt);
      if (selectedPeriod === 'week') {
        const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        return payoutDate >= weekAgo;
      }
      // month
      const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      return payoutDate >= monthAgo;
    });
  }, [payouts, selectedPeriod]);

  const pendingAmount = useMemo(
    () =>
      (payouts || [])
        .filter((p) => p.status === 'pending')
        .reduce((sum, p) => sum + p.netAmount, 0),
    [payouts],
  );

  const paidAmount = useMemo(
    () =>
      (payouts || [])
        .filter((p) => p.status === 'paid')
        .reduce((sum, p) => sum + p.netAmount, 0),
    [payouts],
  );

  const onRefresh = useCallback(() => {
    fetchEarnings();
    refreshPayoutsStatus();
  }, [fetchEarnings, refreshPayoutsStatus]);

  // Derive the live status. Prefer the dedicated /payouts/status endpoint
  // because the dashboard one only checks for the existence of an account id,
  // not whether payouts are actually enabled.
  const effectiveStripeStatus: 'not_connected' | 'pending' | 'active' | 'restricted' =
    livePayoutsStatus
      ? !livePayoutsStatus.connected
        ? 'not_connected'
        : livePayoutsStatus.payoutsEnabled
        ? 'active'
        : livePayoutsStatus.requirementsDue.length > 0
        ? 'restricted'
        : 'pending'
      : providerProfile?.stripeConnectStatus ?? 'not_connected';

  return (
    <GlassBackground>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.contentContainer}
        refreshControl={
          <RefreshControl
            refreshing={isLoadingEarnings}
            onRefresh={onRefresh}
            tintColor={Colors.primary}
            colors={[Colors.primary]}
          />
        }
      >
        {/* Summary cards */}
        <View style={styles.summaryGrid}>
          <GlassCard variant="standard" padding={14} style={styles.summaryCard}>
            <Text style={[styles.summaryLabel, { color: theme.textSecondary }]}>{t('earningsScreen.today')}</Text>
            <Text style={styles.summaryValue}>
              {formatCurrency(earnings.today)}
            </Text>
          </GlassCard>
          <GlassCard variant="standard" padding={14} style={styles.summaryCard}>
            <Text style={[styles.summaryLabel, { color: theme.textSecondary }]}>{t('earningsScreen.thisWeek')}</Text>
            <Text style={styles.summaryValue}>
              {formatCurrency(earnings.thisWeek)}
            </Text>
          </GlassCard>
          <GlassCard variant="standard" padding={14} style={styles.summaryCard}>
            <Text style={[styles.summaryLabel, { color: theme.textSecondary }]}>{t('earningsScreen.thisMonth')}</Text>
            <Text style={styles.summaryValue}>
              {formatCurrency(earnings.thisMonth)}
            </Text>
          </GlassCard>
          <GlassCard variant="standard" padding={14} style={styles.summaryCard}>
            <Text style={[styles.summaryLabel, { color: theme.textSecondary }]}>{t('earningsScreen.totalEarned')}</Text>
            <Text style={[styles.summaryValue, { color: Colors.primary }]}>
              {formatCurrency(earnings.totalEarned)}
            </Text>
          </GlassCard>
        </View>

        {/* Pending vs Paid */}
        <GlassCard variant="dark" style={styles.payoutSplitCard}>
          <View style={styles.payoutSplitRow}>
            <View style={styles.payoutSplitItem}>
              <Text style={[styles.payoutSplitLabel, { color: theme.textSecondary }]}>{t('earningsScreen.pending')}</Text>
              <Text
                style={[styles.payoutSplitValue, { color: Colors.warning }]}
              >
                {formatCurrency(pendingAmount)}
              </Text>
            </View>
            <View style={styles.payoutSplitDivider} />
            <View style={styles.payoutSplitItem}>
              <Text style={[styles.payoutSplitLabel, { color: theme.textSecondary }]}>{t('earningsScreen.paidOut')}</Text>
              <Text
                style={[styles.payoutSplitValue, { color: Colors.success }]}
              >
                {formatCurrency(paidAmount)}
              </Text>
            </View>
          </View>
        </GlassCard>

        {/* Weekly chart */}
        {weeklyEarnings.length > 0 && (
          <GlassCard variant="standard" style={styles.chartCard}>
            <Text style={[styles.sectionTitle, { color: theme.textPrimary }]}>{t('earningsScreen.earnings')}</Text>
            <AnimatedBarChart data={weeklyEarnings} containerWidth={screenWidth} />
          </GlassCard>
        )}

        {/* Stripe connect status */}
        {providerProfile && (
          <>
            <StripeStatus
              status={effectiveStripeStatus}
              onConnect={handleConnectStripe}
              isConnecting={isConnecting}
              balance={stripeBalance}
              recentPayouts={stripePayouts}
            />
            {effectiveStripeStatus === 'pending' && (
              <View style={{ marginHorizontal: 16, marginTop: 8 }}>
                <GlassButton
                  title={t('profileScreen.stripeConnectCheckButton')}
                  variant="outline"
                  onPress={refreshPayoutsStatus}
                />
              </View>
            )}
            {effectiveStripeStatus === 'restricted' && (
              <View style={{ marginHorizontal: 16, marginTop: 8 }}>
                <GlassButton
                  title={t('profileScreen.stripeConnectContinueButton')}
                  variant="glow"
                  onPress={handleConnectStripe}
                  loading={isConnecting}
                  disabled={isConnecting}
                />
              </View>
            )}
          </>
        )}

        {/* Period filter */}
        <View style={styles.filterRow}>
          <Text style={[styles.sectionTitle, { color: theme.textPrimary }]}>{t('earningsScreen.earnings')}</Text>
          <View style={styles.periodTabs}>
            {(['week', 'month', 'all'] as Period[]).map((period) => (
              <TouchableOpacity
                key={period}
                style={[
                  styles.periodTab,
                  selectedPeriod === period && styles.periodTabActive,
                ]}
                onPress={() => setSelectedPeriod(period)}
                accessibilityRole="tab"
                accessibilityState={{ selected: selectedPeriod === period }}
              >
                <Text
                  style={[
                    styles.periodTabText,
                    selectedPeriod === period && styles.periodTabTextActive,
                  ]}
                >
                  {period === 'week'
                    ? t('earningsScreen.week')
                    : period === 'month'
                      ? t('earningsScreen.month')
                      : t('earningsScreen.all')}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Payouts list */}
        {filteredPayouts.length === 0 ? (
          <View style={styles.emptyPayouts}>
            <Text style={[styles.emptyPayoutsText, { color: theme.textSecondary }]}>
              {t('earningsScreen.noPayoutsForPeriod')}
            </Text>
          </View>
        ) : (
          filteredPayouts.map((payout) => (
            <PayoutItem key={payout.id} payout={payout} />
          ))
        )}

        <View style={styles.bottomSpacer} />
      </ScrollView>
    </GlassBackground>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  contentContainer: {
    paddingTop: 16,
  },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 12,
    marginBottom: 12,
  },
  summaryCard: {
    width: '48%',
    margin: '1%',
  },
  summaryLabel: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.6)',
    marginBottom: 4,
  },
  summaryValue: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.success,
  },
  payoutSplitCard: {
    marginHorizontal: 16,
    marginBottom: 12,
  },
  payoutSplitRow: {
    flexDirection: 'row',
  },
  payoutSplitItem: {
    flex: 1,
    alignItems: 'center',
  },
  payoutSplitDivider: {
    width: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
  },
  payoutSplitLabel: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.6)',
    marginBottom: 4,
  },
  payoutSplitValue: {
    fontSize: 18,
    fontWeight: '700',
  },
  chartCard: {
    marginHorizontal: 16,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  filterRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  periodTabs: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    borderRadius: 10,
    padding: 2,
  },
  periodTab: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 8,
  },
  periodTabActive: {
    backgroundColor: 'rgba(120, 80, 255, 0.8)',
    ...Platform.select({
      ios: {
        shadowColor: 'rgba(120, 80, 255, 0.6)',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 1,
        shadowRadius: 8,
      },
      android: { elevation: 4 },
    }),
  },
  periodTabText: {
    fontSize: 12,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.5)',
  },
  periodTabTextActive: {
    color: '#FFFFFF',
  },
  emptyPayouts: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  emptyPayoutsText: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.4)',
  },
  bottomSpacer: {
    height: 32,
  },
});
