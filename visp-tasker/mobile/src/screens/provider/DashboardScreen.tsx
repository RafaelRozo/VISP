/**
 * VISP/Tasker - Provider Dashboard Screen
 *
 * Main provider home: earnings summary, active job card, incoming job
 * offers queue, availability toggle, on-call status for Level 4, and
 * performance score display.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Colors, getLevelColor } from '../../theme/colors';
import { useProviderStore } from '../../stores/providerStore';
import { useAuthStore } from '../../stores/authStore';
import JobCard from '../../components/JobCard';
import OnCallToggle from '../../components/OnCallToggle';
import { taxonomyService } from '../../services/taxonomyService';
import { ProviderTabParamList, ServiceLevel } from '../../types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DashboardNav = NativeStackNavigationProp<ProviderTabParamList, 'Dashboard'>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatCurrency(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function DashboardScreen(): React.JSX.Element {
  const navigation = useNavigation<DashboardNav>();
  const user = useAuthStore((state) => state.user);

  // Track whether the provider has selected any services
  const [hasServices, setHasServices] = useState<boolean | null>(null);

  const {
    isOnline,
    isOnCall,
    activeJob,
    pendingOffers = [],
    earnings = { today: 0, thisWeek: 0, thisMonth: 0, pendingPayout: 0, totalEarned: 0 },
    performanceScore = 0,
    providerProfile,
    isLoadingDashboard,
    isTogglingStatus,
    onCallShifts = [],
    fetchDashboard,
    toggleOnline,
    toggleOnCall,
    acceptOffer,
    declineOffer,
  } = useProviderStore();

  // Initial load
  useEffect(() => {
    fetchDashboard();
    // Check if provider has selected any services
    taxonomyService.getMyServices()
      .then((res) => setHasServices(res.taskIds.length > 0))
      .catch(() => setHasServices(null));
  }, [fetchDashboard]);

  // Pull-to-refresh
  const onRefresh = useCallback(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  const isLevel4 = providerProfile?.level === 4;
  const levelColor = providerProfile
    ? getLevelColor(providerProfile.level)
    : Colors.primary;

  const currentShift = useMemo(() => {
    if (!onCallShifts || onCallShifts.length === 0) return null;
    const now = new Date();
    return (
      onCallShifts.find((shift) => {
        const start = new Date(shift.startTime);
        const end = new Date(shift.endTime);
        return now >= start && now <= end;
      }) ?? null
    );
  }, [onCallShifts]);

  // ------------------------------------------
  // Earnings summary section
  // ------------------------------------------

  const renderEarningsSummary = () => (
    <View style={styles.earningsCard}>
      <Text style={styles.sectionTitle}>Earnings</Text>
      <View style={styles.earningsRow}>
        <View style={styles.earningsItem}>
          <Text style={styles.earningsLabel}>Today</Text>
          <Text style={styles.earningsValue}>
            {formatCurrency(earnings.today)}
          </Text>
        </View>
        <View style={styles.earningsDivider} />
        <View style={styles.earningsItem}>
          <Text style={styles.earningsLabel}>This Week</Text>
          <Text style={styles.earningsValue}>
            {formatCurrency(earnings.thisWeek)}
          </Text>
        </View>
        <View style={styles.earningsDivider} />
        <View style={styles.earningsItem}>
          <Text style={styles.earningsLabel}>This Month</Text>
          <Text style={styles.earningsValue}>
            {formatCurrency(earnings.thisMonth)}
          </Text>
        </View>
      </View>
      <TouchableOpacity
        style={styles.viewAllButton}
        onPress={() => navigation.navigate('Earnings')}
        accessibilityRole="button"
        accessibilityLabel="View all earnings"
      >
        <Text style={styles.viewAllText}>View All Earnings</Text>
      </TouchableOpacity>
    </View>
  );

  // ------------------------------------------
  // Performance score section
  // ------------------------------------------

  const renderPerformanceScore = () => {
    const scoreColor =
      performanceScore >= 80
        ? Colors.success
        : performanceScore >= 60
          ? Colors.warning
          : Colors.emergencyRed;

    return (
      <View style={styles.performanceCard}>
        <Text style={styles.sectionTitle}>Performance Score</Text>
        <View style={styles.performanceRow}>
          <View style={styles.scoreCircle}>
            <Text style={[styles.scoreValue, { color: scoreColor }]}>
              {performanceScore}
            </Text>
            <Text style={styles.scoreMax}>/100</Text>
          </View>
          <View style={styles.performanceInfo}>
            <Text style={styles.performanceLabel}>
              {performanceScore >= 80
                ? 'Excellent'
                : performanceScore >= 60
                  ? 'Good'
                  : 'Needs Improvement'}
            </Text>
            <Text style={styles.performanceSubtext}>
              Based on ratings, completion rate, and response time
            </Text>
          </View>
        </View>
      </View>
    );
  };

  // ------------------------------------------
  // Availability toggle section
  // ------------------------------------------

  const renderAvailabilityToggle = () => (
    <View style={styles.availabilityCard}>
      <View style={styles.availabilityRow}>
        <View style={styles.availabilityInfo}>
          <View style={styles.availabilityLabelRow}>
            <View
              style={[
                styles.onlineDot,
                {
                  backgroundColor: isOnline
                    ? Colors.success
                    : Colors.textTertiary,
                },
              ]}
            />
            <Text style={styles.availabilityTitle}>
              {isOnline ? 'Online' : 'Offline'}
            </Text>
          </View>
          <Text style={styles.availabilitySubtext}>
            {isOnline
              ? 'You are receiving job offers'
              : 'Toggle on to start receiving jobs'}
          </Text>
        </View>
        {isTogglingStatus ? (
          <ActivityIndicator size="small" color={Colors.primary} />
        ) : (
          <Switch
            value={isOnline}
            onValueChange={toggleOnline}
            trackColor={{
              false: Colors.border,
              true: Colors.success,
            }}
            thumbColor={Colors.white}
            ios_backgroundColor={Colors.border}
            accessibilityLabel="Toggle online status"
            accessibilityRole="switch"
          />
        )}
      </View>
    </View>
  );

  // ------------------------------------------
  // Active job section
  // ------------------------------------------

  const renderActiveJob = () => {
    if (!activeJob) return null;

    return (
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Active Job</Text>
        <JobCard
          taskName={activeJob.taskName}
          categoryName={activeJob.categoryName}
          customerArea={activeJob.address.city}
          distanceKm={0}
          estimatedPrice={activeJob.estimatedPrice}
          level={activeJob.level}
          status={activeJob.status}
          scheduledAt={activeJob.scheduledAt}
          slaDeadline={activeJob.slaDeadline}
          onPress={() =>
            navigation.navigate('ActiveJob', { jobId: activeJob.id })
          }
        />
      </View>
    );
  };

  // ------------------------------------------
  // Pending offers section
  // ------------------------------------------

  const renderPendingOffers = () => {
    const offers = Array.isArray(pendingOffers) ? pendingOffers : [];
    if (offers.length === 0) return null;

    return (
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Incoming Offers</Text>
          <TouchableOpacity
            onPress={() => navigation.navigate('JobsTab')}
            accessibilityRole="button"
            accessibilityLabel="View all offers"
          >
            <Text style={styles.viewAllText}>
              View All ({offers.length})
            </Text>
          </TouchableOpacity>
        </View>
        {offers.slice(0, 3).map((offer) => (
          <View key={offer.assignmentId}>
            <JobCard
              taskName={offer.task.name}
              categoryName={offer.task.categoryName ?? 'Service'}
              customerArea={offer.serviceCity ?? offer.serviceAddress}
              distanceKm={offer.distanceKm ?? 0}
              estimatedPrice={offer.pricing.quotedPriceCents ? offer.pricing.quotedPriceCents / 100 : 0}
              level={(parseInt(offer.task.level.replace(/\D/g, ''), 10) || 1) as ServiceLevel}
              status="pending"
              scheduledAt={null}
              slaDeadline={null}
              onPress={() => navigation.navigate('JobsTab')}
            />
            {/* Accept / Decline buttons */}
            <View style={styles.offerActions}>
              <TouchableOpacity
                style={styles.declineButton}
                onPress={() => {
                  Alert.alert(
                    'Decline Offer',
                    `Decline ${offer.task.name}?`,
                    [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: 'Decline',
                        style: 'destructive',
                        onPress: () => declineOffer(offer.jobId),
                      },
                    ],
                  );
                }}
              >
                <Text style={styles.declineButtonText}>Decline</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.acceptButton}
                onPress={() => acceptOffer(offer.jobId)}
              >
                <Text style={styles.acceptButtonText}>Accept</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}
      </View>
    );
  };

  // ------------------------------------------
  // Setup services prompt
  // ------------------------------------------

  const renderSetupServicesPrompt = () => {
    if (hasServices !== false) return null;
    return (
      <View style={styles.setupCard}>
        <Text style={styles.setupIcon}>⚙️</Text>
        <Text style={styles.setupTitle}>Set Up Your Services</Text>
        <Text style={styles.setupText}>
          Select the services you offer so you can start receiving job offers from clients near you.
        </Text>
        <TouchableOpacity
          style={styles.setupButton}
          onPress={() => navigation.navigate('ProviderOnboarding' as any)}
          activeOpacity={0.8}
        >
          <Text style={styles.setupButtonText}>Select My Services</Text>
        </TouchableOpacity>
      </View>
    );
  };

  // ------------------------------------------
  // Main render
  // ------------------------------------------

  if (isLoadingDashboard && !providerProfile) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={styles.loadingText}>Loading dashboard...</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.contentContainer}
      refreshControl={
        <RefreshControl
          refreshing={isLoadingDashboard}
          onRefresh={onRefresh}
          tintColor={Colors.primary}
          colors={[Colors.primary]}
        />
      }
    >
      {/* Provider level header */}
      {providerProfile && (
        <View style={styles.headerCard}>
          <View style={[styles.levelBadge, { backgroundColor: levelColor }]}>
            <Text style={styles.levelBadgeText}>
              L{providerProfile.level}
            </Text>
          </View>
          <View style={styles.headerInfo}>
            <Text style={styles.headerGreeting}>
              Welcome back, {user?.firstName}
            </Text>
            <Text style={styles.headerSubtext}>
              {providerProfile.completedJobs} jobs completed | Rating:{' '}
              {providerProfile.rating.toFixed(1)}
            </Text>
          </View>
        </View>
      )}

      {renderSetupServicesPrompt()}

      {renderAvailabilityToggle()}

      {isLevel4 && (
        <OnCallToggle
          isOnCall={isOnCall}
          currentShift={currentShift}
          isLoading={isTogglingStatus}
          onToggle={toggleOnCall}
        />
      )}

      {renderEarningsSummary()}
      {renderPerformanceScore()}
      {renderActiveJob()}
      {renderPendingOffers()}

      {/* Bottom spacer */}
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
  loadingContainer: {
    flex: 1,
    backgroundColor: Colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: Colors.textSecondary,
  },
  headerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 16,
    marginHorizontal: 16,
    marginBottom: 12,
  },
  levelBadge: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  levelBadgeText: {
    fontSize: 16,
    fontWeight: '800',
    color: Colors.white,
  },
  headerInfo: {
    flex: 1,
  },
  headerGreeting: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  headerSubtext: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  availabilityCard: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 16,
    marginHorizontal: 16,
    marginBottom: 6,
  },
  availabilityRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  availabilityInfo: {
    flex: 1,
    marginRight: 12,
  },
  availabilityLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  onlineDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 8,
  },
  availabilityTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  availabilitySubtext: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginTop: 4,
    marginLeft: 18,
  },
  earningsCard: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 16,
    marginHorizontal: 16,
    marginVertical: 6,
  },
  earningsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
    marginBottom: 12,
  },
  earningsItem: {
    flex: 1,
    alignItems: 'center',
  },
  earningsDivider: {
    width: StyleSheet.hairlineWidth,
    backgroundColor: Colors.border,
    marginVertical: 4,
  },
  earningsLabel: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginBottom: 4,
  },
  earningsValue: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.success,
  },
  performanceCard: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 16,
    marginHorizontal: 16,
    marginVertical: 6,
  },
  performanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
  },
  scoreCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: Colors.surfaceLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  scoreValue: {
    fontSize: 22,
    fontWeight: '800',
  },
  scoreMax: {
    fontSize: 11,
    color: Colors.textTertiary,
  },
  performanceInfo: {
    flex: 1,
  },
  performanceLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  performanceSubtext: {
    fontSize: 12,
    color: Colors.textTertiary,
    marginTop: 4,
    lineHeight: 16,
  },
  section: {
    marginTop: 12,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.textPrimary,
    paddingHorizontal: 16,
    marginBottom: 4,
  },
  viewAllButton: {
    alignItems: 'center',
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
    marginTop: 4,
  },
  viewAllText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.primary,
  },
  bottomSpacer: {
    height: 32,
  },
  // Setup services prompt
  setupCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 24,
    alignItems: 'center' as const,
    borderWidth: 1,
    borderColor: Colors.primary,
  },
  setupIcon: {
    fontSize: 36,
    marginBottom: 12,
  },
  setupTitle: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: Colors.textPrimary,
    marginBottom: 8,
  },
  setupText: {
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: 'center' as const,
    lineHeight: 20,
    marginBottom: 16,
  },
  setupButton: {
    backgroundColor: Colors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 32,
    alignItems: 'center' as const,
  },
  setupButtonText: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.white,
  },
  // Offer action buttons
  offerActions: {
    flexDirection: 'row' as const,
    justifyContent: 'flex-end' as const,
    paddingHorizontal: 16,
    marginTop: -4,
    marginBottom: 12,
    gap: 10,
  },
  declineButton: {
    paddingVertical: 8,
    paddingHorizontal: 20,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.error,
  },
  declineButtonText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.error,
  },
  acceptButton: {
    paddingVertical: 8,
    paddingHorizontal: 24,
    borderRadius: 8,
    backgroundColor: Colors.success,
  },
  acceptButtonText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.white,
  },
});
