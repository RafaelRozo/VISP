/**
 * VISP - Service Catalog Screen
 *
 * Shows all services the provider is qualified for, organized by category.
 * Collapsible sections, level badges, rate ranges, availability toggles,
 * and level filter pills at the top.
 *
 * Dark glassmorphism styling with GlassBackground, GlassCard, and glass tokens.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { AnimatedSpinner } from '../../components/animations';
import { Colors, getLevelColor } from '../../theme/colors';
import { GlassStyles } from '../../theme/glass';
import { GlassBackground, GlassCard, GlassButton } from '../../components/glass';
import { useProviderStore } from '../../stores/providerStore';
import { ServiceCatalogItem } from '../../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const LEVEL_FILTERS = ['All', 'L1', 'L2', 'L3', 'L4'] as const;
type LevelFilter = (typeof LEVEL_FILTERS)[number];

function getLevelLabel(level: string): string {
  const num = parseInt(level.replace(/\D/g, ''), 10);
  switch (num) {
    case 1:
      return 'L1 Helper';
    case 2:
      return 'L2 Experienced';
    case 3:
      return 'L3 Certified Pro';
    case 4:
      return 'L4 Emergency';
    default:
      return level;
  }
}

function getRateDescription(level: string): string {
  const num = parseInt(level.replace(/\D/g, ''), 10);
  switch (num) {
    case 1:
      return '$45-70/hr';
    case 2:
      return '$80-120/hr';
    case 3:
      return 'Per-job (negotiated)';
    case 4:
      return 'Emergency (negotiated + surcharges)';
    default:
      return '';
  }
}

function getLevelNum(level: string): number {
  return parseInt(level.replace(/\D/g, ''), 10) || 1;
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hrs}h ${mins}m` : `${hrs}h`;
}

// ---------------------------------------------------------------------------
// Category group
// ---------------------------------------------------------------------------

interface CategoryGroup {
  categoryId: string;
  categoryName: string;
  items: ServiceCatalogItem[];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ServiceCatalogScreen(): React.JSX.Element {
  const { serviceCatalog, catalogLoading, fetchServiceCatalog } =
    useProviderStore();

  const [activeFilter, setActiveFilter] = useState<LevelFilter>('All');
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set(),
  );
  const [availabilityMap, setAvailabilityMap] = useState<
    Record<string, boolean>
  >({});

  useEffect(() => {
    fetchServiceCatalog();
  }, [fetchServiceCatalog]);

  // Initialize availability from catalog data
  useEffect(() => {
    const map: Record<string, boolean> = {};
    for (const item of serviceCatalog) {
      map[item.id] = item.isAvailable;
    }
    setAvailabilityMap(map);
  }, [serviceCatalog]);

  // Filter and group by category
  const categoryGroups = useMemo(() => {
    let filtered = serviceCatalog;
    if (activeFilter !== 'All') {
      const levelNum = parseInt(activeFilter.replace('L', ''), 10);
      filtered = filtered.filter((item) => getLevelNum(item.level) === levelNum);
    }

    const groupMap = new Map<string, CategoryGroup>();
    for (const item of filtered) {
      if (!groupMap.has(item.categoryId)) {
        groupMap.set(item.categoryId, {
          categoryId: item.categoryId,
          categoryName: item.categoryName,
          items: [],
        });
      }
      groupMap.get(item.categoryId)!.items.push(item);
    }

    return Array.from(groupMap.values());
  }, [serviceCatalog, activeFilter]);

  const toggleCategory = useCallback((categoryId: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(categoryId)) {
        next.delete(categoryId);
      } else {
        next.add(categoryId);
      }
      return next;
    });
  }, []);

  const toggleAvailability = useCallback((itemId: string) => {
    setAvailabilityMap((prev) => ({
      ...prev,
      [itemId]: !prev[itemId],
    }));
  }, []);

  const renderServiceItem = useCallback(
    (item: ServiceCatalogItem) => {
      const levelNum = getLevelNum(item.level) as 1 | 2 | 3 | 4;
      const levelColor = getLevelColor(levelNum);
      const isAvailable = availabilityMap[item.id] ?? item.isAvailable;

      return (
        <View key={item.id} style={styles.serviceItem}>
          <View style={[styles.serviceLevelStrip, { backgroundColor: levelColor }]} />
          <View style={styles.serviceContent}>
            <View style={styles.serviceHeader}>
              <View style={styles.serviceHeaderLeft}>
                <Text style={styles.serviceName} numberOfLines={1}>
                  {item.name}
                </Text>
                <View style={styles.serviceMetaRow}>
                  <View
                    style={[
                      styles.levelBadge,
                      { backgroundColor: levelColor + '15', borderColor: levelColor + '50' },
                    ]}
                  >
                    <Text style={[styles.levelBadgeText, { color: levelColor }]}>
                      {getLevelLabel(item.level)}
                    </Text>
                  </View>
                </View>
              </View>
              <Switch
                value={isAvailable}
                onValueChange={() => toggleAvailability(item.id)}
                trackColor={{
                  false: 'rgba(255, 255, 255, 0.12)',
                  true: Colors.primary + '80',
                }}
                thumbColor={isAvailable ? Colors.primary : 'rgba(255, 255, 255, 0.4)'}
              />
            </View>
            <View style={styles.serviceDetails}>
              <View style={styles.serviceDetailItem}>
                <Text style={styles.serviceDetailLabel}>Rate</Text>
                <Text style={styles.serviceDetailValue}>
                  {item.rateDescription || getRateDescription(item.level)}
                </Text>
              </View>
              <View style={styles.serviceDetailItem}>
                <Text style={styles.serviceDetailLabel}>Duration</Text>
                <Text style={styles.serviceDetailValue}>
                  {item.estimatedDurationMin > 0
                    ? formatDuration(item.estimatedDurationMin)
                    : 'Varies'}
                </Text>
              </View>
            </View>
          </View>
        </View>
      );
    },
    [availabilityMap, toggleAvailability],
  );

  const renderCategory = useCallback(
    ({ item: group }: { item: CategoryGroup }) => {
      const isExpanded = expandedCategories.has(group.categoryId);

      return (
        <GlassCard variant="dark" padding={0} style={styles.categoryCard}>
          <TouchableOpacity
            style={styles.categoryHeader}
            onPress={() => toggleCategory(group.categoryId)}
            activeOpacity={0.7}
          >
            <View style={styles.categoryInfo}>
              <Text style={styles.categoryName}>{group.categoryName}</Text>
              <View style={styles.categoryCountBadge}>
                <Text style={styles.categoryCountText}>
                  {group.items.length}
                </Text>
              </View>
            </View>
            <Text style={styles.chevron}>{isExpanded ? '\u25B2' : '\u25BC'}</Text>
          </TouchableOpacity>

          {isExpanded && (
            <View style={styles.servicesList}>
              {group.items.map(renderServiceItem)}
            </View>
          )}
        </GlassCard>
      );
    },
    [expandedCategories, toggleCategory, renderServiceItem],
  );

  const renderEmpty = useCallback(() => {
    if (catalogLoading) return null;
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyTitle}>No Services Found</Text>
        <Text style={styles.emptySubtext}>
          {activeFilter !== 'All'
            ? `No services found for ${activeFilter}. Try a different filter.`
            : 'You have no qualified services yet. Complete your profile and credentials to unlock services.'}
        </Text>
      </View>
    );
  }, [catalogLoading, activeFilter]);

  return (
    <GlassBackground>
      {/* Level filter pills */}
      <View style={styles.filterBar}>
        {LEVEL_FILTERS.map((filter) => {
          const isActive = activeFilter === filter;
          const filterLevelNum = parseInt(filter.replace('L', ''), 10);
          const pillColor =
            filter === 'All'
              ? Colors.primary
              : getLevelColor(filterLevelNum as 1 | 2 | 3 | 4);

          return (
            <TouchableOpacity
              key={filter}
              style={[
                styles.filterPill,
                isActive && {
                  backgroundColor: pillColor + '25',
                  borderColor: pillColor + '60',
                },
              ]}
              onPress={() => setActiveFilter(filter)}
              activeOpacity={0.7}
            >
              <Text
                style={[
                  styles.filterPillText,
                  isActive && { color: pillColor },
                ]}
              >
                {filter}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {catalogLoading ? (
        <View style={styles.loadingContainer}>
          <AnimatedSpinner size={48} color={Colors.primary} />
          <Text style={styles.loadingText}>Loading services...</Text>
        </View>
      ) : (
        <FlatList
          data={categoryGroups}
          renderItem={renderCategory}
          keyExtractor={(item) => item.categoryId}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={renderEmpty}
          refreshing={catalogLoading}
          onRefresh={fetchServiceCatalog}
          showsVerticalScrollIndicator={false}
        />
      )}
    </GlassBackground>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  filterBar: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
    backgroundColor: 'rgba(10, 10, 30, 0.60)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
  },
  filterPill: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    backgroundColor: 'rgba(255, 255, 255, 0.07)',
  },
  filterPillText: {
    fontSize: 13,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.5)',
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.5)',
    marginTop: 12,
  },
  listContent: {
    paddingVertical: 12,
    flexGrow: 1,
  },
  categoryCard: {
    marginHorizontal: 16,
    marginBottom: 10,
    overflow: 'hidden',
  },
  categoryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 14,
  },
  categoryInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  categoryName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
    marginRight: 8,
  },
  categoryCountBadge: {
    backgroundColor: 'rgba(74, 144, 226, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(74, 144, 226, 0.30)',
  },
  categoryCountText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.primary,
  },
  chevron: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.45)',
  },
  servicesList: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
  },
  serviceItem: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.06)',
  },
  serviceLevelStrip: {
    width: 3,
  },
  serviceContent: {
    flex: 1,
    padding: 12,
  },
  serviceHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  serviceHeaderLeft: {
    flex: 1,
    marginRight: 12,
  },
  serviceName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  serviceMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  levelBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    borderWidth: 1,
  },
  levelBadgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  serviceDetails: {
    flexDirection: 'row',
    gap: 24,
  },
  serviceDetailItem: {},
  serviceDetailLabel: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.4)',
    marginBottom: 2,
  },
  serviceDetailValue: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.85)',
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
    color: '#FFFFFF',
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.5)',
    textAlign: 'center',
    lineHeight: 20,
  },
});
