import { get } from './apiClient';

export interface ProviderTask {
    id: string;
    slug: string;
    name: string;
    description?: string;
    level: string;
    categoryId: string;
    regulated: boolean;
    licenseRequired: boolean;
    certificationRequired: boolean;
    hazardous: boolean;
    structural: boolean;
    isActive: boolean;
}

export interface ProviderCategory {
    id: string;
    slug: string;
    name: string;
    iconUrl?: string;
    displayOrder: number;
    tasks: ProviderTask[];
}

/**
 * Raw shape from the backend — tasks come under "activeTasksList".
 */
interface BackendCategory {
    id: string;
    slug: string;
    name: string;
    iconUrl?: string;
    displayOrder: number;
    activeTasksList: ProviderTask[];
}

export const taxonomyService = {
    /**
     * Fetch the full hierarchy of active categories and tasks for provider onboarding.
     * The backend returns `activeTasksList`; we normalise it to `tasks` for the UI.
     */
    getProviderTaxonomy: async (): Promise<ProviderCategory[]> => {
        const raw = await get<BackendCategory[]>('/provider/taxonomy');
        return raw.map((cat) => ({
            id: cat.id,
            slug: cat.slug,
            name: cat.name,
            iconUrl: cat.iconUrl,
            displayOrder: cat.displayOrder,
            tasks: cat.activeTasksList ?? [],
        }));
    },

    /**
     * Get the provider's currently saved service qualifications.
     */
    getMyServices: async (): Promise<{ taskIds: string[]; level: string | null; status: string }> => {
        const data = await get<{ taskIds: string[]; level: string | null; status: string }>('/provider/services');
        return data;
    },
};
