/**
 * VISP - My Jobs Screen (Mockup-fidelity refresh)
 *
 * Matches `CustomerJobs` in newdesign/app-customer.jsx:
 *   - ScreenTitle "Jobs" / "§ Activity" with a dark "New job" pill on the right
 *   - TabPills row: Active (N) / Completed (N) / Drafts (N)
 *   - Each Active card is split: top strip with status Chip + JOB-XXXX mono id,
 *     body with title + meta + footer row with date + price.
 *   - Pending-approval (provider review) jobs surface an inline accent
 *     sub-card with Approve / Reject actions.
 *   - Recently completed list rendered with `Row` primitive.
 *
 * Business logic (fetch, navigation, approval handlers) is preserved.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { AnimatedSpinner } from '../../components/animations';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { useTranslation } from '../../i18n';
import {
  Screen,
  ScreenTitle,
  Eyebrow,
  Card,
  Chip,
  Row,
  Icon,
  VispIconName,
} from '../../components/visp';
import { useVispTheme, VispText, VispSpace, VispRadius, FontSansBold, FontMono } from '../../theme/visp';
import taskService from '../../services/taskService';
import { offerService } from '../../services/offerService';
import { paymentService } from '../../services/paymentService';
import { useAuthStore } from '../../stores/authStore';
import type { Job, RootStackParamList } from '../../types';

type NavProp = NativeStackNavigationProp<RootStackParamList>;
type TabKey = 'active' | 'expired' | 'completed' | 'drafts';

const PENDING_STATUSES = ['pending_match', 'draft', 'pending'];

// A job still waiting for a provider whose scheduled time has already passed is
// shown as "expired" (vencido) — nobody picked it up in time.
/**
 * Un trabajo abierto está muerto cuando ya no puede recibir ofertas.
 *
 * Lo decide el BACKEND, que ahora tiene un estado `expired` de verdad. Aquí se
 * calculaba, y por dos motivos estaba mal:
 *
 *   - Solo miraba la ventana de ofertas (48 h) e ignoraba la HORA DEL SERVICIO,
 *     así que un trabajo cuya cita era ayer a la 1 PM seguía saliendo activo
 *     hasta que venciera su ventana, dos días después.
 *   - Y aunque lo pintara como caducado, en la base seguía abierto: los
 *     proveedores lo veían y podían ofertar por él.
 *
 * La regla vive ahora en `offerService.job_deadline_sql`, que compara los dos
 * relojes y —esto no se puede hacer bien desde aquí— resuelve la hora de la cita
 * en la zona del área de servicio, no en la del teléfono de quien mira.
 */
function isExpiredJob(job: Job): boolean {
  return job.status === 'expired';
}

// ──────────────────────────────────────────────
// MotionPressable — scale-spring press feedback
// ──────────────────────────────────────────────

function MotionPressable({
  onPress,
  children,
  style,
  pressScale = 0.97,
  disabled,
}: {
  onPress?: () => void;
  children: React.ReactNode;
  style?: ViewStyle | ViewStyle[];
  pressScale?: number;
  disabled?: boolean;
}): React.JSX.Element {
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={style}
      onPressIn={() => {
        scale.value = withTiming(pressScale, { duration: 90, easing: Easing.out(Easing.quad) });
      }}
      onPressOut={() => {
        scale.value = withSpring(1, { damping: 18, stiffness: 220, mass: 0.6 });
      }}
    >
      <Animated.View style={[{ alignSelf: 'stretch' }, animatedStyle]}>{children}</Animated.View>
    </Pressable>
  );
}

// ──────────────────────────────────────────────
// TabPills (local helper)
// ──────────────────────────────────────────────

interface TabPillsProps {
  tabs: { key: TabKey; label: string; count: number }[];
  active: TabKey;
  onChange: (k: TabKey) => void;
}

function TabPills({ tabs, active, onChange }: TabPillsProps): React.JSX.Element {
  const t = useVispTheme();
  return (
    <ScrollView
      horizontal
      // flexGrow:0 obligatorio: sin altura ni flexGrow un scroll
      // horizontal se expande y roba el espacio vertical del padre.
      style={{ flexGrow: 0 }}
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={pillStyles.row}
    >
      {tabs.map((tab) => {
        const isActive = tab.key === active;
        return (
          <Pressable
            key={tab.key}
            onPress={() => onChange(tab.key)}
            style={[
              pillStyles.pill,
              {
                backgroundColor: isActive ? t.text : 'transparent',
                borderColor: isActive ? t.text : t.border,
              },
            ]}
          >
            <Text
              numberOfLines={1}
              style={[
                VispText.chip,
                // Explicit lineHeight + no clipping: the mono chip font gets
                // vertically clipped on iOS without it (longer FR/EN labels
                // like "COMPLETED (00)" made the whole row look collapsed).
                { color: isActive ? t.bg : t.text2, lineHeight: 14 },
              ]}
            >
              {tab.count > 0 ? `${tab.label} (${tab.count})` : tab.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const pillStyles = StyleSheet.create({
  row: {
    paddingHorizontal: VispSpace.gutter,
    paddingBottom: 14,
    gap: 8,
    flexDirection: 'row',
    // Alineación al inicio, NO centrada: mientras existió el bug del flexGrow
    // la caja quedaba alta y centrar en vertical dejaba hueco arriba y abajo.
    // Con flexGrow:0 la caja ajusta al contenido y esto la mantiene pegada.
    alignItems: 'flex-start',
  },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: VispRadius.pill,
    borderWidth: 1,
    minHeight: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function statusLabelKey(status: string): string {
  const map: Record<string, string> = {
    draft: 'myJobs.draft',
    pending_match: 'myJobs.searchingForProvider',
    matched: 'myJobs.providerAssigned',
    pending_approval: 'myJobs.providerReview',
    scheduled: 'myJobs.scheduled',
    provider_accepted: 'myJobs.providerAccepted',
    provider_en_route: 'myJobs.providerEnRoute',
    arrived: 'myJobs.providerArrived',
    in_progress: 'myJobs.inProgress',
    completed: 'common.completed',
    cancelled_by_customer: 'common.cancelled',
    cancelled_by_provider: 'common.cancelled',
    cancelled_by_system: 'common.cancelled',
    disputed: 'myJobs.disputed',
    refunded: 'myJobs.refunded',
  };
  return map[status] ?? '';
}

function isCompletedStatus(status: string): boolean {
  return [
    'completed',
    'cancelled_by_customer',
    'cancelled_by_provider',
    'cancelled_by_system',
    'disputed',
    'refunded',
  ].includes(status);
}

function isDraftStatus(status: string): boolean {
  return status === 'draft';
}

function isAccentStatus(status: string): boolean {
  return ['pending_match', 'pending_approval', 'matched'].includes(status);
}

function formatJobId(id: string): string {
  // Show short uppercase id à la JOB-2104
  const tail = id.replace(/-/g, '').slice(-4).toUpperCase();
  return `JOB-${tail || '----'}`;
}

function formatDateMeta(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d
    .toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    .toUpperCase();
}

function iconForCategory(name: string | undefined): VispIconName {
  const n = (name || '').toLowerCase();
  if (n.includes('clean')) return 'broom';
  if (n.includes('mov')) return 'truck';
  if (n.includes('hand') || n.includes('mount') || n.includes('fix')) return 'wrench';
  if (n.includes('deliv') || n.includes('pickup')) return 'package';
  if (n.includes('yard') || n.includes('garden')) return 'leaf';
  if (n.includes('pet')) return 'paw';
  if (n.includes('errand')) return 'bolt';
  return 'briefcase';
}

// ──────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────

function MyJobsScreen(): React.JSX.Element {
  const t = useVispTheme();
  const { t: tr } = useTranslation();
  const navigation = useNavigation<NavProp>();
  const stripeCustomerId = useAuthStore((s) => s.user?.stripeCustomerId);

  const [jobs, setJobs] = useState<Job[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>('active');

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

  // Group / count jobs per tab
  // Los CADUCADOS salen de "Activos" y tienen su propia pestaña.
  //
  // Mezclados, un trabajo vivo se perdía entre ocho muertos: la pantalla decía
  // "Activos (10)" cuando de verdad solo había dos esperando ofertas. El contador
  // era falso y la lista, ruido. Separarlos deja "Activos" queriendo decir lo que
  // dice, y junta en un sitio lo que hay que reponer o retirar.
  const grouped = useMemo(() => {
    const active: Job[] = [];
    const expired: Job[] = [];
    const completed: Job[] = [];
    const drafts: Job[] = [];
    for (const j of jobs) {
      if (isDraftStatus(j.status)) drafts.push(j);
      else if (isCompletedStatus(j.status)) completed.push(j);
      else if (isExpiredJob(j)) expired.push(j);
      else active.push(j);
    }
    return { active, expired, completed, drafts };
  }, [jobs]);

  const tabs = useMemo(
    () => [
      { key: 'active' as TabKey, label: tr('myJobs.active') || 'Active', count: grouped.active.length },
      // Caducados justo después de activos: son los que piden una decisión
      // (reponer o retirar), no historial que se consulta de vez en cuando.
      { key: 'expired' as TabKey, label: tr('myJobs.expired') || 'Expired', count: grouped.expired.length },
      { key: 'completed' as TabKey, label: tr('common.completed') || 'Completed', count: grouped.completed.length },
      { key: 'drafts' as TabKey, label: tr('myJobs.draft') || 'Drafts', count: grouped.drafts.length },
    ],
    [grouped, tr],
  );

  const filteredJobs = grouped[activeTab];

  const handleJobPress = useCallback(
    (job: Job) => {
      // `pending_match` va PRIMERO, y el orden es el arreglo de un bug.
      //
      // Esta rama existía desde ofertas v2 pero estaba escrita DESPUÉS del
      // `PENDING_STATUSES.includes(...)`, y esa lista contiene 'pending_match'.
      // Resultado: era código inalcanzable. El cliente pulsaba su trabajo, le
      // salía el diálogo "Searching for Provider" del flujo viejo —cuando el
      // sistema asignaba proveedor solo— y no había forma de llegar a las
      // ofertas que ya tenía esperando. El trabajo se quedaba muerto ahí.
      if (job.status === 'pending_match') {
        navigation.navigate('Offers', { jobId: job.id });
        return;
      }
      if (PENDING_STATUSES.includes(job.status)) {
        Alert.alert(tr('myJobs.searchingForProvider'), tr('homeScreen.searchingMessage'));
        return;
      }
      if (job.status === 'matched') {
        Alert.alert(tr('homeScreen.waitingForProvider'), tr('homeScreen.waitingMessage'));
        return;
      }
      navigation.navigate('JobTracking', { jobId: job.id });
    },
    [navigation, tr],
  );

  // Cuántas ofertas tiene cada trabajo abierto (ofertas v2, 2026-08-20).
  //
  // Antes aquí se cargaba "el proveedor que aceptó" para que el cliente lo
  // aprobara. Ya no hay tal cosa: el trabajo recibe VARIAS ofertas y el cliente
  // elige. Lo que hace falta en la lista es saber si ya hay alguna esperando.
  const [offerCounts, setOfferCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    const abiertos = jobs.filter((j) => j.status === 'pending_match');
    abiertos.forEach(async (job) => {
      if (offerCounts[job.id] != null) return;
      try {
        const res = await offerService.listOffers(job.id);
        setOfferCounts((prev) => ({ ...prev, [job.id]: res.count }));
      } catch {
        // Un fallo aquí no puede tumbar la lista: se queda sin el contador.
      }
    });
  }, [jobs, offerCounts]);

  const handleViewOffers = useCallback(
    (jobId: string) => {
      navigation.navigate('Offers', { jobId });
    },
    [navigation],
  );

  const handleCancelJob = useCallback(
    (jobId: string) => {
      Alert.alert(tr('myJobs.cancelJob') || 'Cancel job', tr('myJobs.cancelConfirm') || 'Are you sure you want to cancel this job request? This cannot be undone.', [
        { text: tr('common.no') || 'No', style: 'cancel' },
        {
          text: tr('myJobs.cancelJob') || 'Cancel job',
          style: 'destructive',
          onPress: async () => {
            try {
              await taskService.cancelJob(jobId);
              fetchJobs(true);
            } catch {
              Alert.alert(tr('common.error'), tr('myJobs.failedCancel') || 'Could not cancel this job. A provider may already be on the way.');
            }
          },
        },
      ]);
    },
    [fetchJobs, tr],
  );

  const handleNewJob = useCallback(() => {
    // Jump to the Home tab — the entry point to browse categories and start a
    // new job (CustomerHome → Home tab → CategoryDetail → TaskSelection → Booking).
    // Navigating to 'CustomerHome' alone is a no-op since we're already inside it,
    // so we target the nested 'Home' tab explicitly.
    navigation.navigate('CustomerHome', { screen: 'Home' } as never);
  }, [navigation]);

  // ── Active card renderer ──────────────────
  const renderActiveCard = useCallback(
    (item: Job) => {
      const isPending = PENDING_STATUSES.includes(item.status);
      const expired = isExpiredJob(item);
      const isOpen = item.status === 'pending_match';
      const accent = isAccentStatus(item.status);
      const offerCount = offerCounts[item.id] ?? 0;
      const labelKey = statusLabelKey(item.status);
      const statusText = expired
        ? (tr('myJobs.expired') || 'Expired').toUpperCase()
        : (labelKey ? tr(labelKey) : item.status.replace(/_/g, ' ')).toUpperCase();
      const city = item.address?.city ? `, ${item.address.city}` : '';
      const meta = [item.address?.street, city, item.categoryName?.toUpperCase()]
        .filter(Boolean)
        .join(' · ');

      return (
        <MotionPressable
          key={item.id}
          onPress={() => handleJobPress(item)}
          style={{ marginBottom: 10 }}
        >
          <Card accent={accent} padding={0}>
            {/* Top strip — status chip + mono job id */}
            <View style={[styles.cardStrip, { borderBottomColor: t.border }]}>
              <View style={styles.chipRow}>
                {isPending && !expired ? <AnimatedSpinner size={10} color={t.violet} style={{ marginRight: 6 }} /> : null}
                {expired ? (
                  <View style={[styles.expiredChip, { borderColor: t.danger }]}>
                    <Text style={[VispText.chip, { color: t.danger }]}>{statusText}</Text>
                  </View>
                ) : (
                  <Chip accent={accent} dark={!accent}>
                    {statusText}
                  </Chip>
                )}
              </View>
              <Text style={[VispText.eyebrow, { color: t.text3 }]}>{formatJobId(item.id)}</Text>
            </View>

            {/* Body */}
            <View style={styles.cardBody}>
              <Text
                style={[VispText.bodyStrong, styles.cardTitle, { color: t.text }]}
                numberOfLines={1}
              >
                {item.taskName || tr('myJobs.job')}
              </Text>
              {meta ? (
                <Text style={[VispText.eyebrow, { color: t.text3, marginBottom: 12 }]} numberOfLines={1}>
                  {meta}
                </Text>
              ) : null}

              {/* Footer — date eyebrow + price */}
              <View style={styles.cardFooter}>
                <Text style={[VispText.eyebrow, { color: t.text3 }]}>{formatDateMeta(item.createdAt)}</Text>
                {item.estimatedPrice > 0 ? (
                  <Text
                    style={{
                      fontFamily: FontMono,
                      fontSize: 14,
                      fontWeight: '700',
                      color: t.text,
                    }}
                  >
                    ${item.estimatedPrice.toFixed(2)}
                  </Text>
                ) : null}
              </View>

              {/* Por qué caducó.
                  "EXPIRED" a secas no explica nada y deja al cliente pensando que
                  falló la app. Decir que nadie ofertó en 48 h convierte la etiqueta
                  en información con la que puede decidir: reponerlo o retirarlo. */}
              {expired ? (
                <Text style={[VispText.body, { color: t.text3, marginTop: 4, marginBottom: 4 }]}>
                  {tr('myJobs.expiredWhy') ||
                    'No provider offered on this job within 48 hours.'}
                </Text>
              ) : null}

              {/* Cancel — allowed while no provider is assigned yet (pending /
                  expired). Backend guards the transition; we only offer it here. */}
              {isPending ? (
                <Pressable
                  onPress={() => handleCancelJob(item.id)}
                  style={[styles.cancelBtn, { borderColor: t.danger }]}
                  hitSlop={8}
                >
                  <Text style={[VispText.chip, { color: t.danger }]}>
                    {expired ? (tr('myJobs.removeJob') || 'Remove') : (tr('myJobs.cancelJob') || 'Cancel job')}
                  </Text>
                </Pressable>
              ) : null}
            </View>

            {/* Ofertas recibidas (ofertas v2, 2026-08-20).

                Aquí vivía la tarjeta de "un proveedor quiere tu trabajo,
                apruébalo o recházalo". Ese flujo desapareció: el trabajo recibe
                VARIAS ofertas y el cliente compara y elige en su propia pantalla.
                Aprobar al primero que llegaba era decidir sin alternativas. */}
            {isOpen && offerCount > 0 ? (
              <Pressable
                onPress={() => handleViewOffers(item.id)}
                style={[styles.providerCard, { borderTopColor: t.border, backgroundColor: t.violetDim }]}
              >
                <Eyebrow color={t.violet}>
                  {(tr('myJobs.offersReceived') || 'Offers received').toUpperCase()}
                </Eyebrow>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
                  <Text style={[VispText.bodyStrong, { color: t.text }]}>
                    {offerCount} {offerCount === 1
                      ? (tr('myJobs.offerSingular') || 'offer')
                      : (tr('myJobs.offerPlural') || 'offers')}
                  </Text>
                  <Text style={[VispText.chip, { color: t.violet }]}>
                    {(tr('myJobs.viewOffers') || 'Compare and choose')} →
                  </Text>
                </View>
              </Pressable>
            ) : null}
          </Card>
        </MotionPressable>
      );
    },
    [handleJobPress, handleViewOffers, offerCounts, t, tr],
  );

  // ── Completed / drafts row renderer ──────
  const renderHistoryRow = useCallback(
    (item: Job, isLast: boolean) => {
      const labelKey = statusLabelKey(item.status);
      const statusText = (labelKey ? tr(labelKey) : item.status.replace(/_/g, ' ')).toUpperCase();
      const date = formatDateMeta(item.completedAt || item.updatedAt || item.createdAt);
      const meta = [date, item.provider ? `${item.provider.firstName?.toUpperCase()} ${item.provider.lastName?.charAt(0).toUpperCase() || ''}.` : null]
        .filter(Boolean)
        .join(' · ');
      const price = (item.finalPrice ?? item.estimatedPrice) || 0;
      return (
        <View key={item.id} style={isLast ? undefined : [styles.rowDivider, { borderBottomColor: t.border }]}>
          <Row
            icon={iconForCategory(item.categoryName)}
            title={item.taskName || statusText}
            sub={meta}
            chevron={false}
            onPress={() => handleJobPress(item)}
            trailing={
              <View style={{ alignItems: 'flex-end' }}>
                {price > 0 ? (
                  <Text style={{ fontFamily: FontMono, fontSize: 13, fontWeight: '700', color: t.text }}>
                    ${price.toFixed(0)}
                  </Text>
                ) : null}
                <Text style={[VispText.eyebrow, { color: t.text3, marginTop: 2 }]}>{statusText}</Text>
              </View>
            }
          />
        </View>
      );
    },
    [handleJobPress, t, tr],
  );

  // ── Empty / loading ──────────────────────
  if (isLoading) {
    return (
      <Screen>
        <View style={styles.loading}>
          <AnimatedSpinner size={32} color={t.violet} />
          <Text style={[VispText.body, { color: t.text2, marginTop: 12 }]}>
            {tr('myJobs.loadingJobs')}
          </Text>
        </View>
      </Screen>
    );
  }

  const newJobButton = (
    <MotionPressable onPress={handleNewJob}>
      <View style={[styles.newJobPill, { backgroundColor: t.text }]}>
        <Icon name="plus" size={14} color={t.bg} active />
        <Text style={[VispText.bodyStrong, { color: t.bg, fontSize: 12 }]}>
          {tr('myJobs.newJob') || 'New job'}
        </Text>
      </View>
    </MotionPressable>
  );

  return (
    <Screen>
      <ScreenTitle title={tr('myJobs.title') || 'Jobs'} sub="§ Activity" right={newJobButton} />

      <TabPills tabs={tabs} active={activeTab} onChange={setActiveTab} />

      <FlatList
        data={filteredJobs}
        keyExtractor={(item) => item.id}
        renderItem={({ item, index }) =>
          activeTab === 'active' || activeTab === 'expired'
            ? renderActiveCard(item)
            : renderHistoryRow(item, index === filteredJobs.length - 1)
        }
        contentContainerStyle={filteredJobs.length === 0 ? styles.emptyList : styles.list}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={[VispText.headlineMid, { color: t.text, textAlign: 'center', marginBottom: 8 }]}>
              {activeTab === 'completed'
                ? tr('myJobs.noPastJobs')
                : activeTab === 'drafts'
                  ? tr('myJobs.draft') || 'No drafts'
                  : activeTab === 'expired'
                    ? tr('myJobs.noExpired') || 'Nothing expired'
                    : tr('myJobs.noActiveJobs')}
            </Text>
            <Text style={[VispText.body, { color: t.text2, textAlign: 'center' }]}>
              {activeTab === 'completed'
                ? tr('myJobs.pastJobsAppear')
                : activeTab === 'expired'
                  ? tr('myJobs.expiredEmptyBody') ||
                    'Jobs that nobody offered on within 48 hours end up here.'
                  : tr('myJobs.bookService')}
            </Text>
          </View>
        }
        refreshControl={
          <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor={t.text2} />
        }
        showsVerticalScrollIndicator={false}
      />
    </Screen>
  );
}

// ──────────────────────────────────────────────
// Styles
// ──────────────────────────────────────────────

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  list: { paddingHorizontal: VispSpace.gutter, paddingTop: 4, paddingBottom: 60 },
  emptyList: { flex: 1, justifyContent: 'center', paddingHorizontal: VispSpace.gutter },

  empty: { alignItems: 'center', justifyContent: 'center' },

  newJobPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },

  cardStrip: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  chipRow: { flexDirection: 'row', alignItems: 'center', flexShrink: 1 },

  cardBody: { padding: 16 },
  cardTitle: { fontSize: 16, marginBottom: 6, letterSpacing: -0.24 },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
  },
  expiredChip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  cancelBtn: {
    alignSelf: 'flex-start',
    marginTop: 12,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },

  providerCard: {
    padding: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  providerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 10,
    marginBottom: 12,
  },
  providerLevel: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  approvalButtons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  approveBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 1,
  },

  rowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});

export default MyJobsScreen;
