/**
 * VISP — Stripe Connect Accounts v2 onboarding service.
 *
 * Thin client wrapper for the seven backend endpoints under
 * /api/v1/provider/payouts/v2/*. The mobile onboarding wizard reads
 * `onboardingStep` from getStatus() / each step's response to decide
 * which screen to render next.
 */

import { get, post } from './apiClient';

export type PayoutOnboardingStep =
  | 'init'
  | 'identity'
  | 'tax'
  | 'bank'
  | 'identity_doc'
  | 'tos'
  | 'complete';

export interface PayoutStatus {
  accountId: string | null;
  onboardingStep: PayoutOnboardingStep;
  requirementsDue: string[];
  capabilities: Record<string, unknown>;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  hasExternalAccount: boolean;
  identitySessionId: string | null;
  /**
   * Por qué Stripe no da por buena la identidad. `verificationCode` es su
   * código (`document_name_mismatch`, `document_expired`…) y se traduce;
   * `verificationMessage` es su frase en inglés y se usa de reserva para los
   * códigos que no tengamos traducidos, que es mejor que no decir nada.
   */
  verificationCode: string | null;
  verificationMessage: string | null;
  /**
   * Stripe está pidiendo un documento de identidad. En Canadá Stripe verifica
   * por coincidencia de datos (nombre + fecha + dirección contra registros
   * oficiales), así que esto significa que los datos NO cuadraron — y el
   * culpable casi siempre es el nombre. Llega ya en la respuesta de
   * `submitIdentity`, que es el momento de mandarlo a corregir el nombre en vez
   * de a pelearse con una foto.
   */
  documentRequired: boolean;
  /**
   * El nombre que Stripe tiene en la cuenta, que es el que compara contra los
   * registros oficiales. No es el de la ficha de VISP: ahí puede estar el
   * nombre con el que el proveedor quiere que le vean los clientes.
   */
  legalName: string | null;
}

export interface PayoutIdentityIn {
  first_name: string;
  last_name: string;
  dob_year: number;
  dob_month: number;
  dob_day: number;
  address_line1: string;
  address_city: string;
  address_state: string;
  address_postal_code: string;
  address_country: string;
  phone: string;
  email: string;
}

export interface PayoutTaxIn {
  id_number: string;
}

export interface PayoutBankIn {
  country: string;
  currency: string;
  account_holder_name: string;
  routing_number: string;
  account_number: string;
}

export interface IdentitySessionOut {
  sessionId: string;
  clientSecret: string;
  ephemeralKeySecret: string;
  publishableKey: string;
}

const BASE = '/provider/payouts/v2';

export const payoutsV2Service = {
  init(): Promise<PayoutStatus> {
    return post<PayoutStatus>(`${BASE}/init`);
  },

  getStatus(): Promise<PayoutStatus> {
    return get<PayoutStatus>(`${BASE}/status`);
  },

  submitIdentity(body: PayoutIdentityIn): Promise<PayoutStatus> {
    return post<PayoutStatus>(`${BASE}/identity`, body);
  },

  submitTax(body: PayoutTaxIn): Promise<PayoutStatus> {
    return post<PayoutStatus>(`${BASE}/tax`, body);
  },

  submitBank(body: PayoutBankIn): Promise<PayoutStatus> {
    return post<PayoutStatus>(`${BASE}/bank`, body);
  },

  startIdentityDocument(): Promise<IdentitySessionOut> {
    return post<IdentitySessionOut>(`${BASE}/identity-document`);
  },

  startIdentityLink(): Promise<{ url: string; expiresAt: number }> {
    return post<{ url: string; expiresAt: number }>(`${BASE}/identity-link`);
  },

  acceptTos(): Promise<PayoutStatus> {
    return post<PayoutStatus>(`${BASE}/tos`, { accepted: true });
  },

  /** Hosted Stripe onboarding link to finish verification (incl. the liveness
   * check that the native Identity sheet cannot satisfy on a connected account).
   * Open with WebBrowser; in test mode the page completes with test data. */
  /** URL de VISP que monta el alta de Stripe embebida.
   *
   *  Sustituye a `onboardingLink()`, que devolvía el alta ALOJADA de Stripe —
   *  su registro, con correo y contraseña. Eso es para cuentas donde Stripe
   *  recoge los requisitos; las nuestras declaran `requirement_collection:
   *  application`, así que al proveedor le pedían crearse una cuenta de Stripe
   *  que por diseño nunca va a tener. */
  embedUrl(): Promise<{ url: string }> {
    return post<{ url: string }>(`${BASE}/embed-url`);
  },

  onboardingLink(): Promise<{ url: string }> {
    return post<{ url: string }>(`${BASE}/onboarding-link`);
  },
};
