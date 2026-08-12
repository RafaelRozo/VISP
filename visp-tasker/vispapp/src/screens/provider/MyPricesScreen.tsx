/**
 * VISP — My Prices / Mis precios (Provider-Set Pricing · PP2 UI)
 *
 * The provider sets their own rate for each service they are *qualified* for
 * (the backend only returns approved, no-pending-docs services). The rate is
 * validated against the catalog guardrail both here (instant feedback) and
 * server-side (source of truth). Custom-quote services show an info row — they
 * are negotiated per job and take no fixed rate.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';

import { useTranslation } from '../../i18n';
import { Screen, ScreenTitle, Eyebrow, Card } from '../../components/visp';
import { useVispTheme, VispText, VispSpace, FontMono, FontSansBold } from '../../theme/visp';
import { providerService, ProviderRateItem } from '../../services/providerService';

type RowMsg = { type: 'ok' | 'err'; text: string };

function centsToStr(cents: number | null | undefined): string {
  if (cents == null) return '';
  return (cents / 100).toFixed(2);
}

function dollarsLabel(cents: number | null | undefined): string {
  if (cents == null) return '—';
  return `$${(cents / 100).toFixed(0)}`;
}

export default function MyPricesScreen(): React.JSX.Element {
  // ScreenTitle aporta el botón de volver: el header del stack está oculto
  // para no duplicar el título.
  const navigation = useNavigation();
  const t = useVispTheme();
  const { t: tr } = useTranslation();

  const [items, setItems] = useState<ProviderRateItem[]>([]);
  // True when the provider belongs to a business: prices are set by the company
  // on the web and shown read-only here.
  const [managedByCompany, setManagedByCompany] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Per-row UI state.
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [rowMsg, setRowMsg] = useState<Record<string, RowMsg>>({});

  const unitLabel = useCallback(
    (unit: ProviderRateItem['pricing_unit']): string =>
      tr(`myPricesScreen.unit.${unit}`) || unit,
    [tr],
  );

  const load = useCallback(async () => {
    setError(null);
    try {
      const { items: rows, managedByCompany: mbc } = await providerService.getProviderRates();
      setItems(rows);
      setManagedByCompany(mbc);
      // Seed the inputs with existing rates (in dollars).
      setInputs((prev) => {
        const next = { ...prev };
        for (const r of rows) {
          if (next[r.task_id] === undefined) next[r.task_id] = centsToStr(r.rate_cents);
        }
        return next;
      });
    } catch (err: unknown) {
      setError(tr('myPricesScreen.loadError') || 'Could not load your services.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [tr]);

  useEffect(() => {
    load();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const onChangeInput = useCallback((taskId: string, raw: string) => {
    // Allow digits + a single decimal point.
    const cleaned = raw.replace(/[^0-9.]/g, '');
    const parts = cleaned.split('.');
    const formatted = parts.length > 2 ? `${parts[0]}.${parts.slice(1).join('')}` : cleaned;
    setInputs((p) => ({ ...p, [taskId]: formatted }));
    setRowMsg((p) => ({ ...p, [taskId]: undefined as unknown as RowMsg }));
  }, []);

  const handleSave = useCallback(
    async (item: ProviderRateItem) => {
      const raw = inputs[item.task_id] ?? '';
      const dollars = parseFloat(raw);
      if (isNaN(dollars) || dollars < 0) {
        setRowMsg((p) => ({ ...p, [item.task_id]: { type: 'err', text: tr('myPricesScreen.invalidAmount') || 'Enter a valid amount.' } }));
        return;
      }
      const cents = Math.round(dollars * 100);

      // Client-side guardrail check for instant feedback (server re-validates).
      const lo = item.base_price_min_cents;
      const hi = item.base_price_max_cents;
      if ((lo != null && cents < lo) || (hi != null && cents > hi)) {
        const rangeText = `${dollarsLabel(lo)} – ${dollarsLabel(hi)}`;
        setRowMsg((p) => ({
          ...p,
          [item.task_id]: { type: 'err', text: `${tr('myPricesScreen.outOfRange') || 'Allowed range'}: ${rangeText}` },
        }));
        return;
      }

      setSavingId(item.task_id);
      setRowMsg((p) => ({ ...p, [item.task_id]: undefined as unknown as RowMsg }));
      try {
        await providerService.setProviderRate(item.task_id, cents);
        setItems((prev) => prev.map((r) => (r.task_id === item.task_id ? { ...r, rate_cents: cents, is_active: true } : r)));
        setRowMsg((p) => ({ ...p, [item.task_id]: { type: 'ok', text: tr('myPricesScreen.saved') || 'Saved ✓' } }));
      } catch (err: unknown) {
        const status = (err as { statusCode?: number })?.statusCode;
        const msg =
          status === 422
            ? tr('myPricesScreen.outOfRangeServer') || 'Price outside the allowed range.'
            : status === 403
              ? tr('myPricesScreen.notQualified') || 'This service is not approved yet.'
              : tr('myPricesScreen.saveError') || 'Could not save. Try again.';
        setRowMsg((p) => ({ ...p, [item.task_id]: { type: 'err', text: msg } }));
      } finally {
        setSavingId(null);
      }
    },
    [inputs, tr],
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load();
  }, [load]);

  const priceable = items.filter((i) => !i.is_custom_quote);
  const customQuote = items.filter((i) => i.is_custom_quote);

  return (
    <Screen>
      <ScreenTitle
        title={tr('myPricesScreen.title') || 'My Prices'}
        sub={tr('myPricesScreen.subtitle') || '§ Set your rate per service'}
       onBack={navigation.canGoBack() ? () => navigation.goBack() : undefined}
      />

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={t.violet} />
        </View>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.text2} />}
        >
          {error ? (
            <Card padding={VispSpace.card} style={{ marginBottom: 12 }}>
              <Text style={[VispText.body, { color: t.danger }]}>{error}</Text>
            </Card>
          ) : null}

          {items.length === 0 ? (
            <Card accent padding={VispSpace.card}>
              <Eyebrow color={t.violet}>{tr('myPricesScreen.empty') || 'No services yet'}</Eyebrow>
              <Text style={[VispText.body, { color: t.text2, marginTop: 8 }]}>
                {tr('myPricesScreen.emptyBody') ||
                  'Once your services are approved (no pending documents), they appear here so you can set your price.'}
              </Text>
            </Card>
          ) : null}

          {managedByCompany && items.length > 0 ? (
            <Card accent padding={VispSpace.card} style={{ marginBottom: 12 }}>
              <Eyebrow color={t.violet}>{tr('myPricesScreen.companyManagedTitle') || 'Set by your company'}</Eyebrow>
              <Text style={[VispText.body, { color: t.text2, marginTop: 8 }]}>
                {tr('myPricesScreen.companyManagedBody') ||
                  'You work for a business — these prices are set by your company and can’t be changed here.'}
              </Text>
            </Card>
          ) : null}

          {priceable.map((item) => {
            const msg = rowMsg[item.task_id];
            const saving = savingId === item.task_id;
            const rangeText = `${dollarsLabel(item.base_price_min_cents)} – ${dollarsLabel(item.base_price_max_cents)}`;
            return (
              <Card key={item.task_id} padding={VispSpace.card} style={{ marginBottom: 12 }}>
                <View style={styles.headerRow}>
                  <Text style={[VispText.bodyStrong, { color: t.text, flex: 1, marginRight: 8 }]} numberOfLines={2}>
                    {item.task_name}
                  </Text>
                  <View style={[styles.chip, { borderColor: t.border }]}>
                    <Text style={{ fontFamily: FontMono, fontSize: 10, color: t.text3, letterSpacing: 0.5 }}>
                      L{item.level} · {unitLabel(item.pricing_unit)}
                    </Text>
                  </View>
                </View>

                <Eyebrow>{tr('myPricesScreen.allowed') || 'Allowed range'} · {rangeText}</Eyebrow>

                <View style={styles.inputRow}>
                  <View style={[styles.inputBox, { borderColor: t.border, backgroundColor: t.surface }]}>
                    <Text style={{ fontFamily: FontSansBold, fontSize: 18, color: t.text3, marginRight: 2 }}>$</Text>
                    <TextInput
                      style={[styles.input, { color: t.text }]}
                      value={inputs[item.task_id] ?? ''}
                      onChangeText={(v) => onChangeInput(item.task_id, v)}
                      keyboardType="decimal-pad"
                      placeholder="0.00"
                      placeholderTextColor={t.text4}
                      editable={!saving && !managedByCompany}
                    />
                    <Text style={{ fontFamily: FontMono, fontSize: 11, color: t.text3 }}>
                      /{unitLabel(item.pricing_unit)}
                    </Text>
                  </View>

                  {!managedByCompany && (
                    <Pressable
                      onPress={() => handleSave(item)}
                      disabled={saving}
                      style={[styles.saveBtn, { backgroundColor: t.text, opacity: saving ? 0.6 : 1 }]}
                    >
                      {saving ? (
                        <ActivityIndicator size="small" color={t.bg} />
                      ) : (
                        <Text style={[VispText.bodyStrong, { color: t.bg, fontSize: 13 }]}>
                          {tr('myPricesScreen.save') || 'Save'}
                        </Text>
                      )}
                    </Pressable>
                  )}
                </View>

                {msg ? (
                  <Text style={[VispText.caption, { marginTop: 8, color: msg.type === 'ok' ? t.ok : t.danger }]}>
                    {msg.text}
                  </Text>
                ) : null}
              </Card>
            );
          })}

          {customQuote.length > 0 ? (
            <View style={{ marginTop: 4 }}>
              <Eyebrow color={t.text3}>{tr('myPricesScreen.customSection') || 'Quoted per job'}</Eyebrow>
              {customQuote.map((item) => (
                <Card key={item.task_id} padding={VispSpace.card} style={{ marginTop: 8 }}>
                  <Text style={[VispText.bodyStrong, { color: t.text2 }]} numberOfLines={2}>
                    {item.task_name}
                  </Text>
                  <Text style={[VispText.caption, { color: t.text3, marginTop: 4 }]}>
                    {tr('myPricesScreen.customBody') || 'Agreed with the customer before the job starts.'}
                  </Text>
                </Card>
              ))}
            </View>
          ) : null}
        </ScrollView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { paddingHorizontal: VispSpace.gutter, paddingTop: 4, paddingBottom: 40 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8 },
  chip: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: 1 },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10 },
  inputBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  input: { flex: 1, fontFamily: FontMono, fontSize: 18, padding: 0 },
  saveBtn: { paddingHorizontal: 18, paddingVertical: 12, borderRadius: 10, alignItems: 'center', justifyContent: 'center', minWidth: 72 },
});
