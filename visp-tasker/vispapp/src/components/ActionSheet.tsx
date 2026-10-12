/**
 * Hoja de opciones para iOS y Android con una sola llamada.
 *
 * `showActionSheet` tiene la misma firma que
 * `ActionSheetIOS.showActionSheetWithOptions`:
 * - iOS: llama a ActionSheetIOS tal cual. Nada cambia allí.
 * - Android: abre una hoja inferior propia. El `Alert.alert` que se usaba de
 *   reserva enseña como mucho 3 botones, y la bolsa de trabajos (descripción,
 *   fotos, persona, bloquear) o la lista de credenciales perdían opciones.
 *
 * Necesita <ActionSheetHost /> montado una vez en la raíz (App.tsx).
 */

import React, { useEffect, useState } from 'react';
import {
  ActionSheetIOS,
  ActionSheetIOSOptions,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useVispTheme, VispSpace } from '../theme/visp';

type Callback = (buttonIndex: number) => void;
type Request = { options: ActionSheetIOSOptions; callback: Callback };

let presentOnHost: ((req: Request) => void) | null = null;

export function showActionSheet(options: ActionSheetIOSOptions, callback: Callback): void {
  if (Platform.OS === 'ios') {
    ActionSheetIOS.showActionSheetWithOptions(options, callback);
    return;
  }
  if (!presentOnHost) {
    // Sin host no hay hoja: mejor un aviso en el log que un toque que no hace nada en silencio.
    console.warn('[ActionSheet] <ActionSheetHost /> no está montado');
    return;
  }
  presentOnHost({ options, callback });
}

function isDestructive(index: number, d: ActionSheetIOSOptions['destructiveButtonIndex']): boolean {
  return Array.isArray(d) ? d.includes(index) : d === index;
}

export function ActionSheetHost(): React.JSX.Element | null {
  const t = useVispTheme();
  const insets = useSafeAreaInsets();
  const [req, setReq] = useState<Request | null>(null);

  useEffect(() => {
    if (Platform.OS === 'ios') return undefined;
    presentOnHost = setReq;
    return () => {
      presentOnHost = null;
    };
  }, []);

  if (Platform.OS === 'ios' || !req) return null;

  const { options, callback } = req;
  const cancelIndex = options.cancelButtonIndex ?? -1;
  const disabled = options.disabledButtonIndices ?? [];

  const pick = (index: number) => {
    setReq(null);
    callback(index);
  };
  // Atrás del sistema o tocar fuera = cancelar, igual que en iOS.
  const cancel = () => pick(cancelIndex >= 0 ? cancelIndex : options.options.length);

  return (
    <Modal
      visible
      transparent
      animationType="slide"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={cancel}
    >
      <Pressable style={styles.backdrop} onPress={cancel}>
        <Pressable
          style={[
            styles.sheet,
            { backgroundColor: t.surface, borderColor: t.border, paddingBottom: 12 + insets.bottom },
          ]}
          onPress={() => {}}
        >
          {options.title || options.message ? (
            <View style={styles.header}>
              {options.title ? (
                <Text style={[styles.title, { color: t.text }]}>{options.title}</Text>
              ) : null}
              {options.message ? (
                <Text style={[styles.message, { color: t.text2 }]}>{options.message}</Text>
              ) : null}
            </View>
          ) : null}

          <ScrollView style={styles.list} bounces={false}>
            {options.options.map((label, i) =>
              i === cancelIndex ? null : (
                <Pressable
                  key={`${i}-${label}`}
                  disabled={disabled.includes(i)}
                  onPress={() => pick(i)}
                  android_ripple={{ color: t.border }}
                  style={[styles.row, { borderTopColor: t.border }]}
                  accessibilityRole="button"
                >
                  <Text
                    style={[
                      styles.rowText,
                      { color: isDestructive(i, options.destructiveButtonIndex) ? t.danger : t.text },
                      disabled.includes(i) && { color: t.text4 },
                    ]}
                  >
                    {label}
                  </Text>
                </Pressable>
              ),
            )}
          </ScrollView>

          {cancelIndex >= 0 ? (
            <Pressable
              onPress={() => pick(cancelIndex)}
              android_ripple={{ color: t.border }}
              style={[styles.cancel, { backgroundColor: t.card, borderColor: t.border }]}
              accessibilityRole="button"
            >
              <Text style={[styles.cancelText, { color: t.text }]}>
                {options.options[cancelIndex]}
              </Text>
            </Pressable>
          ) : null}
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
    paddingTop: 16,
    maxHeight: '80%',
  },
  header: {
    paddingBottom: 12,
    gap: 4,
  },
  title: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 16,
    textAlign: 'center',
  },
  message: {
    fontFamily: 'Manrope_500Medium',
    fontSize: 13,
    textAlign: 'center',
  },
  list: {
    flexGrow: 0,
  },
  row: {
    minHeight: 52,
    justifyContent: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  rowText: {
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 16,
    textAlign: 'center',
  },
  cancel: {
    marginTop: 12,
    minHeight: 52,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: 'center',
  },
  cancelText: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 16,
    textAlign: 'center',
  },
});
