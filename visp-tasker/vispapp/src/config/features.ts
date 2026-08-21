/**
 * Interruptores de producto.
 *
 * Aquí se apaga lo que está construido pero todavía no sale al usuario. La regla
 * es apagar la PUERTA, no borrar la habitación: el código se queda, los trabajos
 * históricos siguen abriéndose sin reventar, y encenderlo de nuevo es cambiar un
 * booleano en vez de recuperar pantallas de un commit viejo.
 */

/**
 * Servicios de emergencia (24/7 on-call).
 *
 * APAGADO desde el 2026-08-21 por decisión de Ricardo: no entran en esta versión.
 *
 * No es solo cosmético — detrás no hay nada: en `visp_prod` hay **cero servicios
 * activos** marcados `emergency_eligible` y **cero de nivel 4**. Un cliente que
 * entrara por ahí llegaría a un flujo sin catálogo, que es peor que no ver la
 * puerta. El nivel 4 ya salió del producto (ver CLAUDE.md § El sistema de
 * niveles); el valor sigue en el enum porque Postgres no deja quitarlo y porque
 * los trabajos antiguos aún lo referencian.
 *
 * Qué se apaga: el banner de Home, la única entrada del cliente. Las pantallas de
 * `screens/emergency/` y su navegador se quedan montados a propósito, para que un
 * trabajo de emergencia histórico se pueda seguir abriendo.
 */
export const EMERGENCY_ENABLED = false;
