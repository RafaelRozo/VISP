/**
 * VISP — Terms and Conditions.
 *
 * El texto viene del SERVIDOR, no de la app.
 *
 * Hasta hoy estaba incrustado aquí: 14 secciones en EN y FR que describían un
 * sistema de «Tier 1-4» retirado del producto el 04-08-2026 (los niveles son
 * L0-L3). O sea que la pantalla que explica las reglas contradecía a la propia
 * app, y cada cambio del abogado exigía una versión nueva en la App Store.
 *
 * Ahora se pide `GET /consents/document/platform_tos` y se pinta con el mismo
 * `LegalMarkdown` que ya usa la pantalla de firma, así que el usuario lee
 * EXACTAMENTE el mismo texto que el backend archiva y hashea. Un solo sitio.
 *
 * Solo inglés, como el resto de los documentos legales: el francés está en
 * revisión del abogado. Cuando exista, lo servirá el backend por idioma — no
 * volverá aquí.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Screen, LegalMarkdown } from '../../components/visp';
import { useTheme } from '../../theme/ThemeContext';
import { useTranslation } from '../../i18n';
import { Colors } from '../../theme/colors';
import { getLegalDocument, LegalDocument } from '../../services/legalService';

export default function TermsScreen(): React.JSX.Element {
  const theme = useTheme();
  const { t } = useTranslation();
  const [doc, setDoc] = useState<LegalDocument | null>(null);
  const [fallo, setFallo] = useState(false);

  const cargar = useCallback(() => {
    setFallo(false);
    setDoc(null);
    getLegalDocument('platform_tos')
      .then(setDoc)
      .catch(() => setFallo(true));
  }, []);

  useEffect(cargar, [cargar]);

  return (
    <Screen>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        {doc ? (
          <>
            {/* La versión y la fecha son parte del documento: quien lo lee tiene
                que poder decir cuál leyó. */}
            <Text style={[styles.version, { color: theme.textSecondary }]}>
              {t('termsScreen.version', { version: doc.version })}
            </Text>
            <LegalMarkdown markdown={doc.text} />
          </>
        ) : fallo ? (
          // Sin inventar nada: enseñar una copia vieja guardada en la app sería
          // volver al problema que esta pantalla acaba de resolver.
          <View style={styles.centro}>
            <Text style={[styles.error, { color: theme.textPrimary }]}>
              {t('termsScreen.loadFailed')}
            </Text>
            <Pressable onPress={cargar} style={[styles.reintentar, { borderColor: Colors.primary }]}>
              <Text style={[styles.reintentarTexto, { color: Colors.primary }]}>
                {t('common.retry')}
              </Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.centro}>
            <ActivityIndicator color={Colors.primary} />
          </View>
        )}
        <View style={styles.spacer} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { padding: 20, paddingBottom: 60 },
  version: { fontSize: 12, marginBottom: 16 },
  centro: { paddingVertical: 60, alignItems: 'center' },
  error: { fontSize: 15, textAlign: 'center', marginBottom: 16 },
  reintentar: { paddingVertical: 10, paddingHorizontal: 20, borderRadius: 10, borderWidth: 1 },
  reintentarTexto: { fontSize: 14, fontWeight: '700' },
  spacer: { height: 40 },
});
