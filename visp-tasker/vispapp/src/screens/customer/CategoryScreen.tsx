/**
 * VISP - Category Screen (Editorial refresh)
 *
 * Lists tasks within a selected category.
 * - Editorial title with category name
 * - SearchInput primitive for in-catalog filter
 * - Horizontal scroll of mono pills for level filter
 * - Tasks rendered via TaskCard component (internal restyle pending)
 */

import React, { useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { AnimatedSpinner } from '../../components/animations';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  Screen,
  ScreenTitle,
  Card,
  Eyebrow,
  SearchInput,
} from '../../components/visp';
import { useVispTheme, VispText, VispSpace, VispRadius } from '../../theme/visp';
import { useTaskStore } from '../../stores/taskStore';
import TaskCard from '../../components/TaskCard';
import LevelBadge from '../../components/LevelBadge';
import type { CustomerFlowParamList, ServiceLevel, ServiceTask } from '../../types';

type CategoryScreenRouteProp = RouteProp<CustomerFlowParamList, 'Category'>;
type CategoryScreenNavProp = NativeStackNavigationProp<CustomerFlowParamList, 'Category'>;

interface LevelTab {
  level: ServiceLevel | null;
  label: string;
}

const LEVEL_TABS: LevelTab[] = [
  { level: null, label: 'ALL' },
  { level: 1, label: 'HELPER' },
  { level: 2, label: 'EXPERIENCED' },
  { level: 3, label: 'CERTIFIED' },
  { level: 4, label: 'EMERGENCY' },
];

function CategoryScreen(): React.JSX.Element {
  const t = useVispTheme();
  const route = useRoute<CategoryScreenRouteProp>();
  const navigation = useNavigation<CategoryScreenNavProp>();
  const { categoryId, categoryName } = route.params ?? { categoryId: '', categoryName: '' };

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

  // Hide native header in favour of our editorial title
  useEffect(() => {
    navigation.setOptions({ headerShown: false });
  }, [navigation]);

  useEffect(() => {
    setSearchQuery('');
    setLevelFilter(null);
    if (categoryId) fetchCategoryTasks(categoryId);
  }, [categoryId, fetchCategoryTasks, setSearchQuery, setLevelFilter]);

  const handleTaskPress = useCallback(
    (taskId: string) => {
      navigation.navigate('Subcategory', { taskId });
    },
    [navigation],
  );

  const groupedTasks = useMemo(() => {
    const groups = new Map<ServiceLevel, ServiceTask[]>();
    filteredTasks.forEach((task) => {
      const existing = groups.get(task.level) || [];
      existing.push(task);
      groups.set(task.level, existing);
    });
    return groups;
  }, [filteredTasks]);

  const sortedLevels = useMemo(
    () => Array.from(groupedTasks.keys()).sort((a, b) => a - b),
    [groupedTasks],
  );

  return (
    <Screen>
      <ScreenTitle
        title={categoryName}
        sub="§ Tasks"
        onBack={() => navigation.getParent()?.goBack()}
      />

      {/* Search */}
      <View style={styles.searchWrap}>
        <SearchInput
          placeholder="Search tasks…"
          value={searchQuery}
          onChangeText={setSearchQuery}
          trailing={
            searchQuery.length > 0 ? (
              <TouchableOpacity onPress={() => setSearchQuery('')}>
                <Text style={[VispText.eyebrow, { color: t.text2 }]}>CLEAR</Text>
              </TouchableOpacity>
            ) : null
          }
        />
      </View>

      {/* Level filter pills */}
      <ScrollView
        horizontal
        // flexGrow:0 obligatorio: sin altura ni flexGrow un scroll
        // horizontal se expande y roba el espacio vertical del padre.
        style={{ flexGrow: 0 }}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.tabsRow}
      >
        {LEVEL_TABS.map((tab) => {
          const isActive = selectedLevelFilter === tab.level;
          return (
            <TouchableOpacity
              key={tab.label}
              onPress={() => setLevelFilter(tab.level)}
              activeOpacity={0.7}
              style={[
                styles.tab,
                {
                  backgroundColor: isActive ? t.text : t.card,
                  borderColor: isActive ? t.text : t.border,
                },
              ]}
            >
              <Text style={[VispText.chip, { color: isActive ? t.bg : t.text2 }]}>
                {tab.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Error */}
      {error && (
        <View style={[styles.errorBox, { backgroundColor: t.violetDim, borderColor: t.violetLine }]}>
          <Text style={[VispText.body, { color: t.text, flex: 1 }]}>{error}</Text>
          <TouchableOpacity
            onPress={() => fetchCategoryTasks(categoryId)}
            style={[styles.retryBtn, { borderColor: t.borderStrong }]}
          >
            <Text style={[VispText.bodyStrong, { color: t.text, fontSize: 13 }]}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Loading */}
      {isLoadingTasks && (
        <View style={styles.loading}>
          <AnimatedSpinner size={32} color={t.violet} />
          <Text style={[VispText.body, { color: t.text2, marginTop: 12 }]}>Loading tasks…</Text>
        </View>
      )}

      {/* Task list */}
      {!isLoadingTasks && (
        <ScrollView
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        >
          {filteredTasks.length === 0 ? (
            <Card style={{ alignItems: 'center', paddingVertical: 36 }}>
              <Text style={[VispText.headlineMid, { color: t.text, textAlign: 'center', marginBottom: 8 }]}>
                No tasks found
              </Text>
              <Text style={[VispText.body, { color: t.text2, textAlign: 'center' }]}>
                {searchQuery
                  ? 'Try adjusting your search or filter criteria.'
                  : 'No tasks are available in this category at the moment.'}
              </Text>
            </Card>
          ) : selectedLevelFilter !== null ? (
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
            sortedLevels.map((level) => {
              const tasks = groupedTasks.get(level);
              if (!tasks || tasks.length === 0) return null;
              return (
                <View key={level} style={styles.levelSection}>
                  <View style={styles.levelHeader}>
                    <LevelBadge level={level} size="medium" />
                    <Eyebrow color={t.text3}>
                      {tasks.length} {tasks.length === 1 ? 'TASK' : 'TASKS'}
                    </Eyebrow>
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
            })
          )}
        </ScrollView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  searchWrap: { paddingHorizontal: VispSpace.gutter, paddingBottom: 12 },

  tabsRow: {
    paddingHorizontal: VispSpace.gutter,
    gap: 6,
    paddingBottom: 12,
  },
  tab: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: VispRadius.pill,
    borderWidth: 1,
  },

  errorBox: {
    marginHorizontal: VispSpace.gutter,
    marginBottom: 10,
    padding: 14,
    borderRadius: VispRadius.card,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  retryBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },

  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  listContent: {
    paddingHorizontal: VispSpace.gutter,
    paddingTop: 4,
    paddingBottom: 60,
  },

  levelSection: { marginBottom: 22 },
  levelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
});

export default CategoryScreen;
