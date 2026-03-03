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
  pendingOffers: JobOffer[];

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
  acceptOffer: (offerId: string) => Promise<void>;
  declineOffer: (offerId: string) => Promise<void>;
  updateJobStatus: (jobId: string, status: JobStatus) => Promise<void>;
  startNavigation: (jobId: string) => Promise<void>;
  arriveAtJob: (jobId: string) => Promise<void>;
  completeJob: (jobId: string) => Promise<void>;
  fetchActiveJob: (jobId: string) => Promise<void>;
  setOfferFilter: (category: string | null, maxDistance: number | null) => void;
  setOfferSort: (sortBy: 'distance' | 'price' | 'expiry') => void;
  getFilteredOffers: () => JobOffer[];
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
        pendingOffers: JobOffer[];
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
    set({ isLoadingOffers: true, error: null });
    try {
      const response = await get<{ items: JobOffer[] }>('/provider/offers');
      const offers = response?.items ?? (Array.isArray(response) ? response : []);
      set({ pendingOffers: offers, isLoadingOffers: false });
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
      const data = await get<{
        summary: EarningsSummary;
        weekly: WeeklyEarnings[];
        payouts: EarningsPayout[];
      }>('/provider/earnings');

      set({
        earnings: data.summary,
        weeklyEarnings: data.weekly,
        payouts: data.payouts,
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

  acceptOffer: async (jobId: string) => {
    set({ error: null });
    try {
      // Backend returns {assignment: AssignmentOut}, not a Job object
      await post(`/provider/offers/${jobId}/accept`);
      set((state) => ({
        pendingOffers: state.pendingOffers.filter((o) => o.jobId !== jobId),
      }));
      // Refresh dashboard, schedule, and offers so the accepted job
      // shows up in the correct tab (Schedule) rather than disappearing.
      getState().fetchDashboard();
      getState().fetchSchedule();
    } catch (err: unknown) {
      console.error('[acceptOffer] ERROR:', err);
      set({ error: extractErrorMessage(err) });
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

  getFilteredOffers: (): JobOffer[] => {
    const state = getState();
    let offers = [...state.pendingOffers];

    if (state.offerFilterCategory) {
      offers = offers.filter(
        (o) => o.task.categoryName === state.offerFilterCategory,
      );
    }

    if (state.offerFilterMaxDistance !== null) {
      offers = offers.filter(
        (o) =>
          o.distanceKm !== undefined &&
          o.distanceKm <= (state.offerFilterMaxDistance ?? Infinity),
      );
    }

    switch (state.offerSortBy) {
      case 'distance':
        offers.sort((a, b) => (a.distanceKm ?? 999) - (b.distanceKm ?? 999));
        break;
      case 'price':
        offers.sort(
          (a, b) =>
            (b.pricing.estimatedPayoutCents ?? 0) -
            (a.pricing.estimatedPayoutCents ?? 0),
        );
        break;
      case 'expiry':
      default:
        offers.sort((a, b) => {
          const aExp = a.offerExpiresAt
            ? new Date(a.offerExpiresAt).getTime()
            : Infinity;
          const bExp = b.offerExpiresAt
            ? new Date(b.offerExpiresAt).getTime()
            : Infinity;
          return aExp - bExp;
        });
        break;
    }

    return offers;
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
