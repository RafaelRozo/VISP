/**
 * VISP - Job Offers Screen (Mockup-fidelity refresh)
 *
 * Matches `ProviderJobs` in newdesign/app-provider.jsx:
 *   - Provider TopBar: Avatar(initials) + ["PRO · LV N" eyebrow + name strong]
 *     + OnlinePill + settings IconBtn
 *   - "This week" Card: $X,XXX.YY headline + WoW delta + MiniBars chart with
 *     M/T/W/T/F/S/S labels.
 *   - 3-up StatTiles: Rating / Jobs done / Response.
 *   - "Available near you" Eyebrow + count eyebrow on the right.
 *   - Incoming offer cards: icon + title + meta eyebrow + price/match badge,
 *     then "Apply · $price" primary + "DETAILS" secondary actions.
 *
 * Hooks, accept/decline/propose flows, ProposalModal, and filter helpers are
 * preserved. The previous filter bar + Mapbox preview + status badges have
 * been collapsed into the editorial layout (filters become two-row TabPills
 * underneath the hero card).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  Modal,
  Pressable,
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
import { useTranslation } from '../../i18n';
import {
  Screen,
  TopBar,
  Eyebrow,
  Card,
  Chip,
  IconBtn,
  Avatar,
  OnlinePill,
  StatTile,
  MiniBars,
  Icon,
  VispIconName,
} from '../../components/visp';
import { useVispTheme, VispText, VispSpace, VispRadius, FontSansBold, FontMono } from '../../theme/visp';
import { GlassInput, GlassButton } from '../../components/glass';
import { useProviderStore } from '../../stores/providerStore';
import { useAuthStore } from '../../stores/authStore';
import { Image, ScrollView } from 'react-native';
import { magnitudeLabel, type OpenJob, type SubmitOfferInput } from '../../services/offerService';
import { resolveUploadUrl } from '../../services/userService';

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
// Helpers
// ──────────────────────────────────────────────

function getTimeRemaining(expiresAt: string): { minutes: number; seconds: number; isExpired: boolean } {
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff <= 0) return { minutes: 0, seconds: 0, isExpired: true };
  return {
    minutes: Math.floor(diff / 60000),
    seconds: Math.floor((diff % 60000) / 1000),
    isExpired: false,
  };
}

function formatDistance(km: number | undefined): string {
  if (km === undefined || km === null) return '—';
  return km < 1 ? `${Math.round(km * 1000)}M` : `${km.toFixed(1)} KM`;
}

function formatPrice(cents: number | undefined): string {
  if (cents === undefined || cents === null) return '—';
  return `$${(cents / 100).toFixed(0)}`;
}

function getLevelNum(level: string): number {
  return parseInt(level.replace(/\D/g, ''), 10) || 1;
}

function isNegotiatedLevel(level: string): boolean {
  return getLevelNum(level) >= 3;
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
  return 'briefcase';
}

function useOfferTimer(expiresAt: string | undefined) {
  const fallback = { minutes: 99, seconds: 0, isExpired: false };
  const [time, setTime] = useState(() => (expiresAt ? getTimeRemaining(expiresAt) : fallback));
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!expiresAt) return;
    intervalRef.current = setInterval(() => {
      const next = getTimeRemaining(expiresAt);
      setTime(next);
      if (next.isExpired && intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    }, 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [expiresAt]);

  return time;
}

// ──────────────────────────────────────────────
// Tarjeta de trabajo abierto + formulario de oferta
//
// Aquí vivían `ProposalModal` (proponer un precio) y `OfferCard` (aceptar o
// rechazar un trabajo). Los dos desaparecen con el modelo de ofertas: el proveedor
// ya no acepta un trabajo con el precio puesto por el catálogo, ni negocia aparte.
// Lee el trabajo y OFERTA — su tarifa sale del perfil, y lo que aporta es cuánto
// tarda y, si lleva material, cuánto costará y por qué.
// ──────────────────────────────────────────────

interface OpenJobCardProps {
  job: OpenJob;
  onSubmit: (jobId: string, input: SubmitOfferInput) => Promise<void>;
  onDecline: (jobId: string) => void;
  isProcessing: boolean;
}

function OpenJobCard({ job, onSubmit, onDecline, isProcessing }: OpenJobCardProps): React.JSX.Element {
  const t = useVispTheme();
  const { t: tr } = useTranslation();

  const [open, setOpen] = useState(false);
  const [magnitude, setMagnitude] = useState('');
  const [materials, setMaterials] = useState('');
  const [materialsNote, setMaterialsNote] = useState('');
  const [message, setMessage] = useState('');

  // En un contrato el trato ya está cerrado: el cliente puso precio y horas. El
  // proveedor no aporta magnitud ni cotiza material — acepta o no acepta.
  const isContract = job.isContract;
  const needsMagnitude = !isContract && job.magnitudeSource === 'PROVIDER';
  const needsMaterials = !isContract && job.materialsRequested;
  const unidad = magnitudeLabel(job.pricingUnit);

  // Total en vivo, para que el proveedor vea lo que va a cobrar mientras teclea y
  // no tenga que hacer la cuenta de cabeza.
  const magnitudeNum = needsMagnitude
    ? parseFloat(magnitude || '0')
    : (job.customerQuantity ?? 1);
  const materialsNum = parseFloat(materials || '0');
  // En un contrato la tarifa es la del cliente; en el resto, la del perfil.
  const tarifa = isContract ? (job.customerRateCents ?? 0) : (job.myRateCents ?? 0);
  const manoObra = tarifa * (Number.isFinite(magnitudeNum) ? magnitudeNum : 0);
  const total = manoObra + (Number.isFinite(materialsNum) ? materialsNum * 100 : 0);

  const puedeEnviar =
    job.canOffer &&
    !isProcessing &&
    (!needsMagnitude || (Number.isFinite(magnitudeNum) && magnitudeNum > 0)) &&
    (!needsMaterials ||
      (Number.isFinite(materialsNum) && materialsNum > 0 && materialsNote.trim() !== ''));

  const enviar = useCallback(async () => {
    if (!puedeEnviar) return;
    await onSubmit(job.jobId, {
      magnitude: needsMagnitude ? magnitudeNum : undefined,
      materialsCents: needsMaterials ? Math.round(materialsNum * 100) : undefined,
      materialsNote: needsMaterials ? materialsNote.trim() : undefined,
      message: message.trim() || undefined,
    });
  }, [
    puedeEnviar, onSubmit, job.jobId, needsMagnitude, magnitudeNum,
    needsMaterials, materialsNum, materialsNote, message,
  ]);

  return (
    <View style={[cardStyles.card, { backgroundColor: t.card, borderColor: t.border }]}>
      {/* ── Qué es y dónde ─────────────────────────────── */}
      <Text style={[VispText.bodyStrong, { color: t.text }]}>{job.serviceName}</Text>
      <Text style={[VispText.eyebrow, { color: t.text3, marginTop: 3 }]}>
        {[job.city, job.requestedDate, job.requestedTimeStart?.slice(0, 5)]
          .filter(Boolean)
          .join(' · ')}
      </Text>

      {/* ── Lo que escribió y fotografió el cliente ──────
          Es soporte de decisión: se lee ANTES de ofertar, que es justo el punto. */}
      {job.details ? (
        <Text style={[VispText.body, { color: t.text2, marginTop: 10 }]} numberOfLines={4}>
          {job.details}
        </Text>
      ) : null}
      {/* `?? []` y no `job.evidence.length`: este acceso directo tumbó la app
          entera cuando el store traía la bolsa con la forma vieja. La causa está
          arreglada en `providerStore.fetchDashboard`, pero una tarjeta no debe
          poder matar la app por un campo que no vino. */}
      {(job.evidence ?? []).length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={cardStyles.thumbs}>
          {(job.evidence ?? []).map((url) => (
            <Image
              key={url}
              source={{ uri: resolveUploadUrl(url) ?? url }}
              style={cardStyles.thumb}
            />
          ))}
        </ScrollView>
      ) : null}
      {(job.answers ?? []).length > 0 ? (
        <View style={{ marginTop: 8, gap: 4 }}>
          {(job.answers ?? []).map((a, i) => (
            <Text key={i} style={[VispText.eyebrow, { color: t.text3 }]}>
              {a.question}: <Text style={{ color: t.text2 }}>{
                a.answerType === 'IMAGE' ? (tr('jobOffers.photoAnswer') || 'photo attached') : a.answer
              }</Text>
            </Text>
          ))}
        </View>
      ) : null}

      {/* ── El trato, en un contrato ─────────────────────
          El precio ya está puesto: se enseña arriba y grande, porque es lo único
          que el proveedor tiene que decidir. */}
      {isContract ? (
        <View style={[cardStyles.materials, { borderColor: t.violetLine, backgroundColor: t.violetDim }]}>
          <Eyebrow color={t.violet}>
            {(tr('jobOffers.contractOffer') || 'The customer sets this price').toUpperCase()}
          </Eyebrow>
          <Text style={[VispText.bodyStrong, { color: t.text, marginTop: 6 }]}>
            {`$${((job.customerRateCents ?? 0) / 100).toFixed(2)}/h × ${job.customerQuantity ?? 0} h = $${(manoObra / 100).toFixed(2)}`}
          </Text>
          <Text style={[VispText.eyebrow, { color: t.text3, marginTop: 6 }]}>
            {tr('jobOffers.contractCancelNote') ||
              'If the job is cut short, you are paid for every hour started.'}
          </Text>
        </View>
      ) : null}

      {/* ── Material ─────────────────────────────────────
          Se muestra siempre que el trabajo lo lleve, y ANTES de ofertar: el
          proveedor adelanta dinero de su bolsillo y eso pesa en su decisión. */}
      {needsMaterials ? (
        <View style={[cardStyles.materials, { borderColor: t.violetLine, backgroundColor: t.violetDim }]}>
          <Eyebrow color={t.violet}>
            {(tr('jobOffers.materialsNeeded') || 'Materials needed').toUpperCase()}
          </Eyebrow>
          {job.materialsNote ? (
            <Text style={[VispText.body, { color: t.text2, marginTop: 6 }]}>
              {job.materialsNote}
            </Text>
          ) : null}
          {job.materialsBudgetCents != null ? (
            <Text style={[VispText.eyebrow, { color: t.text3, marginTop: 6 }]}>
              {(tr('jobOffers.customerBudget') ||
                'The customer had about ${budget} in mind — you quote what it really costs.')
                .replace('${budget}', `$${(job.materialsBudgetCents / 100).toFixed(2)}`)}
            </Text>
          ) : null}
        </View>
      ) : null}

      {/* ── Por qué no puede ofertar ────────────────────── */}
      {/* El motivo manda sobre el mensaje: hasta hoy siempre decía "pon tu
          precio", que en un choque de agenda es sencillamente falso y manda al
          proveedor a arreglar algo que no está roto. */}
      {!job.canOffer && !job.alreadyOffered ? (
        <Text style={[VispText.eyebrow, { color: t.danger, marginTop: 12 }]}>
          {job.blockedReason === 'schedule_conflict'
            ? tr('jobOffers.scheduleConflict') ||
              'You already have another job booked at this time.'
            : tr('jobOffers.setRateFirst') ||
              'Set your price for this service in My Prices before you can offer.'}
        </Text>
      ) : null}
      {job.alreadyOffered ? (
        <Text style={[VispText.eyebrow, { color: t.text3, marginTop: 12 }]}>
          {tr('jobOffers.alreadyOffered') || 'You already sent an offer for this job.'}
        </Text>
      ) : null}

      {/* ── Formulario ─────────────────────────────────── */}
      {open && job.canOffer ? (
        <View style={{ marginTop: 14, gap: 10 }}>
          {needsMagnitude ? (
            <View>
              <Eyebrow color={t.text3}>
                {(tr('jobOffers.howLong') || `How many ${unidad}?`).toUpperCase()}
              </Eyebrow>
              <GlassInput
                value={magnitude}
                onChangeText={setMagnitude}
                onChange={(e) => setMagnitude(e.nativeEvent.text)}
                placeholder={unidad === 'hours' ? '8' : '80'}
                keyboardType="decimal-pad"
              />
            </View>
          ) : (
            <Text style={[VispText.eyebrow, { color: t.text3 }]}>
              {(tr('jobOffers.fixedWork') || 'The customer set this: {n} {unit}')
                .replace('{n}', String(job.customerQuantity ?? 1))
                .replace('{unit}', unidad)}
            </Text>
          )}

          {needsMaterials ? (
            <>
              <View>
                <Eyebrow color={t.text3}>
                  {(tr('jobOffers.materialsCost') || 'Materials cost').toUpperCase()}
                </Eyebrow>
                <GlassInput
                  value={materials}
                  onChangeText={setMaterials}
                  onChange={(e) => setMaterials(e.nativeEvent.text)}
                  placeholder="150"
                  keyboardType="decimal-pad"
                />
              </View>
              <View>
                <Eyebrow color={t.text3}>
                  {(tr('jobOffers.materialsWhy') || 'What is it for?').toUpperCase()}
                </Eyebrow>
                {/* Obligatoria: es lo único que le permite al cliente juzgar si el
                    importe es razonable, y sin ella el backend rechaza la oferta. */}
                <GlassInput
                  value={materialsNote}
                  onChangeText={setMaterialsNote}
                  onChange={(e) => setMaterialsNote(e.nativeEvent.text)}
                  placeholder={
                    tr('jobOffers.materialsWhyHint') || 'Matte paint for that brand runs $150'
                  }
                  multiline
                />
              </View>
            </>
          ) : null}

          <View>
            <Eyebrow color={t.text3}>
              {(tr('jobOffers.messageOptional') || 'Message (optional)').toUpperCase()}
            </Eyebrow>
            <GlassInput
              value={message}
              onChangeText={setMessage}
              onChange={(e) => setMessage(e.nativeEvent.text)}
              placeholder={tr('jobOffers.messageHint') || 'I bring my own equipment.'}
              multiline
            />
          </View>

          {/* La cuenta, a la vista mientras teclea. */}
          <View style={[cardStyles.totalBox, { borderTopColor: t.border }]}>
            <Text style={[VispText.eyebrow, { color: t.text3 }]}>
              {`${Number.isFinite(magnitudeNum) ? magnitudeNum : 0} × $${(tarifa / 100).toFixed(2)}`}
              {materialsNum > 0 ? ` + $${materialsNum.toFixed(2)} ${tr('jobOffers.materials') || 'materials'}` : ''}
            </Text>
            <Text style={[VispText.bodyStrong, { color: t.text }]}>
              ${(total / 100).toFixed(2)}
            </Text>
          </View>
        </View>
      ) : null}

      {/* ── Acciones ───────────────────────────────────── */}
      <View style={cardStyles.actions}>
        {!job.alreadyOffered ? (
          <MotionPressable
            onPress={() => onDecline(job.jobId)}
            style={[cardStyles.btnGhost, { borderColor: t.border }]}
          >
            <Text style={[VispText.chip, { color: t.text2 }]}>
              {tr('jobOffers.notInterested') || 'Not interested'}
            </Text>
          </MotionPressable>
        ) : null}
        {job.canOffer ? (
          <MotionPressable
            onPress={() => (isContract || open ? enviar() : setOpen(true))}
            disabled={(open && !puedeEnviar) || (isContract && !job.canOffer)}
            style={[
              cardStyles.btnPrimary,
              { backgroundColor: t.violet, opacity: open && !puedeEnviar ? 0.5 : 1 },
            ]}
          >
            <Text style={[VispText.chip, { color: '#FFFFFF' }]}>
              {isContract
                ? tr('jobOffers.acceptContract') || 'Accept'
                : open
                  ? tr('jobOffers.sendOffer') || 'Send offer'
                  : tr('jobOffers.makeOffer') || 'Make an offer'}
            </Text>
          </MotionPressable>
        ) : null}
      </View>
    </View>
  );
}

const cardStyles = StyleSheet.create({
  card: {
    borderRadius: VispRadius.card,
    borderWidth: 1,
    padding: 14,
    marginBottom: 8,
    position: 'relative',
  },
  hotBar: {
    position: 'absolute',
    top: -1,
    left: 14,
    right: 14,
    height: 2,
    borderRadius: 2,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconBox: {
    width: 36,
    height: 36,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emergencyRow: { marginTop: 10 },
  actionsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  primaryBtn: {
    paddingVertical: 9,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryBtn: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 6,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // ── Tarjeta de trabajo abierto (ofertas v2) ──
  // flexGrow:0 obligatorio: un ScrollView horizontal sin él se expande y se come
  // el espacio vertical de la tarjeta. Lo detecta scripts/audit_layout.py.
  thumbs: { marginTop: 10, flexGrow: 0 },
  thumb: { width: 64, height: 64, borderRadius: 8, marginRight: 8 },
  materials: {
    marginTop: 12,
    padding: 12,
    borderRadius: VispRadius.card,
    borderWidth: 1,
  },
  totalBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'transparent',
  },
  btnGhost: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 6,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPrimary: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

// ──────────────────────────────────────────────
// Main component
// ──────────────────────────────────────────────

export default function JobOffersScreen(): React.JSX.Element {
  const t = useVispTheme();
  const { t: tr } = useTranslation();
  const {
    isLoadingOffers,
    fetchOffers,
    submitOffer,
    declineOffer,
    getFilteredOffers,
    pendingOffers,
    earnings,
    weeklyEarnings,
    providerProfile,
    isOnline,
    toggleOnline,
  } = useProviderStore();
  const user = useAuthStore((s) => s.user);

  const [processingId, setProcessingId] = useState<string | null>(null);

  useEffect(() => {
    fetchOffers();
  }, [fetchOffers]);

  const filteredOffers = useMemo(
    () => getFilteredOffers(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pendingOffers, getFilteredOffers],
  );

  const handleSubmitOffer = useCallback(
    async (jobId: string, input: SubmitOfferInput) => {
      setProcessingId(jobId);
      try {
        await submitOffer(jobId, input);
        Alert.alert(
          tr('jobOffers.offerSentTitle') || 'Offer sent',
          tr('jobOffers.offerSentBody') ||
            "The customer will compare it with the others and decide. We'll let you know.",
        );
      } catch (err: unknown) {
        // El backend explica QUÉ falta (importe de material, justificación,
        // tarifa sin poner). Repetirlo tal cual evita el "algo salió mal".
        const detail = (err as { response?: { data?: { detail?: { message?: string } } } })
          ?.response?.data?.detail;
        Alert.alert(
          tr('jobOffers.offerFailedTitle') || 'Could not send the offer',
          detail?.message || tr('common.errorGeneric') || 'Please try again.',
        );
      } finally {
        setProcessingId(null);
      }
    },
    [submitOffer, tr],
  );

  const handleDecline = useCallback(
    async (jobId: string) => {
      setProcessingId(jobId);
      try {
        await declineOffer(jobId);
      } finally {
        setProcessingId(null);
      }
    },
    [declineOffer],
  );

  // Provider header data
  const initials = `${user?.firstName?.charAt(0) || 'M'}${user?.lastName?.charAt(0) || ''}`.toUpperCase();
  const fullName = user ? `${user.firstName} ${user.lastName?.charAt(0) || ''}.` : 'Marcus R.';
  const proEyebrow = `PRO · LV ${providerProfile?.level ?? 4}`;

  // Mini-bars (last 7 weeks or fallback) — taken from weeklyEarnings if present
  const last7 = (weeklyEarnings.slice(-7).map((w) => w.amount) as number[]);
  const peak = last7.length ? last7.reduce((b, v, i) => (v > last7[b] ? i : b), 0) : undefined;
  const wkLabel =
    weeklyEarnings.length > 0
      ? (weeklyEarnings[weeklyEarnings.length - 1].weekLabel || '').toUpperCase()
      : 'WK —';

  // WoW pct (last vs previous)
  const wow =
    weeklyEarnings.length >= 2
      ? (() => {
        const a = weeklyEarnings[weeklyEarnings.length - 1].amount;
        const p = weeklyEarnings[weeklyEarnings.length - 2].amount || 1;
        return Math.round(((a - p) / p) * 100);
      })()
      : null;

  // Hero amount split
  const fixed = (Math.round(earnings.thisWeek * 100) / 100).toFixed(2);
  const [d, c] = fixed.split('.');
  const dollars = Number(d).toLocaleString();

  const renderOffer = useCallback(
    ({ item }: { item: OpenJob }) => (
      <OpenJobCard
        job={item}
        onSubmit={handleSubmitOffer}
        onDecline={handleDecline}
        isProcessing={processingId === item.jobId}
      />
    ),
    [handleSubmitOffer, handleDecline, processingId],
  );

  // La bolsa no tiene assignmentId: la clave es el trabajo.
  const keyExtractor = useCallback((item: OpenJob) => item.jobId, []);

  return (
    <Screen>
      <TopBar
        left={
          <>
            <Avatar initials={initials} />
            <View>
              <Text style={[VispText.eyebrow, { color: t.text3 }]} numberOfLines={1}>
                {proEyebrow}
              </Text>
              <Text style={[VispText.bodyStrong, { color: t.text, marginTop: 1 }]} numberOfLines={1}>
                {fullName}
              </Text>
            </View>
          </>
        }
        right={
          <>
            <OnlinePill online={isOnline} onPress={() => toggleOnline()} />
            <IconBtn name="settings" />
          </>
        }
      />

      <FlatList
        data={filteredOffers}
        renderItem={renderOffer}
        keyExtractor={keyExtractor}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        refreshing={isLoadingOffers}
        onRefresh={fetchOffers}
        ListHeaderComponent={
          <View>
            {/* Hero "this week" card */}
            <Card padding={VispSpace.card} style={{ marginBottom: 14 }}>
              <View style={styles.weekHeaderRow}>
                <Eyebrow>{tr('earningsScreen.thisWeek') || 'This week'}</Eyebrow>
                <Eyebrow>{wkLabel}</Eyebrow>
              </View>
              <View style={styles.heroAmountRow}>
                <Text style={{ fontFamily: FontSansBold, fontSize: 18, color: t.text3, fontWeight: '700' }}>$</Text>
                <Text
                  style={{
                    fontFamily: FontSansBold,
                    fontSize: 42,
                    fontWeight: '700',
                    color: t.text,
                    letterSpacing: -1.5,
                    lineHeight: 42,
                  }}
                >
                  {dollars}
                </Text>
                <Text
                  style={{
                    fontFamily: FontMono,
                    fontSize: 13,
                    marginLeft: 6,
                    color: t.text3,
                    letterSpacing: 0.8,
                  }}
                >
                  .{c}
                </Text>
              </View>
              {wow != null ? (
                <View style={styles.deltaRow}>
                  <Icon name="trending" size={11} color={t.violet} />
                  <Text
                    style={{
                      fontFamily: FontMono,
                      fontSize: 11,
                      color: t.violet,
                      letterSpacing: 0.6,
                      marginLeft: 6,
                    }}
                  >
                    {wow >= 0 ? '↑' : '↓'} {Math.abs(wow)}% VS LAST WEEK
                  </Text>
                </View>
              ) : null}

              {last7.length > 0 ? (
                <View style={[styles.barsBox, { borderTopColor: t.border }]}>
                  <MiniBars data={last7} peakIndex={peak} height={32} />
                  <View style={styles.weekLabelsRow}>
                    {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
                      <Text
                        key={i}
                        style={{
                          fontFamily: FontMono,
                          fontSize: 9,
                          color: t.text4,
                          letterSpacing: 1,
                          flex: 1,
                          textAlign: 'center',
                        }}
                      >
                        {d}
                      </Text>
                    ))}
                  </View>
                </View>
              ) : null}
            </Card>

            {/* 3-up stat tiles */}
            <View style={styles.statsRow}>
              <StatTile label={tr('profileScreen.rating') || '★ Rating'} value={(providerProfile?.rating ?? 0).toFixed(1)} />
              <StatTile label={tr('profileScreen.jobsDoneLabel') || 'Jobs done'} value={String(providerProfile?.completedJobs ?? 0)} />
              <StatTile label={tr('profileScreen.responseRate') || 'Response'} value="—" />
            </View>

            {/* Available header */}
            <View style={styles.availableHeader}>
              <Eyebrow>{tr('jobOffers.title') || 'Available near you'}</Eyebrow>
              <Eyebrow>{String(filteredOffers.length).padStart(2, '0')} OPEN</Eyebrow>
            </View>
          </View>
        }
        ListEmptyComponent={
          isLoadingOffers ? null : (
            <View style={styles.emptyContainer}>
              <Text style={[VispText.headlineMid, { color: t.text, marginBottom: 8, textAlign: 'center' }]}>
                {tr('jobOffers.noJobOffers') || 'No offers right now'}
              </Text>
              <Text style={[VispText.body, { color: t.text2, textAlign: 'center' }]}>
                {tr('jobOffers.newOffersAppear') || "We'll ping you when something matches."}
              </Text>
            </View>
          )
        }
      />

    </Screen>
  );
}

// ──────────────────────────────────────────────
// Styles
// ──────────────────────────────────────────────

const styles = StyleSheet.create({
  listContent: {
    paddingHorizontal: VispSpace.gutter,
    paddingBottom: 40,
    flexGrow: 1,
  },
  weekHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  heroAmountRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
    marginTop: 10,
  },
  deltaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
  },
  barsBox: {
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  weekLabelsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 18,
  },
  availableHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  emptyContainer: {
    paddingHorizontal: 30,
    paddingTop: 50,
    alignItems: 'center',
  },
});

// Modal styles
const modalStyles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  content: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 40,
  },
  guideContainer: {
    padding: 10,
    borderRadius: 10,
    marginTop: 12,
    marginBottom: 16,
    borderWidth: 1,
  },
  inputSpacing: { marginBottom: 16 },
  actions: { flexDirection: 'row', gap: 12, marginTop: 8 },
  actionBtn: { flex: 1 },
});
