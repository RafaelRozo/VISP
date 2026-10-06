/**
 * VISP — Denunciar (Apple, guía 1.2).
 *
 * Un solo formulario para todo lo denunciable: un mensaje del chat, los
 * detalles o fotos del cliente, la tarjeta del proveedor o la persona. Lo que
 * cambia es el `target`; a quién se denuncia lo decide el servidor.
 *
 * "Bloquear también" solo se ofrece donde se puede bloquear directamente
 * (`allowBlock`). Con un trabajo asignado, bloquear pasa por el botón de pánico,
 * y si aun así el servidor responde `job_active`, se avisa con `onJobActive`.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useVispTheme, VispText, VispSpace, VispRadius } from '../theme/visp';
import { useTranslation } from '../i18n';
import { Icon } from './visp';
import {
  REPORT_REASONS,
  activeJobFromError,
  reportContent,
  type ReportReason,
  type ReportTarget,
} from '../services/moderationService';

const MAX_NOTE = 500;

interface Props {
  visible: boolean;
  target: ReportTarget | null;
  /** Para los textos ("Kelly también queda bloqueada"). */
  otherName?: string;
  allowBlock: boolean;
  onClose: () => void;
  /** La denuncia se guardó. `blocked` = también se bloqueó. */
  onDone?: (blocked: boolean) => void;
  /** Bloquear no se pudo porque hay un trabajo asignado: abrir su botón de pánico. */
  onJobActive?: (jobId: string) => void;
}

export default function ReportSheet({
  visible,
  target,
  otherName,
  allowBlock,
  onClose,
  onDone,
  onJobActive,
}: Props): React.JSX.Element {
  const t = useVispTheme();
  const { t: tr } = useTranslation();
  const name = otherName || tr('moderation.thisPerson');

  const [reason, setReason] = useState<ReportReason | null>(null);
  const [note, setNote] = useState('');
  const [block, setBlock] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setReason(null);
    setNote('');
    setBlock(allowBlock);
    setError(null);
  }, [visible, allowBlock]);

  // Con "otra cosa" la nota es lo único que explica la denuncia. El backend también lo exige.
  const needsNote = reason === 'OTHER';
  const canSend = !!target && !!reason && (!needsNote || note.trim() !== '') && !sending;

  const submit = useCallback(async () => {
    if (!canSend || !target || !reason) return;
    setSending(true);
    setError(null);
    const withBlock = allowBlock && block;
    try {
      const res = await reportContent(target, reason, note.trim() || undefined, withBlock);
      onClose();
      onDone?.(res.blocked);
      Alert.alert(
        tr('moderation.sentTitle'),
        res.blocked
          ? `${tr('moderation.sentBody')}\n\n${tr('moderation.sentBlocked', { name })}`
          : tr('moderation.sentBody'),
      );
    } catch (err) {
      const activeJob = activeJobFromError(err);
      if (activeJob && onJobActive) {
        onClose();
        onJobActive(activeJob);
        return;
      }
      setError(tr('moderation.failed'));
    } finally {
      setSending(false);
    }
  }, [allowBlock, block, canSend, name, note, onClose, onDone, onJobActive, reason, target, tr]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      {/* La nota está al final de la hoja: sin esto el teclado la tapa. */}
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Pressable style={styles.backdrop} onPress={() => !sending && onClose()}>
        <Pressable
          style={[styles.sheet, { backgroundColor: t.surface, borderColor: t.border }]}
          onPress={() => {}}
        >
          <Text style={[VispText.headlineMid, { color: t.text }]}>{tr('moderation.sheetTitle')}</Text>

          <ScrollView style={{ maxHeight: 380 }} keyboardShouldPersistTaps="handled">
            <Text style={[VispText.eyebrow, { color: t.text3, marginBottom: 8 }]}>
              {tr('moderation.reasonQuestion').toUpperCase()}
            </Text>

            {REPORT_REASONS.map((r) => {
              const active = reason === r;
              return (
                <Pressable
                  key={r}
                  onPress={() => setReason(r)}
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
                    {tr(`moderation.reasons.${r}`)}
                  </Text>
                </Pressable>
              );
            })}

            <Text style={[VispText.eyebrow, { color: t.text3, marginTop: 16, marginBottom: 6 }]}>
              {tr('moderation.details').toUpperCase()}
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
              placeholder={needsNote ? tr('moderation.noteRequired') : tr('moderation.notePlaceholder')}
              placeholderTextColor={t.text4}
              multiline
              maxLength={MAX_NOTE}
              textAlignVertical="top"
              editable={!sending}
            />

            {allowBlock ? (
              <Pressable
                style={styles.blockRow}
                onPress={() => setBlock((b) => !b)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: block }}
              >
                <View
                  style={[
                    styles.checkbox,
                    {
                      borderColor: block ? t.danger : t.border,
                      backgroundColor: block ? t.danger : 'transparent',
                    },
                  ]}
                >
                  {block ? <Icon name="check" size={14} color="#FFFFFF" /> : null}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[VispText.body, { color: t.text }]}>{tr('moderation.alsoBlock')}</Text>
                  <Text style={[VispText.body, { color: t.text3, fontSize: 13 }]}>
                    {tr('moderation.alsoBlockHint')}
                  </Text>
                </View>
              </Pressable>
            ) : null}

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
              <Text style={[VispText.chip, { color: t.text2 }]}>{tr('moderation.cancel')}</Text>
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
              accessibilityRole="button"
            >
              {sending ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text style={[VispText.chip, { color: canSend ? '#FFFFFF' : t.text3 }]}>
                  {tr('moderation.send')}
                </Text>
              )}
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
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
    minHeight: 80,
    fontSize: 15,
  },
  blockRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginTop: 16,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
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
