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

  acceptTos(): Promise<PayoutStatus> {
    return post<PayoutStatus>(`${BASE}/tos`, { accepted: true });
  },
};
