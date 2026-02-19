/**
 * VISP - Job Offers Screen
 *
 * List of available job offers for the provider. Each offer shows:
 * task name, customer location (distance), price, SLA deadline,
 * accept/decline buttons, timer showing offer expiry, and map preview.
 *
 * Enhancements:
 * - Filter bar: category, distance, sort
 * - Level badge with rate range on each card
 * - L3/L4 negotiated pricing: "Propose Price" flow
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Colors, getLevelColor } from '../../theme/colors';
import { GlassStyles } from '../../theme/glass';
import { GlassBackground, GlassCard, GlassButton, GlassInput } from '../../components/glass';
import { useProviderStore } from '../../stores/providerStore';
import { JobOffer } from '../../types';
import MapboxGL from '@rnmapbox/maps';
import { Config } from '../../services/config';

MapboxGL.setAccessToken(Config.mapboxAccessToken);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DISTANCE_OPTIONS = [
  { label: '< 5km', value: 5 },
  { label: '< 10km', value: 10 },
  { label: '< 25km', value: 25 },
  { label: 'All', value: null },
] as const;

const SORT_OPTIONS = [
  { label: 'Expiring Soon', value: 'expiry' as const },
  { label: 'Nearest', value: 'distance' as const },
  { label: 'Highest Pay', value: 'price' as const },
] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getTimeRemaining(expiresAt: string): {
  minutes: number;
  seconds: number;
  isExpired: boolean;
} {
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff <= 0) return { minutes: 0, seconds: 0, isExpired: true };
  return {
    minutes: Math.floor(diff / 60000),
    seconds: Math.floor((diff % 60000) / 1000),
    isExpired: false,
  };
}

function formatDistance(km: number | undefined): string {
  if (km === undefined || km === null) return '\u2014';
  return km < 1 ? `${Math.round(km * 1000)}m` : `${km.toFixed(1)}km`;
}

function formatPrice(cents: number | undefined): string {
  if (cents === undefined || cents === null) return '\u2014';
  return `$${(cents / 100).toFixed(2)}`;
}

function getLevelNum(level: string): number {
  return parseInt(level.replace(/\D/g, ''), 10) || 1;
}

function isNegotiatedLevel(level: string): boolean {
  const num = getLevelNum(level);
  return num >= 3;
}

function getRateBadgeText(level: string): string {
  const num = getLevelNum(level);
  switch (num) {
    case 1:
      return '$45-70/hr';
    case 2:
      return '$80-120/hr';
    case 3:
    case 4:
      return 'Negotiate Price';
    default:
      return '';
  }
}

function getLevelLabel(level: string): string {
  const num = getLevelNum(level);
  switch (num) {
    case 1:
      return 'L1';
    case 2:
      return 'L2';
    case 3:
      return 'L3';
    case 4:
      return 'L4';
    default:
      return level;
  }
}

// ---------------------------------------------------------------------------
// Offer Timer Hook
// ---------------------------------------------------------------------------

function useOfferTimer(expiresAt: string | undefined) {
  const fallback = { minutes: 99, seconds: 0, isExpired: false };
  const [time, setTime] = useState(() =>
    expiresAt ? getTimeRemaining(expiresAt) : fallback,
  );
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

// ---------------------------------------------------------------------------
// Price Proposal Modal
// ---------------------------------------------------------------------------

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
      Alert.alert('Invalid Price', 'Please enter a valid dollar amount.');
      return;
    }
    onSubmit(Math.round(dollars * 100), description);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={modalStyles.overlay}>
        <View style={[GlassStyles.modal, modalStyles.content]}>
          <Text style={modalStyles.title}>Propose Your Price</Text>
          {offer && (
            <Text style={modalStyles.taskName}>{offer.task.name}</Text>
          )}
          {guidePrice && (
            <View style={modalStyles.guideContainer}>
              <Text style={modalStyles.guideText}>
                Guide range: {guidePrice}
              </Text>
            </View>
          )}

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

// ---------------------------------------------------------------------------
// OfferCard sub-component
// ---------------------------------------------------------------------------

interface OfferCardProps {
  offer: JobOffer;
  onAccept: (jobId: string) => void;
  onDecline: (jobId: string) => void;
  onPropose: (offer: JobOffer) => void;
  isProcessing: boolean;
}

function OfferCard({
  offer,
  onAccept,
  onDecline,
  onPropose,
  isProcessing,
}: OfferCardProps): React.JSX.Element {
  const timer = useOfferTimer(offer.offerExpiresAt);
  const levelNum = getLevelNum(offer.task.level) as 1 | 2 | 3 | 4;
  const levelColor = getLevelColor(levelNum);
  const negotiated = isNegotiatedLevel(offer.task.level);

  const timerColor = timer.isExpired
    ? Colors.textTertiary
    : timer.minutes < 2
      ? Colors.emergencyRed
      : Colors.warning;

  const timerText = timer.isExpired
    ? 'Expired'
    : `${String(timer.minutes).padStart(2, '0')}:${String(timer.seconds).padStart(2, '0')}`;

  const handleAccept = useCallback(() => {
    const totalPrice = formatPrice(offer.pricing.quotedPriceCents);
    const yourPay = formatPrice(offer.pricing.estimatedPayoutCents);
    Alert.alert(
      'Accept Offer',
      `Accept "${offer.task.name}"?\n\nTotal: ${totalPrice}\nYour Pay: ${yourPay}`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Accept',
          onPress: () => onAccept(offer.jobId),
        },
      ],
    );
  }, [offer, onAccept]);

  const handleDecline = useCallback(() => {
    Alert.alert(
      'Decline Offer',
      'Are you sure you want to decline this offer?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Decline',
          style: 'destructive',
          onPress: () => onDecline(offer.jobId),
        },
      ],
    );
  }, [offer.jobId, onDecline]);

  return (
    <GlassCard variant="dark" padding={0} style={styles.offerCard}>
      {/* Level strip */}
      <View style={[styles.offerLevelStrip, { backgroundColor: levelColor }]} />

      <View style={styles.offerContent}>
        {/* Header */}
        <View style={styles.offerHeader}>
          <View style={styles.offerHeaderLeft}>
            <Text style={styles.offerTaskName} numberOfLines={1}>
              {offer.task.name}
            </Text>
            <View style={styles.offerSubHeader}>
              <Text style={styles.offerCategory} numberOfLines={1}>
                {offer.task.categoryName ?? 'Service'} {'\u2022'} {offer.referenceNumber}
              </Text>
            </View>
          </View>
          <View style={[styles.timerBadge, { borderColor: timerColor }]}>
            <Text style={[styles.timerText, { color: timerColor }]}>
              {timerText}
            </Text>
          </View>
        </View>

        {/* Level + Rate badge row */}
        <View style={styles.badgeRow}>
          <View
            style={[
              styles.levelBadge,
              { backgroundColor: levelColor + '20', borderColor: levelColor },
            ]}
          >
            <Text style={[styles.levelBadgeText, { color: levelColor }]}>
              {getLevelLabel(offer.task.level)}
            </Text>
          </View>
          <View
            style={[
              styles.rateBadge,
              negotiated
                ? { backgroundColor: Colors.level3 + '20', borderColor: Colors.level3 }
                : { backgroundColor: Colors.success + '20', borderColor: Colors.success },
            ]}
          >
            <Text
              style={[
                styles.rateBadgeText,
                { color: negotiated ? Colors.level3 : Colors.success },
              ]}
            >
              {getRateBadgeText(offer.task.level)}
            </Text>
          </View>
        </View>

        {/* Details */}
        <View style={styles.offerDetails}>
          <View style={styles.offerDetailItem}>
            <Text style={styles.offerDetailLabel}>Location</Text>
            <Text style={styles.offerDetailValue} numberOfLines={1}>
              {offer.serviceCity ?? offer.serviceAddress}
            </Text>
          </View>
          <View style={styles.offerDetailItem}>
            <Text style={styles.offerDetailLabel}>Distance</Text>
            <Text style={styles.offerDetailValue}>
              {formatDistance(offer.distanceKm)}
            </Text>
          </View>
          {!negotiated ? (
            <>
              <View style={styles.offerDetailItem}>
                <Text style={styles.offerDetailLabel}>Total</Text>
                <Text style={styles.offerDetailValue}>
                  {formatPrice(offer.pricing.quotedPriceCents)}
                </Text>
              </View>
              <View style={styles.offerDetailItem}>
                <Text style={styles.offerDetailLabel}>Your Pay</Text>
                <Text style={styles.offerPriceValue}>
                  {formatPrice(offer.pricing.estimatedPayoutCents)}
                </Text>
              </View>
            </>
          ) : (
            <View style={styles.offerDetailItem}>
              <Text style={styles.offerDetailLabel}>Estimate</Text>
              <Text style={styles.offerDetailValue}>
                {offer.pricing.quotedPriceCents
                  ? formatPrice(offer.pricing.quotedPriceCents)
                  : 'TBD'}
              </Text>
            </View>
          )}
        </View>

        {/* Customer info */}
        {offer.customer.displayName && (
          <View style={styles.customerRow}>
            <Text style={styles.customerLabel}>Customer:</Text>
            <Text style={styles.customerValue}>
              {offer.customer.displayName}
              {offer.customer.rating ? ` \u2605${offer.customer.rating}` : ''}
            </Text>
          </View>
        )}

        {/* Emergency badge */}
        {offer.isEmergency && (
          <View style={styles.emergencyRow}>
            <Text style={styles.emergencyLabel}>EMERGENCY</Text>
          </View>
        )}

        {/* Map preview */}
        <View style={styles.mapContainer}>
          <MapboxGL.MapView
            style={styles.map}
            styleURL={MapboxGL.StyleURL.Street}
            scrollEnabled={false}
            zoomEnabled={false}
            rotateEnabled={false}
            pitchEnabled={false}
            attributionEnabled={false}
            logoEnabled={false}
          >
            <MapboxGL.Camera
              zoomLevel={13}
              centerCoordinate={[
                Number(offer.serviceLongitude),
                Number(offer.serviceLatitude),
              ]}
              animationMode="none"
            />
            <MapboxGL.MarkerView
              id={`offer-loc-${offer.assignmentId}`}
              coordinate={[
                Number(offer.serviceLongitude),
                Number(offer.serviceLatitude),
              ]}
            >
              <View style={styles.mapMarker} />
            </MapboxGL.MarkerView>
          </MapboxGL.MapView>
          {/* Glass overlay on map */}
          <View style={styles.mapGlassOverlay} />
        </View>

        {/* Action buttons */}
        <View style={styles.offerActions}>
          <GlassButton
            title={isProcessing ? '' : 'Decline'}
            variant="outline"
            onPress={handleDecline}
            disabled={isProcessing || timer.isExpired}
            loading={isProcessing}
            style={styles.actionBtnHalf}
          />

          {negotiated ? (
            <GlassButton
              title={timer.isExpired ? 'Expired' : 'Propose Price'}
              variant="glow"
              onPress={() => onPropose(offer)}
              disabled={isProcessing || timer.isExpired}
              style={styles.actionBtnHalf}
            />
          ) : (
            <GlassButton
              title={timer.isExpired ? 'Expired' : 'Accept'}
              variant="glow"
              onPress={handleAccept}
              disabled={isProcessing || timer.isExpired}
              loading={isProcessing}
              style={styles.actionBtnHalf}
            />
          )}
        </View>
      </View>
    </GlassCard>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function JobOffersScreen(): React.JSX.Element {
  const {
    isLoadingOffers,
    fetchOffers,
    acceptOffer,
    declineOffer,
    getFilteredOffers,
    setOfferFilter,
    setOfferSort,
    offerFilterCategory,
    offerFilterMaxDistance,
    offerSortBy,
    pendingOffers,
    submitPriceProposal,
  } = useProviderStore();

  const [processingId, setProcessingId] = useState<string | null>(null);
  const [proposalOffer, setProposalOffer] = useState<JobOffer | null>(null);
  const [isSubmittingProposal, setIsSubmittingProposal] = useState(false);

  // Derive unique categories from offers
  const categories = useMemo(() => {
    const catSet = new Set<string>();
    for (const offer of pendingOffers) {
      if (offer.task.categoryName) catSet.add(offer.task.categoryName);
    }
    return Array.from(catSet).sort();
  }, [pendingOffers]);

  useEffect(() => {
    fetchOffers();
  }, [fetchOffers]);

  const filteredOffers = useMemo(() => getFilteredOffers(), [
    pendingOffers,
    offerFilterCategory,
    offerFilterMaxDistance,
    offerSortBy,
    getFilteredOffers,
  ]);

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
        Alert.alert('Proposal Submitted', 'Your price proposal has been sent.');
        setProposalOffer(null);
      } catch {
        Alert.alert('Error', 'Failed to submit proposal. Please try again.');
      } finally {
        setIsSubmittingProposal(false);
      }
    },
    [proposalOffer, submitPriceProposal],
  );

  const handleDistanceFilter = useCallback(
    (value: number | null) => {
      setOfferFilter(offerFilterCategory, value);
    },
    [offerFilterCategory, setOfferFilter],
  );

  const handleCategoryFilter = useCallback(
    (category: string | null) => {
      setOfferFilter(category, offerFilterMaxDistance);
    },
    [offerFilterMaxDistance, setOfferFilter],
  );

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

  const renderEmpty = useCallback(() => {
    if (isLoadingOffers) return null;
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyTitle}>No Job Offers</Text>
        <Text style={styles.emptySubtext}>
          New offers will appear here when customers request services in your
          area. Make sure you are online to receive offers.
        </Text>
      </View>
    );
  }, [isLoadingOffers]);

  return (
    <GlassBackground>
      {/* Filter bar */}
      <View style={styles.filterSection}>
        {/* Category pills */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterRow}
        >
          <TouchableOpacity
            style={[
              styles.filterPill,
              !offerFilterCategory && styles.filterPillActive,
            ]}
            onPress={() => handleCategoryFilter(null)}
          >
            <Text
              style={[
                styles.filterPillText,
                !offerFilterCategory && styles.filterPillTextActive,
              ]}
            >
              All Types
            </Text>
          </TouchableOpacity>
          {categories.map((cat) => (
            <TouchableOpacity
              key={cat}
              style={[
                styles.filterPill,
                offerFilterCategory === cat && styles.filterPillActive,
              ]}
              onPress={() => handleCategoryFilter(cat)}
            >
              <Text
                style={[
                  styles.filterPillText,
                  offerFilterCategory === cat && styles.filterPillTextActive,
                ]}
              >
                {cat}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Distance + Sort row */}
        <View style={styles.filterSecondRow}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filterRow}
          >
            {DISTANCE_OPTIONS.map((opt) => (
              <TouchableOpacity
                key={opt.label}
                style={[
                  styles.filterChip,
                  offerFilterMaxDistance === opt.value && styles.filterChipActive,
                ]}
                onPress={() => handleDistanceFilter(opt.value)}
              >
                <Text
                  style={[
                    styles.filterChipText,
                    offerFilterMaxDistance === opt.value &&
                      styles.filterChipTextActive,
                  ]}
                >
                  {opt.label}
                </Text>
              </TouchableOpacity>
            ))}

            <View style={styles.filterDivider} />

            {SORT_OPTIONS.map((opt) => (
              <TouchableOpacity
                key={opt.value}
                style={[
                  styles.filterChip,
                  offerSortBy === opt.value && styles.filterChipActive,
                ]}
                onPress={() => setOfferSort(opt.value)}
              >
                <Text
                  style={[
                    styles.filterChipText,
                    offerSortBy === opt.value && styles.filterChipTextActive,
                  ]}
                >
                  {opt.label}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      </View>

      <FlatList
        data={filteredOffers}
        renderItem={renderOffer}
        keyExtractor={keyExtractor}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={renderEmpty}
        refreshing={isLoadingOffers}
        onRefresh={fetchOffers}
        showsVerticalScrollIndicator={false}
      />

      <ProposalModal
        visible={proposalOffer !== null}
        offer={proposalOffer}
        onClose={() => setProposalOffer(null)}
        onSubmit={handleSubmitProposal}
        isSubmitting={isSubmittingProposal}
      />
    </GlassBackground>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  filterSection: {
    backgroundColor: Colors.glass.dark,
    borderBottomWidth: 1,
    borderBottomColor: Colors.glassBorder.subtle,
    paddingTop: 8,
  },
  filterRow: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    gap: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  filterSecondRow: {
    borderTopWidth: 1,
    borderTopColor: Colors.glassBorder.subtle,
  },
  filterPill: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.glassBorder.light,
    backgroundColor: Colors.glass.white,
  },
  filterPillActive: {
    backgroundColor: Colors.primary + '25',
    borderColor: Colors.primary,
  },
  filterPillText: {
    fontSize: 13,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.6)',
  },
  filterPillTextActive: {
    color: Colors.primary,
  },
  filterChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.glassBorder.light,
    backgroundColor: Colors.glass.white,
  },
  filterChipActive: {
    backgroundColor: Colors.primary + '25',
    borderColor: Colors.primary,
  },
  filterChipText: {
    fontSize: 12,
    fontWeight: '500',
    color: 'rgba(255, 255, 255, 0.6)',
  },
  filterChipTextActive: {
    color: Colors.primary,
  },
  filterDivider: {
    width: 1,
    height: 20,
    backgroundColor: Colors.glassBorder.subtle,
    marginHorizontal: 4,
  },
  listContent: {
    paddingVertical: 16,
    flexGrow: 1,
  },
  offerCard: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginBottom: 12,
    overflow: 'hidden',
    padding: 0,
  },
  offerLevelStrip: {
    width: 4,
  },
  offerContent: {
    flex: 1,
    padding: 14,
  },
  offerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  offerHeaderLeft: {
    flex: 1,
    marginRight: 8,
  },
  offerSubHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  offerTaskName: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.textPrimary,
    marginBottom: 2,
  },
  offerCategory: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.55)',
  },
  timerBadge: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: Colors.glass.white,
  },
  timerText: {
    fontSize: 14,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  badgeRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  levelBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    borderWidth: 1,
  },
  levelBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  rateBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    borderWidth: 1,
  },
  rateBadgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  offerDetails: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  offerDetailItem: {
    flex: 1,
  },
  offerDetailLabel: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.4)',
    marginBottom: 2,
  },
  offerDetailValue: {
    fontSize: 14,
    color: Colors.textPrimary,
  },
  offerPriceValue: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.success,
  },
  customerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    padding: 8,
    backgroundColor: Colors.glass.white,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.glassBorder.subtle,
  },
  customerLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.55)',
    marginRight: 6,
  },
  customerValue: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  emergencyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    padding: 8,
    backgroundColor: Colors.emergencyRed + '15',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.emergencyRed + '40',
  },
  emergencyLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.emergencyRed,
  },
  mapContainer: {
    height: 120,
    borderRadius: 12,
    marginBottom: 12,
    overflow: 'hidden',
    backgroundColor: Colors.glass.dark,
    position: 'relative',
  },
  map: {
    flex: 1,
  },
  mapGlassOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(10, 10, 30, 0.15)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.glassBorder.subtle,
  },
  mapMarker: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: Colors.primary,
    borderWidth: 2,
    borderColor: Colors.white,
  },
  offerActions: {
    flexDirection: 'row',
    gap: 10,
  },
  actionBtnHalf: {
    flex: 1,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    paddingTop: 80,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: Colors.textPrimary,
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.55)',
    textAlign: 'center',
    lineHeight: 20,
  },
});

// ---------------------------------------------------------------------------
// Modal Styles
// ---------------------------------------------------------------------------

const modalStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'flex-end',
  },
  content: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    padding: 24,
    paddingBottom: 40,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: 4,
  },
  taskName: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.55)',
    marginBottom: 12,
  },
  guideContainer: {
    backgroundColor: Colors.primary + '15',
    padding: 10,
    borderRadius: 10,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: Colors.primary + '30',
  },
  guideText: {
    fontSize: 13,
    color: Colors.primary,
  },
  inputSpacing: {
    marginBottom: 16,
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  actionBtn: {
    flex: 1,
  },
});
