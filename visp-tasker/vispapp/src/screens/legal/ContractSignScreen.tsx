/**
 * VISP — ContractSignScreen.
 *
 * La puerta legal: se abre nada más crear la cuenta y no deja pasar hasta que
 * el usuario ha aceptado lo que le corresponde por su rol.
 *
 * QUIÉN FIRMA QUÉ
 * ---------------
 * El rol no es una cadena: en la base son dos banderas independientes
 * (`role_customer`, `role_provider`). Quien es las dos cosas FIRMA el contrato
 * de proveedor —porque es proveedor— y ADEMÁS acepta el del cliente —porque
 * también reserva—. Son dos relaciones distintas con VISP y cada una deja su
 * propia fila. El servidor decide la lista en `GET /consents/pending`; esta
 * pantalla solo la recorre.
 *
 * POR QUÉ HAY QUE LLEGAR AL FINAL DEL TEXTO
 * -----------------------------------------
 * El botón de aceptar no se habilita hasta que el contrato se ha desplazado
 * hasta abajo. No es adorno: la defensa de un contrato electrónico se apoya en
 * que el firmante tuvo el texto delante, y un botón activo desde el primer
 * segundo dice lo contrario.
 *
 * SIN SALIDA
 * ----------
 * No hay botón de atrás ni de "más tarde". Un proveedor sin contrato no puede
 * ofertar, así que dejarle entrar solo lo llevaría a una app donde todo está
 * bloqueado sin explicación.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import * as Device from 'expo-device';
import { Screen, LegalMarkdown, SignaturePad } from '../../components/visp';
import type { SignatureValue } from '../../components/visp/SignaturePad';
import { GlassButton } from '../../components/glass';
import { useVispTheme } from '../../theme/visp';
import { useAuthStore } from '../../stores/authStore';
import * as legalService from '../../services/legalService';
import type { ConsentType, PendingConsent } from '../../services/legalService';

const TITLES: Record<string, string> = {
  provider_ic_agreement: 'Service Provider Agreement',
  customer_service_agreement: 'Customer Agreement',
  platform_tos: 'Terms of Service',
  privacy_policy: 'Privacy Policy',
};

/** Margen de tolerancia: llegar "al final" no debe exigir el píxel exacto. */
const SCROLL_END_SLACK = 48;

interface ContractSignScreenProps {
  /** Se llama cuando ya no queda nada por firmar. */
  onCompleted: () => void;
}

export function ContractSignScreen({
  onCompleted,
}: ContractSignScreenProps): React.JSX.Element {
  const t = useVispTheme();
  const user = useAuthStore((s) => s.user);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [queue, setQueue] = useState<PendingConsent[]>([]);
  const [index, setIndex] = useState(0);
  const [doc, setDoc] = useState<legalService.LegalDocument | null>(null);

  const [legalName, setLegalName] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [accountEmail, setAccountEmail] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [reachedEnd, setReachedEnd] = useState(false);
  const [signature, setSignature] = useState<SignatureValue | null>(null);

  const scrollRef = useRef<ScrollView>(null);

  const currentPending = queue[index];

  // ── Carga de la cola ──────────────────────────────────────────────────
  const loadQueue = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const pending = await legalService.getPendingConsents();
      if (pending.pending.length === 0) {
        onCompleted();
        return;
      }
      setQueue(pending.pending);
      setIndex(0);
      // Precargado y EDITABLE: el campo del contrato es "Legal Name" y debe
      // coincidir con la identificación oficial. Quien se registró como
      // "Richie" y cuya ID dice "Ricardo" tiene que poder corregirlo.
      setLegalName(
        pending.suggestedLegalName ||
          [user?.firstName, user?.lastName].filter(Boolean).join(' '),
      );
      setAccountEmail(pending.accountEmail);
    } catch (e: any) {
      setLoadError(
        e?.response?.data?.detail ||
          'Could not load your agreement. Check your connection and try again.',
      );
    } finally {
      setLoading(false);
    }
  }, [onCompleted, user?.firstName, user?.lastName]);

  useEffect(() => {
    loadQueue();
  }, [loadQueue]);

  // ── Carga del documento en curso ──────────────────────────────────────
  useEffect(() => {
    if (!currentPending) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      setLoadError(null);
      setDoc(null);
      setAccepted(false);
      setReachedEnd(false);
      setSignature(null);
      try {
        const d = await legalService.getLegalDocument(currentPending.consentType);
        if (!cancelled) {
          setDoc(d);
          scrollRef.current?.scrollTo({ y: 0, animated: false });
        }
      } catch (e: any) {
        if (!cancelled) {
          setLoadError(
            e?.response?.data?.detail || 'Could not load the agreement text.',
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [currentPending]);

  // ── Scroll hasta el final ─────────────────────────────────────────────
  const handleScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
      const atEnd =
        layoutMeasurement.height + contentOffset.y >=
        contentSize.height - SCROLL_END_SLACK;
      if (atEnd) setReachedEnd(true);
    },
    [],
  );

  const needsSignature = !!currentPending && (
    currentPending.consentType === 'customer_service_agreement' ||
    currentPending.consentType === 'provider_ic_agreement' ||
    currentPending.requiresSignature || !!doc?.requiresSignature
  );
  const hasSignature = !!signature && signature.strokes.some((stroke) => stroke.length >= 2);
  const nameOk = legalName.trim().length >= 2;

  const canSubmit =
    !!doc && doc.consentType === currentPending?.consentType &&
    !submitting &&
    reachedEnd &&
    accepted &&
    nameOk &&
    (!needsSignature || hasSignature);

  // ── Envío ─────────────────────────────────────────────────────────────
  const handleSubmit = useCallback(async () => {
    if (!doc || !currentPending || !canSubmit) return;
    setSubmitting(true);
    try {
      await legalService.signConsent({
        consentType: currentPending.consentType,
        signedFullName: legalName.trim(),
        businessName: businessName.trim() || undefined,
        // El hash del texto que ESTA pantalla mostró. El servidor lo compara
        // con el de la versión vigente y rechaza la firma si no coinciden.
        documentHash: doc.hash,
        // El identificador del aparato entra en el rastro de auditoría. Sale de
        // `expo-device`, que ya estaba instalado: no vale meter una dependencia
        // nativa nueva por esto, con Expo 55 cada una es riesgo en cada prebuild.
        deviceId: [Device.modelId, Device.osVersion].filter(Boolean).join(' iOS ') || undefined,
        signature:
          needsSignature && signature
            ? {
                width: signature.width,
                height: signature.height,
                strokes: signature.strokes,
              }
            : undefined,
      });

      if (index + 1 < queue.length) {
        setIndex(index + 1);
      } else {
        onCompleted();
      }
    } catch (e: any) {
      const status = e?.response?.status;
      const detail = e?.response?.data?.detail;
      if (status === 409) {
        // El documento cambió entre que se cargó y se firmó: recargar, no
        // reintentar con el hash viejo — se archivaría el texto equivocado.
        Alert.alert(
          'Agreement updated',
          'This agreement was updated while you were reading it. It will reload so you can review the current version.',
          [{ text: 'OK', onPress: loadQueue }],
        );
      } else {
        Alert.alert(
          'Could not submit',
          typeof detail === 'string'
            ? detail
            : 'Something went wrong submitting your acceptance. Please try again.',
        );
      }
    } finally {
      setSubmitting(false);
    }
  }, [
    doc, currentPending, canSubmit, legalName, businessName, needsSignature, signature,
    index, queue.length, onCompleted, loadQueue,
  ]);

  const title = useMemo(
    () =>
      currentPending
        ? TITLES[currentPending.consentType] || 'Agreement'
        : 'Agreement',
    [currentPending],
  );

  // ── Estados de carga / error ──────────────────────────────────────────
  if (loading && !doc) {
    return (
      <Screen edges={['top', 'bottom']}>
        <View style={styles.center}>
          <ActivityIndicator color={t.violet} />
          <Text style={[styles.centerText, { color: t.text3 }]}>
            Loading your agreement…
          </Text>
        </View>
      </Screen>
    );
  }

  if (loadError && !doc) {
    return (
      <Screen edges={['top', 'bottom']}>
        <View style={styles.center}>
          <Text style={[styles.errorTitle, { color: t.text }]}>
            Could not load
          </Text>
          <Text style={[styles.centerText, { color: t.text3 }]}>{loadError}</Text>
          <GlassButton title="Try again" onPress={loadQueue} style={styles.retry} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen edges={['top', 'bottom']}>
      {/* Cabecera: sin botón de atrás a propósito. */}
      <View style={[styles.header, { borderBottomColor: t.border }]}>
        <View style={styles.headerText}>
          <Text style={[styles.eyebrow, { color: t.text3 }]}>
            {queue.length > 1
              ? `STEP ${index + 1} OF ${queue.length}`
              : 'BEFORE YOU START'}
          </Text>
          <Text style={[styles.title, { color: t.text }]}>{title}</Text>
          {!!doc && (
            <Text style={[styles.version, { color: t.text3 }]}>
              Version {doc.version}
            </Text>
          )}
        </View>
      </View>

      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        onScroll={handleScroll}
        scrollEventThrottle={64}
        keyboardShouldPersistTaps="handled"
      >
        {!!doc && <LegalMarkdown markdown={doc.text} replaceAcceptanceForm />}

        {/* Aviso de idioma: los contratos solo existen en inglés todavía; el
            francés está en revisión legal. Un contrato no se traduce a medias. */}
        <Text style={[styles.langNote, { color: t.text3 }]}>
          This agreement is currently available in English only.
        </Text>

        <View style={[styles.divider, { backgroundColor: t.border }]} />

        {/* The final blank form is completed here; the original document/hash
            stays intact and the server archives these fields with the drawing. */}
        <View
          style={[
            styles.recordCard,
            { backgroundColor: t.surface, borderColor: t.border },
          ]}
        >
          <Text style={[styles.recordTitle, { color: t.text }]}>
            {currentPending?.consentType === 'provider_ic_agreement'
              ? 'Service provider acceptance and signature'
              : 'Customer acceptance and signature'}
          </Text>
          {[
            ['Legal name', legalName.trim() || '—'],
            ['Business name (if applicable)', businessName.trim() || '—'],
            ['Account email', accountEmail || '—'],
            ['Account ID', user?.id || '—'],
            ['Agreement version', doc ? `v${doc.version}` : '—'],
            ['Acceptance date', 'Recorded when you sign (Ontario time)'],
          ].map(([k, v]) => (
            <View key={k} style={styles.recordRow}>
              <Text style={[styles.recordKey, { color: t.text3 }]}>{k}</Text>
              <Text style={[styles.recordValue, { color: t.text2 }]}>
                {v}
              </Text>
            </View>
          ))}
          <Text style={[styles.recordNote, { color: t.text3 }]}>
            Your signature, these details, the acceptance record ID, date and
            time, IP address, device and agreement text will be archived in your signed PDF.
          </Text>
        </View>

        {/* ── Nombre legal ── */}
        <Text style={[styles.label, { color: t.text }]}>Full legal name</Text>
        <Text style={[styles.help, { color: t.text3 }]}>
          Must match your government-issued ID.
        </Text>
        <TextInput
          value={legalName}
          onChangeText={setLegalName}
          placeholder="Full legal name"
          placeholderTextColor={t.text4}
          autoCapitalize="words"
          autoCorrect={false}
          style={[
            styles.input,
            { color: t.text, backgroundColor: t.surface, borderColor: t.border },
          ]}
        />

        <Text style={[styles.label, { color: t.text }]}>Business name (optional)</Text>
        <TextInput
          value={businessName}
          onChangeText={setBusinessName}
          placeholder="Business name, if applicable"
          placeholderTextColor={t.text4}
          autoCapitalize="words"
          style={[
            styles.input,
            { color: t.text, backgroundColor: t.surface, borderColor: t.border },
          ]}
        />

        {/* ── Firma ── */}
        {needsSignature && (
          <>
            <Text style={[styles.label, { color: t.text }]}>Signature</Text>
            <Text style={[styles.help, { color: t.text3 }]}>
              Sign with your finger.
            </Text>
            <SignaturePad
              key={`${currentPending?.consentType}:${doc?.version}`}
              onChange={setSignature}
              caption={legalName.trim() || undefined}
            />
          </>
        )}

        {/* ── Aceptación ── */}
        <TouchableOpacity
          style={styles.checkboxRow}
          onPress={() => setAccepted((v) => !v)}
          activeOpacity={0.7}
        >
          <View
            style={[
              styles.checkbox,
              { borderColor: accepted ? t.violet : t.borderStrong },
              accepted && { backgroundColor: t.violet },
            ]}
          >
            {accepted && <Text style={styles.checkMark}>✓</Text>}
          </View>
          <Text style={[styles.checkboxText, { color: t.text2 }]}>
            I have read and agree to the {title} (version {doc?.version}).
          </Text>
        </TouchableOpacity>

        {!reachedEnd && (
          <Text style={[styles.gateHint, { color: t.text3 }]}>
            Scroll to the end of the agreement to continue.
          </Text>
        )}
      </ScrollView>

      <View style={[styles.footer, { borderTopColor: t.border, backgroundColor: t.bg }]}>
        <GlassButton
          title={
            submitting
              ? 'Submitting…'
              : index + 1 < queue.length
                ? 'Agree and continue'
                : 'Agree and finish'
          }
          onPress={handleSubmit}
          disabled={!canSubmit}
          loading={submitting}
          variant="glow"
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  centerText: { fontSize: 13, marginTop: 12, textAlign: 'center' },
  errorTitle: { fontSize: 17, fontWeight: '700' },
  retry: { marginTop: 20, minWidth: 160 },

  header: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 14, borderBottomWidth: 1 },
  headerText: {},
  eyebrow: { fontSize: 10.5, fontWeight: '800', letterSpacing: 1.1 },
  title: { fontSize: 22, fontWeight: '800', marginTop: 4, letterSpacing: -0.5 },
  version: { fontSize: 11.5, marginTop: 2 },

  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 32 },

  langNote: { fontSize: 11.5, fontStyle: 'italic', marginTop: 16 },
  divider: { height: 1, marginVertical: 24 },

  recordCard: { borderWidth: 1, borderRadius: 14, padding: 14, marginBottom: 24 },
  recordTitle: { fontSize: 13, fontWeight: '800', letterSpacing: 0.2, marginBottom: 10 },
  recordRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, marginBottom: 6 },
  recordKey: { fontSize: 12 },
  recordValue: { fontSize: 12.5, fontWeight: '600', flexShrink: 1, textAlign: 'right' },
  recordNote: { fontSize: 11, lineHeight: 16, marginTop: 8 },

  label: { fontSize: 14, fontWeight: '700', marginTop: 8 },
  help: { fontSize: 12, marginTop: 2, marginBottom: 10 },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 15,
    marginBottom: 20,
  },

  checkboxRow: { flexDirection: 'row', alignItems: 'flex-start', marginTop: 24 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    marginTop: 1,
  },
  checkMark: { color: '#FFFFFF', fontSize: 13, fontWeight: '900' },
  checkboxText: { flex: 1, fontSize: 13.5, lineHeight: 20 },
  gateHint: { fontSize: 12, marginTop: 14, textAlign: 'center' },

  footer: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8, borderTopWidth: 1 },
});

export default ContractSignScreen;
