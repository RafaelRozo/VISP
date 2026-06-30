/**
 * VISP - My Jobs Screen (Mockup-fidelity refresh)
 *
 * Matches `CustomerJobs` in newdesign/app-customer.jsx:
 *   - ScreenTitle "Jobs" / "§ Activity" with a dark "New job" pill on the right
 *   - TabPills row: Active (N) / Completed (N) / Drafts (N)
 *   - Each Active card is split: top strip with status Chip + JOB-XXXX mono id,
 *     body with title + meta + footer row with date + price.
 *   - Pending-approval (provider review) jobs surface an inline accent
 *     sub-card with Approve / Reject actions.
 *   - Recently completed list rendered with `Row` primitive.
 *
 * Business logic (fetch, navigation, approval handlers) is preserved.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
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
import { AnimatedSpinner } from '../../components/animations';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { useTranslation } from '../../i18n';
import {
  Screen,
  ScreenTitle,
  Eyebrow,
  Card,
  Chip,
  Row,
  Icon,
  VispIconName,
} from '../../components/visp';
import { useVispTheme, VispText, VispSpace, VispRadius, FontSansBold, FontMono } from '../../theme/visp';
import taskService from '../../services/taskService';
import { paymentService } from '../../services/paymentService';
import { useAuthStore } from '../../stores/authStore';
import type { Job, RootStackParamList } from '../../types';

type NavProp = NativeStackNavigationProp<RootStackParamList>;
type TabKey = 'active' | 'completed' | 'drafts';

const PENDING_STATUSES = ['pending_match', 'draft', 'pending'];

// ──────────────────────────────────────────────
// MotionPressable — scale-spring press feedback
// ──────────────────────────────────────────────

function MotionPressable({
  onPress,
  children,
  style,
  pressScale = 0.97,
  disabled,
}: {
  onPress?: () => void;
  children: React.ReactNode;
  style?: ViewStyle | ViewStyle[];
  pressScale?: number;
  disabled?: boolean;
}): React.JSX.Element {
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
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
// TabPills (local helper)
// ──────────────────────────────────────────────

interface TabPillsProps {
  tabs: { key: TabKey; label: string; count: number }[];
  active: TabKey;
  onChange: (k: TabKey) => void;
}

function TabPills({ tabs, active, onChange }: TabPillsProps): React.JSX.Element {
  const t = useVispTheme();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={pillStyles.row}
    >
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
            <Text
              style={[
                VispText.chip,
                { color: isActive ? t.bg : t.text2 },
              ]}
            >
              {tab.label} ({String(tab.count).padStart(2, '0')})
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const pillStyles = StyleSheet.create({
  row: {
    paddingHorizontal: VispSpace.gutter,
    paddingBottom: 14,
    gap: 8,
    flexDirection: 'row',
    alignItems: 'center',
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

function statusLabelKey(status: string): string {
  const map: Record<string, string> = {
    draft: 'myJobs.draft',
    pending_match: 'myJobs.searchingForProvider',
    matched: 'myJobs.providerAssigned',
    pending_approval: 'myJobs.providerReview',
    scheduled: 'myJobs.scheduled',
    provider_accepted: 'myJobs.providerAccepted',
    provider_en_route: 'myJobs.providerEnRoute',
    arrived: 'myJobs.providerArrived',
    in_progress: 'myJobs.inProgress',
    completed: 'common.completed',
    cancelled_by_customer: 'common.cancelled',
    cancelled_by_provider: 'common.cancelled',
    cancelled_by_system: 'common.cancelled',
    disputed: 'myJobs.disputed',
    refunded: 'myJobs.refunded',
  };
  return map[status] ?? '';
}

function isCompletedStatus(status: string): boolean {
  return [
    'completed',
    'cancelled_by_customer',
    'cancelled_by_provider',
    'cancelled_by_system',
    'disputed',
    'refunded',
  ].includes(status);
}

function isDraftStatus(status: string): boolean {
  return status === 'draft';
}

function isAccentStatus(status: string): boolean {
  return ['pending_match', 'pending_approval', 'matched'].includes(status);
}

function formatJobId(id: string): string {
  // Show short uppercase id à la JOB-2104
  const tail = id.replace(/-/g, '').slice(-4).toUpperCase();
  return `JOB-${tail || '----'}`;
}

function formatDateMeta(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d
    .toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    .toUpperCase();
}

function iconForCategory(name: string | undefined): VispIconName {
  const n = (name || '').toLowerCase();
  if (n.includes('clean')) return 'broom';
  if (n.includes('mov')) return 'truck';
  if (n.includes('hand') || n.includes('mount') || n.includes('fix')) return 'wrench';
  if (n.includes('deliv') || n.includes('pickup')) return 'package';
  if (n.includes('yard') || n.includes('garden')) return 'leaf';
  if (n.includes('pet')) return 'paw';
  if (n.includes('errand')) return 'bolt';
  return 'briefcase';
}

// ──────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────

function MyJobsScreen(): React.JSX.Element {
  const t = useVispTheme();
  const { t: tr } = useTranslation();
  const navigation = useNavigation<NavProp>();
  const stripeCustomerId = useAuthStore((s) => s.user?.stripeCustomerId);

  const [jobs, setJobs] = useState<Job[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>('active');

  const fetchJobs = useCallback(async (silent = false) => {
    try {
      if (!silent) setIsLoading(true);
      const data = await taskService.getActiveJobs();
      setJobs(data);
    } catch {
      // Silently fail
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  const handleRefresh = useCallback(() => {
    setIsRefreshing(true);
    fetchJobs(true);
  }, [fetchJobs]);

  // Group / count jobs per tab
  const grouped = useMemo(() => {
    const active: Job[] = [];
    const completed: Job[] = [];
    const drafts: Job[] = [];
    for (const j of jobs) {
      if (isDraftStatus(j.status)) drafts.push(j);
      else if (isCompletedStatus(j.status)) completed.push(j);
      else active.push(j);
    }
    return { active, completed, drafts };
  }, [jobs]);

  const tabs = useMemo(
    () => [
      { key: 'active' as TabKey, label: tr('myJobs.active') || 'Active', count: grouped.active.length },
      { key: 'completed' as TabKey, label: tr('common.completed') || 'Completed', count: grouped.completed.length },
      { key: 'drafts' as TabKey, label: tr('myJobs.draft') || 'Drafts', count: grouped.drafts.length },
    ],
    [grouped, tr],
  );

  const filteredJobs = grouped[activeTab];

  const handleJobPress = useCallback(
    (job: Job) => {
      if (PENDING_STATUSES.includes(job.status)) {
        Alert.alert(tr('myJobs.searchingForProvider'), tr('homeScreen.searchingMessage'));
        return;
      }
      if (job.status === 'matched') {
        Alert.alert(tr('homeScreen.waitingForProvider'), tr('homeScreen.waitingMessage'));
        return;
      }
      if (job.status === 'pending_approval') {
        Alert.alert(tr('myJobs.providerReview'), tr('myJobs.reviewProviderInfo'));
        return;
      }
      navigation.navigate('JobTracking', { jobId: job.id });
    },
    [navigation, tr],
  );

  // Provider info cache for pending_approval jobs
  const [providerInfoMap, setProviderInfoMap] = useState<Record<string, any>>({});

  useEffect(() => {
    const pendingApprovalJobs = jobs.filter((j) => j.status === 'pending_approval');
    pendingApprovalJobs.forEach(async (job) => {
      if (providerInfoMap[job.id]) return;
      try {
        const info = await taskService.getPendingProvider(job.id);
        if (info) setProviderInfoMap((prev) => ({ ...prev, [job.id]: info }));
      } catch {
        // ignore
      }
    });
  }, [jobs, providerInfoMap]);

  const handleApproveProvider = useCallback(
    async (jobId: string) => {
      try {
        await taskService.approveProvider(jobId);
      } catch {
        Alert.alert(tr('common.error'), tr('myJobs.failedApprove'));
        return;
      }

      // PP5-3 — place the manual-capture hold (total × 1.30) on the customer's
      // saved card. Non-blocking: the provider is already approved; if there's
      // no card or the hold fails, surface a prompt but keep the job scheduled.
      let held = false;
      try {
        if (stripeCustomerId) {
          const { methods } = await paymentService.listPaymentMethods(stripeCustomerId);
          if (methods.length > 0) {
            const res = await taskService.authorizePayment(jobId, methods[0].id);
            held = res.status === 'requires_capture';
          }
        }
      } catch {
        held = false;
      }

      if (held) {
        Alert.alert(tr('myJobs.approved'), tr('myJobs.holdPlaced'));
      } else {
        Alert.alert(tr('myJobs.approved'), tr('myJobs.holdPending'));
      }
      fetchJobs(true);
    },
    [fetchJobs, tr, stripeCustomerId],
  );

  const handleRejectProvider = useCallback(
    (jobId: string) => {
      Alert.alert(tr('myJobs.rejectProvider'), tr('myJobs.rejectConfirm'), [
        { text: tr('common.cancel'), style: 'cancel' },
        {
          text: tr('myJobs.reject'),
          style: 'destructive',
          onPress: async () => {
            try {
              await taskService.rejectProvider(jobId);
              Alert.alert(tr('myJobs.providerRejected'), tr('myJobs.findAnother'));
              fetchJobs(true);
            } catch {
              Alert.alert(tr('common.error'), tr('myJobs.failedReject'));
            }
          },
        },
      ]);
    },
    [fetchJobs, tr],
  );

  const handleNewJob = useCallback(() => {
    // Jump to the Home tab — the entry point to browse categories and start a
    // new job (CustomerHome → Home tab → CategoryDetail → TaskSelection → Booking).
    // Navigating to 'CustomerHome' alone is a no-op since we're already inside it,
    // so we target the nested 'Home' tab explicitly.
    navigation.navigate('CustomerHome', { screen: 'Home' } as never);
  }, [navigation]);

  // ── Active card renderer ──────────────────
  const renderActiveCard = useCallback(
    (item: Job) => {
      const isPending = PENDING_STATUSES.includes(item.status);
      const isPendingApproval = item.status === 'pending_approval';
      const accent = isAccentStatus(item.status);
      const providerInfo = providerInfoMap[item.id];
      const labelKey = statusLabelKey(item.status);
      const statusText = (labelKey ? tr(labelKey) : item.status.replace(/_/g, ' ')).toUpperCase();
      const city = item.address?.city ? `, ${item.address.city}` : '';
      const meta = [item.address?.street, city, item.categoryName?.toUpperCase()]
        .filter(Boolean)
        .join(' · ');

      return (
        <MotionPressable
          key={item.id}
          onPress={() => handleJobPress(item)}
          style={{ marginBottom: 10 }}
        >
          <Card accent={accent} padding={0}>
            {/* Top strip — status chip + mono job id */}
            <View style={[styles.cardStrip, { borderBottomColor: t.border }]}>
              <View style={styles.chipRow}>
                {isPending ? <AnimatedSpinner size={10} color={t.violet} style={{ marginRight: 6 }} /> : null}
                <Chip accent={accent} dark={!accent}>
                  {statusText}
                </Chip>
              </View>
              <Text style={[VispText.eyebrow, { color: t.text3 }]}>{formatJobId(item.id)}</Text>
            </View>

            {/* Body */}
            <View style={styles.cardBody}>
              <Text
                style={[VispText.bodyStrong, styles.cardTitle, { color: t.text }]}
                numberOfLines={1}
              >
                {item.taskName || tr('myJobs.job')}
              </Text>
              {meta ? (
                <Text style={[VispText.eyebrow, { color: t.text3, marginBottom: 12 }]} numberOfLines={1}>
                  {meta}
                </Text>
              ) : null}

              {/* Footer — date eyebrow + price */}
              <View style={styles.cardFooter}>
                <Text style={[VispText.eyebrow, { color: t.text3 }]}>{formatDateMeta(item.createdAt)}</Text>
                {item.estimatedPrice > 0 ? (
                  <Text
                    style={{
                      fontFamily: FontMono,
                      fontSize: 14,
                      fontWeight: '700',
                      color: t.text,
                    }}
                  >
                    ${item.estimatedPrice.toFixed(2)}
                  </Text>
                ) : null}
              </View>
            </View>

            {/* Pending approval — provider preview + actions */}
            {isPendingApproval && providerInfo ? (
              <View style={[styles.providerCard, { borderTopColor: t.border, backgroundColor: t.violetDim }]}>
                <Eyebrow color={t.violet}>{tr('myJobs.wantsToAccept').toUpperCase()}</Eyebrow>
                <View style={styles.providerRow}>
                  <View style={[styles.providerLevel, { backgroundColor: t.violet }]}>
                    <Text style={{ fontFamily: FontSansBold, color: t.bg, fontSize: 13, fontWeight: '800' }}>
                      L{providerInfo.level}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[VispText.bodyStrong, { color: t.text }]} numberOfLines={1}>
                      {providerInfo.displayName}
                    </Text>
                    {providerInfo.yearsExperience ? (
                      <Text style={[VispText.body, { color: t.text2, fontSize: 12, marginTop: 2 }]} numberOfLines={1}>
                        {providerInfo.yearsExperience} {tr('myJobs.yearsExperience')}
                      </Text>
                    ) : null}
                  </View>
                </View>

                {/* PP4 — the provider's own offered price for this job */}
                {providerInfo.rateCents != null ? (
                  <View style={{ marginTop: 10, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.border }}>
                    <Eyebrow color={t.text3}>{tr('myJobs.offeredPrice')}</Eyebrow>
                    <Text style={{ fontFamily: FontMono, fontSize: 14, fontWeight: '700', color: t.text, marginTop: 4 }}>
                      ${(providerInfo.rateCents / 100).toFixed(2)}/{tr(`myPricesScreen.unit.${providerInfo.pricingUnit}`) || providerInfo.pricingUnit}
                      {providerInfo.quotedPriceCents != null
                        ? `   →   $${(providerInfo.quotedPriceCents / 100).toFixed(2)}`
                        : ''}
                    </Text>
                    {providerInfo.estimatedQuantity != null ? (
                      <Text style={[VispText.eyebrow, { color: t.text3, marginTop: 3 }]}>
                        {tr('myJobs.estimatedQty')} · ~{providerInfo.estimatedQuantity} {tr(`myPricesScreen.unit.${providerInfo.pricingUnit}`) || ''}
                      </Text>
                    ) : null}
                  </View>
                ) : providerInfo.quotedPriceCents != null ? (
                  <View style={{ marginTop: 10, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.border }}>
                    <Eyebrow color={t.text3}>{tr('myJobs.offeredPrice')}</Eyebrow>
                    <Text style={{ fontFamily: FontMono, fontSize: 15, fontWeight: '700', color: t.text, marginTop: 4 }}>
                      ${(providerInfo.quotedPriceCents / 100).toFixed(2)}
                    </Text>
                  </View>
                ) : null}

                {/* PP4c — full price breakdown: Servicio + Impuesto + Tarifa de servicio = Total */}
                {providerInfo.totalChargedCents != null ? (
                  <View style={{ marginTop: 10, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.border }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 }}>
                      <Text style={[VispText.eyebrow, { color: t.text3 }]}>{tr('myJobs.priceServicio')}</Text>
                      <Text style={{ fontFamily: FontMono, fontSize: 13, color: t.text2 }}>
                        ${((providerInfo.quotedPriceCents ?? 0) / 100).toFixed(2)}
                      </Text>
                    </View>
                    {providerInfo.serviceTaxCents ? (
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 }}>
                        <Text style={[VispText.eyebrow, { color: t.text3 }]}>
                          {tr('myJobs.priceTax')}{providerInfo.taxJurisdiction ? ` (${providerInfo.taxJurisdiction})` : ''}
                        </Text>
                        <Text style={{ fontFamily: FontMono, fontSize: 13, color: t.text2 }}>
                          ${(providerInfo.serviceTaxCents / 100).toFixed(2)}
                        </Text>
                      </View>
                    ) : null}
                    {providerInfo.serviceFeeCents ? (
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 }}>
                        <Text style={[VispText.eyebrow, { color: t.text3 }]}>{tr('myJobs.priceServiceFee')}</Text>
                        <Text style={{ fontFamily: FontMono, fontSize: 13, color: t.text2 }}>
                          ${(providerInfo.serviceFeeCents / 100).toFixed(2)}
                        </Text>
                      </View>
                    ) : null}
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4, paddingTop: 4, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.border }}>
                      <Text style={[VispText.eyebrow, { color: t.text, fontWeight: '700' }]}>{tr('myJobs.priceTotal')}</Text>
                      <Text style={{ fontFamily: FontMono, fontSize: 15, fontWeight: '700', color: t.text }}>
                        ${(providerInfo.totalChargedCents / 100).toFixed(2)}
                      </Text>
                    </View>
                  </View>
                ) : null}

                <View style={styles.approvalButtons}>
                  <Pressable
                    onPress={() => handleRejectProvider(item.id)}
                    style={[styles.approveBtn, { borderColor: t.borderStrong, backgroundColor: 'transparent' }]}
                  >
                    <Text style={[VispText.chip, { color: t.danger }]}>{tr('myJobs.reject')}</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => handleApproveProvider(item.id)}
                    style={[styles.approveBtn, { backgroundColor: t.text, borderColor: t.text }]}
                  >
                    <Text style={[VispText.bodyStrong, { color: t.bg, fontSize: 13 }]}>{tr('myJobs.approve')}</Text>
                  </Pressable>
                </View>
              </View>
            ) : null}
          </Card>
        </MotionPressable>
      );
    },
    [handleApproveProvider, handleJobPress, handleRejectProvider, providerInfoMap, t, tr],
  );

  // ── Completed / drafts row renderer ──────
  const renderHistoryRow = useCallback(
    (item: Job, isLast: boolean) => {
      const labelKey = statusLabelKey(item.status);
      const statusText = (labelKey ? tr(labelKey) : item.status.replace(/_/g, ' ')).toUpperCase();
      const date = formatDateMeta(item.completedAt || item.updatedAt || item.createdAt);
      const meta = [date, item.provider ? `${item.provider.firstName?.toUpperCase()} ${item.provider.lastName?.charAt(0).toUpperCase() || ''}.` : null]
        .filter(Boolean)
        .join(' · ');
      const price = (item.finalPrice ?? item.estimatedPrice) || 0;
      return (
        <View key={item.id} style={isLast ? undefined : [styles.rowDivider, { borderBottomColor: t.border }]}>
          <Row
            icon={iconForCategory(item.categoryName)}
            title={item.taskName || statusText}
            sub={meta}
            chevron={false}
            onPress={() => handleJobPress(item)}
            trailing={
              <View style={{ alignItems: 'flex-end' }}>
                {price > 0 ? (
                  <Text style={{ fontFamily: FontMono, fontSize: 13, fontWeight: '700', color: t.text }}>
                    ${price.toFixed(0)}
                  </Text>
                ) : null}
                <Text style={[VispText.eyebrow, { color: t.text3, marginTop: 2 }]}>{statusText}</Text>
              </View>
            }
          />
        </View>
      );
    },
    [handleJobPress, t, tr],
  );

  // ── Empty / loading ──────────────────────
  if (isLoading) {
    return (
      <Screen>
        <View style={styles.loading}>
          <AnimatedSpinner size={32} color={t.violet} />
          <Text style={[VispText.body, { color: t.text2, marginTop: 12 }]}>
            {tr('myJobs.loadingJobs')}
          </Text>
        </View>
      </Screen>
    );
  }

  const newJobButton = (
    <MotionPressable onPress={handleNewJob}>
      <View style={[styles.newJobPill, { backgroundColor: t.text }]}>
        <Icon name="plus" size={14} color={t.bg} active />
        <Text style={[VispText.bodyStrong, { color: t.bg, fontSize: 12 }]}>
          {tr('myJobs.newJob') || 'New job'}
        </Text>
      </View>
    </MotionPressable>
  );

  return (
    <Screen>
      <ScreenTitle title={tr('myJobs.title') || 'Jobs'} sub="§ Activity" right={newJobButton} />

      <TabPills tabs={tabs} active={activeTab} onChange={setActiveTab} />

      <FlatList
        data={filteredJobs}
        keyExtractor={(item) => item.id}
        renderItem={({ item, index }) =>
          activeTab === 'active'
            ? renderActiveCard(item)
            : renderHistoryRow(item, index === filteredJobs.length - 1)
        }
        contentContainerStyle={filteredJobs.length === 0 ? styles.emptyList : styles.list}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={[VispText.headlineMid, { color: t.text, textAlign: 'center', marginBottom: 8 }]}>
              {activeTab === 'completed'
                ? tr('myJobs.noPastJobs')
                : activeTab === 'drafts'
                  ? tr('myJobs.draft') || 'No drafts'
                  : tr('myJobs.noActiveJobs')}
            </Text>
            <Text style={[VispText.body, { color: t.text2, textAlign: 'center' }]}>
              {activeTab === 'completed' ? tr('myJobs.pastJobsAppear') : tr('myJobs.bookService')}
            </Text>
          </View>
        }
        refreshControl={
          <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor={t.text2} />
        }
        showsVerticalScrollIndicator={false}
      />
    </Screen>
  );
}

// ──────────────────────────────────────────────
// Styles
// ──────────────────────────────────────────────

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  list: { paddingHorizontal: VispSpace.gutter, paddingTop: 4, paddingBottom: 60 },
  emptyList: { flex: 1, justifyContent: 'center', paddingHorizontal: VispSpace.gutter },

  empty: { alignItems: 'center', justifyContent: 'center' },

  newJobPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },

  cardStrip: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  chipRow: { flexDirection: 'row', alignItems: 'center', flexShrink: 1 },

  cardBody: { padding: 16 },
  cardTitle: { fontSize: 16, marginBottom: 6, letterSpacing: -0.24 },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
  },

  providerCard: {
    padding: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  providerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 10,
    marginBottom: 12,
  },
  providerLevel: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  approvalButtons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  approveBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 1,
  },

  rowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});

export default MyJobsScreen;
