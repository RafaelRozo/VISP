/**
 * Preparación de la cuenta — qué le falta al usuario para poder operar.
 *
 * Alimenta el checklist guiado del Home y los estados vacíos de las pantallas
 * (bolsa de ofertas, ganancias). El backend devuelve HECHOS —qué paso, en qué
 * estado, con qué conteos—; los TEXTOS viven aquí en la app porque tienen que
 * estar traducidos, y un mismo paso se escribe igual en el checklist que en el
 * estado vacío de su pantalla.
 */

import { get } from './apiClient';

/** Claves de paso. Son el contrato con el backend: cada una mapea a una
 *  pantalla y a un texto de `setup.*` en los json de i18n. */
export type ReadinessStepKey =
  | 'contract'
  | 'address'
  | 'services'
  | 'rates'
  | 'payouts'
  | 'profile'
  | 'customer_address'
  | 'payment_method'
  | 'phone';

/**
 * `in_review` es el estado que evita la pregunta número uno de soporte: una
 * casilla sin marcar mientras VISP revisa parece culpa del usuario. No es
 * accionable, así que la fila no se puede tocar.
 */
export type ReadinessStatus = 'done' | 'action_required' | 'in_review' | 'blocked';

export interface ReadinessStep {
  key: ReadinessStepKey;
  status: ReadinessStatus;
  blocking: boolean;
  meta: {
    /** address: ciudad y radio ya guardados. */
    city?: string | null;
    radiusKm?: number | null;
    /** services: cuántos servicios cualificados. */
    count?: number;
    /** rates: cuántos de los tarifables tienen precio. */
    withRate?: number;
    total?: number;
    /** payouts: tramos del alta de cobros y por dónde reanudar. */
    done?: number;
    resumeAt?: string;
    /** profile: la bio. Solo la bio — las «3 fotos» que pedía antes ni existían
     *  como regla en el backend ni se contaban de la tabla vigente. */
    hasBio?: boolean;
  };
}

export interface Readiness {
  role: 'provider' | 'customer';
  steps: ReadinessStep[];
  doneCount: number;
  totalCount: number;
  /** El único paso destacado: el primer bloqueante sin hacer. Un checklist
   *  donde todo grita a la vez no guía, abruma. */
  nextKey: ReadinessStepKey | null;
  /** Cuando es true el checklist NO se pinta. No se queda en verde. */
  allDone: boolean;
  blockingCount: number;
}

export const readinessService = {
  get(role: 'provider' | 'customer'): Promise<Readiness> {
    return get<Readiness>('/users/me/readiness', { role });
  },
};

/** El paso pedido, o undefined. Para los estados vacíos, que solo miran uno. */
export function findStep(
  readiness: Readiness | null,
  key: ReadinessStepKey,
): ReadinessStep | undefined {
  return readiness?.steps.find((s) => s.key === key);
}

export default readinessService;
