/**
 * VISP - Provider Zustand Store
 *
 * Manages all provider-side state: online status, on-call status,
 * active job, pending offers, earnings, and performance score.
 */

import { create } from 'zustand';
import {
  EarningsSummary,
  Job,
  JobOffer,
  JobStatus,
  ProviderProfile,
  ScheduledJob,
  OnCallShift,
  WeeklyEarnings,
  EarningsPayout,
  ServiceCatalogItem,
} from '../types';
import { get, post, patch } from '../services/apiClient';
import { offerService, type OpenJob, type SubmitOfferInput } from '../services/offerService';

// ---------------------------------------------------------------------------
// State shape
// ---------------------------------------------------------------------------

interface ProviderState {
  // Status
  isOnline: boolean;
  isOnCall: boolean;
  providerProfile: ProviderProfile | null;

  // Active work
  activeJob: Job | null;
  pendingOffers: OpenJob[];

  // Earnings
  earnings: EarningsSummary;
  weeklyEarnings: WeeklyEarnings[];
  payouts: EarningsPayout[];

  // Performance
  performanceScore: number;

  // Schedule
  scheduledJobs: ScheduledJob[];
  onCallShifts: OnCallShift[];

  // Offer filters
  offerFilterCategory: string | null;
  offerFilterMaxDistance: number | null;
  offerSortBy: 'distance' | 'price' | 'expiry';

  // Service catalog
  serviceCatalog: ServiceCatalogItem[];
  catalogLoading: boolean;

  // Loading flags
  isLoadingDashboard: boolean;
  isLoadingOffers: boolean;
  isLoadingEarnings: boolean;
  isLoadingSchedule: boolean;
  isTogglingStatus: boolean;

  // Error
  error: string | null;

  // Actions
  fetchProviderProfile: () => Promise<void>;
  fetchDashboard: () => Promise<void>;
  fetchOffers: () => Promise<void>;
  fetchEarnings: () => Promise<void>;
  fetchSchedule: () => Promise<void>;
  toggleOnline: () => Promise<void>;
  toggleOnCall: () => Promise<void>;
  submitOffer: (jobId: string, input: SubmitOfferInput) => Promise<void>;
  declineOffer: (offerId: string) => Promise<void>;
  updateJobStatus: (jobId: string, status: JobStatus) => Promise<void>;
  startNavigation: (jobId: string) => Promise<void>;
  arriveAtJob: (jobId: string) => Promise<void>;
  completeJob: (jobId: string) => Promise<void>;
  fetchActiveJob: (jobId: string) => Promise<void>;
  setOfferFilter: (category: string | null, maxDistance: number | null) => void;
  setOfferSort: (sortBy: 'distance' | 'price' | 'expiry') => void;
  getFilteredOffers: () => OpenJob[];
  fetchServiceCatalog: () => Promise<void>;
  submitPriceProposal: (jobId: string, priceCents: number, description?: string) => Promise<void>;
  clearError: () => void;
  reset: () => void;
}

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

const initialEarnings: EarningsSummary = {
  today: 0,
  thisWeek: 0,
  thisMonth: 0,
  pendingPayout: 0,
  totalEarned: 0,
};

const initialState = {
  isOnline: false,
  isOnCall: false,
  providerProfile: null,
  activeJob: null,
  pendingOffers: [],
  earnings: initialEarnings,
  weeklyEarnings: [],
  payouts: [],
  performanceScore: 0,
  scheduledJobs: [],
  onCallShifts: [],
  offerFilterCategory: null,
  offerFilterMaxDistance: null,
  offerSortBy: 'expiry' as const,
  serviceCatalog: [],
  catalogLoading: false,
  isLoadingDashboard: false,
  isLoadingOffers: false,
  isLoadingEarnings: false,
  isLoadingSchedule: false,
  isTogglingStatus: false,
  error: null,
};

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function extractErrorMessage(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) {
    return (err as { message: string }).message;
  }
  return 'An unexpected error occurred';
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useProviderStore = create<ProviderState>((set, getState) => ({
  ...initialState,

  fetchProviderProfile: async () => {
    try {
      const response = await get<{ data: ProviderProfile }>('/provider/profile');
      set({ providerProfile: response.data });
    } catch (error) {
      console.error('Failed to fetch provider profile:', error);
    }
  },

  fetchDashboard: async () => {
    set({ isLoadingDashboard: true, error: null });
    try {
      const dashboard = await get<{
        profile: ProviderProfile;
        activeJob: Job | null;
        pendingOffers: OpenJob[];
        earnings: EarningsSummary;
        performanceScore: number;
      }>('/provider/dashboard');

      set({
        providerProfile: dashboard.profile,
        isOnline: dashboard.profile?.isOnline ?? false,
        isOnCall: dashboard.profile?.isOnCall ?? false,
        activeJob: dashboard.activeJob ?? null,
        pendingOffers: dashboard.pendingOffers ?? [],
        earnings: dashboard.earnings ?? initialEarnings,
        performanceScore: dashboard.performanceScore ?? 0,
        onCallShifts: getState().onCallShifts ?? [],
        scheduledJobs: getState().scheduledJobs ?? [],
        isLoadingDashboard: false,
      });
    } catch (err: unknown) {
      const message = extractErrorMessage(err);
      set({
        error: message,
        isLoadingDashboard: false,
        onCallShifts: getState().onCallShifts ?? [],
        scheduledJobs: getState().scheduledJobs ?? [],
      });
    }
  },

  fetchOffers: async () => {
    // Ofertas v2 (2026-08-20): la bolsa es /provider/open-jobs. El proveedor ya no
    // "acepta" un trabajo — lo lee y OFERTA, aportando cuánto tarda y, si lleva
    // material, cuánto costará y por qué.
    set({ isLoadingOffers: true, error: null });
    try {
      const openJobs = await offerService.listOpenJobs();
      set({ pendingOffers: openJobs, isLoadingOffers: false });
    } catch (err: unknown) {
      console.error('[fetchOffers] ERROR:', err);
      set({
        isLoadingOffers: false,
        error: extractErrorMessage(err),
      });
    }
  },

  fetchEarnings: async () => {
    set({ isLoadingEarnings: true, error: null });
    try {
      // Backend returns: { data: { period, totalCents, commissionCents, netCents, jobCount, currency, jobs[] } }
      const response = await get<{
        data: {
          period: string;
          totalCents: number;
          commissionCents: number;
          netCents: number;
          jobCount: number;
          currency: string;
          jobs: Array<{
            jobId: string;
            referenceNumber: string;
            serviceCity?: string;
            finalPriceCents?: number;
            commissionCents?: number;
            payoutCents?: number;
            completedAt?: string;
          }>;
        };
      }>('/provider/earnings');

      const raw = response?.data ?? response;
      const netDollars = (raw?.netCents ?? 0) / 100;
      const totalDollars = (raw?.totalCents ?? 0) / 100;

      // Map backend response to frontend EarningsSummary shape
      const summary: EarningsSummary = {
        today: 0,
        thisWeek: raw?.period === 'week' ? netDollars : 0,
        thisMonth: 0,
        pendingPayout: 0,
        totalEarned: totalDollars,
      };

      // Fetch month separately to fill thisMonth
      try {
        const monthResp = await get<{ data: { netCents: number } }>('/provider/earnings?period=month');
        const monthRaw = monthResp?.data ?? monthResp;
        summary.thisMonth = (monthRaw?.netCents ?? 0) / 100;
      } catch { /* ignore */ }

      // Fetch today separately
      try {
        const todayResp = await get<{ data: { netCents: number } }>('/provider/earnings?period=today');
        const todayRaw = todayResp?.data ?? todayResp;
        summary.today = (todayRaw?.netCents ?? 0) / 100;
      } catch { /* ignore */ }

      // Map jobs to EarningsPayout shape
      const payouts: EarningsPayout[] = (raw?.jobs ?? []).map((j) => ({
        id: j.jobId,
        jobId: j.jobId,
        taskName: j.referenceNumber || 'Job',
        grossAmount: (j.finalPriceCents ?? 0) / 100,
        commissionAmount: (j.commissionCents ?? 0) / 100,
        commissionRate: j.finalPriceCents ? (j.commissionCents ?? 0) / j.finalPriceCents : 0,
        netAmount: (j.payoutCents ?? 0) / 100,
        status: 'paid' as const,
        paidAt: j.completedAt ?? null,
        createdAt: j.completedAt ?? new Date().toISOString(),
      }));

      set({
        earnings: summary,
        weeklyEarnings: [],
        payouts,
        isLoadingEarnings: false,
      });
    } catch (err: unknown) {
      set({
        isLoadingEarnings: false,
        error: extractErrorMessage(err),
      });
    }
  },

  fetchSchedule: async () => {
    set({ isLoadingSchedule: true, error: null });
    try {
      const data = await get<{
        upcoming: Array<{
          jobId: string;
          referenceNumber: string;
          status: string;
          serviceAddress: string | null;
          serviceCity: string | null;
          requestedDate: string | null;
          requestedTimeStart: string | null;
          requestedTimeEnd: string | null;
          taskName: string | null;
          isEmergency: boolean;
        }>;
        shifts: OnCallShift[];
      }>('/provider/schedule');

      // Map backend "upcoming" to ScheduledJob shape expected by ScheduleScreen
      const scheduledJobs: ScheduledJob[] = (data.upcoming || []).map((j) => {
        // Build scheduledAt from requestedDate + requestedTimeStart.
        // IMPORTANT: "2026-02-14" alone is parsed as UTC midnight which shifts
        // to the previous day in negative UTC offsets. Appending T00:00:00 forces
        // local-timezone interpretation.
        let scheduledAt: string;
        if (j.requestedDate && j.requestedTimeStart) {
          scheduledAt = `${j.requestedDate}T${j.requestedTimeStart}`;
        } else if (j.requestedDate) {
          scheduledAt = `${j.requestedDate}T00:00:00`;
        } else {
          scheduledAt = new Date().toISOString();
        }

        return {
          id: j.jobId,
          taskName: j.taskName || 'Job',
          customerArea: j.serviceCity || j.serviceAddress || '',
          status: j.status as any,
          scheduledAt,
          estimatedDurationMinutes: 60,
          level: 1 as any,
        };
      });

      set({
        scheduledJobs,
        onCallShifts: data.shifts || [],
        isLoadingSchedule: false,
      });
    } catch (err: unknown) {
      set({
        isLoadingSchedule: false,
        error: extractErrorMessage(err),
      });
    }
  },

  toggleOnline: async () => {
    const currentState = getState();
    const newStatus = !currentState.isOnline;

    set({ isTogglingStatus: true, error: null });
    try {
      await patch('/provider/status', { isOnline: newStatus });
      set({ isOnline: newStatus, isTogglingStatus: false });
    } catch (err: unknown) {
      set({
        isTogglingStatus: false,
        error: extractErrorMessage(err),
      });
    }
  },

  toggleOnCall: async () => {
    const currentState = getState();
    const newStatus = !currentState.isOnCall;

    set({ isTogglingStatus: true, error: null });
    try {
      await patch('/provider/status', { isOnCall: newStatus });
      set({ isOnCall: newStatus, isTogglingStatus: false });
    } catch (err: unknown) {
      set({
        isTogglingStatus: false,
        error: extractErrorMessage(err),
      });
    }
  },

  submitOffer: async (jobId: string, input: SubmitOfferInput) => {
    set({ error: null });
    try {
      await offerService.submitOffer(jobId, input);
      // El trabajo sale de la bolsa: ya se ofertó y no se puede ofertar dos veces.
      set((state) => ({
        pendingOffers: state.pendingOffers.filter((o) => o.jobId !== jobId),
      }));
      getState().fetchDashboard();
    } catch (err: unknown) {
      console.error('[submitOffer] ERROR:', err);
      set({ error: extractErrorMessage(err) });
      throw err; // la pantalla necesita saberlo para no cerrar el formulario
    }
  },

  declineOffer: async (jobId: string) => {
    set({ error: null });
    try {
      await post(`/provider/offers/${jobId}/reject`);
      set((state) => ({
        pendingOffers: state.pendingOffers.filter((o) => o.jobId !== jobId),
      }));
    } catch (err: unknown) {
      set({ error: extractErrorMessage(err) });
    }
  },

  updateJobStatus: async (jobId: string, newStatus: JobStatus) => {
    set({ error: null });
    try {
      const updatedJob = await patch<Job>(`/provider/jobs/${jobId}/status`, {
        status: newStatus,
      });
      if (newStatus === 'completed') {
        set({ activeJob: null });
      } else {
        set({ activeJob: updatedJob });
      }
    } catch (err: unknown) {
      set({ error: extractErrorMessage(err) });
    }
  },

  startNavigation: async (jobId: string) => {
    set({ error: null });
    try {
      await post(`/provider/jobs/${jobId}/en-route`);
      getState().fetchDashboard();
    } catch (err: unknown) {
      console.error('[startNavigation] ERROR:', err);
      set({ error: extractErrorMessage(err) });
    }
  },

  arriveAtJob: async (jobId: string) => {
    set({ error: null });
    try {
      await post(`/provider/jobs/${jobId}/arrive`);
      getState().fetchDashboard();
    } catch (err: unknown) {
      console.error('[arriveAtJob] ERROR:', err);
      set({ error: extractErrorMessage(err) });
    }
  },

  completeJob: async (jobId: string) => {
    set({ error: null });
    try {
      await post(`/provider/jobs/${jobId}/complete`);
      set({ activeJob: null });
      getState().fetchDashboard();
    } catch (err: unknown) {
      console.error('[completeJob] ERROR:', err);
      set({ error: extractErrorMessage(err) });
    }
  },

  fetchActiveJob: async (jobId: string) => {
    set({ error: null });
    try {
      const job = await get<Job>(`/provider/jobs/${jobId}`);
      set({ activeJob: job });
    } catch (err: unknown) {
      set({ error: extractErrorMessage(err) });
    }
  },

  setOfferFilter: (category: string | null, maxDistance: number | null) => {
    set({ offerFilterCategory: category, offerFilterMaxDistance: maxDistance });
  },

  setOfferSort: (sortBy: 'distance' | 'price' | 'expiry') => {
    set({ offerSortBy: sortBy });
  },

  getFilteredOffers: (): OpenJob[] => {
    // Los filtros por categoría, distancia y precio se apoyaban en campos que la
    // bolsa nueva no trae (`task.categoryName`, `distanceKm`, `pricing`). Se
    // ordena por lo único que importa ahora: primero los que se pueden ofertar.
    // Un filtro que miente sobre datos inexistentes es peor que no tenerlo.
    const state = getState();
    return [...state.pendingOffers].sort((a, b) => {
      if (a.canOffer !== b.canOffer) return a.canOffer ? -1 : 1;
      return 0;
    });
  },

  fetchServiceCatalog: async () => {
    set({ catalogLoading: true, error: null });
    try {
      const data = await get<ServiceCatalogItem[]>('/provider/service-catalog');
      set({ serviceCatalog: data, catalogLoading: false });
    } catch (err: unknown) {
      console.error('[fetchServiceCatalog] ERROR:', err);
      set({ catalogLoading: false, error: extractErrorMessage(err) });
    }
  },

  submitPriceProposal: async (
    jobId: string,
    priceCents: number,
    description?: string,
  ) => {
    set({ error: null });
    try {
      await post('/proposals', {
        jobId,
        proposedPriceCents: priceCents,
        description: description ?? '',
      });
    } catch (err: unknown) {
      console.error('[submitPriceProposal] ERROR:', err);
      set({ error: extractErrorMessage(err) });
      throw err;
    }
  },

  clearError: () => set({ error: null }),

  reset: () => set(initialState),
}));
