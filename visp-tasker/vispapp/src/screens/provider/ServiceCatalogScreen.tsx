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
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { pickImage } from '../../services/imagePickerService';
import { AnimatedSpinner } from '../../components/animations';
import { Colors, getLevelColor } from '../../theme/colors';
import { useTheme } from '../../theme/ThemeContext';
import { useTranslation } from '../../i18n';
import { GlassStyles } from '../../theme/glass';
import { GlassCard, GlassButton } from '../../components/glass';
import { Screen } from '../../components/visp';
import { useProviderStore } from '../../stores/providerStore';
import { providerService } from '../../services/providerService';
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
  const theme = useTheme();
  const { t, language } = useTranslation();
  const { serviceCatalog, catalogLoading, fetchServiceCatalog } =
    useProviderStore();

  const [activeFilter, setActiveFilter] = useState<LevelFilter>('All');
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set(),
  );
  const [availabilityMap, setAvailabilityMap] = useState<
    Record<string, boolean>
  >({});
  // Section-credential gate: the locked service the provider tapped. Drives the
  // help-message pop-up + section-document upload (migration 029).
  const [gateItem, setGateItem] = useState<ServiceCatalogItem | null>(null);
  const [uploading, setUploading] = useState(false);

  // Pick the admin-set help message for the current language, with a fallback.
  const gateHelp = useMemo(() => {
    if (!gateItem) return '';
    const msg = language === 'fr' ? gateItem.helpMessageFr : gateItem.helpMessageEn;
    return (
      msg ||
      t('credentials.sectionDocDefaultHelp') ||
      'This section requires a document approved by an admin before you can offer its services. Upload it to get verified.'
    );
  }, [gateItem, language, t]);

  const openGate = useCallback(
    (item: ServiceCatalogItem) => {
      // Un candado por SEGURO no se abre subiendo el documento de sección: hace
      // falta la póliza, que se carga en Verification. Mandar al proveedor al
      // popup equivocado lo dejaría subiendo archivos que no desbloquean nada.
      if (item.insuranceMissing) {
        Alert.alert(
          t('serviceCatalog.insuranceNeededTitle') || 'Insurance required',
          t('serviceCatalog.insuranceNeededBody') ||
            'This service requires commercial general liability insurance. Add your policy in Verification — once VISP verifies it, the service unlocks on its own.',
        );
        return;
      }
      setGateItem(item);
    },
    [t],
  );

  const uploadSectionDoc = useCallback(async () => {
    if (!gateItem) return;
    try {
      // Cámara o galería: el documento suele estar en papel, delante.
      const asset = await pickImage({ quality: 0.8 });
      if (!asset) return;

      setUploading(true);
      await providerService.uploadCredential(
        { uri: asset.uri, type: asset.mimeType, name: asset.fileName },
        'certification',
        { categoryId: gateItem.categoryId },
      );
      setGateItem(null);
      Alert.alert(
        t('credentials.documentUploaded') || 'Document uploaded',
        `Your document for "${gateItem.categoryName}" has been submitted for review. You'll be notified once an admin approves it.`,
      );
      fetchServiceCatalog();
    } catch (err) {
      console.error('[ServiceCatalog] section doc upload failed', err);
      Alert.alert(t('common.error'), t('credentials.uploadFailed') || 'Upload failed');
    } finally {
      setUploading(false);
    }
  }, [gateItem, t, fetchServiceCatalog]);

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
                <Text style={[styles.serviceName, { color: theme.textPrimary }]} numberOfLines={1}>
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
              {item.locked ? (
                <TouchableOpacity
                  onPress={() => openGate(item)}
                  style={[styles.lockPill, { borderColor: Colors.primary + '60' }]}
                  accessibilityLabel="Locked — upload section document"
                >
                  <Text style={[styles.lockPillText, { color: Colors.primary }]}>
                    {item.insuranceMissing
                      ? `🔒 ${t('serviceCatalog.insuranceLock') || 'Insurance'}`
                      : '🔒 Unlock'}
                  </Text>
                </TouchableOpacity>
              ) : (
                <Switch
                  value={isAvailable}
                  onValueChange={() => toggleAvailability(item.id)}
                  trackColor={{
                    false: 'rgba(255, 255, 255, 0.12)',
                    true: Colors.primary + '80',
                  }}
                  thumbColor={isAvailable ? Colors.primary : 'rgba(255, 255, 255, 0.4)'}
                />
              )}
            </View>
            <View style={styles.serviceDetails}>
              <View style={styles.serviceDetailItem}>
                <Text style={[styles.serviceDetailLabel, { color: theme.textSecondary }]}>Rate</Text>
                <Text style={[styles.serviceDetailValue, { color: theme.textPrimary }]}>
                  {item.rateDescription || getRateDescription(item.level)}
                </Text>
              </View>
              <View style={styles.serviceDetailItem}>
                <Text style={[styles.serviceDetailLabel, { color: theme.textSecondary }]}>Duration</Text>
                <Text style={[styles.serviceDetailValue, { color: theme.textPrimary }]}>
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
    [availabilityMap, toggleAvailability, openGate, theme],
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
              <Text style={[styles.categoryName, { color: theme.textPrimary }]}>{group.categoryName}</Text>
              <View style={styles.categoryCountBadge}>
                <Text style={styles.categoryCountText}>
                  {group.items.length}
                </Text>
              </View>
            </View>
            <Text style={[styles.chevron, { color: theme.textSecondary }]}>{isExpanded ? '\u25B2' : '\u25BC'}</Text>
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
        <Text style={[styles.emptyTitle, { color: theme.textPrimary }]}>No Services Found</Text>
        <Text style={[styles.emptySubtext, { color: theme.textSecondary }]}>
          {activeFilter !== 'All'
            ? `No services found for ${activeFilter}. Try a different filter.`
            : 'You have no qualified services yet. Complete your profile and credentials to unlock services.'}
        </Text>
      </View>
    );
  }, [catalogLoading, activeFilter]);

  return (
    <Screen>
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
                  { color: theme.textSecondary },
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
          <Text style={[styles.loadingText, { color: theme.textSecondary }]}>Loading services...</Text>
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

      {/* Section-document gate pop-up: help message (EN/FR) + upload. */}
      <Modal
        visible={gateItem != null}
        transparent
        animationType="fade"
        onRequestClose={() => setGateItem(null)}
      >
        <Pressable style={styles.gateBackdrop} onPress={() => !uploading && setGateItem(null)}>
          <Pressable
            style={[styles.gateCard, { backgroundColor: theme.surface, borderColor: theme.border }]}
            onPress={() => {}}
          >
            {gateItem && (
              <>
                <Text style={[styles.gateTitle, { color: theme.textPrimary }]}>
                  🔒 {gateItem.categoryName}
                </Text>
                <Text style={[styles.gateSub, { color: theme.textSecondary }]}>
                  {t('credentials.sectionLockedTitle') || 'This section needs a verified document'}
                </Text>
                <Text style={[styles.gateHelp, { color: theme.textSecondary }]}>
                  {gateHelp}
                </Text>
                <View style={styles.gateActions}>
                  <GlassButton
                    title={t('common.cancel') || 'Cancel'}
                    variant="outline"
                    onPress={() => setGateItem(null)}
                    disabled={uploading}
                  />
                  {uploading ? (
                    <View style={styles.gateUploading}>
                      <ActivityIndicator color={Colors.primary} />
                    </View>
                  ) : (
                    <GlassButton
                      title={t('credentials.uploadDocument') || 'Upload document'}
                      variant="glow"
                      onPress={uploadSectionDoc}
                    />
                  )}
                </View>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  lockPill: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  lockPillText: {
    fontSize: 12,
    fontWeight: '700',
  },
  gateBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  gateCard: {
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 20,
  },
  gateTitle: {
    fontSize: 20,
    fontWeight: '700',
  },
  gateSub: {
    fontSize: 13,
    fontWeight: '600',
    marginTop: 4,
  },
  gateHelp: {
    fontSize: 14,
    lineHeight: 20,
    marginTop: 12,
  },
  gateActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 20,
    gap: 12,
  },
  gateUploading: {
    paddingHorizontal: 24,
    paddingVertical: 10,
  },
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
