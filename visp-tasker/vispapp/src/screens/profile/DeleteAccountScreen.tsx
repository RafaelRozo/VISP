/**
 * VISP - Delete Account Screen
 *
 * Apple 5.1.1(v): una app que deja crear cuenta tiene que dejar borrarla desde
 * dentro. Plan: docs/plan-borrar-cuenta.md. Backend:
 * services/account_deletion_service.py.
 *
 * Tres partes:
 *   1. Qué se borra y qué se conserva, en claro.
 *   2. La comprobación previa: lo que BLOQUEA (y cómo resolverlo) o lo que
 *      cambiará solo (trabajos que se cancelan o vuelven al matching).
 *   3. La contraseña para confirmar (D5).
 *
 * La comprobación se repite al volver a la pantalla: el usuario suele salir a
 * cancelar el trabajo que bloquea y volver.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Colors } from '../../theme/colors';
import { useTheme } from '../../theme/ThemeContext';
import { GlassCard, GlassButton } from '../../components/glass';
import { Screen } from '../../components/visp';
import { useTranslation } from '../../i18n';
import { useAuthStore } from '../../stores/authStore';
import {
  userService,
  type DeletionBlocker,
  type DeletionChange,
  type DeletionCheck,
} from '../../services/userService';
import type { ApiError } from '../../types';

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export default function DeleteAccountScreen(): React.JSX.Element {
  const theme = useTheme();
  const { t, language } = useTranslation();
  const logout = useAuthStore((s) => s.logout);
  const locale = language === 'fr' ? 'fr-CA' : 'en-CA';

  const [check, setCheck] = useState<DeletionCheck | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const passwordFocused = useRef(false);

  // El campo y el botón están al final: cuando sube el teclado se baja hasta ahí
  // para que se vea lo que se escribe (el inset lo pone automaticallyAdjustKeyboardInsets).
  useEffect(() => {
    const sub = Keyboard.addListener('keyboardDidShow', () => {
      if (passwordFocused.current) scrollRef.current?.scrollToEnd({ animated: true });
    });
    return () => sub.remove();
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      setCheck(await userService.getDeletionCheck());
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const formatDate = useCallback(
    (iso: string): string => {
      // `YYYY-MM-DD` suelto se interpretaría en UTC y podría pintar el día anterior.
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
      const d = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(iso);
      return d.toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric' });
    },
    [locale],
  );

  const blockerText = useCallback(
    (b: DeletionBlocker): string => {
      if (b.code === 'PAYOUT_PENDING') {
        const amount = money(b.amountCents ?? 0);
        return b.expectedPayoutDate
          ? t('deleteAccount.blocker.PAYOUT_PENDING_DATE', {
              amount,
              date: formatDate(b.expectedPayoutDate),
            })
          : t('deleteAccount.blocker.PAYOUT_PENDING', { amount });
      }
      return t(`deleteAccount.blocker.${b.code}`, { ref: b.reference ?? '' });
    },
    [t, formatDate],
  );

  const changeText = useCallback(
    (c: DeletionChange): string =>
      t(`deleteAccount.change.${c.action}`, { ref: c.reference ?? '', count: c.count ?? 0 }),
    [t],
  );

  const doDelete = useCallback(async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await userService.deleteAccount(password);
      // La despedida va en una alerta NATIVA y la sesión se cierra ya: la alerta
      // sobrevive al cambio de navegador (vuelta al login) y no dependemos de
      // que el usuario la cierre para limpiar el llavero.
      Alert.alert(
        t('deleteAccount.doneTitle'),
        t('deleteAccount.doneBody', { date: formatDate(res.purgeAfter) }),
        [{ text: t('deleteAccount.doneButton') }],
      );
      logout().catch(() => {});
    } catch (err) {
      const e = err as ApiError;
      if (e.code === 'wrong_password') {
        setError(t('deleteAccount.wrongPassword'));
      } else if (e.code === 'deletion_blocked' && e.body) {
        // Algo cambió entre la comprobación y la confirmación: se pinta el plan nuevo.
        setCheck(e.body as unknown as DeletionCheck);
        setError(t('deleteAccount.changed'));
      } else {
        setError(t('deleteAccount.genericError'));
      }
    } finally {
      setSubmitting(false);
    }
  }, [password, t, formatDate, logout]);

  const confirm = useCallback(() => {
    Alert.alert(t('deleteAccount.confirmTitle'), t('deleteAccount.confirmBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('deleteAccount.confirmButton'), style: 'destructive', onPress: doDelete },
    ]);
  }, [t, doDelete]);

  const days = check?.retentionDays ?? 30;
  const canSubmit = !!check?.canDelete && password.length > 0 && !submitting;

  return (
    <Screen>
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.intro, { color: theme.textPrimary }]}>{t('deleteAccount.intro')}</Text>

        <GlassCard variant="dark" padding={16} style={styles.card}>
          <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>
            {t('deleteAccount.whatDeleted')}
          </Text>
          <Text style={[styles.body, { color: theme.textSecondary }]}>
            {t('deleteAccount.deletedItems', { days })}
          </Text>
          <Text style={[styles.cardTitle, styles.spaced, { color: theme.textPrimary }]}>
            {t('deleteAccount.whatKept')}
          </Text>
          <Text style={[styles.body, { color: theme.textSecondary }]}>
            {t('deleteAccount.keptItems')}
          </Text>
        </GlassCard>

        <Text style={[styles.note, { color: theme.textSecondary }]}>
          {t('deleteAccount.restore', { days })}
        </Text>

        {loading && !check ? (
          <View style={styles.center}>
            <ActivityIndicator color={theme.textPrimary} />
            <Text style={[styles.body, styles.spaced, { color: theme.textSecondary }]}>
              {t('deleteAccount.checking')}
            </Text>
          </View>
        ) : loadFailed ? (
          <View style={styles.center}>
            <Text style={[styles.body, { color: theme.textSecondary }]}>
              {t('deleteAccount.loadError')}
            </Text>
            <GlassButton
              title={t('deleteAccount.retry')}
              variant="outline"
              onPress={load}
              style={styles.retry}
            />
          </View>
        ) : check && !check.canDelete ? (
          <GlassCard variant="dark" padding={16} style={styles.card}>
            <Text style={[styles.cardTitle, { color: Colors.emergencyRed }]}>
              {t('deleteAccount.blockedTitle')}
            </Text>
            {check.blockers.map((b, i) => (
              <View key={`${b.code}-${b.jobId ?? i}`} style={styles.item}>
                <Text style={[styles.bullet, { color: Colors.emergencyRed }]}>{'•'}</Text>
                <Text style={[styles.body, styles.itemText, { color: theme.textPrimary }]}>
                  {blockerText(b)}
                </Text>
              </View>
            ))}
          </GlassCard>
        ) : check ? (
          <>
            {check.willChange.length > 0 && (
              <GlassCard variant="dark" padding={16} style={styles.card}>
                <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>
                  {t('deleteAccount.willChangeTitle')}
                </Text>
                {check.willChange.map((c, i) => (
                  <View key={`${c.action}-${c.jobId ?? i}`} style={styles.item}>
                    <Text style={[styles.bullet, { color: theme.textSecondary }]}>{'•'}</Text>
                    <Text style={[styles.body, styles.itemText, { color: theme.textSecondary }]}>
                      {changeText(c)}
                    </Text>
                  </View>
                ))}
              </GlassCard>
            )}

            <Text style={[styles.label, { color: theme.textPrimary }]}>
              {t('deleteAccount.passwordLabel')}
            </Text>
            <TextInput
              style={[
                styles.input,
                { color: theme.inputText, backgroundColor: theme.inputBackground },
              ]}
              placeholder={t('deleteAccount.passwordPlaceholder')}
              placeholderTextColor={theme.inputPlaceholder}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              textContentType="password"
              value={password}
              onChangeText={setPassword}
              onFocus={() => {
                passwordFocused.current = true;
              }}
              onBlur={() => {
                passwordFocused.current = false;
              }}
              returnKeyType="done"
              editable={!submitting}
            />
          </>
        ) : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {check?.canDelete ? (
          <TouchableOpacity
            style={[styles.deleteButton, !canSubmit && styles.deleteDisabled]}
            onPress={confirm}
            disabled={!canSubmit}
            activeOpacity={0.8}
            accessibilityRole="button"
          >
            {submitting ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.deleteText}>{t('deleteAccount.confirmButton')}</Text>
            )}
          </TouchableOpacity>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 48 },
  intro: { fontSize: 16, lineHeight: 22, marginBottom: 16 },
  card: { marginBottom: 16 },
  cardTitle: { fontSize: 15, fontWeight: '700', marginBottom: 6 },
  spaced: { marginTop: 12 },
  body: { fontSize: 14, lineHeight: 20 },
  note: { fontSize: 13, lineHeight: 19, marginBottom: 16 },
  center: { alignItems: 'center', paddingVertical: 24 },
  retry: { marginTop: 12, minWidth: 160 },
  item: { flexDirection: 'row', marginTop: 8 },
  bullet: { fontSize: 14, lineHeight: 20, marginRight: 8 },
  itemText: { flex: 1 },
  label: { fontSize: 14, fontWeight: '600', marginBottom: 8 },
  input: {
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 15,
    marginBottom: 12,
  },
  error: { fontSize: 13, color: Colors.error, marginBottom: 12, textAlign: 'center' },
  deleteButton: {
    backgroundColor: Colors.emergencyRed,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 4,
  },
  deleteDisabled: { opacity: 0.45 },
  deleteText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
});
