/**
 * Dinero en el admin.
 *
 * La BD y la API guardan SIEMPRE centavos (enteros) — nunca floats, para no
 * arrastrar errores de precisión con Stripe. Pero al usuario del admin le
 * mostramos dólares, y sin ceros de más: 2500 -> "25", 2550 -> "25.50".
 */

/** Centavos -> texto para un input en dólares. `null` -> cadena vacía. */
export function centsToInput(cents: number | null | undefined): string {
  if (cents == null || Number.isNaN(cents)) return '';
  const dollars = cents / 100;
  // Sin decimales cuando son .00, con dos cuando los hay.
  return Number.isInteger(dollars) ? String(dollars) : dollars.toFixed(2);
}

/** Texto de un input en dólares -> centavos. Vacío o inválido -> `null`. */
export function inputToCents(value: string): number | null {
  const cleaned = value.trim().replace(/[$,\s]/g, '');
  if (cleaned === '') return null;
  const dollars = Number(cleaned);
  if (!Number.isFinite(dollars)) return null;
  return Math.round(dollars * 100);
}

/** Centavos -> etiqueta para mostrar. 2500 -> "$25", 2550 -> "$25.50". */
export function formatMoney(cents: number | null | undefined): string {
  if (cents == null) return '—';
  return `$${centsToInput(cents)}`;
}

/** Rango de precio para las listas. Colapsa el rango cuando min === max. */
export function formatMoneyRange(
  minCents: number | null | undefined,
  maxCents: number | null | undefined,
): string | null {
  if (minCents == null && maxCents == null) return null;
  if (minCents != null && maxCents != null) {
    return minCents === maxCents
      ? formatMoney(minCents)
      : `${formatMoney(minCents)}–${formatMoney(maxCents)}`;
  }
  return formatMoney(minCents ?? maxCents);
}
