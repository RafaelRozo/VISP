/**
 * VISP/Tasker - Job Offers Screen
 *
 * List of available job offers for the provider. Each offer shows:
 * task name, customer location (distance), price, SLA deadline,
 * accept/decline buttons, timer showing offer expiry, and map preview.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Colors, getLevelColor } from '../../theme/colors';
import { useProviderStore } from '../../stores/providerStore';
import { JobOffer } from '../../types';
import MapboxGL from '@rnmapbox/maps';
import { Config } from '../../services/config';

MapboxGL.setAccessToken(Config.mapboxAccessToken);

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
  if (km === undefined || km === null) return '—';
  return km < 1 ? `${Math.round(km * 1000)}m` : `${km.toFixed(1)}km`;
}

function formatPrice(cents: number | undefined): string {
  if (cents === undefined || cents === null) return '—';
  return `$${(cents / 100).toFixed(2)}`;
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
// OfferCard sub-component
// ---------------------------------------------------------------------------

interface OfferCardProps {
  offer: JobOffer;
  onAccept: (jobId: string) => void;
  onDecline: (jobId: string) => void;
  isProcessing: boolean;
}

function OfferCard({
  offer,
  onAccept,
  onDecline,
  isProcessing,
}: OfferCardProps): React.JSX.Element {
  const timer = useOfferTimer(offer.offerExpiresAt);
  const levelNum = parseInt(offer.task.level.replace(/\D/g, ''), 10) || 1;
  const levelColor = getLevelColor(levelNum as 1 | 2 | 3 | 4);

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
    <View style={styles.offerCard}>
      {/* Level strip */}
      <View style={[styles.offerLevelStrip, { backgroundColor: levelColor }]} />

      <View style={styles.offerContent}>
        {/* Header */}
        <View style={styles.offerHeader}>
          <View style={styles.offerHeaderLeft}>
            <Text style={styles.offerTaskName} numberOfLines={1}>
              {offer.task.name}
            </Text>
            <Text style={styles.offerCategory} numberOfLines={1}>
              {offer.task.categoryName ?? 'Service'} • {offer.referenceNumber}
            </Text>
          </View>
          <View style={[styles.timerBadge, { borderColor: timerColor }]}>
            <Text style={[styles.timerText, { color: timerColor }]}>
              {timerText}
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
        </View>

        {/* Customer info */}
        {offer.customer.displayName && (
          <View style={styles.slaRow}>
            <Text style={styles.slaLabel}>Customer:</Text>
            <Text style={styles.slaValue}>
              {offer.customer.displayName}
              {offer.customer.rating ? ` ★${offer.customer.rating}` : ''}
            </Text>
          </View>
        )}

        {/* Emergency badge */}
        {offer.isEmergency && (
          <View style={styles.slaRow}>
            <Text style={styles.slaLabel}>🚨 EMERGENCY</Text>
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
        </View>

        {/* Action buttons */}
        <View style={styles.offerActions}>
          <TouchableOpacity
            style={styles.declineButton}
            onPress={handleDecline}
            disabled={isProcessing || timer.isExpired}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Decline offer"
          >
            {isProcessing ? (
              <ActivityIndicator size="small" color={Colors.textSecondary} />
            ) : (
              <Text style={styles.declineButtonText}>Decline</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.acceptButton,
              (isProcessing || timer.isExpired) && styles.buttonDisabled,
            ]}
            onPress={handleAccept}
            disabled={isProcessing || timer.isExpired}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Accept offer"
          >
            {isProcessing ? (
              <ActivityIndicator size="small" color={Colors.white} />
            ) : (
              <Text style={styles.acceptButtonText}>
                {timer.isExpired ? 'Expired' : 'Accept'}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function JobOffersScreen(): React.JSX.Element {
  const {
    pendingOffers,
    isLoadingOffers,
    fetchOffers,
    acceptOffer,
    declineOffer,
  } = useProviderStore();

  const [processingId, setProcessingId] = useState<string | null>(null);

  useEffect(() => {
    fetchOffers();
  }, [fetchOffers]);

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

  const renderOffer = useCallback(
    ({ item }: { item: JobOffer }) => (
      <OfferCard
        offer={item}
        onAccept={handleAccept}
        onDecline={handleDecline}
        isProcessing={processingId === item.jobId}
      />
    ),
    [handleAccept, handleDecline, processingId],
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
    <View style={styles.container}>
      <FlatList
        data={pendingOffers}
        renderItem={renderOffer}
        keyExtractor={keyExtractor}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={renderEmpty}
        refreshing={isLoadingOffers}
        onRefresh={fetchOffers}
        showsVerticalScrollIndicator={false}
      />
    </View>
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
  listContent: {
    paddingVertical: 16,
    flexGrow: 1,
  },
  offerCard: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderRadius: 12,
    marginHorizontal: 16,
    marginBottom: 12,
    overflow: 'hidden',
    shadowColor: Colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
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
    marginBottom: 10,
  },
  offerHeaderLeft: {
    flex: 1,
    marginRight: 8,
  },
  offerTaskName: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.textPrimary,
    marginBottom: 2,
  },
  offerCategory: {
    fontSize: 13,
    color: Colors.textSecondary,
  },
  timerBadge: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  timerText: {
    fontSize: 14,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
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
    color: Colors.textTertiary,
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
  slaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    padding: 8,
    backgroundColor: Colors.surfaceLight,
    borderRadius: 6,
  },
  slaLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.emergencyRed,
    marginRight: 6,
  },
  slaValue: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.emergencyRed,
  },
  mapContainer: {
    height: 120,
    borderRadius: 8,
    marginBottom: 12,
    overflow: 'hidden',
    backgroundColor: Colors.surfaceLight,
  },
  map: {
    flex: 1,
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
  declineButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  declineButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  acceptButton: {
    flex: 1,
    backgroundColor: Colors.primary,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  acceptButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.white,
  },
  buttonDisabled: {
    backgroundColor: Colors.border,
    opacity: 0.6,
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
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
});
