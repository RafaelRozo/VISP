/**
 * VISP/Tasker - CategoryScreen
 *
 * Shows tasks within a selected category.
 * Features:
 *   - Tasks grouped by level with level badges
 *   - Filter by level (tabs: All, Helper, Experienced, Certified, Emergency)
 *   - Search bar for filtering tasks within the closed catalog
 *   - Each task shows: name, level badge, estimated price range, brief description
 *
 * CRITICAL: Closed task catalog. No free-text task creation.
 */

import React, { useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  SafeAreaView,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Colors } from '../../theme/colors';
import { Spacing } from '../../theme/spacing';
import { Typography, FontWeight, FontSize } from '../../theme/typography';
import { BorderRadius } from '../../theme/borders';
import { useTaskStore } from '../../stores/taskStore';
import TaskCard from '../../components/TaskCard';
import LevelBadge from '../../components/LevelBadge';
import type { CustomerFlowParamList, ServiceLevel, ServiceTask } from '../../types';

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

type CategoryScreenRouteProp = RouteProp<CustomerFlowParamList, 'Category'>;
type CategoryScreenNavProp = NativeStackNavigationProp<CustomerFlowParamList, 'Category'>;

interface LevelTab {
  level: ServiceLevel | null;
  label: string;
}

// ──────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────

const LEVEL_TABS: LevelTab[] = [
  { level: null, label: 'All' },
  { level: 1, label: 'Helper' },
  { level: 2, label: 'Experienced' },
  { level: 3, label: 'Certified' },
  { level: 4, label: 'Emergency' },
];

// ──────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────

function CategoryScreen(): React.JSX.Element {
  const route = useRoute<CategoryScreenRouteProp>();
  const navigation = useNavigation<CategoryScreenNavProp>();
  const { categoryId, categoryName } = route.params;

  const {
    filteredTasks,
    selectedLevelFilter,
    searchQuery,
    isLoadingTasks,
    error,
    fetchCategoryTasks,
    setLevelFilter,
    setSearchQuery,
  } = useTaskStore();

  // Set header title
  useEffect(() => {
    navigation.setOptions({ title: categoryName });
  }, [navigation, categoryName]);

  // Load tasks on mount
  useEffect(() => {
    fetchCategoryTasks(categoryId);
  }, [categoryId, fetchCategoryTasks]);

  // Handlers
  const handleLevelFilter = useCallback(
    (level: ServiceLevel | null) => {
      setLevelFilter(level);
    },
    [setLevelFilter],
  );

  const handleSearchChange = useCallback(
    (text: string) => {
      setSearchQuery(text);
    },
    [setSearchQuery],
  );

  const handleTaskPress = useCallback(
    (taskId: string) => {
      navigation.navigate('Subcategory', { taskId });
    },
    [navigation],
  );

  // Group tasks by level for section display
  const groupedTasks = useMemo(() => {
    const groups = new Map<ServiceLevel, ServiceTask[]>();
    filteredTasks.forEach((task) => {
      const existing = groups.get(task.level) || [];
      existing.push(task);
      groups.set(task.level, existing);
    });
    return groups;
  }, [filteredTasks]);

  const sortedLevels = useMemo(() => {
    return Array.from(groupedTasks.keys()).sort((a, b) => a - b);
  }, [groupedTasks]);

  // Render functions
  const renderLevelTab = useCallback(
    (tab: LevelTab) => {
      const isActive = selectedLevelFilter === tab.level;
      return (
        <TouchableOpacity
          key={tab.label}
          style={[styles.tab, isActive && styles.tabActive]}
          onPress={() => handleLevelFilter(tab.level)}
          activeOpacity={0.7}
          accessibilityRole="tab"
          accessibilityState={{ selected: isActive }}
          accessibilityLabel={`Filter by ${tab.label}`}
        >
          <Text
            style={[styles.tabText, isActive && styles.tabTextActive]}
          >
            {tab.label}
          </Text>
        </TouchableOpacity>
      );
    },
    [selectedLevelFilter, handleLevelFilter],
  );

  const renderTaskItem = useCallback(
    ({ item }: { item: ServiceTask }) => (
      <TaskCard
        id={item.id}
        name={item.name}
        description={item.description}
        level={item.level}
        estimatedDurationMinutes={item.estimatedDurationMinutes}
        basePrice={item.basePrice}
        onPress={handleTaskPress}
      />
    ),
    [handleTaskPress],
  );

  const keyExtractor = useCallback((item: ServiceTask) => item.id, []);

  const renderLevelSection = useCallback(
    (level: ServiceLevel) => {
      const tasks = groupedTasks.get(level);
      if (!tasks || tasks.length === 0) {
        return null;
      }

      return (
        <View key={level} style={styles.levelSection}>
          <View style={styles.levelHeader}>
            <LevelBadge level={level} size="medium" />
            <Text style={styles.taskCount}>
              {tasks.length} {tasks.length === 1 ? 'task' : 'tasks'}
            </Text>
          </View>
          {tasks.map((task) => (
            <TaskCard
              key={task.id}
              id={task.id}
              name={task.name}
              description={task.description}
              level={task.level}
              estimatedDurationMinutes={task.estimatedDurationMinutes}
              basePrice={task.basePrice}
              onPress={handleTaskPress}
            />
          ))}
        </View>
      );
    },
    [groupedTasks, handleTaskPress],
  );

  // Empty state
  const renderEmpty = useCallback(() => {
    if (isLoadingTasks) {
      return null;
    }
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyTitle}>No tasks found</Text>
        <Text style={styles.emptyDescription}>
          {searchQuery
            ? 'Try adjusting your search or filter criteria.'
            : 'No tasks are available in this category at the moment.'}
        </Text>
      </View>
    );
  }, [isLoadingTasks, searchQuery]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        {/* Search bar */}
        <View style={styles.searchContainer}>
          <View style={styles.searchInputContainer}>
            <Text style={styles.searchIcon}>S</Text>
            <TextInput
              style={styles.searchInput}
              placeholder="Search tasks..."
              placeholderTextColor={Colors.inputPlaceholder}
              value={searchQuery}
              onChangeText={handleSearchChange}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              accessibilityLabel="Search tasks"
              accessibilityHint="Type to filter tasks within this category"
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity
                onPress={() => handleSearchChange('')}
                style={styles.clearButton}
                accessibilityLabel="Clear search"
              >
                <Text style={styles.clearButtonText}>X</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Level filter tabs */}
        <View style={styles.tabContainer}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.tabScrollContent}
          >
            {LEVEL_TABS.map(renderLevelTab)}
          </ScrollView>
        </View>

        {/* Error */}
        {error && (
          <View style={styles.errorContainer}>
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity
              onPress={() => fetchCategoryTasks(categoryId)}
              style={styles.retryButton}
            >
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Loading */}
        {isLoadingTasks && (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={Colors.primary} />
            <Text style={styles.loadingText}>Loading tasks...</Text>
          </View>
        )}

        {/* Task list grouped by level */}
        {!isLoadingTasks && (
          <ScrollView
            style={styles.taskList}
            contentContainerStyle={styles.taskListContent}
            showsVerticalScrollIndicator={false}
          >
            {filteredTasks.length === 0 ? (
              renderEmpty()
            ) : selectedLevelFilter !== null ? (
              // When a specific level filter is active, show flat list
              filteredTasks.map((task) => (
                <TaskCard
                  key={task.id}
                  id={task.id}
                  name={task.name}
                  description={task.description}
                  level={task.level}
                  estimatedDurationMinutes={task.estimatedDurationMinutes}
                  basePrice={task.basePrice}
                  onPress={handleTaskPress}
                />
              ))
            ) : (
              // When showing all, group by level
              sortedLevels.map(renderLevelSection)
            )}
          </ScrollView>
        )}
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
    backgroundColor: Colors.background,
  },

  // Search
  searchContainer: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  searchInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.inputBackground,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    borderColor: Colors.inputBorder,
    paddingHorizontal: Spacing.md,
    height: 44,
  },
  searchIcon: {
    fontSize: 16,
    color: Colors.textTertiary,
    fontWeight: FontWeight.bold,
    marginRight: Spacing.sm,
  },
  searchInput: {
    flex: 1,
    ...Typography.body,
    color: Colors.inputText,
    paddingVertical: 0,
  },
  clearButton: {
    padding: Spacing.xs,
    marginLeft: Spacing.sm,
  },
  clearButtonText: {
    fontSize: 14,
    color: Colors.textSecondary,
    fontWeight: FontWeight.bold,
  },

  // Tabs
  tabContainer: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.divider,
  },
  tabScrollContent: {
    paddingHorizontal: Spacing.lg,
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
  },
  tab: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.xxl,
    backgroundColor: Colors.surfaceLight,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  tabActive: {
    backgroundColor: `${Colors.primary}20`,
    borderColor: Colors.primary,
  },
  tabText: {
    ...Typography.buttonSmall,
    color: Colors.textSecondary,
  },
  tabTextActive: {
    color: Colors.primary,
  },

  // Task list
  taskList: {
    flex: 1,
  },
  taskListContent: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.massive,
  },

  // Level sections
  levelSection: {
    marginBottom: Spacing.xl,
  },
  levelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.md,
  },
  taskCount: {
    ...Typography.footnote,
    color: Colors.textTertiary,
  },

  // Empty state
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: Spacing.giant,
    paddingHorizontal: Spacing.xxl,
  },
  emptyTitle: {
    ...Typography.title3,
    color: Colors.textPrimary,
    marginBottom: Spacing.sm,
    textAlign: 'center',
  },
  emptyDescription: {
    ...Typography.body,
    color: Colors.textSecondary,
    textAlign: 'center',
  },

  // Loading
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    ...Typography.footnote,
    color: Colors.textSecondary,
    marginTop: Spacing.md,
  },

  // Error
  errorContainer: {
    margin: Spacing.lg,
    padding: Spacing.lg,
    backgroundColor: `${Colors.error}15`,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    borderColor: `${Colors.error}30`,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  errorText: {
    ...Typography.footnote,
    color: Colors.error,
    flex: 1,
  },
  retryButton: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    backgroundColor: Colors.error,
    borderRadius: BorderRadius.xs,
    marginLeft: Spacing.sm,
  },
  retryText: {
    ...Typography.buttonSmall,
    color: Colors.white,
  },
});

export default CategoryScreen;
