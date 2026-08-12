import { get, post, put, del, upload, patch } from './apiClient';

// ── Provider profile summary + free-form documents (VISP-8) ──
export interface ProviderDocumentDto {
  id: string;
  name: string;
  documentUrl: string;
}

export interface ProviderPublicProfile {
  providerId: string;
  displayName: string;
  level: number | null;
  bio: string | null;
  yearsExperience: number | null;
  rating: number | null;
  reviewCount: number;
  documents: ProviderDocumentDto[];
}

/** One priceable service for the provider, with the catalog guardrail and the
 *  provider's current rate (null if unset). Mirrors the backend payload from
 *  GET /provider/rates (snake_case preserved on purpose). */
export interface ProviderRateItem {
    task_id: string;
    task_name: string;
    task_slug: string;
    level: string;
    pricing_unit: 'hourly' | 'per_unit' | 'per_area' | 'per_linear_m' | 'per_visit' | 'flat_package' | 'custom_quote';
    allows_quantity: boolean;
    base_price_min_cents: number | null;
    base_price_max_cents: number | null;
    is_custom_quote: boolean;
    rate_cents: number | null;
    min_charge_cents: number | null;
    is_active: boolean;
}

export interface PendingCredential {
    taskId: string;
    taskName: string;
    taskSlug: string;
    requiredType: 'license' | 'certification';
    badge: string;
    uploadStatus: 'not_uploaded' | 'pending_review' | 'verified' | 'rejected' | 'expired';
    credentialId: string | null;
}

export interface PayoutsSetupResponse {
    accountId: string;
    onboardingUrl: string;
}

export interface PayoutsStatus {
    connected: boolean;
    accountId: string | null;
    detailsSubmitted: boolean;
    chargesEnabled: boolean;
    payoutsEnabled: boolean;
    transfersCapability: 'active' | 'inactive' | 'pending' | 'unknown';
    disabledReason: string | null;
    requirementsDue: string[];
}

/** Backend returns this body when the provider profile is missing fields. */
export interface ProfileIncompleteError {
    code: 'profile_incomplete';
    missing: Array<'street' | 'city' | 'province' | 'postalCode'>;
    message: string;
}

export const providerService = {
    /**
     * Update the provider's list of qualified services.
     * This replaces the existing list.
     */
    updateServices: async (taskIds: string[]): Promise<void> => {
        await post('/provider/services', { taskIds });
    },

    /**
     * Fetch services that require credential uploads (pending qualification).
     */
    getPendingCredentials: async (): Promise<PendingCredential[]> => {
        return await get<PendingCredential[]>('/provider/pending-credentials');
    },

    /**
     * Upload a credential document for verification.
     * @param file Local file URI or object
     * @param type Credential type (license, certification, etc.)
     * @param taskId Optional task ID to associate the credential with
     */
    uploadCredential: async (
        file: any,
        type: string,
        opts?: { taskId?: string; categoryId?: string },
    ): Promise<void> => {
        const formData = new FormData();
        formData.append('file', {
            uri: file.uri,
            type: file.type || 'image/jpeg',
            name: file.name || 'upload.jpg',
        } as any);
        formData.append('type', type);
        if (opts?.taskId) {
            formData.append('task_id', opts.taskId);
        }
        // Section-based model (migration 029): attach the doc to the section so
        // admin approval unlocks the whole section and flips the provider level.
        if (opts?.categoryId) {
            formData.append('category_id', opts.categoryId);
        }

        await upload('/provider/credentials', formData);
    },

    /*
     * setupPayouts — RETIRADO el 2026-08-12. Llamaba a /provider/payouts/setup
     * (Stripe Express), endpoint que ya no existe. Ninguna pantalla lo usaba; el
     * onboarding es payoutsV2Service (Accounts v2).
     */

    /**
     * Check whether the provider's Stripe Connect account is fully active.
     */
    getPayoutsStatus: async (): Promise<PayoutsStatus> => {
        return await get<PayoutsStatus>('/provider/payouts/status');
    },

    // ── Provider-set service rates (Provider-Set Pricing · PP2) ──

    /** List the services the provider is qualified to price, each with its
     *  guardrail range and current rate (null if unset). */
    getProviderRates: async (): Promise<{ items: ProviderRateItem[]; managedByCompany: boolean }> => {
        const res = await get<{ items: ProviderRateItem[]; managedByCompany?: boolean }>('/provider/rates');
        // managedByCompany = the provider belongs to a business; prices are set by
        // the company on the web and are read-only here.
        return { items: res?.items ?? [], managedByCompany: res?.managedByCompany ?? false };
    },

    /** Set or update the provider's rate for one service. `rateCents` is
     *  clamped server-side to the task guardrail (422 price_out_of_range). */
    setProviderRate: async (
        taskId: string,
        rateCents: number,
        minChargeCents?: number | null,
    ): Promise<void> => {
        await put(`/provider/rates/${taskId}`, {
            rate_cents: rateCents,
            min_charge_cents: minChargeCents ?? null,
        });
    },

    /** Remove the provider's rate for one service. */
    deleteProviderRate: async (taskId: string): Promise<void> => {
        await del(`/provider/rates/${taskId}`);
    },

    /** Update the provider's own profile summary (bio + years of experience). */
    updateProfileSummary: async (body: { bio?: string; yearsExperience?: number }): Promise<void> => {
        await patch('/provider/profile', body);
    },

    /** Upload a free-form document/certificate (not tied to any service). */
    uploadProviderDocument: async (file: any, name?: string): Promise<void> => {
        const formData = new FormData();
        formData.append('file', {
            uri: file.uri,
            type: file.type || 'image/jpeg',
            name: file.name || 'document.jpg',
        } as any);
        if (name) formData.append('name', name);
        await upload('/provider/documents', formData);
    },

    /** List the provider's own free-form documents. */
    listProviderDocuments: async (): Promise<ProviderDocumentDto[]> => {
        return (await get<ProviderDocumentDto[]>('/provider/documents')) ?? [];
    },

    /** Delete one of the provider's own documents. */
    deleteProviderDocument: async (documentId: string): Promise<void> => {
        await del(`/provider/documents/${documentId}`);
    },

    /** Public provider profile (bio, rating, documents) for radar / job status. */
    getPublicProfile: async (providerId: string): Promise<ProviderPublicProfile> => {
        return await get<ProviderPublicProfile>(`/provider/${providerId}/public-profile`);
    },
};
