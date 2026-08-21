/**
 * VISP — Customer Home Screen (mockup-faithful refresh).
 *
 * Composition (top to bottom):
 *   1. TopBar — pin + city / "Good [time], [Name]" + bell + initials avatar
 *   2. RoleSwitcher (only if user.role === 'both')
 *   3. Compact Emergency banner (single row, red tint)
 *   4. Hero "What needs doing?" — functional search input + quick chips,
 *      filters categories below as the user types.
 *   5. Browse categories — 4-col grid (8 by default) with "See all" toggle.
 *   6. Your active jobs — real job cards from taskService.
 *   7. Recently used — providers derived from recent activity / fallback empty.
 *
 * Motion via react-native-reanimated:
 *   - Section fade-in stagger on mount (60ms apart).
 *   - Scale-spring press on chips/tiles/avatar/IconBtn (MotionPressable helper).
 *   - Hero card dim briefly when 'both' user toggles mode.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  Keyboard,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
  ViewStyle,
} from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import type { CompositeScreenProps } from '@react-navigation/native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { useTranslation } from '../../i18n';
import { useAuthStore } from '../../stores/authStore';
import {
  Screen,
  TopBar,
  Eyebrow,
  IconBtn,
  Avatar,
  Card,
  Chip,
  Icon,
} from '../../components/visp';
import {
  useVispTheme,
  VispText,
  VispSpace,
  VispRadius,
  FontSansBold,
  FontSans,
} from '../../theme/visp';
import { EMERGENCY_ENABLED } from '../../config/features';
import RoleSwitcher from '../../components/RoleSwitcher';
import { useCompanyStore } from '../../stores/companyStore';
import { get } from '../../services/apiClient';
import taskService from '../../services/taskService';
import type {
  Job,
  RootStackParamList,
  CustomerTabParamList,
  ServiceCategory,
  ServiceTask,
} from '../../types';
import type { VispIconName } from '../../components/visp';

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

type Props = CompositeScreenProps<
  BottomTabScreenProps<CustomerTabParamList, 'Home'>,
  NativeStackScreenProps<RootStackParamList>
>;

interface RecentProvider {
  id: string;
  firstName: string;
  lastName: string;
  avatarUrl?: string | null;
  rating?: number;
  primaryCategories?: string[];
  lastJobId?: string;
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function getGreetingKey(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'homeScreen.goodMorning';
  if (hour < 17) return 'homeScreen.goodAfternoon';
  return 'homeScreen.goodEvening';
}

// Maps backend slug → editorial icon name. Exact slugs first, then we fall back
// to keyword matching against the category name so unknown backend slugs
// (e.g. `gardening_landscaping`, `moving_hauling`, `assembly`) still get a
// reasonable icon instead of the generic `grid`.
const CATEGORY_ICON_MAP: Record<string, VispIconName> = {
  // Cleaning
  cleaning: 'broom',
  house_cleaning: 'broom',
  deep_cleaning: 'broom',
  // Moving
  moving: 'truck',
  moving_hauling: 'truck',
  hauling: 'truck',
  // Handyman / assembly / repairs
  handyman: 'wrench',
  assembly: 'wrench',
  repairs: 'wrench',
  furniture: 'wrench',
  furniture_assembly: 'wrench',
  // Delivery
  delivery: 'package',
  pickup: 'package',
  // Errands
  errands: 'bolt',
  groceries: 'bolt',
  // Pet care
  pet_care: 'paw',
  petcare: 'paw',
  pets: 'paw',
  // Yard / gardening / landscaping
  yard: 'leaf',
  gardening: 'leaf',
  landscaping: 'leaf',
  gardening_landscaping: 'leaf',
  lawn: 'leaf',
  lawn_care: 'leaf',
  // Tech / beauty / tutoring / events
  tech: 'spark',
  tech_help: 'spark',
  beauty: 'spark',
  tutoring: 'book',
  event: 'cal',
  events: 'cal',
  // Emergency
  emergency: 'bolt',
};

function iconForCategory(cat: ServiceCategory): VispIconName {
  const exact = CATEGORY_ICON_MAP[cat.slug];
  if (exact) return exact;
  const name = (cat.name || '').toLowerCase();
  if (name.includes('clean')) return 'broom';
  if (name.includes('mov') || name.includes('haul')) return 'truck';
  if (
    name.includes('handy') ||
    name.includes('assembly') ||
    name.includes('repair') ||
    name.includes('furnit') ||
    name.includes('mount')
  )
    return 'wrench';
  if (name.includes('deliv') || name.includes('pickup')) return 'package';
  if (name.includes('errand') || name.includes('groc')) return 'bolt';
  if (name.includes('pet') || name.includes('dog') || name.includes('cat')) return 'paw';
  if (
    name.includes('yard') ||
    name.includes('garden') ||
    name.includes('lawn') ||
    name.includes('landsc')
  )
    return 'leaf';
  if (name.includes('tech') || name.includes('beauty')) return 'spark';
  if (name.includes('tutor')) return 'book';
  if (name.includes('event')) return 'cal';
  if (name.includes('emerg')) return 'bolt';
  return 'grid';
}

function formatScheduleStamp(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const isToday = date.toDateString() === today.toDateString();
  const isTomorrow = date.toDateString() === tomorrow.toDateString();
  const prefix = isToday ? 'TODAY' : isTomorrow ? 'TOMORROW' : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase();
  const time = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${prefix} ${time}`;
}

// ──────────────────────────────────────────────
// Motion primitives
// ──────────────────────────────────────────────

interface MotionPressableProps {
  onPress?: () => void;
  children: React.ReactNode;
  /** Layout style applied to the outer Pressable (so flex/width/aspect work). */
  style?: ViewStyle | ViewStyle[];
  pressScale?: number;
  disabled?: boolean;
}

function MotionPressable({ onPress, children, style, pressScale = 0.95, disabled }: MotionPressableProps): React.JSX.Element {
  const scale = useSharedValue(1);
  const opacity = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={style}
      onPressIn={() => {
        scale.value = withTiming(pressScale, { duration: 90, easing: Easing.out(Easing.quad) });
        opacity.value = withTiming(0.85, { duration: 90 });
      }}
      onPressOut={() => {
        scale.value = withSpring(1, { damping: 18, stiffness: 220, mass: 0.6 });
        opacity.value = withTiming(1, { duration: 140 });
      }}
    >
      <Animated.View style={animatedStyle}>{children}</Animated.View>
    </Pressable>
  );
}

const TILE_GAP = 8;

// ──────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────

const VISIBLE_CATEGORY_COUNT = 8;

function HomeScreen({ navigation }: Props): React.JSX.Element {
  const t = useVispTheme();
  const { t: tr } = useTranslation();
  const { width: screenW } = useWindowDimensions();
  const tileSize = Math.floor((screenW - VispSpace.gutter * 2 - TILE_GAP * 3) / 4);
  const user = useAuthStore((s) => s.user);
  const activeMode = useAuthStore((s) => s.activeMode);
  const setActiveMode = useAuthStore((s) => s.setActiveMode);
  const isBoth = user?.role === 'both';

  // VISP for Business: a company member sees a "Company" entry on the dashboard.
  // admin/supervisor -> the supervisor (claim/assign) screen; collaborator ->
  // their assignments screen. Non-members see nothing.
  const companyMembership = useCompanyStore((s) => s.membership);
  const isCompanySupervisor =
    companyMembership?.role === 'admin' || companyMembership?.role === 'supervisor';
  const handleCompanyPress = useCallback(() => {
    navigation.navigate(
      isCompanySupervisor ? 'CompanySupervisor' : 'CompanyAssignments',
    );
  }, [navigation, isCompanySupervisor]);

  const [categories, setCategories] = useState<ServiceCategory[]>([]);
  const [activeJobs, setActiveJobs] = useState<Job[]>([]);
  const [recentProviders, setRecentProviders] = useState<RecentProvider[]>([]);
  const [isLoadingCategories, setIsLoadingCategories] = useState(true);
  const [isLoadingJobs, setIsLoadingJobs] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [showAllCategories, setShowAllCategories] = useState(false);
  const [taskResults, setTaskResults] = useState<ServiceTask[]>([]);
  const [searchingTasks, setSearchingTasks] = useState(false);

  const greetingKey = useMemo(() => getGreetingKey(), []);
  const greeting = tr(greetingKey);
  const firstName = user?.firstName ?? '';
  const userCity = (user as any)?.city ?? 'BURLINGTON';
  const initials = ((user?.firstName?.charAt(0) ?? '') + (user?.lastName?.charAt(0) ?? '')) || 'U';

  // Hero dim animation on role switch
  const heroDim = useSharedValue(1);
  const heroDimStyle = useAnimatedStyle(() => ({ opacity: heroDim.value }));
  useEffect(() => {
    heroDim.value = withSequence(
      withTiming(0.55, { duration: 100 }),
      withTiming(1, { duration: 200 }),
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMode]);

  // ── Data fetching ────────────────────────
  const fetchCategories = useCallback(async () => {
    try {
      setIsLoadingCategories(true);
      const raw = await get<Array<{
        id: string;
        slug: string;
        name: string;
        icon_url?: string | null;
        task_count?: number;
        display_order?: number;
      }>>('/categories');
      const mapped: ServiceCategory[] = (raw ?? []).map((c) => ({
        id: c.id,
        name: c.name,
        slug: c.slug,
        icon: c.icon_url ?? '',
        taskCount: c.task_count ?? 0,
        isEmergency: false,
        sortOrder: c.display_order ?? 0,
      }));
      setCategories(mapped);
    } catch {
      // silent
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
      // silent
    } finally {
      setIsLoadingJobs(false);
    }
  }, []);

  const fetchRecentProviders = useCallback(async () => {
    try {
      // Endpoint may not exist yet — fail soft to empty list
      const data = await get<RecentProvider[]>('/users/me/recent-providers');
      setRecentProviders(Array.isArray(data) ? data : []);
    } catch {
      setRecentProviders([]);
    }
  }, []);

  const loadAll = useCallback(async () => {
    await Promise.all([fetchCategories(), fetchActiveJobs(), fetchRecentProviders()]);
  }, [fetchCategories, fetchActiveJobs, fetchRecentProviders]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await loadAll();
    setIsRefreshing(false);
  }, [loadAll]);

  // ── Nav handlers ─────────────────────────
  const handleEmergencyPress = useCallback(() => {
    navigation.navigate('EmergencyFlow');
  }, [navigation]);

  const handleCategoryPress = useCallback((category: ServiceCategory) => {
    Keyboard.dismiss();
    navigation.navigate('CategoryDetail', {
      categoryId: category.id,
      categoryName: category.name,
    });
  }, [navigation]);

  // Tapping a search result jumps straight into the booking flow for that task.
  // TaskSelection lives inside the nested CustomerNavigator (mounted by the
  // 'CategoryDetail' route), so navigate into it via nested navigation — a bare
  // navigate('TaskSelection') from this (App)navigator silently no-ops.
  const handleTaskPress = useCallback((task: ServiceTask) => {
    Keyboard.dismiss();
    setSearchQuery('');
    (navigation as any).navigate('CategoryDetail', {
      screen: 'TaskSelection',
      params: { taskId: task.id },
    });
  }, [navigation]);

  // Debounced natural-language search across the closed catalog (backend).
  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 2) {
      setTaskResults([]);
      setSearchingTasks(false);
      return;
    }
    setSearchingTasks(true);
    const handle = setTimeout(async () => {
      try {
        const results = await taskService.searchAllTasks(q);
        setTaskResults(results);
      } catch {
        setTaskResults([]);
      } finally {
        setSearchingTasks(false);
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [searchQuery]);

  const handleJobPress = useCallback((job: Job) => {
    const pendingStatuses = ['pending_match', 'draft', 'pending'];
    if (pendingStatuses.includes(job.status)) {
      Alert.alert(tr('homeScreen.searchingForProvider'), tr('homeScreen.searchingMessage'));
      return;
    }
    if (job.status === 'matched') {
      Alert.alert(tr('homeScreen.waitingForProvider'), tr('homeScreen.waitingMessage'));
      return;
    }
    if (job.status === 'pending_approval') {
      navigation.navigate('MyJobs');
      return;
    }
    navigation.navigate('JobTracking', { jobId: job.id });
  }, [navigation, tr]);

  const handleProfilePress = useCallback(() => {
    navigation.navigate('CustomerProfile' as never);
  }, [navigation]);

  // ── Derived state ────────────────────────
  const trimmedQuery = searchQuery.trim().toLowerCase();
  const filteredCategories = useMemo(() => {
    if (!trimmedQuery) return [];
    return categories
      .filter((c) =>
        c.name.toLowerCase().includes(trimmedQuery) ||
        c.slug.toLowerCase().includes(trimmedQuery),
      )
      .slice(0, 5);
  }, [categories, trimmedQuery]);

  const quickChips = useMemo(() => categories.slice(0, 4), [categories]);

  const visibleCategories = useMemo(
    () => (showAllCategories ? categories : categories.slice(0, VISIBLE_CATEGORY_COUNT)),
    [categories, showAllCategories],
  );
  const hasMoreCategories = categories.length > VISIBLE_CATEGORY_COUNT;

  const openActiveJobsCount = activeJobs.filter((j) => !['completed', 'cancelled_by_customer', 'cancelled_by_provider', 'cancelled_by_system'].includes(j.status)).length;

  // ──────────────────────────────────────────
  // Render
  // ──────────────────────────────────────────
  return (
    <Screen>
      <Animated.ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor={t.text2} />
        }
      >
        {/* — Top header — */}
        <View>
          <TopBar
            left={
              <>
                <Icon name="pin" size={14} color={t.text2} />
                <View>
                  <Eyebrow>{String(userCity).toUpperCase()}</Eyebrow>
                  <Text style={[VispText.bodyStrong, { color: t.text, fontSize: 14, marginTop: 2 }]} numberOfLines={1}>
                    {greeting}{firstName ? `, ${firstName}` : ''}
                  </Text>
                </View>
              </>
            }
            right={
              <>
                <MotionPressable pressScale={0.92}>
                  <IconBtn name="bell" />
                </MotionPressable>
                <MotionPressable onPress={handleProfilePress} pressScale={0.92}>
                  <Avatar initials={initials} />
                </MotionPressable>
              </>
            }
          />
        </View>

        {/* — Role switcher (both users) — */}
        {isBoth && (
          <View style={styles.switcher}>
            <RoleSwitcher mode={activeMode} onChange={(m) => void setActiveMode(m)} />
          </View>
        )}

        {/* — Emergency —
            Apagado en esta versión (EMERGENCY_ENABLED). No es solo que no toque
            todavía: detrás no hay catálogo — cero servicios activos de emergencia
            y cero de nivel 4—, así que la puerta llevaba a una habitación vacía.
            El bloque se queda para encenderlo con un booleano. */}
        {EMERGENCY_ENABLED ? (
          <View style={styles.sectionGutter}>
            <MotionPressable onPress={handleEmergencyPress} pressScale={0.98}>
              <View
                style={[
                  styles.emergencyBanner,
                  {
                    backgroundColor: t.isDark ? 'rgba(252,129,129,0.10)' : 'rgba(220,38,38,0.06)',
                    borderColor: t.isDark ? 'rgba(252,129,129,0.30)' : 'rgba(220,38,38,0.20)',
                  },
                ]}
              >
                <View style={[styles.emergencyIcon, { backgroundColor: t.danger }]}>
                  <Icon name="bolt" size={16} color={t.bg} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[VispText.bodyStrong, { color: t.text }]}>
                    {tr('homeScreen.emergency')}
                  </Text>
                  <Text style={[VispText.eyebrowTight, { color: t.text3, marginTop: 2 }]}>
                    {String(tr('homeScreen.emergencySub')).toUpperCase()}
                  </Text>
                </View>
                <Icon name="chevron-right" size={16} color={t.text3} />
              </View>
            </MotionPressable>
          </View>
        ) : null}

        {/* — Company (VISP for Business) — only for company members — */}
        {companyMembership ? (
          <View style={styles.sectionGutter}>
            <MotionPressable onPress={handleCompanyPress} pressScale={0.98}>
              <View
                style={[
                  styles.companyBanner,
                  { backgroundColor: t.violetDim, borderColor: t.violetLine },
                ]}
              >
                <View style={[styles.companyIcon, { backgroundColor: t.violet }]}>
                  <Icon name="briefcase" size={16} color={t.bg} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[VispText.bodyStrong, { color: t.text }]}>
                    {isCompanySupervisor
                      ? tr('companySupervisor.entry') || 'Company jobs'
                      : tr('companyAssignments.entry') || 'My assignments'}
                  </Text>
                  <Text
                    style={[VispText.eyebrowTight, { color: t.text3, marginTop: 2 }]}
                    numberOfLines={1}
                  >
                    {String(companyMembership.companyName).toUpperCase()}
                  </Text>
                </View>
                <Icon name="chevron-right" size={16} color={t.text3} />
              </View>
            </MotionPressable>
          </View>
        ) : null}

        {/* — Hero "What needs doing?" — */}
        <View style={styles.sectionGutter}>
          <Animated.View style={heroDimStyle}>
            <Card>
              <Eyebrow>{String(tr('homeScreen.needHelp')).toUpperCase()}</Eyebrow>
              <View style={styles.heroInputRow}>
                <TextInput
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  placeholder={tr('homeScreen.whatNeedsDoing')}
                  placeholderTextColor={t.text3}
                  style={[
                    styles.heroInput,
                    { color: t.text, fontFamily: FontSansBold },
                  ]}
                  returnKeyType="search"
                  autoCorrect={false}
                />
                <MotionPressable pressScale={0.92}>
                  <IconBtn name={searchQuery ? 'x' : 'plus'} onPress={() => searchQuery ? setSearchQuery('') : null} />
                </MotionPressable>
              </View>

              {/* Quick chips when no query, dropdown when typing */}
              {!searchQuery && quickChips.length > 0 && (
                <View style={styles.chipsRow}>
                  {quickChips.map((c) => (
                    <MotionPressable key={c.id} onPress={() => handleCategoryPress(c)} pressScale={0.92}>
                      <Chip>{c.name}</Chip>
                    </MotionPressable>
                  ))}
                </View>
              )}
              {searchQuery.trim().length > 0 && (
                <View style={[styles.dropdown, { borderTopColor: t.border }]}>
                  {searchingTasks && taskResults.length === 0 ? (
                    <Text style={[VispText.body, { color: t.text3, paddingVertical: 8 }]}>
                      {tr('homeScreen.searching') || 'Searching…'}
                    </Text>
                  ) : taskResults.length === 0 ? (
                    <Text style={[VispText.body, { color: t.text3, paddingVertical: 8 }]}>
                      {(tr('homeScreen.noMatches') || 'No matches for') + ` "${searchQuery.trim()}"`}
                    </Text>
                  ) : (
                    taskResults.map((task) => (
                      <MotionPressable key={task.id} onPress={() => handleTaskPress(task)} pressScale={0.97}>
                        <View style={styles.dropdownRow}>
                          <View style={[styles.dropdownIcon, { backgroundColor: t.deep, borderColor: t.border }]}>
                            <Icon name="search" size={14} color={t.text2} />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={[VispText.bodyStrong, { color: t.text, fontSize: 14 }]} numberOfLines={1}>
                              {task.name}
                            </Text>
                            <Text style={[VispText.eyebrowTight, { color: t.text3, marginTop: 2 }]}>
                              {`L${task.level}`}{task.basePrice > 0 ? ` · ~$${task.basePrice.toFixed(0)}` : ''}
                            </Text>
                          </View>
                          <Icon name="chevron-right" size={14} color={t.text3} />
                        </View>
                      </MotionPressable>
                    ))
                  )}
                </View>
              )}
            </Card>
          </Animated.View>
        </View>

        {/* — Browse categories — */}
        <View style={styles.sectionGutter}>
          <View style={styles.sectionHeader}>
            <Eyebrow>{String(tr('homeScreen.browseCategories')).toUpperCase()}</Eyebrow>
            {hasMoreCategories && (
              <Pressable onPress={() => setShowAllCategories((s) => !s)}>
                <Eyebrow color={t.text2}>
                  {String(tr(showAllCategories ? 'homeScreen.seeLess' : 'homeScreen.seeAll')).toUpperCase()}
                </Eyebrow>
              </Pressable>
            )}
          </View>
          {isLoadingCategories ? (
            <View style={styles.catGrid}>
              {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
                <View
                  key={i}
                  style={[
                    styles.catTile,
                    { width: tileSize, height: tileSize, backgroundColor: t.card, borderColor: t.border },
                  ]}
                />
              ))}
            </View>
          ) : (
            <View style={styles.catGrid}>
              {visibleCategories.map((cat) => (
                <MotionPressable
                  key={cat.id}
                  onPress={() => handleCategoryPress(cat)}
                  pressScale={0.94}
                  style={{ width: tileSize, height: tileSize }}
                >
                  <View
                    style={[
                      styles.catTile,
                      { width: tileSize, height: tileSize, backgroundColor: t.card, borderColor: t.border },
                    ]}
                  >
                    <Icon name={iconForCategory(cat)} size={22} color={t.text} />
                    <Text
                      style={[
                        VispText.label,
                        { color: t.text, marginTop: 8, textAlign: 'center', fontSize: 12, lineHeight: 14 },
                      ]}
                      numberOfLines={2}
                    >
                      {cat.name}
                    </Text>
                  </View>
                </MotionPressable>
              ))}
            </View>
          )}
        </View>

        {/* — Your active jobs — */}
        <View style={styles.sectionGutter}>
          <View style={styles.sectionHeader}>
            <Eyebrow>{String(tr('homeScreen.yourActiveJobs')).toUpperCase()}</Eyebrow>
            {!isLoadingJobs && openActiveJobsCount > 0 && (
              <Eyebrow color={t.text2}>
                {`${String(openActiveJobsCount).padStart(2, '0')} ${tr('homeScreen.openCount', { count: openActiveJobsCount }).split(' ').slice(-1)[0] ?? 'OPEN'}`.toUpperCase()}
              </Eyebrow>
            )}
          </View>
          {isLoadingJobs ? (
            <View style={[styles.skeletonRow, { backgroundColor: t.card, borderColor: t.border }]} />
          ) : activeJobs.length === 0 ? (
            <Card>
              <Text style={[VispText.body, { color: t.text3, textAlign: 'center' }]}>
                {tr('homeScreen.noActiveJobs')}
              </Text>
            </Card>
          ) : (
            <FlatList
              data={activeJobs}
              horizontal
              // flexGrow:0 obligatorio: sin altura ni flexGrow un scroll
              // horizontal se expande y roba el espacio vertical del padre.
              style={{ flexGrow: 0 }}
              showsHorizontalScrollIndicator={false}
              keyExtractor={(item) => item.id}
              ItemSeparatorComponent={() => <View style={{ width: 10 }} />}
              renderItem={({ item }) => <ActiveJobRow job={item} onPress={() => handleJobPress(item)} />}
            />
          )}
        </View>

        {/* — Recently used providers — */}
        <View style={[styles.sectionGutter, { marginBottom: 24 }]}>
          <View style={styles.sectionHeader}>
            <Eyebrow>{String(tr('homeScreen.recentlyUsed')).toUpperCase()}</Eyebrow>
          </View>
          {recentProviders.length === 0 ? (
            <Card>
              <Text style={[VispText.body, { color: t.text3, textAlign: 'center' }]}>
                {tr('homeScreen.noProvidersUsed')}
              </Text>
            </Card>
          ) : (
            <Card padding={0}>
              {recentProviders.slice(0, 5).map((p, idx, arr) => (
                <View
                  key={p.id}
                  style={[
                    styles.recentRow,
                    idx < arr.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.border },
                  ]}
                >
                  <Avatar initials={`${p.firstName?.[0] ?? ''}${p.lastName?.[0] ?? ''}`} size={36} />
                  <View style={{ flex: 1 }}>
                    <View style={styles.recentNameRow}>
                      <Text style={[VispText.bodyStrong, { color: t.text }]}>
                        {p.firstName} {p.lastName?.[0] ?? ''}{p.lastName ? '.' : ''}
                      </Text>
                      {typeof p.rating === 'number' && (
                        <View style={styles.recentRating}>
                          <Icon name="star" size={11} color={t.text2} />
                          <Text style={[VispText.bodyStrong, { color: t.text, fontSize: 12, marginLeft: 3 }]}>
                            {p.rating.toFixed(1)}
                          </Text>
                        </View>
                      )}
                    </View>
                    {p.primaryCategories && p.primaryCategories.length > 0 && (
                      <Text style={[VispText.eyebrowTight, { color: t.text3, marginTop: 2 }]} numberOfLines={1}>
                        {p.primaryCategories.join(' · ').toUpperCase()}
                      </Text>
                    )}
                  </View>
                  <MotionPressable pressScale={0.96}>
                    <View style={[styles.rehireBtn, { borderColor: t.borderStrong }]}>
                      <Text style={[VispText.chip, { color: t.text }]}>{String(tr('homeScreen.rehire')).toUpperCase()}</Text>
                    </View>
                  </MotionPressable>
                </View>
              ))}
            </Card>
          )}
        </View>

        <View style={{ height: 24 }} />
      </Animated.ScrollView>
    </Screen>
  );
}

// ──────────────────────────────────────────────
// Active job row (horizontal card)
// ──────────────────────────────────────────────

function ActiveJobRow({ job, onPress }: { job: Job; onPress: () => void }): React.JSX.Element {
  const t = useVispTheme();
  const isPending = ['pending_match', 'pending', 'draft', 'matched'].includes(job.status);
  const provider = job.provider;
  const initials = provider ? `${provider.firstName?.[0] ?? ''}${provider.lastName?.[0] ?? ''}`.toUpperCase() : null;
  const sched = formatScheduleStamp(job.scheduledAt);

  return (
    <MotionPressable onPress={onPress} pressScale={0.97}>
      <View style={[activeJobStyles.card, { backgroundColor: t.card, borderColor: t.border }]}>
        <View style={activeJobStyles.topRow}>
          <Text style={[VispText.bodyStrong, { color: t.text, fontSize: 15, flex: 1 }]} numberOfLines={1}>
            {job.taskName}
          </Text>
          <View
            style={[
              activeJobStyles.statusChip,
              {
                backgroundColor: isPending ? t.violetDim : t.deep,
                borderColor: isPending ? t.violetLine : t.border,
              },
            ]}
          >
            <Text style={[VispText.chip, { color: isPending ? t.violet : t.text2 }]} numberOfLines={1}>
              {isPending ? 'PENDING' : job.status.replace(/_/g, ' ').toUpperCase()}
            </Text>
          </View>
        </View>

        {sched ? (
          <Text style={[VispText.eyebrowTight, { color: t.text3, marginTop: 8 }]}>
            {sched}
          </Text>
        ) : null}

        <View style={activeJobStyles.metaRow}>
          {provider && initials ? (
            <View style={activeJobStyles.providerCol}>
              <Avatar initials={initials} size={28} />
              <View style={{ marginLeft: 8 }}>
                <Text style={[VispText.bodyStrong, { color: t.text, fontSize: 13 }]} numberOfLines={1}>
                  {provider.firstName} {provider.lastName?.[0] ?? ''}.
                </Text>
                {typeof provider.rating === 'number' && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 1 }}>
                    <Icon name="star" size={10} color={t.text3} />
                    <Text style={[VispText.eyebrowTight, { color: t.text3, marginLeft: 3 }]}>
                      {provider.rating.toFixed(1)}
                    </Text>
                  </View>
                )}
              </View>
            </View>
          ) : (
            <Text style={[VispText.eyebrowTight, { color: t.text3 }]}>FINDING PROVIDER…</Text>
          )}

          <Text style={[{ fontFamily: FontSansBold, fontSize: 16, fontWeight: '700', letterSpacing: -0.4, color: t.text }]}>
            ${job.estimatedPrice.toFixed(2)}
          </Text>
        </View>
      </View>
    </MotionPressable>
  );
}

// ──────────────────────────────────────────────
// Styles
// ──────────────────────────────────────────────

const styles = StyleSheet.create({
  scroll: { paddingBottom: 20 },
  switcher: { paddingHorizontal: VispSpace.gutter, marginBottom: 10, alignItems: 'center' },
  sectionGutter: { paddingHorizontal: VispSpace.gutter, marginBottom: 14 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },

  // Emergency banner
  emergencyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: VispRadius.card,
    borderWidth: 1,
  },
  emergencyIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  companyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: VispRadius.card,
    borderWidth: 1,
  },
  companyIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Hero
  heroInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
    gap: 12,
  },
  heroInput: {
    flex: 1,
    fontSize: 22,
    letterSpacing: -0.44,
    padding: 0,
    minHeight: 38,
  },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 14,
  },
  dropdown: {
    marginTop: 12,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  dropdownRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
  },
  dropdownIcon: {
    width: 30,
    height: 30,
    borderRadius: 7,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Browse grid — tile width/height supplied inline (from useWindowDimensions)
  catGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: TILE_GAP,
  },
  catTile: {
    borderRadius: VispRadius.card,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },

  // Active jobs
  skeletonRow: {
    height: 110,
    borderRadius: VispRadius.card,
    borderWidth: 1,
  },

  // Recently used
  recentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: VispSpace.card,
    paddingVertical: 14,
  },
  recentNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  recentRating: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  rehireBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
  },
});

const activeJobStyles = StyleSheet.create({
  card: {
    width: 280,
    borderRadius: VispRadius.card,
    borderWidth: 1,
    padding: 16,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  statusChip: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: VispRadius.chip,
    borderWidth: 1,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  providerCol: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
});

export default HomeScreen;
