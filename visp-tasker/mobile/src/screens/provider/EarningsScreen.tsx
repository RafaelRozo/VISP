/**
 * VISP/Tasker - Earnings Screen
 *
 * Earnings breakdown by period with charts for weekly/monthly earnings,
 * individual job payouts list, commission breakdown per job, pending vs
 * paid payouts, and bank account / Stripe Connect status.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Colors } from '../../theme/colors';
import { useProviderStore } from '../../stores/providerStore';
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
// BarChart sub-component (simple RN implementation)
// ---------------------------------------------------------------------------

interface BarChartProps {
  data: WeeklyEarnings[];
}

function BarChart({ data }: BarChartProps): React.JSX.Element {
  const maxAmount = useMemo(
    () => Math.max(...data.map((d) => d.amount), 1),
    [data],
  );

  return (
    <View style={chartStyles.container}>
      <View style={chartStyles.barsRow}>
        {data.map((item, index) => {
          const heightPercent = (item.amount / maxAmount) * 100;
          return (
            <View key={index} style={chartStyles.barColumn}>
              <Text style={chartStyles.barValue}>
                {item.amount > 0 ? `$${Math.round(item.amount)}` : ''}
              </Text>
              <View style={chartStyles.barTrack}>
                <View
                  style={[
                    chartStyles.barFill,
                    { height: `${Math.max(heightPercent, 2)}%` },
                  ]}
                />
              </View>
              <Text style={chartStyles.barLabel}>{item.weekLabel}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const chartStyles = StyleSheet.create({
  container: {
    marginTop: 12,
  },
  barsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    height: 160,
  },
  barColumn: {
    flex: 1,
    alignItems: 'center',
    marginHorizontal: 4,
  },
  barValue: {
    fontSize: 10,
    color: Colors.textSecondary,
    marginBottom: 4,
    fontWeight: '600',
  },
  barTrack: {
    width: '80%',
    height: 120,
    backgroundColor: Colors.surfaceLight,
    borderRadius: 4,
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  barFill: {
    width: '100%',
    backgroundColor: Colors.primary,
    borderRadius: 4,
  },
  barLabel: {
    fontSize: 10,
    color: Colors.textTertiary,
    marginTop: 6,
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
    <View style={payoutStyles.container}>
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
  );
}

const payoutStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 10,
    padding: 14,
    marginHorizontal: 16,
    marginBottom: 8,
  },
  left: {
    flex: 1,
    marginRight: 12,
  },
  taskName: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textPrimary,
    marginBottom: 4,
  },
  date: {
    fontSize: 12,
    color: Colors.textTertiary,
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
    color: Colors.textTertiary,
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
}

function StripeStatus({ status }: StripeStatusProps): React.JSX.Element {
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
    <View style={stripeStyles.container}>
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
        <TouchableOpacity
          style={stripeStyles.connectButton}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Connect Stripe account"
        >
          <Text style={stripeStyles.connectButtonText}>Connect Stripe</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const stripeStyles = StyleSheet.create({
  container: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 16,
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
    color: Colors.textPrimary,
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
    color: Colors.textSecondary,
    lineHeight: 18,
  },
  connectButton: {
    marginTop: 12,
    backgroundColor: Colors.primary,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  connectButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.white,
  },
});

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function EarningsScreen(): React.JSX.Element {
  const {
    earnings,
    weeklyEarnings,
    payouts,
    providerProfile,
    isLoadingEarnings,
    fetchEarnings,
  } = useProviderStore();

  const [selectedPeriod, setSelectedPeriod] = useState<Period>('week');

  useEffect(() => {
    fetchEarnings();
  }, [fetchEarnings]);

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
        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>Today</Text>
          <Text style={styles.summaryValue}>
            {formatCurrency(earnings.today)}
          </Text>
        </View>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>This Week</Text>
          <Text style={styles.summaryValue}>
            {formatCurrency(earnings.thisWeek)}
          </Text>
        </View>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>This Month</Text>
          <Text style={styles.summaryValue}>
            {formatCurrency(earnings.thisMonth)}
          </Text>
        </View>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>Total Earned</Text>
          <Text style={[styles.summaryValue, { color: Colors.primary }]}>
            {formatCurrency(earnings.totalEarned)}
          </Text>
        </View>
      </View>

      {/* Pending vs Paid */}
      <View style={styles.payoutSplitCard}>
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

      {/* Weekly chart */}
      {weeklyEarnings.length > 0 && (
        <View style={styles.chartCard}>
          <Text style={styles.sectionTitle}>Weekly Earnings</Text>
          <BarChart data={weeklyEarnings} />
        </View>
      )}

      {/* Stripe connect status */}
      {providerProfile && (
        <StripeStatus status={providerProfile.stripeConnectStatus} />
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
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
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
    backgroundColor: Colors.surface,
    borderRadius: 10,
    padding: 14,
    margin: '1%',
  },
  summaryLabel: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginBottom: 4,
  },
  summaryValue: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.success,
  },
  payoutSplitCard: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderRadius: 12,
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 16,
  },
  payoutSplitItem: {
    flex: 1,
    alignItems: 'center',
  },
  payoutSplitDivider: {
    width: StyleSheet.hairlineWidth,
    backgroundColor: Colors.border,
  },
  payoutSplitLabel: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginBottom: 4,
  },
  payoutSplitValue: {
    fontSize: 18,
    fontWeight: '700',
  },
  chartCard: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 16,
    marginHorizontal: 16,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.textPrimary,
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
    backgroundColor: Colors.surface,
    borderRadius: 8,
    padding: 2,
  },
  periodTab: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  periodTabActive: {
    backgroundColor: Colors.primary,
  },
  periodTabText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  periodTabTextActive: {
    color: Colors.white,
  },
  emptyPayouts: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  emptyPayoutsText: {
    fontSize: 14,
    color: Colors.textTertiary,
  },
  bottomSpacer: {
    height: 32,
  },
});
