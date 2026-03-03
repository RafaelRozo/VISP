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
};
