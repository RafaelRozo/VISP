/**
 * VISP - Provider Dashboard Screen
 *
 * Main provider home: earnings summary, active job card, incoming job
 * offers queue, availability toggle, on-call status for Level 4, and
 * performance score display.
 *
 * Redesigned with dark glassmorphism.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Platform,
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
import { GlassStyles } from '../../theme/glass';
import { GlassBackground, GlassCard, GlassButton } from '../../components/glass';
import { AnimatedSpinner, MorphingBlob } from '../../components/animations';
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
    <View style={styles.earningsWrapper}>
      <MorphingBlob
        size={200}
        color="#7850FF"
        opacity={0.12}
        style={styles.earningsBlob}
      />
      <GlassCard variant="standard" style={styles.earningsCard}>
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
      </GlassCard>
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
      <GlassCard variant="standard" style={styles.performanceCard}>
        <Text style={styles.sectionTitle}>Performance Score</Text>
        <View style={styles.performanceRow}>
          <View style={[styles.scoreCircle, { borderColor: scoreColor }]}>
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
      </GlassCard>
    );
  };

  // ------------------------------------------
  // Availability toggle section
  // ------------------------------------------

  const renderAvailabilityToggle = () => (
    <GlassCard variant="dark" style={styles.availabilityCard}>
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
                  ...(isOnline
                    ? {
                        shadowColor: Colors.success,
                        shadowOffset: { width: 0, height: 0 },
                        shadowOpacity: 0.8,
                        shadowRadius: 6,
                      }
                    : {}),
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
          <AnimatedSpinner size={28} color={Colors.primary} />
        ) : (
          <Switch
            value={isOnline}
            onValueChange={toggleOnline}
            trackColor={{
              false: 'rgba(255, 255, 255, 0.15)',
              true: Colors.success,
            }}
            thumbColor={Colors.white}
            ios_backgroundColor="rgba(255, 255, 255, 0.15)"
            accessibilityLabel="Toggle online status"
            accessibilityRole="switch"
          />
        )}
      </View>
    </GlassCard>
  );

  // ------------------------------------------
  // Active job section
  // ------------------------------------------

  const renderActiveJob = () => {
    if (!activeJob) return null;

    return (
      <View style={styles.section}>
        <Text style={styles.sectionTitleOuter}>Active Job</Text>
        <GlassCard variant="elevated" style={styles.activeJobCard}>
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
        </GlassCard>
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
          <Text style={styles.sectionTitleOuter}>Incoming Offers</Text>
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
            <GlassCard variant="standard" style={styles.offerCard}>
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
            </GlassCard>
            {/* Accept / Decline buttons */}
            <View style={styles.offerActions}>
              <GlassButton
                title="Decline"
                variant="outline"
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
              />
              <GlassButton
                title="Accept"
                variant="glow"
                style={styles.acceptButton}
                onPress={() => acceptOffer(offer.jobId)}
              />
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
      <GlassCard variant="elevated" style={styles.setupCard}>
        <Text style={styles.setupIcon}>&#x2699;&#xFE0F;</Text>
        <Text style={styles.setupTitle}>Set Up Your Services</Text>
        <Text style={styles.setupText}>
          Select the services you offer so you can start receiving job offers from clients near you.
        </Text>
        <GlassButton
          title="Select My Services"
          variant="glow"
          onPress={() => navigation.navigate('ProviderProfile' as any, { screen: 'ProviderOnboarding' })}
        />
      </GlassCard>
    );
  };

  // ------------------------------------------
  // Main render
  // ------------------------------------------

  if (isLoadingDashboard && !providerProfile) {
    return (
      <GlassBackground>
        <View style={styles.loadingContainer}>
          <AnimatedSpinner size={48} color={Colors.primary} />
          <Text style={styles.loadingText}>Loading dashboard...</Text>
        </View>
      </GlassBackground>
    );
  }

  return (
    <GlassBackground>
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
          <GlassCard variant="dark" style={styles.headerCard}>
            <View
              style={[
                styles.levelBadge,
                {
                  backgroundColor: `${levelColor}30`,
                  borderColor: levelColor,
                  ...(Platform.OS === 'ios'
                    ? {
                        shadowColor: levelColor,
                        shadowOffset: { width: 0, height: 0 },
                        shadowOpacity: 0.6,
                        shadowRadius: 10,
                      }
                    : {}),
                },
              ]}
            >
              <Text style={[styles.levelBadgeText, { color: levelColor }]}>
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
          </GlassCard>
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
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.6)',
  },
  headerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginBottom: 12,
  },
  levelBadge: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
    borderWidth: 2,
  },
  levelBadgeText: {
    fontSize: 16,
    fontWeight: '800',
  },
  headerInfo: {
    flex: 1,
  },
  headerGreeting: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  headerSubtext: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.6)',
    marginTop: 2,
  },
  availabilityCard: {
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
    color: '#FFFFFF',
  },
  availabilitySubtext: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.6)',
    marginTop: 4,
    marginLeft: 18,
  },
  earningsWrapper: {
    position: 'relative',
  },
  earningsBlob: {
    position: 'absolute',
    top: -40,
    right: -30,
    zIndex: 0,
  },
  earningsCard: {
    marginHorizontal: 16,
    marginVertical: 6,
    zIndex: 1,
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
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    marginVertical: 4,
  },
  earningsLabel: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.6)',
    marginBottom: 4,
  },
  earningsValue: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.success,
  },
  performanceCard: {
    marginHorizontal: 16,
    marginVertical: 6,
  },
  performanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
  },
  scoreCircle: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 2,
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
    color: 'rgba(255, 255, 255, 0.4)',
  },
  performanceInfo: {
    flex: 1,
  },
  performanceLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  performanceSubtext: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.4)',
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
    color: '#FFFFFF',
    marginBottom: 4,
  },
  sectionTitleOuter: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  viewAllButton: {
    alignItems: 'center',
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255, 255, 255, 0.12)',
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
    marginHorizontal: 16,
    marginBottom: 16,
    alignItems: 'center' as const,
  },
  setupIcon: {
    fontSize: 36,
    marginBottom: 12,
  },
  setupTitle: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: '#FFFFFF',
    marginBottom: 8,
  },
  setupText: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.6)',
    textAlign: 'center' as const,
    lineHeight: 20,
    marginBottom: 16,
  },
  // Active job card wrapper
  activeJobCard: {
    marginHorizontal: 16,
  },
  // Offer cards
  offerCard: {
    marginHorizontal: 16,
    marginBottom: 4,
  },
  offerActions: {
    flexDirection: 'row' as const,
    justifyContent: 'flex-end' as const,
    paddingHorizontal: 16,
    marginTop: 4,
    marginBottom: 12,
    gap: 10,
  },
  declineButton: {
    borderColor: 'rgba(231, 76, 60, 0.6)',
    minHeight: 38,
    paddingVertical: 8,
    paddingHorizontal: 20,
  },
  acceptButton: {
    minHeight: 38,
    paddingVertical: 8,
    paddingHorizontal: 24,
  },
});
