/**
 * VISP - PriceProposalScreen (Glass Redesign)
 *
 * Displays incoming price proposals from providers for L3/L4 jobs.
 * The customer can accept or reject each proposal.
 *
 * Accept calls POST /api/v1/proposals/{id}/respond with { accept: true }
 * Reject calls POST /api/v1/proposals/{id}/respond with { accept: false }
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { AnimatedSpinner } from '../../components/animations';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { GlassBackground, GlassCard, GlassButton } from '../../components/glass';
import { Colors, getLevelColor } from '../../theme/colors';
import { Spacing } from '../../theme/spacing';
import { Typography, FontWeight, FontSize } from '../../theme/typography';
import { get, post } from '../../services/apiClient';
import type { CustomerFlowParamList, PriceProposal } from '../../types';

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

type ProposalRouteProp = RouteProp<CustomerFlowParamList, 'PriceProposal'>;
type ProposalNavProp = NativeStackNavigationProp<CustomerFlowParamList, 'PriceProposal'>;

// ──────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────

function PriceProposalScreen(): React.JSX.Element {
  const route = useRoute<ProposalRouteProp>();
  const navigation = useNavigation<ProposalNavProp>();
  const { jobId, taskName, level, guideMin, guideMax } = route.params;

  const [proposals, setProposals] = useState<PriceProposal[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [respondingId, setRespondingId] = useState<string | null>(null);

  const levelColor = getLevelColor(level);

  useEffect(() => {
    navigation.setOptions({ title: 'Price Proposals' });
  }, [navigation]);

  // Fetch proposals
  const fetchProposals = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await get<PriceProposal[]>(`/proposals/${jobId}`);
      setProposals(Array.isArray(data) ? data : []);
    } catch {
      console.warn('[PriceProposalScreen] Failed to fetch proposals');
      setProposals([]);
    } finally {
      setIsLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    fetchProposals();
  }, [fetchProposals]);

  // Accept proposal
  const handleAccept = useCallback(async (proposalId: string) => {
    Alert.alert(
      'Accept Proposal',
      'Are you sure you want to accept this price proposal? Payment will be authorized for the agreed amount.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Accept',
          onPress: async () => {
            setRespondingId(proposalId);
            try {
              await post(`/proposals/${proposalId}/respond`, { accept: true });
              Alert.alert('Proposal Accepted', 'The price has been agreed. Your job will proceed.', [
                {
                  text: 'OK',
                  onPress: () => {
                    navigation.navigate('JobTracking', { jobId });
                  },
                },
              ]);
            } catch {
              Alert.alert('Error', 'Failed to accept proposal. Please try again.');
            } finally {
              setRespondingId(null);
            }
          },
        },
      ],
    );
  }, [jobId, navigation]);

  // Reject proposal
  const handleReject = useCallback(async (proposalId: string) => {
    Alert.alert(
      'Reject Proposal',
      'Are you sure you want to reject this price proposal? The provider may submit a new one.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reject',
          style: 'destructive',
          onPress: async () => {
            setRespondingId(proposalId);
            try {
              await post(`/proposals/${proposalId}/respond`, { accept: false });
              fetchProposals();
            } catch {
              Alert.alert('Error', 'Failed to reject proposal. Please try again.');
            } finally {
              setRespondingId(null);
            }
          },
        },
      ],
    );
  }, [fetchProposals]);

  // Loading state
  if (isLoading) {
    return (
      <GlassBackground>
        <View style={styles.loadingContainer}>
          <AnimatedSpinner size={48} color={Colors.primary} />
          <Text style={styles.loadingText}>Loading proposals...</Text>
        </View>
      </GlassBackground>
    );
  }

  const pendingProposals = proposals.filter(p => p.status === 'pending');
  const pastProposals = proposals.filter(p => p.status !== 'pending');

  return (
    <GlassBackground>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.section}>
          <Text style={styles.headerTitle}>{taskName}</Text>
          <View style={[styles.levelBadge, { backgroundColor: `${levelColor}30`, borderColor: `${levelColor}60` }]}>
            <Text style={[styles.levelBadgeText, { color: levelColor }]}>Level {level}</Text>
          </View>
        </View>

        {/* Guide range */}
        {guideMin != null && guideMax != null && (
          <View style={styles.section}>
            <GlassCard variant="dark">
              <View style={styles.guideContent}>
                <Text style={styles.guideLabel}>Guide Price Range</Text>
                <Text style={styles.guideValue}>
                  ${guideMin} - ${guideMax}
                </Text>
                <Text style={styles.guideNote}>
                  For reference only. Provider proposals may differ based on
                  the specific scope of your job.
                </Text>
              </View>
            </GlassCard>
          </View>
        )}

        {/* Pending proposals */}
        {pendingProposals.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Pending Proposals</Text>
            {pendingProposals.map((proposal) => {
              const isResponding = respondingId === proposal.id;
              const priceDollars = (proposal.proposedPriceCents / 100).toFixed(2);
              return (
                <GlassCard
                  key={proposal.id}
                  variant="standard"
                  style={styles.proposalCardBorder}
                >
                  <View style={styles.proposalHeader}>
                    <Text style={styles.proposalPrice}>${priceDollars}</Text>
                    <Text style={styles.proposalDate}>
                      {new Date(proposal.createdAt).toLocaleDateString()}
                    </Text>
                  </View>
                  {proposal.description ? (
                    <Text style={styles.proposalDescription}>
                      {proposal.description}
                    </Text>
                  ) : null}
                  <View style={styles.proposalActions}>
                    <GlassButton
                      title="Reject"
                      variant="outline"
                      onPress={() => handleReject(proposal.id)}
                      disabled={isResponding}
                      loading={isResponding && respondingId === proposal.id}
                      style={styles.rejectBtnStyle}
                    />
                    <GlassButton
                      title="Accept"
                      variant="glow"
                      onPress={() => handleAccept(proposal.id)}
                      disabled={isResponding}
                      loading={isResponding && respondingId === proposal.id}
                      style={styles.acceptBtnStyle}
                    />
                  </View>
                </GlassCard>
              );
            })}
          </View>
        ) : (
          <View style={styles.section}>
            <GlassCard variant="dark">
              <View style={styles.emptyContent}>
                <Text style={styles.emptyTitle}>Waiting for Proposal</Text>
                <Text style={styles.emptyText}>
                  Your provider is reviewing the job details and will submit a
                  price proposal shortly. You will be notified when it arrives.
                </Text>
              </View>
            </GlassCard>
          </View>
        )}

        {/* Past proposals */}
        {pastProposals.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Previous Proposals</Text>
            {pastProposals.map((proposal) => {
              const priceDollars = (proposal.proposedPriceCents / 100).toFixed(2);
              const statusLabelText = proposal.status === 'accepted' ? 'Accepted' : 'Rejected';
              const statusColor = proposal.status === 'accepted' ? Colors.success : 'rgba(255, 255, 255, 0.35)';
              return (
                <GlassCard
                  key={proposal.id}
                  variant="dark"
                  style={styles.pastProposalCard}
                >
                  <View style={styles.proposalHeader}>
                    <Text style={[styles.proposalPrice, { color: 'rgba(255, 255, 255, 0.5)' }]}>
                      ${priceDollars}
                    </Text>
                    <View style={[styles.statusBadge, { backgroundColor: `${statusColor}20`, borderColor: `${statusColor}40` }]}>
                      <Text style={[styles.statusBadgeText, { color: statusColor }]}>
                        {statusLabelText}
                      </Text>
                    </View>
                  </View>
                  {proposal.description ? (
                    <Text style={[styles.proposalDescription, { color: 'rgba(255, 255, 255, 0.35)' }]}>
                      {proposal.description}
                    </Text>
                  ) : null}
                </GlassCard>
              );
            })}
          </View>
        )}

        <View style={styles.bottomPadding} />
      </ScrollView>
    </GlassBackground>
  );
}

// ──────────────────────────────────────────────
// Styles
// ──────────────────────────────────────────────

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: Spacing.lg,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    ...Typography.footnote,
    color: 'rgba(255, 255, 255, 0.5)',
    marginTop: Spacing.md,
  },

  // Sections
  section: {
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.xl,
  },
  sectionTitle: {
    ...Typography.headline,
    color: '#FFFFFF',
    marginBottom: Spacing.md,
  },

  // Header
  headerTitle: {
    fontSize: FontSize.title2,
    fontWeight: FontWeight.bold as '700',
    color: '#FFFFFF',
    marginBottom: Spacing.sm,
  },
  levelBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: 999,
    borderWidth: 1,
  },
  levelBadgeText: {
    fontSize: FontSize.caption,
    fontWeight: FontWeight.bold as '700',
    textTransform: 'uppercase',
  },

  // Guide range
  guideContent: {
    alignItems: 'center',
  },
  guideLabel: {
    ...Typography.label,
    color: 'rgba(255, 255, 255, 0.5)',
    marginBottom: Spacing.xs,
  },
  guideValue: {
    fontSize: FontSize.title2,
    fontWeight: FontWeight.bold as '700',
    color: '#FFFFFF',
    marginBottom: Spacing.sm,
  },
  guideNote: {
    ...Typography.caption,
    color: 'rgba(255, 255, 255, 0.35)',
    textAlign: 'center',
    lineHeight: 16,
  },

  // Proposal card
  proposalCardBorder: {
    borderColor: 'rgba(120, 80, 255, 0.4)',
    marginBottom: Spacing.md,
  },
  pastProposalCard: {
    marginBottom: Spacing.md,
  },
  proposalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  proposalPrice: {
    fontSize: FontSize.title2,
    fontWeight: FontWeight.bold as '700',
    color: '#FFFFFF',
  },
  proposalDate: {
    ...Typography.caption,
    color: 'rgba(255, 255, 255, 0.35)',
  },
  proposalDescription: {
    ...Typography.footnote,
    color: 'rgba(255, 255, 255, 0.5)',
    lineHeight: 18,
    marginBottom: Spacing.md,
  },
  proposalActions: {
    flexDirection: 'row',
    gap: Spacing.md,
    marginTop: Spacing.sm,
  },
  rejectBtnStyle: {
    flex: 1,
    borderColor: 'rgba(231, 76, 60, 0.5)',
  },
  acceptBtnStyle: {
    flex: 1,
  },

  // Status badge
  statusBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xxs,
    borderRadius: 999,
    borderWidth: 1,
  },
  statusBadgeText: {
    fontSize: FontSize.caption,
    fontWeight: FontWeight.semiBold as '600',
    textTransform: 'uppercase',
  },

  // Empty state
  emptyContent: {
    alignItems: 'center',
  },
  emptyTitle: {
    ...Typography.headline,
    color: '#FFFFFF',
    marginBottom: Spacing.sm,
  },
  emptyText: {
    ...Typography.footnote,
    color: 'rgba(255, 255, 255, 0.5)',
    textAlign: 'center',
    lineHeight: 20,
  },

  // Bottom padding
  bottomPadding: {
    height: 32,
  },
});

export default PriceProposalScreen;
