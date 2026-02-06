/**
 * VISP/Tasker - Category Grid Component
 *
 * Displays service categories in a 2-column grid layout.
 * Each tile shows an icon, name, and task count.
 * Includes a skeleton loading state.
 */

import React, { useCallback } from 'react';
import {
  Animated,
  Dimensions,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { Colors, Spacing, Typography, BorderRadius, Shadows } from '../theme';
import type { ServiceCategory } from '../types';

// ──────────────────────────────────────────────
// Props
// ──────────────────────────────────────────────

interface CategoryGridProps {
  /** List of service categories to display. */
  categories: ServiceCategory[];
  /** Called when a category tile is tapped. */
  onCategoryPress: (category: ServiceCategory) => void;
  /** Whether data is still loading; shows skeletons when true. */
  isLoading?: boolean;
  /** Number of skeleton items to show during loading. */
  skeletonCount?: number;
}

// ──────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────

const NUM_COLUMNS = 2;
const GRID_GAP = Spacing.md;
const HORIZONTAL_PADDING = Spacing.xxl;
const SCREEN_WIDTH = Dimensions.get('window').width;
const TILE_WIDTH =
  (SCREEN_WIDTH - HORIZONTAL_PADDING * 2 - GRID_GAP * (NUM_COLUMNS - 1)) /
  NUM_COLUMNS;

// Category icon mapping (text-based placeholder icons).
// In production, these would be replaced with an icon library (e.g. react-native-vector-icons).
const CATEGORY_ICONS: Record<string, string> = {
  plumbing: 'P',
  electrical: 'E',
  cleaning: 'C',
  hvac: 'H',
  painting: 'PT',
  landscaping: 'L',
  moving: 'M',
  appliance: 'A',
  locksmith: 'LK',
  pest_control: 'PC',
  roofing: 'R',
  general: 'G',
};

function getCategoryIcon(slug: string): string {
  return CATEGORY_ICONS[slug] ?? slug.charAt(0).toUpperCase();
}

// ──────────────────────────────────────────────
// Skeleton Tile
// ──────────────────────────────────────────────

function SkeletonTile(): React.JSX.Element {
  return (
    <View style={[styles.tile, styles.skeletonTile]}>
      <View style={styles.skeletonIcon} />
      <View style={styles.skeletonTextLong} />
      <View style={styles.skeletonTextShort} />
    </View>
  );
}

// ──────────────────────────────────────────────
// Category Tile
// ──────────────────────────────────────────────

interface TileProps {
  category: ServiceCategory;
  onPress: (category: ServiceCategory) => void;
}

function CategoryTile({ category, onPress }: TileProps): React.JSX.Element {
  const handlePress = useCallback(() => {
    onPress(category);
  }, [category, onPress]);

  const iconText = getCategoryIcon(category.slug);
  const isEmergency = category.isEmergency;

  return (
    <TouchableOpacity
      style={[styles.tile, isEmergency && styles.tileEmergency]}
      onPress={handlePress}
      activeOpacity={0.7}
      accessibilityLabel={`${category.name}, ${category.taskCount} tasks available`}
      accessibilityRole="button"
    >
      <View
        style={[
          styles.iconContainer,
          isEmergency && styles.iconContainerEmergency,
        ]}
      >
        <Text
          style={[
            styles.iconText,
            isEmergency && styles.iconTextEmergency,
          ]}
        >
          {iconText}
        </Text>
      </View>
      <Text style={styles.categoryName} numberOfLines={1}>
        {category.name}
      </Text>
      <Text style={styles.taskCount}>
        {category.taskCount} {category.taskCount === 1 ? 'task' : 'tasks'}
      </Text>
    </TouchableOpacity>
  );
}

const MemoizedCategoryTile = React.memo(CategoryTile);

// ──────────────────────────────────────────────
// Grid Component
// ──────────────────────────────────────────────

function CategoryGrid({
  categories,
  onCategoryPress,
  isLoading = false,
  skeletonCount = 6,
}: CategoryGridProps): React.JSX.Element {
  // ── Skeleton Rendering ───────────────────
  if (isLoading) {
    const skeletons = Array.from({ length: skeletonCount }, (_, i) => ({
      id: `skeleton-${i}`,
    }));

    return (
      <View style={styles.container}>
        <View style={styles.gridRow}>
          {skeletons.map((item) => (
            <SkeletonTile key={item.id} />
          ))}
        </View>
      </View>
    );
  }

  // ── Empty State ──────────────────────────
  if (categories.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>No service categories available</Text>
      </View>
    );
  }

  // ── Grid Rendering ───────────────────────
  const renderItem = useCallback(
    ({ item }: { item: ServiceCategory }) => (
      <MemoizedCategoryTile category={item} onPress={onCategoryPress} />
    ),
    [onCategoryPress],
  );

  const keyExtractor = useCallback(
    (item: ServiceCategory) => item.id,
    [],
  );

  return (
    <View style={styles.container}>
      <FlatList
        data={categories}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        numColumns={NUM_COLUMNS}
        columnWrapperStyle={styles.columnWrapper}
        scrollEnabled={false}
        contentContainerStyle={styles.flatListContent}
      />
    </View>
  );
}

// ──────────────────────────────────────────────
// Styles
// ──────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    marginBottom: Spacing.lg,
  },
  flatListContent: {
    gap: GRID_GAP,
  },
  columnWrapper: {
    gap: GRID_GAP,
  },
  gridRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GRID_GAP,
  },

  // ── Tile ──────────────────────────────
  tile: {
    width: TILE_WIDTH,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    padding: Spacing.lg,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
    ...Shadows.sm,
  },
  tileEmergency: {
    borderColor: 'rgba(231, 76, 60, 0.3)',
  },

  // ── Icon ──────────────────────────────
  iconContainer: {
    width: 48,
    height: 48,
    borderRadius: BorderRadius.md,
    backgroundColor: 'rgba(74, 144, 226, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.md,
  },
  iconContainerEmergency: {
    backgroundColor: 'rgba(231, 76, 60, 0.12)',
  },
  iconText: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.primary,
  },
  iconTextEmergency: {
    color: Colors.emergencyRed,
  },

  // ── Text ──────────────────────────────
  categoryName: {
    ...Typography.footnote,
    color: Colors.textPrimary,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: Spacing.xxs,
  },
  taskCount: {
    ...Typography.caption,
    color: Colors.textTertiary,
  },

  // ── Skeleton ──────────────────────────
  skeletonTile: {
    width: TILE_WIDTH,
  },
  skeletonIcon: {
    width: 48,
    height: 48,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.skeleton,
    marginBottom: Spacing.md,
  },
  skeletonTextLong: {
    width: '70%',
    height: 12,
    borderRadius: 6,
    backgroundColor: Colors.skeleton,
    marginBottom: Spacing.xs,
  },
  skeletonTextShort: {
    width: '45%',
    height: 10,
    borderRadius: 5,
    backgroundColor: Colors.skeleton,
  },

  // ── Empty ─────────────────────────────
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: Spacing.xxxl,
  },
  emptyText: {
    ...Typography.body,
    color: Colors.textTertiary,
  },
});

export default React.memo(CategoryGrid);
