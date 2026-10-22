/**
 * Cuándo puede el proveedor salir hacia el cliente.
 *
 * Una sola regla para Schedule y para la pantalla del trabajo: antes solo la
 * aplicaba Schedule (con 10 min) y desde el panel se podía arrancar la ruta a
 * cualquier hora.
 */

// Minutos antes de la cita en que se puede abrir el trabajo y empezar la ruta.
// Eran 10: a 15 min de la cita decía "demasiado pronto", y en el GTA un trayecto
// normal son 30–50 min. Decisión de Ricardo, 2026-10-22: 60.
export const EARLY_START_MINUTES = 60;

/**
 * Minutos que faltan para la cita, o null si no se sabe.
 *
 * `startsAt` es el instante que manda el servidor (ISO con zona). La hora local
 * sin zona (`2026-10-22T11:00:00`) NO sirve para esto: `new Date()` la lee con
 * la zona del teléfono, y en un teléfono en México las 11:00 de Toronto se
 * volvían las 13:00 —el botón se abría con dos horas de retraso—. Solo se usa
 * como respaldo si el backend aún no manda el instante.
 */
export function minutesUntilStart(
  startsAt: string | null | undefined,
  localFallback?: string | null,
): number | null {
  const source = startsAt ?? localFallback;
  if (!source) return null;
  const t = new Date(source).getTime();
  if (Number.isNaN(t)) return null;
  return (t - Date.now()) / 60000;
}

/** Minutos que aún faltan para poder salir, o 0 si ya se puede. */
export function minutesUntilCanStart(
  startsAt: string | null | undefined,
  localFallback?: string | null,
): number {
  const left = minutesUntilStart(startsAt, localFallback);
  if (left == null) return 0;
  return Math.max(0, Math.ceil(left - EARLY_START_MINUTES));
}
