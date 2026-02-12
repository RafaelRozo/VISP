/**
 * VISP/Tasker - My Jobs Screen
 *
 * Displays the customer's jobs grouped by status:
 *   - Active (pending_match, matched, provider_en_route, arrived, in_progress)
 *   - Completed / Cancelled (history)
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    FlatList,
    RefreshControl,
    SafeAreaView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { Colors, Spacing, Typography, BorderRadius, Shadows } from '../../theme';
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
        pending_match: 'Searching for Tasker',
        matched: 'Tasker Assigned',
        provider_accepted: 'Tasker Accepted',
        provider_en_route: 'Tasker En Route',
        arrived: 'Tasker Arrived',
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
                    'Searching for a Tasker',
                    'We\'re still looking for the best available Tasker in your area. You\'ll be notified as soon as one is assigned. Hang tight!',
                );
                return;
            }
            navigation.navigate('JobTracking', { jobId: job.id });
        },
        [navigation],
    );

    // ── Render job card ──────────────────────
    const renderJobCard = useCallback(
        ({ item }: { item: Job }) => {
            const color = statusColor(item.status);
            const isPending = PENDING_STATUSES.includes(item.status);

            return (
                <TouchableOpacity
                    style={styles.jobCard}
                    onPress={() => handleJobPress(item)}
                    activeOpacity={0.7}
                >
                    <View style={styles.jobHeader}>
                        <Text style={styles.jobName} numberOfLines={1}>
                            {item.taskName || 'Job'}
                        </Text>
                        <View style={[styles.statusBadge, { backgroundColor: `${color}20` }]}>
                            {isPending && (
                                <ActivityIndicator
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
                            📍 {item.address.street}
                            {item.address.city ? `, ${item.address.city}` : ''}
                        </Text>
                    ) : null}

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
                </TouchableOpacity>
            );
        },
        [handleJobPress],
    );

    // ── Empty state ──────────────────────────
    const renderEmptyState = () => (
        <View style={styles.emptyContainer}>
            <Text style={styles.emptyIcon}>
                {activeTab === 'active' ? '📋' : '📁'}
            </Text>
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
            <SafeAreaView style={styles.safeArea}>
                <View style={styles.loadingContainer}>
                    <ActivityIndicator size="large" color={Colors.primary} />
                    <Text style={styles.loadingText}>Loading jobs...</Text>
                </View>
            </SafeAreaView>
        );
    }

    // ── Render ────────────────────────────────
    return (
        <SafeAreaView style={styles.safeArea}>
            <View style={styles.container}>
                {/* Tab bar */}
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
        </SafeAreaView>
    );
}

// ──────────────────────────────────────────────
// Styles
// ──────────────────────────────────────────────

const styles = StyleSheet.create({
    safeArea: {
        flex: 1,
        backgroundColor: Colors.background,
    },
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
        color: Colors.textSecondary,
        marginTop: Spacing.md,
    },

    // Tab bar
    tabBar: {
        flexDirection: 'row',
        paddingHorizontal: Spacing.lg,
        paddingTop: Spacing.md,
        paddingBottom: Spacing.sm,
        gap: Spacing.sm,
    },
    tab: {
        flex: 1,
        paddingVertical: Spacing.sm,
        borderRadius: BorderRadius.md,
        alignItems: 'center',
        backgroundColor: Colors.surface,
    },
    tabActive: {
        backgroundColor: Colors.primary,
    },
    tabText: {
        ...Typography.headline,
        color: Colors.textSecondary,
    },
    tabTextActive: {
        color: Colors.white,
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
    jobCard: {
        backgroundColor: Colors.card,
        borderRadius: BorderRadius.lg,
        padding: Spacing.lg,
        marginBottom: Spacing.md,
        ...Shadows.sm,
    },
    jobHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: Spacing.sm,
    },
    jobName: {
        ...Typography.headline,
        color: Colors.textPrimary,
        flex: 1,
        marginRight: Spacing.sm,
    },
    statusBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: Spacing.sm,
        paddingVertical: Spacing.xxs,
        borderRadius: BorderRadius.sm,
    },
    statusText: {
        ...Typography.caption1,
        fontWeight: FontWeight.semiBold as '600',
    },
    jobAddress: {
        ...Typography.footnote,
        color: Colors.textSecondary,
        marginBottom: Spacing.sm,
    },
    jobFooter: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    jobDate: {
        ...Typography.caption1,
        color: Colors.textTertiary,
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
    emptyIcon: {
        fontSize: 48,
        marginBottom: Spacing.md,
    },
    emptyTitle: {
        ...Typography.title3,
        color: Colors.textPrimary,
        marginBottom: Spacing.sm,
        textAlign: 'center',
    },
    emptySubtext: {
        ...Typography.footnote,
        color: Colors.textSecondary,
        textAlign: 'center',
        lineHeight: 20,
    },
});

export default MyJobsScreen;
