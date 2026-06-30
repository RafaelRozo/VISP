/**
 * VISP - Payment Service
 *
 * Handles all API calls related to Stripe payments:
 * - Customer payment intents (create, confirm, cancel)
 * - Payment method listing and attachment
 * - Provider Stripe Connect onboarding and status
 * - Provider balance and payout queries
 *
 * All monetary amounts from the backend are in cents.
 */

import { get, post } from './apiClient';

// ---------------------------------------------------------------------------
// Types -- mirror backend Pydantic schemas (snake_case from API)
// ---------------------------------------------------------------------------

export interface PaymentIntent {
  id: string;
  client_secret: string;
  status: string;
  amount_cents: number;
  currency: string;
}

export interface PaymentConfirmation {
  id: string;
  status: string;
  amount_cents: number;
  currency: string;
  payment_method_id: string | null;
}

export interface CancelPaymentResult {
  cancelled: boolean;
  payment_intent_id: string;
}

export interface PaymentMethodInfo {
  id: string;
  type: string;
  last4: string;
  brand: string;
  exp_month: number;
  exp_year: number;
}

export interface PaymentMethodList {
  methods: PaymentMethodInfo[];
  count: number;
}

export interface ConnectedAccount {
  account_id: string;
  onboarding_complete: boolean;
  details_submitted: boolean;
}

export interface AccountLink {
  url: string;
  account_id: string;
}

export interface AccountStatus {
  account_id: string;
  charges_enabled: boolean;
  payouts_enabled: boolean;
  requirements_due: string[];
}

export interface ProviderBalance {
  available_cents: number;
  pending_cents: number;
  currency: string;
}

export interface PayoutInfo {
  id: string;
  status: string;
  amount_cents: number;
  currency: string;
  arrival_date: string | null;
  created_at: string;
}

export interface PayoutList {
  payouts: PayoutInfo[];
  count: number;
}

// ---------------------------------------------------------------------------
// Stripe Customer Management
// ---------------------------------------------------------------------------

/**
 * Ensure the current user has a Stripe customer ID.
 * Calls the SetupIntent endpoint which auto-creates a Stripe customer
 * if one doesn't exist. Returns the customerId.
 * POST /api/v1/users/me/payment-setup-intent
 */
async function ensureStripeCustomer(): Promise<string | null> {
  const result = await post<{
    clientSecret: string;
    customerId: string;
    setupIntentId: string;
  }>('/users/me/payment-setup-intent', {});
  return result.customerId ?? null;
}

// ---------------------------------------------------------------------------
// Customer Payment Lifecycle
// ---------------------------------------------------------------------------

/**
 * Create a PaymentIntent for a job.
 * POST /api/v1/payments/create-intent
 */
async function createPaymentIntent(
  jobId: string,
  amountCents: number,
  currency: string = 'cad',
  customerStripeId?: string | null,
): Promise<PaymentIntent> {
  return post<PaymentIntent>('/payments/create-intent', {
    job_id: jobId,
    amount_cents: amountCents,
    currency,
    customer_stripe_id: customerStripeId ?? undefined,
  });
}

/**
 * Confirm a PaymentIntent server-side.
 * POST /api/v1/payments/confirm/{id}
 */
async function confirmPayment(
  paymentIntentId: string,
): Promise<PaymentConfirmation> {
  return post<PaymentConfirmation>(`/payments/confirm/${paymentIntentId}`);
}

/**
 * Cancel a PaymentIntent.
 * POST /api/v1/payments/cancel/{id}
 */
async function cancelPayment(
  paymentIntentId: string,
  reason?: string,
): Promise<CancelPaymentResult> {
  return post<CancelPaymentResult>(`/payments/cancel/${paymentIntentId}`, {
    reason: reason ?? 'requested_by_customer',
  });
}

// ---------------------------------------------------------------------------
// Payment Methods
// ---------------------------------------------------------------------------

/**
 * List saved payment methods for a Stripe customer.
 * GET /api/v1/payments/methods/{customer_id}
 */
async function listPaymentMethods(
  customerStripeId: string,
): Promise<PaymentMethodList> {
  return get<PaymentMethodList>(`/payments/methods/${customerStripeId}`);
}

/**
 * Attach a payment method to a Stripe customer.
 * POST /api/v1/payments/methods/attach
 */
async function attachPaymentMethod(
  customerId: string,
  paymentMethodId: string,
): Promise<{ attached: boolean; customer_id: string; payment_method_id: string }> {
  return post('/payments/methods/attach', {
    customer_id: customerId,
    payment_method_id: paymentMethodId,
  });
}

// ---------------------------------------------------------------------------
// Stripe Connect (Provider)
// ---------------------------------------------------------------------------

/**
 * Create a Stripe Connect Express account for a provider.
 * POST /api/v1/payments/connect/create
 */
async function createConnectAccount(
  providerId: string,
  email: string,
  country: string = 'CA',
): Promise<ConnectedAccount> {
  return post<ConnectedAccount>('/payments/connect/create', {
    provider_id: providerId,
    email,
    country,
  });
}

/**
 * Generate a Stripe onboarding link for a provider.
 * POST /api/v1/payments/connect/onboard-link
 */
async function getOnboardingLink(
  accountId: string,
  refreshUrl: string,
  returnUrl: string,
): Promise<AccountLink> {
  return post<AccountLink>('/payments/connect/onboard-link', {
    account_id: accountId,
    refresh_url: refreshUrl,
    return_url: returnUrl,
  });
}

/**
 * Check the status of a provider's Stripe Connect account.
 * GET /api/v1/payments/connect/status/{account_id}
 */
async function checkConnectStatus(
  accountId: string,
): Promise<AccountStatus> {
  return get<AccountStatus>(`/payments/connect/status/${accountId}`);
}

// ---------------------------------------------------------------------------
// Provider Balance & Payouts
// ---------------------------------------------------------------------------

/**
 * Get available and pending balance for a provider's Connect account.
 * GET /api/v1/payments/balance/{account_id}
 */
async function getProviderBalance(
  accountId: string,
): Promise<ProviderBalance> {
  return get<ProviderBalance>(`/payments/balance/${accountId}`);
}

/**
 * List recent payouts for a provider's Connect account.
 * GET /api/v1/payments/payouts/{account_id}
 */
async function listProviderPayouts(
  accountId: string,
  limit: number = 10,
): Promise<PayoutList> {
  return get<PayoutList>(`/payments/payouts/${accountId}`, { limit });
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export const paymentService = {
  ensureStripeCustomer,
  createPaymentIntent,
  confirmPayment,
  cancelPayment,
  listPaymentMethods,
  attachPaymentMethod,
  createConnectAccount,
  getOnboardingLink,
  checkConnectStatus,
  getProviderBalance,
  listProviderPayouts,
};

export default paymentService;
