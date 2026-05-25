import { get, post, upload } from './apiClient';

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
    uploadCredential: async (file: any, type: string, taskId?: string): Promise<void> => {
        const formData = new FormData();
        formData.append('file', {
            uri: file.uri,
            type: file.type || 'image/jpeg',
            name: file.name || 'upload.jpg',
        } as any);
        formData.append('type', type);
        if (taskId) {
            formData.append('task_id', taskId);
        }

        await upload('/provider/credentials', formData);
    },

    /**
     * Start (or continue) Stripe Connect onboarding for the authenticated provider.
     * Backend creates the connected account if missing and persists the account id.
     * Returns a fresh onboarding URL that can be opened with Linking.openURL.
     */
    setupPayouts: async (): Promise<PayoutsSetupResponse> => {
        return await post<PayoutsSetupResponse>('/provider/payouts/setup', {});
    },

    /**
     * Check whether the provider's Stripe Connect account is fully active.
     */
    getPayoutsStatus: async (): Promise<PayoutsStatus> => {
        return await get<PayoutsStatus>('/provider/payouts/status');
    },
};
