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
import { Colors } from '../../theme/colors';
import { GlassStyles } from '../../theme/glass';
import { GlassBackground, GlassCard, GlassButton } from '../../components/glass';
import { StaggeredBars } from '../../components/animations';
import { useProviderStore } from '../../stores/providerStore';
import { useAuthStore } from '../../stores/authStore';
import { paymentService, ProviderBalance, PayoutInfo } from '../../services/paymentService';
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
  const statusColor =
    payout.status === 'paid'
      ? Colors.success
      : payout.status === 'pending'
        ? Colors.warning
        : Colors.emergencyRed;

  const statusLabel =
    payout.status === 'paid'
      ? 'Paid'
      : payout.status === 'pending'
        ? 'Pending'
        : 'Failed';

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
  const config = {
    not_connected: {
      label: 'Not Connected',
      color: Colors.textTertiary,
      message: 'Connect your bank account to receive payouts.',
    },
    pending: {
      label: 'Pending Verification',
      color: Colors.warning,
      message: 'Your account is being verified by Stripe.',
    },
    active: {
      label: 'Active',
      color: Colors.success,
      message: 'Payouts will be sent to your connected account.',
    },
    restricted: {
      label: 'Restricted',
      color: Colors.emergencyRed,
      message:
        'Your Stripe account has restrictions. Please update your information.',
    },
  };

  const { label, color, message } = config[status];

  return (
    <GlassCard variant="standard" style={stripeStyles.container}>
      <View style={stripeStyles.header}>
        <Text style={stripeStyles.title}>Payout Account</Text>
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
          title="Set Up Payments"
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
            <Text style={stripeStyles.balanceLabel}>Available</Text>
            <Text style={[stripeStyles.balanceValue, { color: Colors.success }]}>
              ${(balance.available_cents / 100).toFixed(2)}
            </Text>
          </View>
          <View style={stripeStyles.balanceItem}>
            <Text style={stripeStyles.balanceLabel}>Pending</Text>
            <Text style={[stripeStyles.balanceValue, { color: Colors.warning }]}>
              ${(balance.pending_cents / 100).toFixed(2)}
            </Text>
          </View>
        </View>
      )}
      {(status === 'active') && recentPayouts && recentPayouts.length > 0 && (
        <View style={stripeStyles.payoutsSection}>
          <Text style={stripeStyles.payoutsSectionTitle}>Recent Payouts</Text>
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
  const { width: screenWidth } = useWindowDimensions();
  const {
    earnings,
    weeklyEarnings,
    payouts,
    providerProfile,
    isLoadingEarnings,
    fetchEarnings,
  } = useProviderStore();

  const user = useAuthStore((s) => s.user);

  const [selectedPeriod, setSelectedPeriod] = useState<Period>('week');
  const [isConnecting, setIsConnecting] = useState(false);
  const [stripeBalance, setStripeBalance] = useState<ProviderBalance | null>(null);
  const [stripePayouts, setStripePayouts] = useState<PayoutInfo[]>([]);

  useEffect(() => {
    fetchEarnings();
  }, [fetchEarnings]);

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

  const handleConnectStripe = useCallback(async () => {
    if (!providerProfile || !user) return;
    setIsConnecting(true);
    try {
      // Step 1: Create connected account
      const account = await paymentService.createConnectAccount(
        providerProfile.id,
        user.email,
        'CA',
      );

      // Step 2: Generate onboarding link
      const link = await paymentService.getOnboardingLink(
        account.account_id,
        'visptasker://stripe-refresh',
        'visptasker://stripe-return',
      );

      // Step 3: Open in browser
      const canOpen = await Linking.canOpenURL(link.url);
      if (canOpen) {
        await Linking.openURL(link.url);
      } else {
        Alert.alert('Cannot Open', 'Unable to open Stripe onboarding link.');
      }
    } catch (err: any) {
      console.error('[EarningsScreen] Stripe Connect failed:', err);
      Alert.alert(
        'Setup Failed',
        err?.message ?? 'Failed to set up Stripe payments. Please try again.',
      );
    } finally {
      setIsConnecting(false);
    }
  }, [providerProfile, user]);

  const filteredPayouts = useMemo(() => {
    const now = new Date();
    return payouts.filter((payout) => {
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
      payouts
        .filter((p) => p.status === 'pending')
        .reduce((sum, p) => sum + p.netAmount, 0),
    [payouts],
  );

  const paidAmount = useMemo(
    () =>
      payouts
        .filter((p) => p.status === 'paid')
        .reduce((sum, p) => sum + p.netAmount, 0),
    [payouts],
  );

  const onRefresh = useCallback(() => {
    fetchEarnings();
  }, [fetchEarnings]);

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
            <Text style={styles.summaryLabel}>Today</Text>
            <Text style={styles.summaryValue}>
              {formatCurrency(earnings.today)}
            </Text>
          </GlassCard>
          <GlassCard variant="standard" padding={14} style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>This Week</Text>
            <Text style={styles.summaryValue}>
              {formatCurrency(earnings.thisWeek)}
            </Text>
          </GlassCard>
          <GlassCard variant="standard" padding={14} style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>This Month</Text>
            <Text style={styles.summaryValue}>
              {formatCurrency(earnings.thisMonth)}
            </Text>
          </GlassCard>
          <GlassCard variant="standard" padding={14} style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Total Earned</Text>
            <Text style={[styles.summaryValue, { color: Colors.primary }]}>
              {formatCurrency(earnings.totalEarned)}
            </Text>
          </GlassCard>
        </View>

        {/* Pending vs Paid */}
        <GlassCard variant="dark" style={styles.payoutSplitCard}>
          <View style={styles.payoutSplitRow}>
            <View style={styles.payoutSplitItem}>
              <Text style={styles.payoutSplitLabel}>Pending</Text>
              <Text
                style={[styles.payoutSplitValue, { color: Colors.warning }]}
              >
                {formatCurrency(pendingAmount)}
              </Text>
            </View>
            <View style={styles.payoutSplitDivider} />
            <View style={styles.payoutSplitItem}>
              <Text style={styles.payoutSplitLabel}>Paid Out</Text>
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
            <Text style={styles.sectionTitle}>Weekly Earnings</Text>
            <AnimatedBarChart data={weeklyEarnings} containerWidth={screenWidth} />
          </GlassCard>
        )}

        {/* Stripe connect status */}
        {providerProfile && (
          <StripeStatus
            status={providerProfile.stripeConnectStatus}
            onConnect={handleConnectStripe}
            isConnecting={isConnecting}
            balance={stripeBalance}
            recentPayouts={stripePayouts}
          />
        )}

        {/* Period filter */}
        <View style={styles.filterRow}>
          <Text style={styles.sectionTitle}>Payouts</Text>
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
                    ? 'Week'
                    : period === 'month'
                      ? 'Month'
                      : 'All'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Payouts list */}
        {filteredPayouts.length === 0 ? (
          <View style={styles.emptyPayouts}>
            <Text style={styles.emptyPayoutsText}>
              No payouts for this period
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
