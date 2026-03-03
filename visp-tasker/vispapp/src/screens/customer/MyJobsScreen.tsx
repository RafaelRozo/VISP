/**
 * VISP - My Jobs Screen (Glass Redesign)
 *
 * Displays the customer's jobs grouped by status:
 *   - Active (pending_match, matched, provider_en_route, arrived, in_progress)
 *   - Completed / Cancelled (history)
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
    Alert,
    FlatList,
    RefreshControl,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { AnimatedSpinner } from '../../components/animations';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { GlassBackground, GlassCard } from '../../components/glass';
import { Colors, Spacing, Typography, BorderRadius, GlassStyles } from '../../theme';
import { FontWeight } from '../../theme/typography';
import taskService from '../../services/taskService';
import type { Job, RootStackParamList } from '../../types';

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

type NavProp = NativeStackNavigationProp<RootStackParamList>;

type TabKey = 'active' | 'history';

// ──────────────────────────────────────────────
// Status helpers
// ──────────────────────────────────────────────

const PENDING_STATUSES = ['pending_match', 'draft', 'pending'];

function statusLabel(status: string): string {
    const map: Record<string, string> = {
        draft: 'Draft',
        pending_match: 'Searching for Provider',
        matched: 'Provider Assigned',
        pending_approval: 'Provider Review',
        scheduled: 'Scheduled',
        provider_accepted: 'Provider Accepted',
        provider_en_route: 'Provider En Route',
        arrived: 'Provider Arrived',
        in_progress: 'In Progress',
        completed: 'Completed',
        cancelled_by_customer: 'Cancelled',
        cancelled_by_provider: 'Cancelled',
        cancelled_by_system: 'Cancelled',
        disputed: 'Disputed',
        refunded: 'Refunded',
    };
    return map[status] ?? status.replace(/_/g, ' ');
}

function statusColor(status: string): string {
    if (PENDING_STATUSES.includes(status)) return Colors.warning;
    if (status === 'pending_approval') return '#FF8C00';
    if (status === 'scheduled') return Colors.info ?? '#5B9BD5';
    if (['matched', 'provider_accepted', 'provider_en_route', 'arrived'].includes(status)) return Colors.info ?? '#5B9BD5';
    if (status === 'in_progress') return Colors.primary;
    if (status === 'completed') return Colors.success;
    return Colors.textTertiary;
}

function isActiveStatus(status: string): boolean {
    return ![
        'completed',
        'cancelled_by_customer',
        'cancelled_by_provider',
        'cancelled_by_system',
        'disputed',
        'refunded',
    ].includes(status);
}

function formatDate(iso: string | null | undefined): string {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
    });
}

// ──────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────

function MyJobsScreen(): React.JSX.Element {
    const navigation = useNavigation<NavProp>();

    const [jobs, setJobs] = useState<Job[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [activeTab, setActiveTab] = useState<TabKey>('active');

    // ── Fetch ────────────────────────────────
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

    // ── Filter ───────────────────────────────
    const filteredJobs = jobs.filter((j) =>
        activeTab === 'active' ? isActiveStatus(j.status) : !isActiveStatus(j.status),
    );

    // ── Press handler ────────────────────────
    const handleJobPress = useCallback(
        (job: Job) => {
            if (PENDING_STATUSES.includes(job.status)) {
                Alert.alert(
                    'Searching for a Provider',
                    'We\'re still looking for the best available provider in your area. You\'ll be notified as soon as one is assigned. Hang tight!',
                );
                return;
            }
            if (job.status === 'matched') {
                Alert.alert(
                    'Waiting for Provider',
                    'Your job has been sent to a provider. Waiting for them to review and accept.',
                );
                return;
            }
            if (job.status === 'pending_approval') {
                Alert.alert(
                    'Provider Review',
                    'Review the provider info below and tap Approve or Reject.',
                );
                return;
            }
            // Only provider_accepted and later statuses go to tracking
            navigation.navigate('JobTracking', { jobId: job.id });
        },
        [navigation],
    );

    // ── Provider info cache for pending_approval jobs ─
    const [providerInfoMap, setProviderInfoMap] = useState<Record<string, any>>({});

    // Fetch provider info for pending_approval jobs
    useEffect(() => {
        const pendingApprovalJobs = jobs.filter(j => j.status === 'pending_approval');
        pendingApprovalJobs.forEach(async (job) => {
            if (providerInfoMap[job.id]) return;
            try {
                const info = await taskService.getPendingProvider(job.id);
                if (info) {
                    setProviderInfoMap(prev => ({ ...prev, [job.id]: info }));
                }
            } catch {
                // ignore
            }
        });
    }, [jobs]);

    // ── Approve / Reject provider ─────────────
    const handleApproveProvider = useCallback(async (jobId: string) => {
        try {
            await taskService.approveProvider(jobId);
            Alert.alert('Approved', 'Your job has been scheduled!');
            fetchJobs(true);
        } catch {
            Alert.alert('Error', 'Failed to approve provider.');
        }
    }, [fetchJobs]);

    const handleRejectProvider = useCallback((jobId: string) => {
        Alert.alert(
            'Reject Provider',
            'Are you sure? The job will be re-matched with another provider.',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Reject',
                    style: 'destructive',
                    onPress: async () => {
                        try {
                            await taskService.rejectProvider(jobId);
                            Alert.alert('Provider Rejected', 'We\'ll find you another provider.');
                            fetchJobs(true);
                        } catch {
                            Alert.alert('Error', 'Failed to reject provider.');
                        }
                    },
                },
            ],
        );
    }, [fetchJobs]);

    // ── Render job card ──────────────────────
    const renderJobCard = useCallback(
        ({ item }: { item: Job }) => {
            const color = statusColor(item.status);
            const isPending = PENDING_STATUSES.includes(item.status);
            const isPendingApproval = item.status === 'pending_approval';
            const providerInfo = providerInfoMap[item.id];

            return (
                <TouchableOpacity
                    onPress={() => handleJobPress(item)}
                    activeOpacity={0.7}
                    style={styles.jobCardTouchable}
                >
                    <GlassCard variant="dark">
                        <View style={styles.jobHeader}>
                            <Text style={styles.jobName} numberOfLines={1}>
                                {item.taskName || 'Job'}
                            </Text>
                            <View style={[styles.statusBadge, { backgroundColor: `${color}20`, borderColor: `${color}40` }]}>
                                {isPending && (
                                    <AnimatedSpinner
                                        size={10}
                                        color={color}
                                        style={{ marginRight: 4 }}
                                    />
                                )}
                                <Text style={[styles.statusText, { color }]}>
                                    {statusLabel(item.status)}
                                </Text>
                            </View>
                        </View>

                        {item.address?.street ? (
                            <Text style={styles.jobAddress} numberOfLines={1}>
                                {item.address.street}
                                {item.address.city ? `, ${item.address.city}` : ''}
                            </Text>
                        ) : null}

                        {/* Provider info for pending_approval */}
                        {isPendingApproval && providerInfo && (
                            <View style={styles.providerReviewCard}>
                                <Text style={styles.providerReviewTitle}>Provider wants to accept your job</Text>
                                <View style={styles.providerInfoRow}>
                                    <View style={[styles.providerLevel, { backgroundColor: color }]}>
                                        <Text style={styles.providerLevelText}>L{providerInfo.level}</Text>
                                    </View>
                                    <View style={{ flex: 1 }}>
                                        <Text style={styles.providerName}>{providerInfo.displayName}</Text>
                                        {providerInfo.yearsExperience && (
                                            <Text style={styles.providerDetail}>
                                                {providerInfo.yearsExperience} yrs experience
                                            </Text>
                                        )}
                                    </View>
                                </View>
                                <View style={styles.approvalButtons}>
                                    <TouchableOpacity
                                        style={styles.rejectButton}
                                        onPress={() => handleRejectProvider(item.id)}
                                    >
                                        <Text style={styles.rejectButtonText}>Reject</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity
                                        style={styles.approveButton}
                                        onPress={() => handleApproveProvider(item.id)}
                                    >
                                        <Text style={styles.approveButtonText}>Approve</Text>
                                    </TouchableOpacity>
                                </View>
                            </View>
                        )}

                        <View style={styles.jobFooter}>
                            <Text style={styles.jobDate}>
                                {formatDate(item.createdAt)}
                            </Text>
                            {item.estimatedPrice > 0 && (
                                <Text style={styles.jobPrice}>
                                    ${item.estimatedPrice.toFixed(2)}
                                </Text>
                            )}
                        </View>
                    </GlassCard>
                </TouchableOpacity>
            );
        },
        [handleJobPress, providerInfoMap, handleApproveProvider, handleRejectProvider],
    );

    // ── Empty state ──────────────────────────
    const renderEmptyState = () => (
        <View style={styles.emptyContainer}>
            <Text style={styles.emptyTitle}>
                {activeTab === 'active' ? 'No Active Jobs' : 'No Past Jobs'}
            </Text>
            <Text style={styles.emptySubtext}>
                {activeTab === 'active'
                    ? 'Book a service from the Home tab to get started.'
                    : 'Your completed and cancelled jobs will appear here.'}
            </Text>
        </View>
    );

    // ── Loading ──────────────────────────────
    if (isLoading) {
        return (
            <GlassBackground>
                <View style={styles.loadingContainer}>
                    <AnimatedSpinner size={48} color={Colors.primary} />
                    <Text style={styles.loadingText}>Loading jobs...</Text>
                </View>
            </GlassBackground>
        );
    }

    // ── Render ────────────────────────────────
    return (
        <GlassBackground>
            <View style={styles.container}>
                {/* Glass pill tab bar */}
                <View style={styles.tabBar}>
                    <TouchableOpacity
                        style={[styles.tab, activeTab === 'active' && styles.tabActive]}
                        onPress={() => setActiveTab('active')}
                    >
                        <Text
                            style={[
                                styles.tabText,
                                activeTab === 'active' && styles.tabTextActive,
                            ]}
                        >
                            Active
                        </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={[styles.tab, activeTab === 'history' && styles.tabActive]}
                        onPress={() => setActiveTab('history')}
                    >
                        <Text
                            style={[
                                styles.tabText,
                                activeTab === 'history' && styles.tabTextActive,
                            ]}
                        >
                            History
                        </Text>
                    </TouchableOpacity>
                </View>

                {/* Job list */}
                <FlatList
                    data={filteredJobs}
                    renderItem={renderJobCard}
                    keyExtractor={(item) => item.id}
                    contentContainerStyle={
                        filteredJobs.length === 0
                            ? styles.emptyList
                            : styles.listContent
                    }
                    ListEmptyComponent={renderEmptyState}
                    refreshControl={
                        <RefreshControl
                            refreshing={isRefreshing}
                            onRefresh={handleRefresh}
                            tintColor={Colors.primary}
                        />
                    }
                    showsVerticalScrollIndicator={false}
                />
            </View>
        </GlassBackground>
    );
}

// ──────────────────────────────────────────────
// Styles
// ──────────────────────────────────────────────

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },

    // Loading
    loadingContainer: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
    loadingText: {
        ...Typography.body,
        color: 'rgba(255, 255, 255, 0.6)',
        marginTop: Spacing.md,
    },

    // Glass pill tab bar
    tabBar: {
        flexDirection: 'row',
        paddingHorizontal: Spacing.lg,
        paddingTop: Spacing.md + 48,
        paddingBottom: Spacing.sm,
        gap: Spacing.sm,
    },
    tab: {
        flex: 1,
        paddingVertical: Spacing.sm,
        borderRadius: 999,
        alignItems: 'center',
        backgroundColor: 'rgba(255, 255, 255, 0.07)',
        borderWidth: 1,
        borderColor: 'rgba(255, 255, 255, 0.10)',
    },
    tabActive: {
        backgroundColor: 'rgba(120, 80, 255, 0.35)',
        borderColor: 'rgba(120, 80, 255, 0.6)',
    },
    tabText: {
        ...Typography.headline,
        color: 'rgba(255, 255, 255, 0.5)',
    },
    tabTextActive: {
        color: '#FFFFFF',
    },

    // List
    listContent: {
        paddingHorizontal: Spacing.lg,
        paddingTop: Spacing.sm,
        paddingBottom: Spacing.massive,
    },
    emptyList: {
        flex: 1,
        justifyContent: 'center',
        paddingHorizontal: Spacing.lg,
    },

    // Job card
    jobCardTouchable: {
        marginBottom: Spacing.md,
    },
    jobHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: Spacing.sm,
    },
    jobName: {
        ...Typography.headline,
        color: '#FFFFFF',
        flex: 1,
        marginRight: Spacing.sm,
    },
    statusBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: Spacing.sm,
        paddingVertical: Spacing.xxs,
        borderRadius: 999,
        borderWidth: 1,
    },
    statusText: {
        ...Typography.caption1,
        fontWeight: FontWeight.semiBold as '600',
    },
    jobAddress: {
        ...Typography.footnote,
        color: 'rgba(255, 255, 255, 0.5)',
        marginBottom: Spacing.sm,
    },
    jobFooter: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    jobDate: {
        ...Typography.caption1,
        color: 'rgba(255, 255, 255, 0.35)',
    },
    jobPrice: {
        ...Typography.headline,
        color: Colors.primary,
    },

    // Empty state
    emptyContainer: {
        alignItems: 'center',
        paddingHorizontal: Spacing.xl,
    },
    emptyTitle: {
        ...Typography.title3,
        color: '#FFFFFF',
        marginBottom: Spacing.sm,
        textAlign: 'center',
    },
    emptySubtext: {
        ...Typography.footnote,
        color: 'rgba(255, 255, 255, 0.5)',
        textAlign: 'center',
        lineHeight: 20,
    },

    // Provider review card
    providerReviewCard: {
        backgroundColor: 'rgba(255, 140, 0, 0.10)',
        borderRadius: BorderRadius.md,
        padding: Spacing.md,
        marginTop: Spacing.sm,
        marginBottom: Spacing.sm,
        borderWidth: 1,
        borderColor: 'rgba(255, 140, 0, 0.25)',
    },
    providerReviewTitle: {
        ...Typography.caption1,
        fontWeight: '700' as const,
        color: '#FF8C00',
        marginBottom: Spacing.sm,
    },
    providerInfoRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: Spacing.md,
    },
    providerLevel: {
        width: 36,
        height: 36,
        borderRadius: 18,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: Spacing.sm,
    },
    providerLevelText: {
        fontSize: 14,
        fontWeight: '800' as const,
        color: '#fff',
    },
    providerName: {
        ...Typography.headline,
        color: '#FFFFFF',
    },
    providerDetail: {
        ...Typography.caption1,
        color: 'rgba(255, 255, 255, 0.5)',
    },
    approvalButtons: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        gap: Spacing.sm,
    },
    rejectButton: {
        paddingVertical: Spacing.xs,
        paddingHorizontal: Spacing.lg,
        borderRadius: BorderRadius.md,
        borderWidth: 1,
        borderColor: 'rgba(231, 76, 60, 0.6)',
        backgroundColor: 'rgba(231, 76, 60, 0.12)',
    },
    rejectButtonText: {
        ...Typography.headline,
        color: Colors.error,
    },
    approveButton: {
        paddingVertical: Spacing.xs,
        paddingHorizontal: Spacing.lg,
        borderRadius: BorderRadius.md,
        backgroundColor: 'rgba(39, 174, 96, 0.7)',
        borderWidth: 1,
        borderColor: 'rgba(39, 174, 96, 0.4)',
    },
    approveButtonText: {
        ...Typography.headline,
        color: '#fff',
    },
});

export default MyJobsScreen;
