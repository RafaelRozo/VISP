/**
 * VISP — Ofertas recibidas (ofertas v2, 2026-08-20).
 *
 * El cliente postea el trabajo y los proveedores ofertan; aquí elige.
 *
 * QUÉ SUSTITUYE: antes el cliente escogía proveedor de una lista con el precio ya
 * calculado por el catálogo, y luego aprobaba al primero que aceptaba. Elegir así
 * era elegir a ciegas: no sabía cuánto iba a tardar ESE proveedor en ESTE trabajo
 * ni cuánto le iba a costar de verdad.
 *
 * QUÉ VE AHORA, por oferta: quién es (nombre, estrellas, trabajos hechos, bio),
 * cuánto tarda ("8 h"), a cuánto la hora, el material que cotiza con su
 * justificación, y el total. Con eso decide.
 *
 * Detalle que importa: el material va SIEMPRE en su propia línea, nunca sumado al
 * subtotal. No lleva impuesto encima ni paga comisión, y mostrarlo mezclado haría
 * pensar lo contrario.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { Screen, ScreenTitle, Eyebrow } from '../../components/visp';
import { useVispTheme, VispText, VispRadius } from '../../theme/visp';
import { useTranslation } from '../../i18n';
import { offerService, magnitudeLabel, type JobOffer, type JobOffersResult } from '../../services/offerService';
import { resolveUploadUrl } from '../../services/userService';
import taskService from '../../services/taskService';
import { paymentService } from '../../services/paymentService';
import { useAuthStore } from '../../stores/authStore';
import type { CustomerFlowParamList } from '../../types';

type Nav = NativeStackNavigationProp<CustomerFlowParamList, 'Offers'>;
type Rt = RouteProp<CustomerFlowParamList, 'Offers'>;

function money(cents: number | null | undefined): string {
  return `$${((cents ?? 0) / 100).toFixed(2)}`;
}

/** "8 hours", "80 m²", "5 units" — lo que el proveedor dice que hace falta. */
function workLabel(offer: JobOffer): string {
  const n = offer.magnitude % 1 === 0 ? String(offer.magnitude) : offer.magnitude.toFixed(1);
  return `${n} ${magnitudeLabel(offer.unit)}`;
}

export default function OffersScreen(): React.JSX.Element {
  const t = useVispTheme();
  const { t: tr } = useTranslation();
  const navigation = useNavigation<Nav>();
  const route = useRoute<Rt>();
  const { jobId } = route.params;
  const stripeCustomerId = useAuthStore((s) => s.user?.stripeCustomerId);

  const [data, setData] = useState<JobOffersResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await offerService.listOffers(jobId));
    } catch {
      Alert.alert(
        tr('offers.loadFailedTitle') || 'Could not load offers',
        tr('offers.loadFailedBody') || 'Check your connection and try again.',
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [jobId, tr]);

  useEffect(() => {
    load();
  }, [load]);

  const handleAccept = useCallback(
    (offer: JobOffer) => {
      // Confirmación explícita con el total delante: aceptar agenda el trabajo y
      // cierra las demás ofertas, así que no puede pasar por un toque accidental.
      Alert.alert(
        tr('offers.acceptTitle') || 'Accept this offer?',
        (tr('offers.acceptBody') ||
          '{name} will do the job for {total}. The other offers will be closed.')
          .replace('{name}', offer.displayName)
          .replace('{total}', money(offer.totalCents)),
        [
          { text: tr('common.cancel') || 'Cancel', style: 'cancel' },
          {
            text: tr('offers.accept') || 'Accept',
            style: 'default',
            onPress: async () => {
              setBusyId(offer.offerId);
              try {
                await offerService.acceptOffer(jobId, offer.offerId);

                // Retener el importe en la tarjeta, AQUÍ.
                //
                // Este es el primer instante en que existe un precio: hasta que
                // el cliente elige una oferta no hay ni tarifa ni tiempo. Antes
                // la retención se hacía al aprobar al proveedor, y ese paso
                // desapareció con el modelo de ofertas — sin esto el trabajo
                // llega al cierre sin autorización y el cobro final falla.
                //
                // No bloquea la navegación: la oferta ya está aceptada y el
                // trabajo agendado. Si no hay tarjeta o Stripe falla, se avisa y
                // se cobra al cerrar; atrapar al cliente en esta pantalla por un
                // problema de pago sería peor.
                try {
                  const { methods } = stripeCustomerId
                    ? await paymentService.listPaymentMethods(stripeCustomerId)
                    : { methods: [] };
                  if (methods.length > 0) {
                    await taskService.authorizePayment(jobId, methods[0].id);
                  } else {
                    Alert.alert(
                      tr('offers.noCardTitle') || 'Add a payment method',
                      tr('offers.noCardBody') ||
                        'The job is scheduled. Add a card in your profile so we can hold the amount before the work starts.',
                    );
                  }
                } catch {
                  Alert.alert(
                    tr('offers.holdFailedTitle') || 'Could not hold the amount',
                    tr('offers.holdFailedBody') ||
                      'The job is scheduled. We will try again before the work starts.',
                  );
                }

                navigation.navigate('JobTracking', { jobId });
              } catch (err: unknown) {
                const detail = (err as { response?: { data?: { detail?: { message?: string } } } })
                  ?.response?.data?.detail;
                Alert.alert(
                  tr('offers.acceptFailedTitle') || 'Could not accept',
                  detail?.message ||
                    tr('offers.acceptFailedBody') ||
                    'That offer is no longer available. Pick another one.',
                );
                load();
              } finally {
                setBusyId(null);
              }
            },
          },
        ],
      );
    },
    [jobId, navigation, load, tr, stripeCustomerId],
  );

  const handleReject = useCallback(
    async (offer: JobOffer) => {
      setBusyId(offer.offerId);
      try {
        await offerService.rejectOffer(jobId, offer.offerId);
        await load();
      } catch {
        Alert.alert(tr('offers.rejectFailed') || 'Could not discard that offer.');
      } finally {
        setBusyId(null);
      }
    },
    [jobId, load, tr],
  );

  const offers = data?.offers ?? [];

  return (
    <Screen>
      <ScreenTitle
        title={tr('offers.title') || 'Offers'}
        sub={
          offers.length > 0
            ? `§ ${offers.length} ${offers.length === 1 ? 'offer' : 'offers'}`
            : tr('offers.eyebrowWaiting') || '§ Waiting for offers'
        }
        onBack={navigation.canGoBack() ? () => navigation.goBack() : undefined}
      />

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load();
            }}
            tintColor={t.text3}
          />
        }
      >
        {loading ? (
          <ActivityIndicator style={{ marginTop: 40 }} color={t.violet} />
        ) : offers.length === 0 ? (
          /* Vacío NO es un error: el trabajo acaba de postearse y las ofertas
             tardan. Se dice qué está pasando y qué esperar, en vez de una pantalla
             en blanco que parece que algo falló. */
          <View style={styles.empty}>
            <Text style={[VispText.body, { color: t.text2, textAlign: 'center' }]}>
              {tr('offers.emptyTitle') || 'No offers yet.'}
            </Text>
            <Text
              style={[VispText.eyebrow, { color: t.text3, textAlign: 'center', marginTop: 10 }]}
            >
              {tr('offers.emptyBody') ||
                'Providers in your area are seeing your job. We will notify you as offers come in.'}
            </Text>
            {data?.catalogMinCents != null ? (
              <Text
                style={[VispText.eyebrow, { color: t.text3, textAlign: 'center', marginTop: 16 }]}
              >
                {(tr('offers.emptyRange') || 'Typical range for this service: {range}').replace(
                  '{range}',
                  `${money(data.catalogMinCents)} – ${money(data.catalogMaxCents)}`,
                )}
              </Text>
            ) : null}
          </View>
        ) : (
          offers.map((o) => {
            const busy = busyId === o.offerId;
            return (
              <View
                key={o.offerId}
                style={[styles.card, { borderColor: t.border, backgroundColor: t.surface }]}
              >
                {/* ── Quién es ───────────────────────────────── */}
                <View style={styles.head}>
                  {o.avatarUrl ? (
                    <Image
                      source={{ uri: resolveUploadUrl(o.avatarUrl) ?? o.avatarUrl }}
                      style={styles.avatar}
                    />
                  ) : (
                    <View style={[styles.avatar, { backgroundColor: t.violetDim }]}>
                      <Text style={[VispText.body, { color: t.text }]}>
                        {o.displayName.charAt(0).toUpperCase()}
                      </Text>
                    </View>
                  )}
                  <View style={styles.headText}>
                    <Text style={[VispText.bodyStrong, { color: t.text }]}>{o.displayName}</Text>
                    <Text style={[VispText.eyebrow, { color: t.text3, marginTop: 2 }]}>
                      {o.reviewCount > 0 && o.rating != null
                        ? `★ ${o.rating.toFixed(1)} · ${o.reviewCount} ${
                            o.reviewCount === 1 ? 'review' : 'reviews'
                          }`
                        : tr('offers.newProvider') || 'New provider'}
                      {o.completedJobs > 0
                        ? ` · ${o.completedJobs} ${tr('offers.jobsDone') || 'jobs done'}`
                        : ''}
                      {o.level != null ? ` · L${o.level}` : ''}
                    </Text>
                  </View>
                </View>

                {o.bio ? (
                  <Text
                    style={[VispText.body, { color: t.text2, marginTop: 10 }]}
                    numberOfLines={3}
                  >
                    {o.bio}
                  </Text>
                ) : null}

                {/* ── Qué ofrece ─────────────────────────────── */}
                <View style={[styles.breakdown, { borderTopColor: t.border }]}>
                  <View style={styles.line}>
                    <Text style={[VispText.body, { color: t.text2 }]}>
                      {tr('offers.work') || 'Work'}
                    </Text>
                    <Text style={[VispText.body, { color: t.text }]}>{workLabel(o)}</Text>
                  </View>
                  <View style={styles.line}>
                    <Text style={[VispText.body, { color: t.text2 }]}>
                      {tr('offers.rate') || 'Rate'}
                    </Text>
                    <Text style={[VispText.body, { color: t.text }]}>
                      {money(o.rateCents)}
                      <Text style={{ color: t.text3 }}>{` / ${magnitudeLabel(o.unit).replace(/s$/, '')}`}</Text>
                    </Text>
                  </View>
                  <View style={styles.line}>
                    <Text style={[VispText.body, { color: t.text2 }]}>
                      {tr('offers.labour') || 'Labour'}
                    </Text>
                    <Text style={[VispText.body, { color: t.text }]}>{money(o.subtotalCents)}</Text>
                  </View>
                  {o.serviceTaxCents > 0 ? (
                    <View style={styles.line}>
                      <Text style={[VispText.body, { color: t.text2 }]}>
                        {tr('offers.tax') || 'Tax'}
                      </Text>
                      <Text style={[VispText.body, { color: t.text }]}>
                        {money(o.serviceTaxCents)}
                      </Text>
                    </View>
                  ) : null}

                  {/* El material, en su propia línea y con el porqué que escribió el
                      proveedor. Es lo que permite juzgar si el importe es razonable. */}
                  {o.materialsCents > 0 ? (
                    <>
                      <View style={styles.line}>
                        <Text style={[VispText.body, { color: t.text2 }]}>
                          {tr('offers.materials') || 'Materials'}
                        </Text>
                        <Text style={[VispText.body, { color: t.text }]}>
                          {money(o.materialsCents)}
                        </Text>
                      </View>
                      {o.materialsNote ? (
                        <Text style={[VispText.eyebrow, { color: t.text3, marginTop: -2 }]}>
                          {o.materialsNote}
                        </Text>
                      ) : null}
                    </>
                  ) : null}

                  {o.serviceFeeCents > 0 ? (
                    <View style={styles.line}>
                      <Text style={[VispText.body, { color: t.text2 }]}>
                        {tr('offers.serviceFee') || 'Service fee'}
                      </Text>
                      <Text style={[VispText.body, { color: t.text }]}>
                        {money(o.serviceFeeCents)}
                      </Text>
                    </View>
                  ) : null}

                  <View style={[styles.line, styles.totalLine, { borderTopColor: t.border }]}>
                    <Text style={[VispText.bodyStrong, { color: t.text }]}>
                      {tr('offers.total') || 'Total'}
                    </Text>
                    <Text style={[VispText.bodyStrong, { color: t.violet }]}>{money(o.totalCents)}</Text>
                  </View>
                </View>

                {o.message ? (
                  <Text style={[VispText.body, { color: t.text2, marginTop: 10 }]}>
                    “{o.message}”
                  </Text>
                ) : null}

                {/* ── Decidir ────────────────────────────────── */}
                <View style={styles.actions}>
                  <Pressable
                    onPress={() => handleReject(o)}
                    disabled={busy}
                    style={[styles.btn, styles.btnGhost, { borderColor: t.border }]}
                  >
                    <Text style={[VispText.body, { color: t.text2 }]}>
                      {tr('offers.decline') || 'Decline'}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => handleAccept(o)}
                    disabled={busy}
                    style={[styles.btn, { backgroundColor: t.violet, opacity: busy ? 0.6 : 1 }]}
                  >
                    {busy ? (
                      <ActivityIndicator color="#FFFFFF" size="small" />
                    ) : (
                      <Text style={[VispText.body, { color: '#FFFFFF' }]}>
                        {tr('offers.accept') || 'Accept'}
                      </Text>
                    )}
                  </Pressable>
                </View>
              </View>
            );
          })
        )}

        {/* El material que el cliente indicó al reservar, como recordatorio de que
            era una referencia: cada proveedor cotiza el suyo. */}
        {data?.materialsRequested && offers.length > 0 ? (
          <Text style={[VispText.eyebrow, { color: t.text3, marginTop: 4 }]}>
            {(tr('offers.materialsBudgetNote') ||
              'You said you had about {budget} in mind for materials. Each provider quotes what it will really cost.').replace(
              '{budget}',
              money(data.materialsBudgetCents),
            )}
          </Text>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingBottom: 40, gap: 14 },
  empty: { paddingTop: 60, paddingHorizontal: 20 },
  card: { borderWidth: 1, borderRadius: VispRadius.card, padding: 16 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  headText: { flex: 1 },
  breakdown: { marginTop: 14, paddingTop: 12, borderTopWidth: 1, gap: 8 },
  line: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  totalLine: { marginTop: 6, paddingTop: 10, borderTopWidth: 1 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 16 },
  btn: {
    flex: 1,
    height: 46,
    borderRadius: VispRadius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnGhost: { borderWidth: 1 },
});
