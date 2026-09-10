/**
 * VISP — LegalMarkdown.
 *
 * Pinta el markdown de los contratos legales: encabezados, párrafos, viñetas,
 * cajas de aviso (`> **TÍTULO**`) y tablas.
 *
 * POR QUÉ NO UNA LIBRERÍA DE MARKDOWN
 * -----------------------------------
 * El subconjunto que usan los contratos es pequeño y cerrado —lo genera
 * nuestro propio conversor, no un usuario— y una librería traería estilos que
 * habría que pelear para el modo claro/oscuro. Esto son ~150 líneas y cero
 * dependencias nuevas.
 *
 * LO QUE SE MUESTRA ES LO QUE SE FIRMA
 * ------------------------------------
 * El texto llega del servidor junto con su SHA-256 y ese mismo hash se
 * devuelve al firmar. Por eso aquí NO se recorta, resume ni reordena nada:
 * si la pantalla enseñara algo distinto del texto hasheado, la firma estaría
 * cubriendo un documento que el usuario no vio.
 */

import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useVispTheme } from '../../theme/visp';

type Block =
  | { kind: 'h1' | 'h2' | 'p' | 'em'; text: string }
  | { kind: 'ul'; items: string[] }
  | { kind: 'callout'; title: string; body: string }
  | { kind: 'table'; header: string[]; rows: string[][] };

const TABLE_ROW = /^\|(.+)\|\s*$/;
const TABLE_SEP = /^\|[\s:|-]+\|\s*$/;

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim().replace(/\\\|/g, '|'));
}

/** Quita el marcado en línea que no pintamos (**negrita** dentro de celdas). */
function plain(s: string): string {
  return s.replace(/\*\*/g, '');
}

export function parseLegalMarkdown(md: string): Block[] {
  const lines = md.split('\n');
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const raw = lines[i];
    const line = raw.trim();

    if (!line) {
      i += 1;
      continue;
    }

    // Tabla
    if (TABLE_ROW.test(line) && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1].trim())) {
      const header = splitRow(line);
      const rows: string[][] = [];
      let j = i + 2;
      while (j < lines.length && TABLE_ROW.test(lines[j].trim())) {
        rows.push(splitRow(lines[j].trim()));
        j += 1;
      }
      blocks.push({ kind: 'table', header, rows });
      i = j;
      continue;
    }

    // Caja de aviso
    if (line.startsWith('>')) {
      const buf: string[] = [];
      let j = i;
      while (j < lines.length && lines[j].trim().startsWith('>')) {
        buf.push(lines[j].trim().replace(/^>\s?/, '').trim());
        j += 1;
      }
      const title = (buf[0] || '').replace(/\*\*/g, '');
      const body = buf.slice(1).filter(Boolean).join(' ');
      blocks.push({ kind: 'callout', title, body });
      i = j;
      continue;
    }

    // Viñetas (se agrupan las consecutivas en una sola lista)
    if (line.startsWith('- ')) {
      const items: string[] = [];
      let j = i;
      while (j < lines.length && lines[j].trim().startsWith('- ')) {
        items.push(plain(lines[j].trim().slice(2).trim()));
        j += 1;
      }
      blocks.push({ kind: 'ul', items });
      i = j;
      continue;
    }

    if (line.startsWith('## ')) {
      blocks.push({ kind: 'h2', text: line.slice(3).trim() });
      i += 1;
      continue;
    }
    if (line.startsWith('# ')) {
      blocks.push({ kind: 'h1', text: line.slice(2).trim() });
      i += 1;
      continue;
    }

    const isEm = line.startsWith('*') && line.endsWith('*') && !line.startsWith('**');
    blocks.push({ kind: isEm ? 'em' : 'p', text: plain(line.replace(/^\*|\*$/g, '')) });
    i += 1;
  }

  return blocks;
}

interface LegalMarkdownProps {
  markdown: string;
  /** The signing screen renders this final form with live account data and a pad. */
  replaceAcceptanceForm?: boolean;
}

export function LegalMarkdown({ markdown, replaceAcceptanceForm = false }: LegalMarkdownProps): React.JSX.Element {
  const t = useVispTheme();
  const blocks = useMemo(() => parseLegalMarkdown(markdown), [markdown]);

  return (
    <View>
      {blocks.map((b, idx) => {
        switch (b.kind) {
          case 'h1':
            return (
              <Text key={idx} style={[styles.h1, { color: t.text }]}>
                {b.text}
              </Text>
            );
          case 'h2':
            return (
              <Text key={idx} style={[styles.h2, { color: t.text }]}>
                {b.text}
              </Text>
            );
          case 'em':
            return (
              <Text key={idx} style={[styles.em, { color: t.text2 }]}>
                {b.text}
              </Text>
            );
          case 'ul':
            return (
              <View key={idx} style={styles.ul}>
                {b.items.map((item, k) => (
                  <View key={k} style={styles.li}>
                    <Text style={[styles.bullet, { color: t.text3 }]}>•</Text>
                    <Text style={[styles.p, styles.liText, { color: t.text2 }]}>
                      {item}
                    </Text>
                  </View>
                ))}
              </View>
            );
          case 'callout':
            return (
              <View
                key={idx}
                style={[
                  styles.callout,
                  { backgroundColor: t.violetDim, borderColor: t.violetLine },
                ]}
              >
                <Text style={[styles.calloutTitle, { color: t.text }]}>{b.title}</Text>
                {!!b.body && (
                  <Text style={[styles.calloutBody, { color: t.text2 }]}>{b.body}</Text>
                )}
              </View>
            );
          case 'table':
            if (
              replaceAcceptanceForm && idx === blocks.length - 1 &&
              b.header.length === 2 && b.header[0] === 'Field' &&
              b.header[1] === 'Value (filled at acceptance)' &&
              b.rows.length === 5 && b.rows.every((row) => row.length === 2 && !row[1]) &&
              ['Customer Legal Name', 'Service Provider Legal Name'].includes(plain(b.rows[0][0]))
            ) return null;
            // Cada fila se apila como "etiqueta / valor" en vez de en columnas:
            // la matriz de suministros tiene 3 columnas muy anchas y en un
            // móvil en columnas sale ilegible.
            return (
              <View
                key={idx}
                style={[styles.table, { borderColor: t.border, backgroundColor: t.surface }]}
              >
                {b.rows.map((row, r) => (
                  <View
                    key={r}
                    style={[
                      styles.tableRow,
                      r > 0 && { borderTopWidth: 1, borderTopColor: t.border },
                    ]}
                  >
                    {row.map((cell, c) => (
                      <View key={c} style={styles.tableCell}>
                        <Text style={[styles.tableLabel, { color: t.text3 }]}>
                          {plain(b.header[c] || '')}
                        </Text>
                        <Text
                          style={[
                            styles.tableValue,
                            { color: plain(cell) ? t.text2 : t.text3 },
                            !plain(cell) && styles.tableValueEmpty,
                          ]}
                        >
                          {/* La tabla de aceptación del contrato viene EN BLANCO:
                              es el formulario del PDF, y el texto se muestra
                              verbatim porque es lo que se hashea. Un guion suelto
                              se lee como "falta un dato", así que se dice qué pasa
                              con esa casilla. */}
                          {plain(cell) || 'Completed automatically when you accept'}
                        </Text>
                      </View>
                    ))}
                  </View>
                ))}
              </View>
            );
          default:
            return (
              <Text key={idx} style={[styles.p, { color: t.text2 }]}>
                {b.text}
              </Text>
            );
        }
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  h1: { fontSize: 21, fontWeight: '800', marginTop: 8, marginBottom: 12, letterSpacing: -0.4 },
  h2: { fontSize: 15, fontWeight: '700', marginTop: 22, marginBottom: 8, letterSpacing: -0.2 },
  p: { fontSize: 13.5, lineHeight: 21, marginBottom: 12 },
  em: { fontSize: 13, lineHeight: 20, marginBottom: 12, fontStyle: 'italic' },
  ul: { marginBottom: 8 },
  li: { flexDirection: 'row', paddingRight: 4 },
  bullet: { fontSize: 13.5, lineHeight: 21, width: 16 },
  liText: { flex: 1, marginBottom: 8 },
  callout: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginVertical: 10,
  },
  calloutTitle: { fontSize: 12.5, fontWeight: '800', letterSpacing: 0.3, marginBottom: 6 },
  calloutBody: { fontSize: 13, lineHeight: 20 },
  table: { borderWidth: 1, borderRadius: 12, marginVertical: 10, overflow: 'hidden' },
  tableRow: { padding: 12 },
  tableCell: { marginBottom: 8 },
  tableLabel: { fontSize: 10.5, fontWeight: '700', letterSpacing: 0.4, marginBottom: 2 },
  tableValue: { fontSize: 12.5, lineHeight: 19 },
  tableValueEmpty: { fontStyle: 'italic' },
});
