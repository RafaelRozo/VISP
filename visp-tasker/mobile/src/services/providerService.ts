import { post, upload } from './apiClient';

export const providerService = {
    /**
     * Update the provider's list of qualified services.
     * This replaces the existing list.
     */
    updateServices: async (taskIds: string[]): Promise<void> => {
        await post('/provider/services', { taskIds });
    },

    /**
     * Upload a credential document for verification.
     * @param file Local file URI or object
     * @param type Credential type (license, certification, etc.)
     */
    uploadCredential: async (file: any, type: string): Promise<void> => {
        // Placeholder for file upload logic
        // We'll need FormData here
        const formData = new FormData();
        formData.append('file', {
            uri: file.uri,
            type: file.type || 'image/jpeg',
            name: file.name || 'upload.jpg',
        } as any);
        formData.append('type', type);

        await upload('/provider/credentials', formData);
    },
};
