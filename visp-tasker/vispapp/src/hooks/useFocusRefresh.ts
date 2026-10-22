/**
 * Recarga los datos de una pantalla cuando el usuario la vuelve a ver.
 *
 * Las pestañas (Home, My Jobs, Dashboard, Schedule) se montan una vez y se
 * quedan montadas: un `useEffect` de montaje las carga solo al abrir la app. El
 * 2026-10-22 eso dejó al cliente viendo "Pending · Finding provider" en un
 * trabajo ya aceptado y luego cancelado, y al proveedor sin enterarse de que le
 * habían aceptado la oferta. Mientras no haya notificaciones push, volver a la
 * pantalla es el único momento en que la app puede ponerse al día.
 *
 * Recarga:
 * - al ENFOCAR la pantalla (volver a la pestaña o desde otra pantalla);
 * - al volver la app a primer plano con la pantalla enfocada;
 * - cada `intervalMs` mientras está enfocada, si se pide (para lo que cambia
 *   sin que el usuario haga nada: que le acepten una oferta, que salga hacia él).
 */

import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';

export function useFocusRefresh(refresh: () => unknown, intervalMs?: number): void {
    // La función puede cambiar de identidad en cada render; el ref evita
    // reprogramar el intervalo y el listener cada vez.
    const refreshRef = useRef(refresh);
    useEffect(() => {
        refreshRef.current = refresh;
    }, [refresh]);

    useFocusEffect(
        useCallback(() => {
            refreshRef.current();

            const sub = AppState.addEventListener('change', (state) => {
                if (state === 'active') refreshRef.current();
            });
            const timer =
                intervalMs && intervalMs > 0
                    ? setInterval(() => {
                          if (AppState.currentState === 'active') refreshRef.current();
                      }, intervalMs)
                    : null;

            return () => {
                sub.remove();
                if (timer) clearInterval(timer);
            };
        }, [intervalMs]),
    );
}
