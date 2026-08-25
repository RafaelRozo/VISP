/**
 * VISP - Active Job Screen (Mockup-fidelity refresh)
 *
 * Matches `ProviderMyWork` in newdesign/app-provider.jsx:
 *   - ScreenTitle "My Work" / "§ Scheduled jobs" with a calendar IconBtn
 *   - TabPills: Today (N) / This Week (N) / Calendar
 *   - Today block: time eyebrow + job card (title, "NEXT" chip if next, customer
 *     name eyebrow, "Navigate" primary + msg/phone icon buttons + price).
 *   - Upcoming this week: Row list (icon=cal, title, sub, price trailing).
 *
 * The active job state machine (en_route → in_progress → completed) is
 * preserved — when there is an `activeJob` we render it as the "next" card at
 * the top with the corresponding action button. Scheduled jobs are pulled
 * from `providerStore.scheduledJobs` (already wired up by fetchSchedule).
 *
 * Photos / Mapbox map / detailed legal acknowledgment from the legacy screen
 * are kept available through navigation to JobTracking — this screen is the
 * scheduling surface; the deep job view is JobTrackingScreen.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Pressable,
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
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import MapboxGL from '@rnmapbox/maps';

import { Config } from '../../services/config';
import { watchPosition, clearWatch, pushUserLocation, DevicePosition } from '../../services/geolocationService';
import { useTranslation } from '../../i18n';
import {
  Screen,
  ScreenTitle,
  Eyebrow,
  Chip,
  Row,
  IconBtn,
  Icon,
  VispIconName,
} from '../../components/visp';
import CancelWithReasonModal from '../../components/CancelWithReasonModal';
import { useVispTheme, VispText, VispSpace, VispRadius, FontSansBold, FontMono } from '../../theme/visp';
import { AnimatedSpinner } from '../../components/animations';
import { useProviderStore } from '../../stores/providerStore';
import { Job, JobStatus, ProviderTabParamList, ScheduledJob } from '../../types';
import { pickImage } from '../../services/imagePickerService';
import { offerService, type MaterialReceipt } from '../../services/offerService';

// Idempotent — JobTrackingScreen may also call this; Mapbox swallows duplicates.
MapboxGL.setAccessToken(Config.mapboxAccessToken);

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

type ActiveJobRoute = RouteProp<ProviderTabParamList, 'ActiveJob'>;
// The screen can also push to JobTracking which lives on the RootStack.
// Use `any` to avoid stitching multiple param lists together for one navigate.
type ActiveJobNav = NativeStackNavigationProp<any, 'ActiveJob'>;

type TabKey = 'today' | 'week' | 'calendar';

// ──────────────────────────────────────────────
// JobRouteMap — Mapbox map shown above the active job card when the provider
// is en route or working. Subscribes to expo-location for live updates,
// fetches the polyline from Mapbox Directions, and (throttled) pushes the
// provider's GPS to the backend so the customer's JobTrackingScreen sees it.
// ──────────────────────────────────────────────

function JobRouteMap({ job }: { job: Job }): React.JSX.Element | null {
  const t = useVispTheme();
  const customerLat = job.address?.latitude;
  const customerLng = job.address?.longitude;

  const [providerLat, setProviderLat] = useState<number | null>(null);
  const [providerLng, setProviderLng] = useState<number | null>(null);
  const [routeCoords, setRouteCoords] = useState<[number, number][]>([]);
  const lastSavedRef = React.useRef<number>(0);

  // Subscribe to device GPS while this map is mounted.
  useEffect(() => {
    let subscription: any = null;
    let mounted = true;
    (async () => {
      try {
        subscription = await watchPosition((pos: DevicePosition) => {
          if (!mounted) return;
          setProviderLat(pos.latitude);
          setProviderLng(pos.longitude);
          // Throttle backend pushes to once every 10s so the customer's
          // tracking screen sees movement without thrashing the API.
          const now = Date.now();
          if (now - lastSavedRef.current > 10000) {
            lastSavedRef.current = now;
            pushUserLocation(pos.latitude, pos.longitude);
          }
        });
      } catch (err) {
        console.warn('[JobRouteMap] watchPosition failed', err);
      }
    })();
    return () => {
      mounted = false;
      if (subscription) clearWatch(subscription);
    };
  }, []);

  // Fetch route from Mapbox Directions whenever either endpoint moves.
  useEffect(() => {
    if (providerLat == null || providerLng == null || customerLat == null || customerLng == null) return;
    let cancelled = false;
    (async () => {
      try {
        const url =
          `https://api.mapbox.com/directions/v5/mapbox/driving/` +
          `${providerLng},${providerLat};${customerLng},${customerLat}` +
          `?geometries=geojson&overview=full&access_token=${Config.mapboxAccessToken}`;
        const resp = await fetch(url);
        const json = await resp.json();
        if (cancelled) return;
        if (json.routes && json.routes.length > 0) {
          setRouteCoords(json.routes[0].geometry.coordinates as [number, number][]);
        }
      } catch (err) {
        console.warn('[JobRouteMap] route fetch failed', err);
      }
    })();
    return () => { cancelled = true; };
  }, [providerLat, providerLng, customerLat, customerLng]);

  const routeGeoJSON = useMemo(() => {
    if (routeCoords.length < 2) return null;
    return {
      type: 'Feature' as const,
      geometry: { type: 'LineString' as const, coordinates: routeCoords },
      properties: {},
    };
  }, [routeCoords]);

  if (customerLat == null || customerLng == null) return null;

  // Camera centers on midpoint between provider and customer, or just customer
  // if we don't have a fix yet.
  const centerLng = providerLng != null ? (providerLng + customerLng) / 2 : customerLng;
  const centerLat = providerLat != null ? (providerLat + customerLat) / 2 : customerLat;

  return (
    <View style={mapStyles.card}>
      <MapboxGL.MapView style={mapStyles.view} styleURL={MapboxGL.StyleURL.Street}>
        <MapboxGL.Camera
          centerCoordinate={[centerLng, centerLat]}
          zoomLevel={12}
          animationMode="flyTo"
          animationDuration={1000}
        />
        {routeGeoJSON && (
          <MapboxGL.ShapeSource id="active-job-route-src" shape={routeGeoJSON}>
            <MapboxGL.LineLayer
              id="active-job-route-line"
              style={{ lineColor: t.violet, lineWidth: 4, lineCap: 'round', lineJoin: 'round' }}
            />
          </MapboxGL.ShapeSource>
        )}
        <MapboxGL.MarkerView id="active-customer-marker" coordinate={[customerLng, customerLat]}>
          <View style={[mapStyles.customerMarker, { borderColor: t.violet }]}>
            <View style={[mapStyles.customerMarkerInner, { backgroundColor: t.violet }]} />
          </View>
        </MapboxGL.MarkerView>
        {providerLat != null && providerLng != null && (
          <MapboxGL.MarkerView id="active-provider-marker" coordinate={[providerLng, providerLat]}>
            <View style={[mapStyles.providerMarker, { backgroundColor: t.text }]}>
              <Text style={[mapStyles.providerMarkerText, { color: t.bg }]}>V</Text>
            </View>
          </MapboxGL.MarkerView>
        )}
      </MapboxGL.MapView>
    </View>
  );
}

const mapStyles = StyleSheet.create({
  card: {
    height: 240,
    width: '100%',
    borderRadius: 14,
    overflow: 'hidden',
    marginBottom: 4,
  },
  // Explicit width/height — a flex:1 Mapbox MapView inside a ScrollView renders
  // black on iOS until it gets concrete dimensions (matches JobTrackingScreen).
  view: { width: '100%', height: '100%' },
  customerMarker: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 3,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  customerMarkerInner: { width: 10, height: 10, borderRadius: 5 },
  providerMarker: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  providerMarkerText: { fontWeight: '800', fontSize: 13 },
});

// ──────────────────────────────────────────────
// MotionPressable
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
// TabPills
// ──────────────────────────────────────────────

interface TabPillsProps {
  tabs: { key: TabKey; label: string; count?: number }[];
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
        const label = tab.count != null ? `${tab.label} (${String(tab.count).padStart(2, '0')})` : tab.label;
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
            <Text style={[VispText.chip, { color: isActive ? t.bg : t.text2 }]}>{label}</Text>
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
  },
});

// ──────────────────────────────────────────────
// State machine helpers (preserved from legacy)
// ──────────────────────────────────────────────

const STATUS_FLOW_LABELS: Record<string, string> = {
  scheduled: 'Scheduled',
  accepted: 'Accepted',
  en_route: 'En Route',
  in_progress: 'In Progress',
  completed: 'Completed',
};

const NEXT_STATUS_ACTIONS: Record<string, { label: string; next: JobStatus }> = {
  scheduled: { label: 'Start Route', next: 'en_route' },
  accepted: { label: 'Start Route', next: 'en_route' },
  en_route: { label: "I've Arrived — Start Job", next: 'in_progress' },
  in_progress: { label: 'Complete Job', next: 'completed' },
};

function customerInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function formatTimeHHMM(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '—';
  }
}

function formatDayShort(iso: string | null | undefined): string {
  if (!iso) return 'TBD';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString([], { weekday: 'short' }).toUpperCase();
  } catch {
    return 'TBD';
  }
}

function formatDurationMin(minutes: number | null | undefined): string {
  if (!minutes) return '—';
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function iconForCategory(name: string | undefined): VispIconName {
  const n = (name || '').toLowerCase();
  if (n.includes('clean')) return 'broom';
  if (n.includes('mov') || n.includes('truck')) return 'truck';
  if (n.includes('hand') || n.includes('mount') || n.includes('fix') || n.includes('plumb')) return 'wrench';
  if (n.includes('deliv') || n.includes('pickup') || n.includes('ikea')) return 'package';
  if (n.includes('yard') || n.includes('garden') || n.includes('leaf')) return 'leaf';
  if (n.includes('pet')) return 'paw';
  if (n.includes('errand')) return 'bolt';
  return 'cal';
}

function isToday(iso: string | null | undefined): boolean {
  if (!iso) return false;
  try {
    const d = new Date(iso);
    const now = new Date();
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  } catch {
    return false;
  }
}

function isThisWeek(iso: string | null | undefined): boolean {
  if (!iso) return false;
  try {
    const d = new Date(iso);
    const now = new Date();
    const diff = d.getTime() - now.getTime();
    return diff >= 0 && diff < 7 * 24 * 60 * 60 * 1000;
  } catch {
    return false;
  }
}

// ──────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────

export default function ActiveJobScreen(): React.JSX.Element {
  const t = useVispTheme();
  const { t: tr } = useTranslation();
  const route = useRoute<ActiveJobRoute>();
  const navigation = useNavigation<ActiveJobNav>();
  const [cancelOpen, setCancelOpen] = useState(false);
  const {
    activeJob,
    scheduledJobs,
    startNavigation,
    arriveAtJob,
    completeJob,
    fetchActiveJob,
    fetchSchedule,
    error,
  } = useProviderStore();

  const [isUpdating, setIsUpdating] = useState(false);
  const [legalAcknowledged, setLegalAcknowledged] = useState(false);

  // ── Material (migraciones 043/045) ──────────────────────────────────────
  // El proveedor compra y adelanta el dinero; la factura es lo ÚNICO que separa
  // un gasto real de un número escrito a mano, y sin ella no se le reembolsa.
  const [materials, setMaterials] = useState<{
    requested: boolean;
    agreedCents: number | null;
    spentCents: number;
  } | null>(null);
  const [receipts, setReceipts] = useState<MaterialReceipt[]>([]);
  const [uploadingReceipt, setUploadingReceipt] = useState(false);

  const loadMaterials = useCallback(async (id: string) => {
    try {
      const [estado, lista] = await Promise.all([
        offerService.getProviderJobMaterials(id),
        offerService.listProviderReceipts(id),
      ]);
      setMaterials(estado);
      setReceipts(lista);
    } catch {
      // Un fallo aquí no puede impedir trabajar: la sección simplemente no sale.
    }
  }, []);

  const handleAddReceipt = useCallback(async () => {
    const job = activeJob;
    if (!job) return;

    // Cámara o galería: el proveedor tiene el recibo en la mano al salir de la
    // tienda, no en el carrete.
    const asset = await pickImage({ quality: 0.6 });
    if (!asset) return;

    // El importe se pide aparte: la foto prueba QUÉ se compró, pero lo que se
    // reembolsa es lo que el proveedor declara, y tiene que poder corregirlo.
    Alert.prompt?.(
      tr('activeJob.receiptAmountTitle') || 'How much did you pay?',
      tr('activeJob.receiptAmountBody') || 'Enter the total on the receipt, in dollars.',
      [
        { text: tr('common.cancel') || 'Cancel', style: 'cancel' },
        {
          text: tr('common.save') || 'Save',
          onPress: async (valor?: string) => {
            const monto = Math.round(parseFloat((valor || '').replace(',', '.')) * 100);
            if (!Number.isFinite(monto) || monto <= 0) {
              Alert.alert(tr('activeJob.receiptAmountInvalid') || 'Enter a valid amount.');
              return;
            }
            setUploadingReceipt(true);
            try {
              await offerService.uploadMaterialReceipt(job.id, {
                amountCents: monto,
                fileUri: asset.uri,
              });
              await loadMaterials(job.id);
            } catch {
              Alert.alert(
                tr('activeJob.receiptFailedTitle') || 'Could not upload the receipt',
                tr('activeJob.receiptFailedBody') || 'Check your connection and try again.',
              );
            } finally {
              setUploadingReceipt(false);
            }
          },
        },
      ],
      'plain-text',
      '',
      'decimal-pad',
    );
  }, [activeJob, loadMaterials, tr]);
  const [activeTab, setActiveTab] = useState<TabKey>('today');

  const jobId = route.params?.jobId;

  useEffect(() => {
    if (activeJob?.id) loadMaterials(activeJob.id);
  }, [activeJob?.id, loadMaterials]);

  useEffect(() => {
    if (jobId && (!activeJob || activeJob.id !== jobId)) {
      fetchActiveJob(jobId);
    }
  }, [activeJob, jobId, fetchActiveJob]);

  useEffect(() => {
    fetchSchedule();
  }, [fetchSchedule]);

  // Attempt to start the job (en_route → in_progress). The backend enforces two
  // preconditions and returns a 409 with a clear reason when they aren't met:
  //   • the scheduled time hasn't arrived yet, or
  //   • the provider isn't at the customer's location (GPS geofence).
  // arriveAtJob stores that reason in `error`; surface it as an Alert so the
  // provider knows exactly why they can't start and can retry once on-site/on-time.
  const doArrive = useCallback(async (id: string) => {
    await arriveAtJob(id);
    const err = useProviderStore.getState().error;
    if (err) {
      Alert.alert("You can't start this job yet", err, [{ text: 'OK' }]);
    }
  }, [arriveAtJob]);

  // ── Status update flow (preserved) ──
  const handleStatusUpdate = useCallback(async () => {
    if (!activeJob) return;
    const action = NEXT_STATUS_ACTIONS[activeJob.status];
    if (!action) return;

    if (action.next === 'in_progress' && !legalAcknowledged) {
      Alert.alert(
        'Legal Acknowledgment Required',
        `Before starting work, please confirm:\n\n` +
          `1. I understand this task is limited to "${activeJob.taskName}" only.\n\n` +
          `2. I am acting as an independent contractor.\n\n` +
          `Additional services cannot be performed without a new job request.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'I Acknowledge & Start Job',
            onPress: async () => {
              setLegalAcknowledged(true);
              setIsUpdating(true);
              try {
                await doArrive(activeJob.id);
              } finally {
                setIsUpdating(false);
              }
            },
          },
        ],
      );
      return;
    }

    // Cerrar un trabajo con material sin haber subido la factura significa
    // regalar ese dinero: el reembolso sale de las facturas, no del acuerdo. Se
    // avisa y se deja seguir — puede que la haya subido desde otro sitio o que
    // decida no cobrarlo—, pero nunca en silencio.
    if (
      action.next === 'completed' &&
      materials?.requested &&
      receipts.filter((r) => !r.voided).length === 0
    ) {
      Alert.alert(
        tr('activeJob.noReceiptTitle') || 'No receipt uploaded',
        tr('activeJob.noReceiptBody') ||
          "This job includes materials you paid for. Without a receipt you won't be reimbursed.",
        [
          { text: tr('activeJob.addReceipt') || 'Add receipt', onPress: handleAddReceipt },
          {
            text: tr('activeJob.completeAnyway') || 'Complete anyway',
            style: 'destructive',
            onPress: async () => {
              setIsUpdating(true);
              try {
                await completeJob(activeJob.id);
                navigation.goBack();
              } finally {
                setIsUpdating(false);
              }
            },
          },
          { text: tr('common.cancel') || 'Cancel', style: 'cancel' },
        ],
      );
      return;
    }

    const confirmMessage =
      action.next === 'completed'
        ? 'Confirm that the job is complete. The customer will be notified and payment will be processed.'
        : `Update job status to "${STATUS_FLOW_LABELS[action.next]}"?`;

    Alert.alert('Update Status', confirmMessage, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Confirm',
        onPress: async () => {
          setIsUpdating(true);
          try {
            if (action.next === 'en_route') await startNavigation(activeJob.id);
            else if (action.next === 'in_progress') await doArrive(activeJob.id);
            else if (action.next === 'completed') {
              await completeJob(activeJob.id);
              navigation.goBack();
            }
          } finally {
            setIsUpdating(false);
          }
        },
      },
    ]);
  }, [activeJob, startNavigation, arriveAtJob, completeJob, doArrive, navigation,
      legalAcknowledged, materials, receipts, handleAddReceipt, tr]);

  // ── Open deep view ──
  const handleOpenJob = useCallback(
    (id: string) => {
      navigation.navigate('JobTracking' as any, { jobId: id });
    },
    [navigation],
  );

  // ── Today/week grouping ──
  const today: ScheduledJob[] = useMemo(
    () => (scheduledJobs || []).filter((j) => isToday(j.scheduledAt)),
    [scheduledJobs],
  );
  const week: ScheduledJob[] = useMemo(
    () => (scheduledJobs || []).filter((j) => isThisWeek(j.scheduledAt) && !isToday(j.scheduledAt)),
    [scheduledJobs],
  );

  // If activeJob is in progress / en_route, prepend it as the live "today" item.
  const liveTodayJob: Job | null = useMemo(() => {
    if (!activeJob) return null;
    if (['en_route', 'in_progress', 'scheduled', 'accepted'].includes(activeJob.status)) {
      return activeJob;
    }
    return null;
  }, [activeJob]);

  const tabs: TabPillsProps['tabs'] = [
    { key: 'today', label: tr('schedule.today') || 'Today', count: today.length + (liveTodayJob ? 1 : 0) },
    { key: 'week', label: tr('schedule.thisWeek') || 'This Week', count: week.length },
    { key: 'calendar', label: tr('nav.schedule') || 'Calendar' },
  ];

  return (
    <Screen>
      <ScreenTitle
        title={tr('schedule.myWork') || 'My Work'}
        sub="§ Scheduled jobs"
        right={<IconBtn name="cal" />}
        onBack={navigation.canGoBack() ? () => navigation.goBack() : undefined}
      />

      <TabPills tabs={tabs} active={activeTab} onChange={setActiveTab} />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}
      >
        {/* TODAY */}
        {activeTab === 'today' ? (
          <>
            <Eyebrow>
              {(tr('schedule.today') || 'Today').toUpperCase()} ·{' '}
              {new Date().toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase()}
            </Eyebrow>

            {/* Always show the route-to-destination map for the active job
                (any assigned status), never gated to en_route/in_progress.
                JobRouteMap self-guards against missing coordinates so it can
                never render a black 0,0 ocean tile. */}
            {liveTodayJob ? (
              <JobRouteMap job={liveTodayJob} />
            ) : null}

            {liveTodayJob ? (
              <View style={{ marginTop: 12 }}>
                <TimeJobCard
                  time={formatTimeHHMM(liveTodayJob.scheduledAt || liveTodayJob.startedAt)}
                  duration={formatDurationMin(liveTodayJob.estimatedDurationMinutes)}
                  title={liveTodayJob.taskName}
                  customerName="Customer"
                  location={`${liveTodayJob.address?.city || ''}${liveTodayJob.address?.street ? ' · ' + liveTodayJob.address.street : ''}`.trim().toUpperCase() || 'TBD'}
                  price={`$${(liveTodayJob.finalPrice ?? liveTodayJob.estimatedPrice ?? 0).toFixed(0)}`}
                  status={liveTodayJob.status}
                  actionLabel={NEXT_STATUS_ACTIONS[liveTodayJob.status]?.label || 'Open'}
                  onAction={handleStatusUpdate}
                  onDetails={() => handleOpenJob(liveTodayJob.id)}
                  isLoading={isUpdating}
                  isNext
                />
                {/* ── Material (migraciones 043/045) ─────────────────
                    El proveedor adelanta el dinero de su bolsillo, así que esto
                    va EN el trabajo en curso y no escondido en un menú: la
                    factura es lo único que separa un gasto real de un número
                    escrito a mano, y sin ella no hay reembolso. */}
                {materials?.requested ? (
                  <View
                    style={{
                      marginTop: 12,
                      padding: 14,
                      borderRadius: VispRadius.card,
                      borderWidth: 1,
                      borderColor: t.violetLine,
                      backgroundColor: t.violetDim,
                    }}
                  >
                    <Eyebrow color={t.violet}>
                      {(tr('activeJob.materials') || 'Materials').toUpperCase()}
                    </Eyebrow>
                    <View
                      style={{
                        flexDirection: 'row',
                        justifyContent: 'space-between',
                        marginTop: 8,
                      }}
                    >
                      <Text style={[VispText.body, { color: t.text2 }]}>
                        {tr('activeJob.materialsSpent') || 'Spent'}
                      </Text>
                      <Text style={[VispText.bodyStrong, { color: t.text }]}>
                        ${(materials.spentCents / 100).toFixed(2)}
                        {materials.agreedCents != null ? (
                          <Text style={{ color: t.text3 }}>
                            {` / $${(materials.agreedCents / 100).toFixed(2)}`}
                          </Text>
                        ) : null}
                      </Text>
                    </View>

                    {/* Pasarse de lo acordado no se bloquea, pero se dice: lo tendrá
                        que aprobar el cliente antes de que se cobre. */}
                    {materials.agreedCents != null &&
                    materials.spentCents > materials.agreedCents ? (
                      <Text style={[VispText.eyebrow, { color: t.danger, marginTop: 6 }]}>
                        {tr('activeJob.materialsOver') ||
                          'Above what you quoted — the customer has to approve the difference.'}
                      </Text>
                    ) : null}

                    {receipts
                      .filter((r) => !r.voided)
                      .map((r) => (
                        <Text
                          key={r.receiptId}
                          style={[VispText.eyebrow, { color: t.text3, marginTop: 6 }]}
                        >
                          {`$${(r.amountCents / 100).toFixed(2)}`}
                          {r.merchant ? ` · ${r.merchant}` : ''}
                        </Text>
                      ))}

                    <MotionPressable
                      onPress={handleAddReceipt}
                      disabled={uploadingReceipt}
                      style={{
                        marginTop: 12,
                        paddingVertical: 10,
                        borderRadius: 6,
                        borderWidth: 1,
                        borderColor: t.violet,
                        alignItems: 'center',
                      }}
                    >
                      <Text style={[VispText.chip, { color: t.violet }]}>
                        {uploadingReceipt
                          ? tr('common.loading') || 'Uploading…'
                          : tr('activeJob.addReceipt') || '+ Add receipt'}
                      </Text>
                    </MotionPressable>
                  </View>
                ) : null}

                {/* Cancelar con motivo. Solo con un trabajo asignado: antes de eso
                    no hay contraparte a la que reportar. */}
                <MotionPressable
                  onPress={() => setCancelOpen(true)}
                  style={{
                    marginTop: 10,
                    borderWidth: 1,
                    borderColor: t.danger + '55',
                    borderRadius: VispRadius.card,
                    paddingVertical: 12,
                    alignItems: 'center',
                  }}
                >
                  <Text style={[VispText.chip, { color: t.danger }]}>
                    {tr('cancelReason.openProvider') || "Can't do this job — cancel"}
                  </Text>
                </MotionPressable>
              </View>
            ) : null}

            {today.length === 0 && !liveTodayJob ? (
              <View style={styles.empty}>
                <Text style={[VispText.body, { color: t.text2, textAlign: 'center' }]}>
                  {tr('schedule.noJobsToday') || 'No jobs scheduled today.'}
                </Text>
              </View>
            ) : null}

            {today.length > 0 ? (
              <View style={{ marginTop: liveTodayJob ? 0 : 12, marginBottom: 18 }}>
                {today.map((j, idx) => (
                  <TimeJobCard
                    key={j.id}
                    time={formatTimeHHMM(j.scheduledAt)}
                    duration={formatDurationMin(j.estimatedDurationMinutes)}
                    title={j.taskName}
                    customerName={j.customerArea || 'Customer'}
                    location={(j.customerArea || '').toUpperCase()}
                    price={`L${j.level}`}
                    status={j.status}
                    actionLabel={tr('schedule.navigate') || 'Navigate'}
                    onAction={() => handleOpenJob(j.id)}
                    onDetails={() => handleOpenJob(j.id)}
                    isLoading={false}
                    isLast={idx === today.length - 1}
                  />
                ))}
              </View>
            ) : null}

            {/* Inline error display */}
            {error ? (
              <View style={[styles.errorBox, { borderColor: t.danger, backgroundColor: t.violetDim }]}>
                <Text style={[VispText.body, { color: t.danger }]}>{error}</Text>
              </View>
            ) : null}
          </>
        ) : null}

        {/* THIS WEEK */}
        {activeTab === 'week' ? (
          <>
            <Eyebrow>{tr('schedule.upcomingThisWeek') || 'Upcoming this week'}</Eyebrow>
            <View style={{ marginTop: 6 }}>
              {week.length === 0 ? (
                <View style={styles.empty}>
                  <Text style={[VispText.body, { color: t.text2, textAlign: 'center' }]}>
                    {tr('schedule.noUpcomingJobs') || 'No upcoming jobs.'}
                  </Text>
                </View>
              ) : (
                week.map((j, idx) => {
                  const day = formatDayShort(j.scheduledAt);
                  const time = formatTimeHHMM(j.scheduledAt);
                  return (
                    <View
                      key={j.id}
                      style={idx === week.length - 1 ? undefined : [styles.rowDivider, { borderBottomColor: t.border }]}
                    >
                      <Row
                        icon="cal"
                        title={j.taskName}
                        sub={`${day} ${time} · ${(j.customerArea || '').toUpperCase()}`}
                        chevron={false}
                        onPress={() => handleOpenJob(j.id)}
                        trailing={
                          <Text style={{ fontFamily: FontMono, fontSize: 13, fontWeight: '700', color: t.text }}>
                            L{j.level}
                          </Text>
                        }
                      />
                    </View>
                  );
                })
              )}
            </View>
          </>
        ) : null}

        {/* CALENDAR placeholder */}
        {activeTab === 'calendar' ? (
          <View style={styles.empty}>
            <Text style={[VispText.headlineMid, { color: t.text, marginBottom: 8 }]}>
              {tr('nav.schedule') || 'Calendar'}
            </Text>
            <Text style={[VispText.body, { color: t.text2, textAlign: 'center' }]}>
              {tr('schedule.calendarComingSoon') || 'Full calendar view coming soon.'}
            </Text>
          </View>
        ) : null}
      </ScrollView>

      <CancelWithReasonModal
        visible={cancelOpen}
        jobId={liveTodayJob?.id ?? ''}
        role="provider"
        onClose={() => setCancelOpen(false)}
        onCancelled={() => {
          setCancelOpen(false);
          fetchSchedule();
        }}
      />
    </Screen>
  );
}

// ──────────────────────────────────────────────
// TimeJobCard — left rail time, right card with actions
// ──────────────────────────────────────────────

interface TimeJobCardProps {
  time: string;
  duration: string;
  title: string;
  customerName: string;
  location: string;
  price: string;
  status: JobStatus | string;
  actionLabel: string;
  onAction: () => void;
  onDetails: () => void;
  isLoading: boolean;
  isNext?: boolean;
  isLast?: boolean;
}

function TimeJobCard({
  time,
  duration,
  title,
  customerName,
  location,
  price,
  status,
  actionLabel,
  onAction,
  onDetails,
  isLoading,
  isNext,
  isLast,
}: TimeJobCardProps): React.JSX.Element {
  const t = useVispTheme();
  const initials = customerInitials(customerName);
  return (
    <View
      style={[
        timeCardStyles.row,
        !isLast ? { borderBottomColor: t.border, borderBottomWidth: StyleSheet.hairlineWidth } : undefined,
      ]}
    >
      <View style={timeCardStyles.timeRail}>
        <Text
          style={{
            fontFamily: FontMono,
            fontSize: 18,
            fontWeight: '700',
            color: t.text,
            letterSpacing: -0.36,
            textAlign: 'right',
          }}
        >
          {time}
        </Text>
        <Text
          style={[VispText.eyebrow, { color: t.text3, marginTop: 2, textAlign: 'right' }]}
        >
          {duration}
        </Text>
      </View>

      <View
        style={[
          timeCardStyles.card,
          { backgroundColor: t.card, borderColor: isNext ? t.violetLine : t.border },
        ]}
      >
        <View style={timeCardStyles.headerRow}>
          <Text style={[VispText.bodyStrong, { color: t.text, flex: 1, fontSize: 14 }]} numberOfLines={1}>
            {title}
          </Text>
          {isNext ? <Chip accent>NEXT</Chip> : <Chip dark>{String(status).toUpperCase()}</Chip>}
        </View>

        <View style={timeCardStyles.customerRow}>
          <View style={[timeCardStyles.initialsBox, { backgroundColor: t.deep, borderColor: t.border }]}>
            <Text style={{ fontFamily: FontSansBold, color: t.text, fontWeight: '700', fontSize: 11 }}>
              {initials}
            </Text>
          </View>
          <Text style={[VispText.eyebrow, { color: t.text3, flex: 1 }]} numberOfLines={1}>
            {customerName.toUpperCase()} · {location}
          </Text>
        </View>

        <View style={[timeCardStyles.actionsRow, { borderTopColor: t.border }]}>
          <MotionPressable onPress={onAction} disabled={isLoading} style={{ flex: 1 }}>
            <View style={[timeCardStyles.primaryBtn, { backgroundColor: t.text }]}>
              {isLoading ? (
                <AnimatedSpinner size={14} color={t.bg} />
              ) : (
                <Text style={[VispText.bodyStrong, { color: t.bg, fontSize: 12 }]}>{actionLabel}</Text>
              )}
            </View>
          </MotionPressable>
          <MotionPressable onPress={onDetails}>
            <View style={[timeCardStyles.iconBtn, { borderColor: t.borderStrong }]}>
              <Icon name="msg" size={14} color={t.text2} />
            </View>
          </MotionPressable>
          <MotionPressable onPress={onDetails}>
            <View style={[timeCardStyles.iconBtn, { borderColor: t.borderStrong }]}>
              <Icon name="phone" size={14} color={t.text2} />
            </View>
          </MotionPressable>
          <Text
            style={{ fontFamily: FontMono, fontSize: 13, fontWeight: '700', color: t.text, marginLeft: 'auto' }}
          >
            {price}
          </Text>
        </View>

        {/* "Details" link — opens full job tracking */}
        <MotionPressable onPress={onDetails} style={{ marginTop: 10, alignSelf: 'flex-start' }}>
          <Text style={[VispText.chip, { color: t.text3 }]}>DETAILS →</Text>
        </MotionPressable>
      </View>
    </View>
  );
}

const timeCardStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 14,
    paddingVertical: 14,
  },
  timeRail: { width: 58 },
  card: {
    flex: 1,
    borderRadius: VispRadius.card,
    borderWidth: 1,
    padding: 14,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 8,
    marginBottom: 8,
  },
  customerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  initialsBox: {
    width: 22,
    height: 22,
    borderRadius: 5,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  primaryBtn: {
    paddingVertical: 8,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtn: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

// ──────────────────────────────────────────────
// Styles
// ──────────────────────────────────────────────

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  contentContainer: {
    paddingHorizontal: VispSpace.gutter,
    paddingBottom: 40,
  },
  empty: {
    paddingVertical: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  errorBox: {
    marginTop: 14,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
});
