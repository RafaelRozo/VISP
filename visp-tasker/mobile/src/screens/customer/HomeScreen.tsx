/**
 * VISP/Tasker - Customer Home Screen
 *
 * Main landing screen for customers with:
 * - Personalized greeting header
 * - Emergency button (prominent, top position)
 * - Service category grid (2-column, closed catalog)
 * - Active jobs horizontal scroll
 * - Recent activity section
 * - Pull-to-refresh
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import type { CompositeScreenProps } from '@react-navigation/native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { Colors, Spacing, Typography, BorderRadius, Shadows } from '../../theme';
import { useAuthStore } from '../../stores/authStore';
import EmergencyButton from '../../components/EmergencyButton';
import CategoryGrid from '../../components/CategoryGrid';
import ActiveJobCard from '../../components/ActiveJobCard';
import { get } from '../../services/apiClient';
import taskService from '../../services/taskService';
import type {
  Job,
  PaginatedResponse,
  RootStackParamList,
  CustomerTabParamList,
  ServiceCategory,
} from '../../types';

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

type Props = CompositeScreenProps<
  BottomTabScreenProps<CustomerTabParamList, 'Home'>,
  NativeStackScreenProps<RootStackParamList>
>;

interface RecentActivity {
  id: string;
  type: 'job_completed' | 'job_cancelled' | 'review_left' | 'payment_processed';
  title: string;
  description: string;
  timestamp: string;
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function formatRelativeTime(isoDate: string): string {
  const now = Date.now();
  const date = new Date(isoDate).getTime();
  const diffMs = now - date;
  const diffMinutes = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMinutes < 1) return 'Just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return new Date(isoDate).toLocaleDateString();
}

const ACTIVITY_TYPE_LABELS: Record<RecentActivity['type'], string> = {
  job_completed: 'Completed',
  job_cancelled: 'Cancelled',
  review_left: 'Review',
  payment_processed: 'Payment',
};

const ACTIVITY_TYPE_COLORS: Record<RecentActivity['type'], string> = {
  job_completed: Colors.success,
  job_cancelled: Colors.textTertiary,
  review_left: Colors.info,
  payment_processed: Colors.warning,
};

// ──────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────

function HomeScreen({ navigation }: Props): React.JSX.Element {
  const user = useAuthStore((state) => state.user);

  const [categories, setCategories] = useState<ServiceCategory[]>([]);
  const [activeJobs, setActiveJobs] = useState<Job[]>([]);
  const [recentActivity, setRecentActivity] = useState<RecentActivity[]>([]);
  const [isLoadingCategories, setIsLoadingCategories] = useState(true);
  const [isLoadingJobs, setIsLoadingJobs] = useState(true);
  const [isLoadingActivity, setIsLoadingActivity] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const greeting = useMemo(() => getGreeting(), []);
  const firstName = user?.firstName ?? 'there';

  // ── Data Fetching ────────────────────────

  const fetchCategories = useCallback(async () => {
    try {
      setIsLoadingCategories(true);
      // get() already unwraps response.data.data, so we receive the array directly
      const rawCategories = await get<Array<{
        id: string;
        slug: string;
        name: string;
        icon_url?: string | null;
        task_count?: number;
        is_active?: boolean;
        display_order?: number;
      }>>('/categories');
      // Map backend snake_case fields to mobile ServiceCategory type
      const mapped: ServiceCategory[] = (rawCategories ?? []).map((cat) => ({
        id: cat.id,
        name: cat.name,
        slug: cat.slug,
        icon: cat.icon_url ?? '',
        taskCount: cat.task_count ?? 0,
        isEmergency: false,
        sortOrder: cat.display_order ?? 0,
      }));
      setCategories(mapped);
    } catch {
      // If we fail to fetch, we show error state (controlled by TaskStore)
      // No fallback to mock data in production alignment

    } finally {
      setIsLoadingCategories(false);
    }
  }, []);

  const fetchActiveJobs = useCallback(async () => {
    try {
      setIsLoadingJobs(true);
      const jobs = await taskService.getActiveJobs();
      setActiveJobs(jobs);
    } catch {
      // Silently fail
    } finally {
      setIsLoadingJobs(false);
    }
  }, []);

  const fetchRecentActivity = useCallback(async () => {
    try {
      setIsLoadingActivity(true);
      const data = await get<RecentActivity[]>('/activity/recent');
      setRecentActivity(data);
    } catch {
      // Silently fail
    } finally {
      setIsLoadingActivity(false);
    }
  }, []);

  const loadAllData = useCallback(async () => {
    await Promise.all([
      fetchCategories(),
      fetchActiveJobs(),
      fetchRecentActivity(),
    ]);
  }, [fetchCategories, fetchActiveJobs, fetchRecentActivity]);

  useEffect(() => {
    loadAllData();
  }, [loadAllData]);

  // ── Pull-to-Refresh ──────────────────────

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await loadAllData();
    setIsRefreshing(false);
  }, [loadAllData]);

  // ── Navigation Handlers ──────────────────

  const handleEmergencyPress = useCallback(() => {
    navigation.navigate('EmergencyFlow');
  }, [navigation]);

  const handleCategoryPress = useCallback(
    (category: ServiceCategory) => {
      navigation.navigate('CategoryDetail', {
        categoryId: category.id,
        categoryName: category.name,
      });
    },
    [navigation],
  );

  const handleJobPress = useCallback(
    (job: Job) => {
      const pendingStatuses = ['pending_match', 'draft', 'pending'];
      if (pendingStatuses.includes(job.status)) {
        Alert.alert(
          'Searching for a Tasker',
          'We\'re still looking for the best available Tasker in your area. You\'ll be notified as soon as one is assigned. Hang tight!',
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
        // Navigate to MyJobs tab where the inline Approve/Reject card is shown
        navigation.navigate('MyJobs');
        return;
      }
      // Only provider_accepted and later statuses go to tracking
      navigation.navigate('JobTracking', { jobId: job.id });
    },
    [navigation],
  );

  // ── Derived State ────────────────────────

  const hasActiveEmergency = useMemo(
    () =>
      activeJobs.some(
        (job) =>
          job.level === 4 &&
          !['completed', 'cancelled'].includes(job.status),
      ),
    [activeJobs],
  );

  // ── Render Sections ──────────────────────

  function renderHeader(): React.JSX.Element {
    return (
      <View style={styles.header}>
        <View style={styles.greetingRow}>
          <View>
            <Text style={styles.greeting}>
              {greeting}, {firstName}
            </Text>
            <Text style={styles.greetingSub}>
              What do you need help with today?
            </Text>
          </View>
          {/* Profile Avatar */}
          <TouchableOpacity
            style={styles.profileButton}
            onPress={() => navigation.navigate('CustomerProfile')}
            accessibilityLabel="Open profile"
          >
            <Text style={styles.profileInitials}>
              {(user?.firstName?.charAt(0) ?? '') +
                (user?.lastName?.charAt(0) ?? '')}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  function renderActiveJobs(): React.JSX.Element | null {
    if (isLoadingJobs) {
      return (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Active Jobs</Text>
          <View style={styles.jobsLoadingContainer}>
            {[1, 2].map((i) => (
              <View key={i} style={styles.jobSkeletonCard}>
                <View style={styles.jobSkeletonStrip} />
                <View style={styles.jobSkeletonBody}>
                  <View style={styles.jobSkeletonLine} />
                  <View style={styles.jobSkeletonLineShort} />
                  <View style={styles.jobSkeletonLineShort} />
                </View>
              </View>
            ))}
          </View>
        </View>
      );
    }

    if (activeJobs.length === 0) {
      return null;
    }

    return (
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Active Jobs</Text>
          <Text style={styles.sectionCount}>{activeJobs.length}</Text>
        </View>
        <FlatList
          data={activeJobs}
          renderItem={({ item }) => (
            <ActiveJobCard job={item} onPress={handleJobPress} />
          )}
          keyExtractor={(item) => item.id}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.jobsList}
          ItemSeparatorComponent={() => <View style={styles.jobSeparator} />}
        />
      </View>
    );
  }

  function renderRecentActivity(): React.JSX.Element | null {
    if (isLoadingActivity) {
      return (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Recent Activity</Text>
          {[1, 2, 3].map((i) => (
            <View key={i} style={styles.activitySkeletonRow}>
              <View style={styles.activitySkeletonDot} />
              <View style={styles.activitySkeletonLines}>
                <View style={styles.activitySkeletonLine} />
                <View style={styles.activitySkeletonLineShort} />
              </View>
            </View>
          ))}
        </View>
      );
    }

    if (recentActivity.length === 0) {
      return null;
    }

    return (
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Recent Activity</Text>
        {recentActivity.map((activity) => {
          const typeColor = ACTIVITY_TYPE_COLORS[activity.type];
          const typeLabel = ACTIVITY_TYPE_LABELS[activity.type];

          return (
            <View key={activity.id} style={styles.activityRow}>
              <View
                style={[styles.activityDot, { backgroundColor: typeColor }]}
              />
              <View style={styles.activityContent}>
                <View style={styles.activityTop}>
                  <Text style={styles.activityTitle} numberOfLines={1}>
                    {activity.title}
                  </Text>
                  <Text style={styles.activityTime}>
                    {formatRelativeTime(activity.timestamp)}
                  </Text>
                </View>
                <Text style={styles.activityDescription} numberOfLines={1}>
                  {activity.description}
                </Text>
                <View
                  style={[
                    styles.activityBadge,
                    { backgroundColor: `${typeColor}20` },
                  ]}
                >
                  <Text
                    style={[styles.activityBadgeText, { color: typeColor }]}
                  >
                    {typeLabel}
                  </Text>
                </View>
              </View>
            </View>
          );
        })}
      </View>
    );
  }

  // ── Main Render ──────────────────────────

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={handleRefresh}
            tintColor={Colors.primary}
            colors={[Colors.primary]}
          />
        }
      >
        {/* Greeting Header */}
        {renderHeader()}

        {/* Emergency Button */}
        <View style={styles.emergencySection}>
          <EmergencyButton
            onPress={handleEmergencyPress}
            hasActiveEmergency={hasActiveEmergency}
          />
        </View>

        {/* Active Jobs (horizontal scroll) */}
        {renderActiveJobs()}

        {/* Service Categories */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Services</Text>
          <CategoryGrid
            categories={categories}
            onCategoryPress={handleCategoryPress}
            isLoading={isLoadingCategories}
          />
        </View>

        {/* Recent Activity */}
        {renderRecentActivity()}

        {/* Bottom Spacer */}
        <View style={styles.bottomSpacer} />
      </ScrollView>
    </View>
  );
}

// ──────────────────────────────────────────────
// Styles
// ──────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scrollContent: {
    paddingBottom: Spacing.massive,
  },

  // ── Header ────────────────────────────
  header: {
    paddingHorizontal: Spacing.xxl,
    paddingTop: Spacing.giant,
    paddingBottom: Spacing.lg,
  },
  greetingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  greeting: {
    ...Typography.title2,
    color: Colors.textPrimary,
    marginBottom: Spacing.xxs,
  },
  greetingSub: {
    ...Typography.body,
    color: Colors.textSecondary,
  },
  profileButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.primaryDark,
    alignItems: 'center',
    justifyContent: 'center',
    ...Shadows.sm,
  },
  profileInitials: {
    ...Typography.footnote,
    color: Colors.white,
    fontWeight: '700',
  },

  // ── Emergency ─────────────────────────
  emergencySection: {
    paddingHorizontal: Spacing.xxl,
    marginBottom: Spacing.xxl,
  },

  // ── Sections ──────────────────────────
  section: {
    paddingHorizontal: Spacing.xxl,
    marginBottom: Spacing.xxl,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.lg,
  },
  sectionTitle: {
    ...Typography.title3,
    color: Colors.textPrimary,
    marginBottom: Spacing.lg,
  },
  sectionCount: {
    ...Typography.footnote,
    color: Colors.primary,
    fontWeight: '700',
    backgroundColor: 'rgba(74, 144, 226, 0.12)',
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xxs,
    borderRadius: BorderRadius.full,
    overflow: 'hidden',
    marginBottom: Spacing.lg,
  },

  // ── Active Jobs List ──────────────────
  jobsList: {
    paddingRight: Spacing.xxl,
  },
  jobSeparator: {
    width: Spacing.md,
  },

  // ── Job Skeletons ─────────────────────
  jobsLoadingContainer: {
    flexDirection: 'row',
    gap: Spacing.md,
  },
  jobSkeletonCard: {
    width: 280,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
  },
  jobSkeletonStrip: {
    height: 3,
    backgroundColor: Colors.skeleton,
  },
  jobSkeletonBody: {
    padding: Spacing.lg,
    gap: Spacing.sm,
  },
  jobSkeletonLine: {
    height: 14,
    backgroundColor: Colors.skeleton,
    borderRadius: 7,
    width: '80%',
  },
  jobSkeletonLineShort: {
    height: 10,
    backgroundColor: Colors.skeleton,
    borderRadius: 5,
    width: '55%',
  },

  // ── Activity ──────────────────────────
  activityRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.divider,
  },
  activityDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 6,
    marginRight: Spacing.md,
  },
  activityContent: {
    flex: 1,
  },
  activityTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.xxs,
  },
  activityTitle: {
    ...Typography.footnote,
    color: Colors.textPrimary,
    fontWeight: '600',
    flex: 1,
    marginRight: Spacing.sm,
  },
  activityTime: {
    ...Typography.caption,
    color: Colors.textTertiary,
  },
  activityDescription: {
    ...Typography.caption,
    color: Colors.textSecondary,
    marginBottom: Spacing.sm,
  },
  activityBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xxs,
    borderRadius: BorderRadius.xs,
  },
  activityBadgeText: {
    ...Typography.caption,
    fontWeight: '600',
  },

  // ── Activity Skeletons ────────────────
  activitySkeletonRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: Spacing.md,
  },
  activitySkeletonDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.skeleton,
    marginTop: 6,
    marginRight: Spacing.md,
  },
  activitySkeletonLines: {
    flex: 1,
    gap: Spacing.sm,
  },
  activitySkeletonLine: {
    height: 12,
    backgroundColor: Colors.skeleton,
    borderRadius: 6,
    width: '70%',
  },
  activitySkeletonLineShort: {
    height: 10,
    backgroundColor: Colors.skeleton,
    borderRadius: 5,
    width: '45%',
  },

  // ── Bottom ────────────────────────────
  bottomSpacer: {
    height: Spacing.xxxl,
  },
});

export default HomeScreen;
