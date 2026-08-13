/**
 * VISP — Cancelar un trabajo con motivo, sin penalización.
 *
 * Lo usan las DOS partes: el cliente desde el seguimiento del trabajo y el
 * proveedor desde su trabajo activo. Es el mismo formulario porque el trabajo del
 * usuario es el mismo —elegir un motivo y explicar— aunque los motivos difieran
 * según el rol; el backend los sirve por rol.
 *
 * Tres cosas que la pantalla deja claras a propósito:
 *   1. **No hay cargo.** Es la duda inmediata de quien va a cancelar, y dudarlo
 *      es lo que hace que alguien se quede en una situación incómoda.
 *   2. El motivo es de una lista cerrada. Los códigos hacen visibles los patrones;
 *      con texto libre no se puede contar nada.
 *   3. VISP lo revisa. No se promete que "afectará su calificación", porque eso
 *      lo decide un admin después — prometerlo aquí sería mentir.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useVispTheme, VispText, VispSpace, VispRadius } from '../theme/visp';
import { useTranslation } from '../i18n';
import { get, post } from '../services/apiClient';

interface CancelReason {
  code: string;
  label: string;
}

interface Props {
  visible: boolean;
  jobId: string;
  /** Determina qué lista de motivos pide al backend. */
  role: 'customer' | 'provider';
  onClose: () => void;
  onCancelled: () => void;
}

export default function CancelWithReasonModal({
  visible,
  jobId,
  role,
  onClose,
  onCancelled,
}: Props): React.JSX.Element {
  const t = useVispTheme();
  const { t: tr } = useTranslation();

  const [reasons, setReasons] = useState<CancelReason[]>([]);
  const [code, setCode] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setCode(null);
    setNote('');
    setError(null);
    (async () => {
      try {
        const data = await get<CancelReason[]>('/jobs/cancel-reasons', { role });
        setReasons(data ?? []);
      } catch {
        setReasons([]);
      }
    })();
  }, [visible, role]);

  // Con "otro motivo" el texto es lo único que explica qué pasó: sin él, el
  // reporte llega a la cola sin nada que revisar. El backend también lo exige.
  const needsNote = code === 'OTHER';
  const canSend = !!code && (!needsNote || note.trim() !== '') && !sending;

  const submit = useCallback(async () => {
    if (!canSend || !code) return;
    setSending(true);
    setError(null);
    try {
      await post(`/jobs/${jobId}/cancel-with-reason`, {
        reasonCode: code,
        note: note.trim() || undefined,
      });
      onCancelled();
      onClose();
    } catch (e: unknown) {
      const msg =
        e && typeof e === 'object' && 'message' in e
          ? String((e as { message: string }).message)
          : tr('cancelReason.failed') || 'Could not cancel. Try again.';
      setError(msg);
    } finally {
      setSending(false);
    }
  }, [canSend, code, jobId, note, onCancelled, onClose, tr]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={() => !sending && onClose()}>
        <Pressable
          style={[styles.sheet, { backgroundColor: t.surface, borderColor: t.border }]}
          onPress={() => {}}
        >
          <Text style={[VispText.headlineMid, { color: t.text }]}>
            {tr('cancelReason.title') || 'Cancel this job'}
          </Text>

          {/* Lo primero que se lee: no hay cargo. */}
          <View style={[styles.freeBanner, { backgroundColor: t.violetDim, borderColor: t.violetLine }]}>
            <Text style={[VispText.body, { color: t.text }]}>
              {tr('cancelReason.free') ||
                'No charge. Cancelling here costs you nothing — VISP reviews what happened.'}
            </Text>
          </View>

          <ScrollView style={{ maxHeight: 320 }} keyboardShouldPersistTaps="handled">
            <Text style={[VispText.eyebrow, { color: t.text3, marginBottom: 8 }]}>
              {(tr('cancelReason.whatHappened') || 'What happened?').toUpperCase()}
            </Text>

            {reasons.map((r) => {
              const active = code === r.code;
              return (
                <Pressable
                  key={r.code}
                  onPress={() => setCode(r.code)}
                  style={[
                    styles.reason,
                    {
                      borderColor: active ? t.violet : t.border,
                      backgroundColor: active ? t.violetDim : 'transparent',
                    },
                  ]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                >
                  <Text style={[VispText.body, { color: active ? t.text : t.text2 }]}>
                    {r.label}
                  </Text>
                </Pressable>
              );
            })}

            <Text style={[VispText.eyebrow, { color: t.text3, marginTop: 16, marginBottom: 6 }]}>
              {(tr('cancelReason.details') || 'Details').toUpperCase()}
              {needsNote ? ' *' : ` (${tr('common.optional') || 'optional'})`}
            </Text>
            <TextInput
              style={[
                styles.note,
                {
                  color: t.text,
                  backgroundColor: t.deep,
                  borderColor: needsNote && note.trim() === '' ? t.danger : t.border,
                },
              ]}
              value={note}
              onChangeText={setNote}
              placeholder={tr('cancelReason.notePlaceholder') || 'Tell us what happened'}
              placeholderTextColor={t.text4}
              multiline
              maxLength={2000}
              textAlignVertical="top"
              editable={!sending}
            />

            {error ? (
              <Text style={[VispText.body, { color: t.danger, marginTop: 10 }]}>{error}</Text>
            ) : null}
          </ScrollView>

          <View style={styles.actions}>
            <Pressable
              style={[styles.btn, { borderColor: t.border, flex: 1 }]}
              onPress={onClose}
              disabled={sending}
            >
              <Text style={[VispText.chip, { color: t.text2 }]}>
                {tr('cancelReason.keep') || 'Keep the job'}
              </Text>
            </Pressable>
            <Pressable
              style={[
                styles.btn,
                {
                  flex: 1,
                  backgroundColor: canSend ? t.danger : t.border,
                  borderColor: canSend ? t.danger : t.border,
                },
              ]}
              onPress={submit}
              disabled={!canSend}
            >
              {sending ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text style={[VispText.chip, { color: canSend ? '#FFFFFF' : t.text3 }]}>
                  {tr('cancelReason.confirm') || 'Cancel job'}
                </Text>
              )}
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: VispSpace.gutter,
    paddingTop: 20,
    paddingBottom: 28,
    gap: 14,
  },
  freeBanner: {
    borderWidth: 1,
    borderRadius: VispRadius.card,
    padding: 12,
  },
  reason: {
    borderWidth: 1,
    borderRadius: VispRadius.card,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 8,
  },
  note: {
    borderWidth: 1,
    borderRadius: VispRadius.card,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 12,
    minHeight: 90,
    fontSize: 15,
  },
  actions: { flexDirection: 'row', gap: 10 },
  btn: {
    height: 50,
    borderRadius: VispRadius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
