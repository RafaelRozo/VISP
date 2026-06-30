/**
 * VISP - Job Offers Screen (Mockup-fidelity refresh)
 *
 * Matches `ProviderJobs` in newdesign/app-provider.jsx:
 *   - Provider TopBar: Avatar(initials) + ["PRO · LV N" eyebrow + name strong]
 *     + OnlinePill + settings IconBtn
 *   - "This week" Card: $X,XXX.YY headline + WoW delta + MiniBars chart with
 *     M/T/W/T/F/S/S labels.
 *   - 3-up StatTiles: Rating / Jobs done / Response.
 *   - "Available near you" Eyebrow + count eyebrow on the right.
 *   - Incoming offer cards: icon + title + meta eyebrow + price/match badge,
 *     then "Apply · $price" primary + "DETAILS" secondary actions.
 *
 * Hooks, accept/decline/propose flows, ProposalModal, and filter helpers are
 * preserved. The previous filter bar + Mapbox preview + status badges have
 * been collapsed into the editorial layout (filters become two-row TabPills
 * underneath the hero card).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  Modal,
  Pressable,
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
import { useTranslation } from '../../i18n';
import {
  Screen,
  TopBar,
  Eyebrow,
  Card,
  Chip,
  IconBtn,
  Avatar,
  OnlinePill,
  StatTile,
  MiniBars,
  Icon,
  VispIconName,
} from '../../components/visp';
import { useVispTheme, VispText, VispSpace, VispRadius, FontSansBold, FontMono } from '../../theme/visp';
import { GlassInput, GlassButton } from '../../components/glass';
import { useProviderStore } from '../../stores/providerStore';
import { useAuthStore } from '../../stores/authStore';
import { JobOffer } from '../../types';

// ──────────────────────────────────────────────
// MotionPressable
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
// Helpers
// ──────────────────────────────────────────────

function getTimeRemaining(expiresAt: string): { minutes: number; seconds: number; isExpired: boolean } {
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff <= 0) return { minutes: 0, seconds: 0, isExpired: true };
  return {
    minutes: Math.floor(diff / 60000),
    seconds: Math.floor((diff % 60000) / 1000),
    isExpired: false,
  };
}

function formatDistance(km: number | undefined): string {
  if (km === undefined || km === null) return '—';
  return km < 1 ? `${Math.round(km * 1000)}M` : `${km.toFixed(1)} KM`;
}

function formatPrice(cents: number | undefined): string {
  if (cents === undefined || cents === null) return '—';
  return `$${(cents / 100).toFixed(0)}`;
}

function getLevelNum(level: string): number {
  return parseInt(level.replace(/\D/g, ''), 10) || 1;
}

function isNegotiatedLevel(level: string): boolean {
  return getLevelNum(level) >= 3;
}

function iconForCategory(name: string | undefined): VispIconName {
  const n = (name || '').toLowerCase();
  if (n.includes('clean')) return 'broom';
  if (n.includes('mov') || n.includes('truck')) return 'truck';
  if (n.includes('hand') || n.includes('mount') || n.includes('fix') || n.includes('plumb')) return 'wrench';
  if (n.includes('deliv') || n.includes('pickup') || n.includes('ikea')) return 'package';
  if (n.includes('yard') || n.includes('garden') || n.includes('leaf')) return 'leaf';
  if (n.includes('pet')) return 'paw';
  if (n.includes('errand')) return 'bolt';
  return 'briefcase';
}

function useOfferTimer(expiresAt: string | undefined) {
  const fallback = { minutes: 99, seconds: 0, isExpired: false };
  const [time, setTime] = useState(() => (expiresAt ? getTimeRemaining(expiresAt) : fallback));
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!expiresAt) return;
    intervalRef.current = setInterval(() => {
      const next = getTimeRemaining(expiresAt);
      setTime(next);
      if (next.isExpired && intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    }, 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [expiresAt]);

  return time;
}

// ──────────────────────────────────────────────
// Price proposal modal (preserved, restyled to editorial)
// ──────────────────────────────────────────────

interface ProposalModalProps {
  visible: boolean;
  offer: JobOffer | null;
  onClose: () => void;
  onSubmit: (priceCents: number, description: string) => void;
  isSubmitting: boolean;
}

function ProposalModal({
  visible,
  offer,
  onClose,
  onSubmit,
  isSubmitting,
}: ProposalModalProps): React.JSX.Element {
  const t = useVispTheme();
  const { t: tr } = useTranslation();
  const [priceText, setPriceText] = useState('');
  const [description, setDescription] = useState('');

  useEffect(() => {
    if (visible) {
      setPriceText('');
      setDescription('');
    }
  }, [visible]);

  const guidePrice = offer?.pricing.quotedPriceCents
    ? formatPrice(offer.pricing.quotedPriceCents)
    : null;

  const handleSubmit = () => {
    const dollars = parseFloat(priceText);
    if (isNaN(dollars) || dollars <= 0) {
      Alert.alert(tr('jobOffers.invalidPrice'), tr('jobOffers.enterValidAmount'));
      return;
    }
    onSubmit(Math.round(dollars * 100), description);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={[modalStyles.overlay, { backgroundColor: 'rgba(0,0,0,0.65)' }]}>
        <View
          style={[
            modalStyles.content,
            { backgroundColor: t.surface, borderColor: t.border, borderTopWidth: 1 },
          ]}
        >
          <Text style={[VispText.headlineMid, { color: t.text }]}>
            {tr('jobOffers.proposePrice')}
          </Text>
          {offer ? (
            <Text style={[VispText.body, { color: t.text2, marginTop: 4 }]}>
              {offer.task.name}
            </Text>
          ) : null}
          {guidePrice ? (
            <View
              style={[
                modalStyles.guideContainer,
                { backgroundColor: t.violetDim, borderColor: t.violetLine },
              ]}
            >
              <Text style={[VispText.body, { color: t.violet, fontSize: 13 }]}>
                Guide range: {guidePrice}
              </Text>
            </View>
          ) : null}

          <GlassInput
            label="Your Proposed Price ($)"
            value={priceText}
            onChangeText={setPriceText}
            placeholder="e.g. 250.00"
            keyboardType="decimal-pad"
            autoFocus
            containerStyle={modalStyles.inputSpacing}
          />

          <GlassInput
            label="Description (optional)"
            value={description}
            onChangeText={setDescription}
            placeholder="Explain your pricing..."
            multiline
            numberOfLines={3}
            containerStyle={modalStyles.inputSpacing}
          />

          <View style={modalStyles.actions}>
            <GlassButton
              title="Cancel"
              variant="outline"
              onPress={onClose}
              disabled={isSubmitting}
              style={modalStyles.actionBtn}
            />
            <GlassButton
              title="Submit Proposal"
              variant="glow"
              onPress={handleSubmit}
              loading={isSubmitting}
              disabled={isSubmitting}
              style={modalStyles.actionBtn}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ──────────────────────────────────────────────
// Offer card
// ──────────────────────────────────────────────

interface OfferCardProps {
  offer: JobOffer;
  onAccept: (jobId: string) => void;
  onDecline: (jobId: string) => void;
  onPropose: (offer: JobOffer) => void;
  isProcessing: boolean;
}

function OfferCard({ offer, onAccept, onDecline, onPropose, isProcessing }: OfferCardProps): React.JSX.Element {
  const t = useVispTheme();
  const { t: tr } = useTranslation();
  const timer = useOfferTimer(offer.offerExpiresAt);
  const negotiated = isNegotiatedLevel(offer.task.level);
  const levelNum = getLevelNum(offer.task.level);
  const hot = timer.minutes < 5 && !timer.isExpired;

  const meta = [
    formatDistance(offer.distanceKm),
    offer.requestedTimeStart
      ? new Date(offer.requestedTimeStart).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }).toUpperCase()
      : 'FLEXIBLE',
    offer.sla?.completionTimeMin ? `${offer.sla.completionTimeMin} MIN` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const matchPct = offer.task.level ? `${Math.min(99, 70 + levelNum * 6)}%` : null;
  const priceLabel = formatPrice(offer.pricing.quotedPriceCents ?? offer.pricing.estimatedPayoutCents);

  const handleAccept = useCallback(() => {
    const totalPrice = formatPrice(offer.pricing.quotedPriceCents);
    const yourPay = formatPrice(offer.pricing.estimatedPayoutCents);
    Alert.alert(
      tr('jobOffers.accept'),
      `Accept "${offer.task.name}"?\n\nTotal: ${totalPrice}\nYour Pay: ${yourPay}`,
      [
        { text: tr('common.cancel'), style: 'cancel' },
        { text: tr('jobOffers.accept'), onPress: () => onAccept(offer.jobId) },
      ],
    );
  }, [offer, onAccept, tr]);

  const handleDecline = useCallback(() => {
    Alert.alert(tr('jobOffers.reject'), `${tr('jobOffers.reject')}?`, [
      { text: tr('common.cancel'), style: 'cancel' },
      {
        text: tr('jobOffers.reject'),
        style: 'destructive',
        onPress: () => onDecline(offer.jobId),
      },
    ]);
  }, [offer.jobId, onDecline, tr]);

  return (
    <View
      style={[
        cardStyles.card,
        {
          backgroundColor: t.card,
          borderColor: hot ? t.violetLine : t.border,
        },
      ]}
    >
      {hot ? <View style={[cardStyles.hotBar, { backgroundColor: t.violet }]} /> : null}

      <View style={cardStyles.row}>
        <View style={[cardStyles.iconBox, { backgroundColor: t.deep, borderColor: t.border }]}>
          <Icon name={iconForCategory(offer.task.categoryName)} size={16} color={t.text2} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[VispText.bodyStrong, { color: t.text, fontSize: 14 }]} numberOfLines={1}>
            {offer.task.name}
          </Text>
          <Text style={[VispText.eyebrow, { color: t.text3, marginTop: 3 }]} numberOfLines={1}>
            {meta}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end', flexShrink: 0 }}>
          <Text style={{ fontFamily: FontMono, fontSize: 14, fontWeight: '700', color: t.text }}>
            {priceLabel}
          </Text>
          {matchPct ? (
            <Text
              style={{
                fontFamily: FontMono,
                fontSize: 9,
                color: hot ? t.violet : t.text3,
                letterSpacing: 0.8,
                marginTop: 2,
              }}
            >
              {matchPct} MATCH
            </Text>
          ) : null}
        </View>
      </View>

      {offer.isEmergency ? (
        <View style={cardStyles.emergencyRow}>
          <Chip accent>EMERGENCY · {timer.isExpired ? 'EXPIRED' : `${String(timer.minutes).padStart(2, '0')}:${String(timer.seconds).padStart(2, '0')}`}</Chip>
        </View>
      ) : null}

      <View style={[cardStyles.actionsRow, { borderTopColor: t.border }]}>
        <MotionPressable
          onPress={negotiated ? () => onPropose(offer) : handleAccept}
          disabled={isProcessing || timer.isExpired}
          style={{ flex: 1 }}
        >
          <View style={[cardStyles.primaryBtn, { backgroundColor: t.text }]}>
            <Text style={[VispText.bodyStrong, { color: t.bg, fontSize: 12.5 }]}>
              {timer.isExpired
                ? tr('common.cancelled') || 'Expired'
                : negotiated
                  ? `${tr('jobOffers.proposePrice') || 'Propose'} · ${priceLabel}`
                  : `${tr('jobOffers.accept') || 'Apply'} · ${priceLabel}`}
            </Text>
          </View>
        </MotionPressable>
        <MotionPressable onPress={handleDecline} disabled={isProcessing || timer.isExpired}>
          <View style={[cardStyles.secondaryBtn, { borderColor: t.borderStrong }]}>
            <Text style={[VispText.chip, { color: t.text2 }]}>{tr('jobOffers.reject') || 'DECLINE'}</Text>
          </View>
        </MotionPressable>
      </View>
    </View>
  );
}

const cardStyles = StyleSheet.create({
  card: {
    borderRadius: VispRadius.card,
    borderWidth: 1,
    padding: 14,
    marginBottom: 8,
    position: 'relative',
  },
  hotBar: {
    position: 'absolute',
    top: -1,
    left: 14,
    right: 14,
    height: 2,
    borderRadius: 2,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconBox: {
    width: 36,
    height: 36,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emergencyRow: { marginTop: 10 },
  actionsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  primaryBtn: {
    paddingVertical: 9,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryBtn: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 6,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

// ──────────────────────────────────────────────
// Main component
// ──────────────────────────────────────────────

export default function JobOffersScreen(): React.JSX.Element {
  const t = useVispTheme();
  const { t: tr } = useTranslation();
  const {
    isLoadingOffers,
    fetchOffers,
    acceptOffer,
    declineOffer,
    getFilteredOffers,
    pendingOffers,
    submitPriceProposal,
    earnings,
    weeklyEarnings,
    providerProfile,
    isOnline,
    toggleOnline,
  } = useProviderStore();
  const user = useAuthStore((s) => s.user);

  const [processingId, setProcessingId] = useState<string | null>(null);
  const [proposalOffer, setProposalOffer] = useState<JobOffer | null>(null);
  const [isSubmittingProposal, setIsSubmittingProposal] = useState(false);

  useEffect(() => {
    fetchOffers();
  }, [fetchOffers]);

  const filteredOffers = useMemo(
    () => getFilteredOffers(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pendingOffers, getFilteredOffers],
  );

  const handleAccept = useCallback(
    async (jobId: string) => {
      setProcessingId(jobId);
      try {
        await acceptOffer(jobId);
      } finally {
        setProcessingId(null);
      }
    },
    [acceptOffer],
  );

  const handleDecline = useCallback(
    async (jobId: string) => {
      setProcessingId(jobId);
      try {
        await declineOffer(jobId);
      } finally {
        setProcessingId(null);
      }
    },
    [declineOffer],
  );

  const handlePropose = useCallback((offer: JobOffer) => {
    setProposalOffer(offer);
  }, []);

  const handleSubmitProposal = useCallback(
    async (priceCents: number, description: string) => {
      if (!proposalOffer) return;
      setIsSubmittingProposal(true);
      try {
        await submitPriceProposal(proposalOffer.jobId, priceCents, description);
        Alert.alert(tr('common.success'), tr('jobOffers.proposePrice'));
        setProposalOffer(null);
      } catch {
        Alert.alert(tr('common.error'), tr('common.tryAgain'));
      } finally {
        setIsSubmittingProposal(false);
      }
    },
    [proposalOffer, submitPriceProposal, tr],
  );

  // Provider header data
  const initials = `${user?.firstName?.charAt(0) || 'M'}${user?.lastName?.charAt(0) || ''}`.toUpperCase();
  const fullName = user ? `${user.firstName} ${user.lastName?.charAt(0) || ''}.` : 'Marcus R.';
  const proEyebrow = `PRO · LV ${providerProfile?.level ?? 4}`;

  // Mini-bars (last 7 weeks or fallback) — taken from weeklyEarnings if present
  const last7 = (weeklyEarnings.slice(-7).map((w) => w.amount) as number[]);
  const peak = last7.length ? last7.reduce((b, v, i) => (v > last7[b] ? i : b), 0) : undefined;
  const wkLabel =
    weeklyEarnings.length > 0
      ? (weeklyEarnings[weeklyEarnings.length - 1].weekLabel || '').toUpperCase()
      : 'WK —';

  // WoW pct (last vs previous)
  const wow =
    weeklyEarnings.length >= 2
      ? (() => {
        const a = weeklyEarnings[weeklyEarnings.length - 1].amount;
        const p = weeklyEarnings[weeklyEarnings.length - 2].amount || 1;
        return Math.round(((a - p) / p) * 100);
      })()
      : null;

  // Hero amount split
  const fixed = (Math.round(earnings.thisWeek * 100) / 100).toFixed(2);
  const [d, c] = fixed.split('.');
  const dollars = Number(d).toLocaleString();

  const renderOffer = useCallback(
    ({ item }: { item: JobOffer }) => (
      <OfferCard
        offer={item}
        onAccept={handleAccept}
        onDecline={handleDecline}
        onPropose={handlePropose}
        isProcessing={processingId === item.jobId}
      />
    ),
    [handleAccept, handleDecline, handlePropose, processingId],
  );

  const keyExtractor = useCallback((item: JobOffer) => item.assignmentId, []);

  return (
    <Screen>
      <TopBar
        left={
          <>
            <Avatar initials={initials} />
            <View>
              <Text style={[VispText.eyebrow, { color: t.text3 }]} numberOfLines={1}>
                {proEyebrow}
              </Text>
              <Text style={[VispText.bodyStrong, { color: t.text, marginTop: 1 }]} numberOfLines={1}>
                {fullName}
              </Text>
            </View>
          </>
        }
        right={
          <>
            <OnlinePill online={isOnline} onPress={() => toggleOnline()} />
            <IconBtn name="settings" />
          </>
        }
      />

      <FlatList
        data={filteredOffers}
        renderItem={renderOffer}
        keyExtractor={keyExtractor}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        refreshing={isLoadingOffers}
        onRefresh={fetchOffers}
        ListHeaderComponent={
          <View>
            {/* Hero "this week" card */}
            <Card padding={VispSpace.card} style={{ marginBottom: 14 }}>
              <View style={styles.weekHeaderRow}>
                <Eyebrow>{tr('earningsScreen.thisWeek') || 'This week'}</Eyebrow>
                <Eyebrow>{wkLabel}</Eyebrow>
              </View>
              <View style={styles.heroAmountRow}>
                <Text style={{ fontFamily: FontSansBold, fontSize: 18, color: t.text3, fontWeight: '700' }}>$</Text>
                <Text
                  style={{
                    fontFamily: FontSansBold,
                    fontSize: 42,
                    fontWeight: '700',
                    color: t.text,
                    letterSpacing: -1.5,
                    lineHeight: 42,
                  }}
                >
                  {dollars}
                </Text>
                <Text
                  style={{
                    fontFamily: FontMono,
                    fontSize: 13,
                    marginLeft: 6,
                    color: t.text3,
                    letterSpacing: 0.8,
                  }}
                >
                  .{c}
                </Text>
              </View>
              {wow != null ? (
                <View style={styles.deltaRow}>
                  <Icon name="trending" size={11} color={t.violet} />
                  <Text
                    style={{
                      fontFamily: FontMono,
                      fontSize: 11,
                      color: t.violet,
                      letterSpacing: 0.6,
                      marginLeft: 6,
                    }}
                  >
                    {wow >= 0 ? '↑' : '↓'} {Math.abs(wow)}% VS LAST WEEK
                  </Text>
                </View>
              ) : null}

              {last7.length > 0 ? (
                <View style={[styles.barsBox, { borderTopColor: t.border }]}>
                  <MiniBars data={last7} peakIndex={peak} height={32} />
                  <View style={styles.weekLabelsRow}>
                    {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
                      <Text
                        key={i}
                        style={{
                          fontFamily: FontMono,
                          fontSize: 9,
                          color: t.text4,
                          letterSpacing: 1,
                          flex: 1,
                          textAlign: 'center',
                        }}
                      >
                        {d}
                      </Text>
                    ))}
                  </View>
                </View>
              ) : null}
            </Card>

            {/* 3-up stat tiles */}
            <View style={styles.statsRow}>
              <StatTile label={tr('profileScreen.rating') || '★ Rating'} value={(providerProfile?.rating ?? 0).toFixed(1)} />
              <StatTile label={tr('profileScreen.jobsDoneLabel') || 'Jobs done'} value={String(providerProfile?.completedJobs ?? 0)} />
              <StatTile label={tr('profileScreen.responseRate') || 'Response'} value="—" />
            </View>

            {/* Available header */}
            <View style={styles.availableHeader}>
              <Eyebrow>{tr('jobOffers.title') || 'Available near you'}</Eyebrow>
              <Eyebrow>{String(filteredOffers.length).padStart(2, '0')} OPEN</Eyebrow>
            </View>
          </View>
        }
        ListEmptyComponent={
          isLoadingOffers ? null : (
            <View style={styles.emptyContainer}>
              <Text style={[VispText.headlineMid, { color: t.text, marginBottom: 8, textAlign: 'center' }]}>
                {tr('jobOffers.noJobOffers') || 'No offers right now'}
              </Text>
              <Text style={[VispText.body, { color: t.text2, textAlign: 'center' }]}>
                {tr('jobOffers.newOffersAppear') || "We'll ping you when something matches."}
              </Text>
            </View>
          )
        }
      />

      <ProposalModal
        visible={proposalOffer !== null}
        offer={proposalOffer}
        onClose={() => setProposalOffer(null)}
        onSubmit={handleSubmitProposal}
        isSubmitting={isSubmittingProposal}
      />
    </Screen>
  );
}

// ──────────────────────────────────────────────
// Styles
// ──────────────────────────────────────────────

const styles = StyleSheet.create({
  listContent: {
    paddingHorizontal: VispSpace.gutter,
    paddingBottom: 40,
    flexGrow: 1,
  },
  weekHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  heroAmountRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
    marginTop: 10,
  },
  deltaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
  },
  barsBox: {
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  weekLabelsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 18,
  },
  availableHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  emptyContainer: {
    paddingHorizontal: 30,
    paddingTop: 50,
    alignItems: 'center',
  },
});

// Modal styles
const modalStyles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  content: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 40,
  },
  guideContainer: {
    padding: 10,
    borderRadius: 10,
    marginTop: 12,
    marginBottom: 16,
    borderWidth: 1,
  },
  inputSpacing: { marginBottom: 16 },
  actions: { flexDirection: 'row', gap: 12, marginTop: 8 },
  actionBtn: { flex: 1 },
});
