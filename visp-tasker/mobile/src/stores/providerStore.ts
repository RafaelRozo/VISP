/**
 * VISP/Tasker - Provider Zustand Store
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

  // Loading flags
  isLoadingDashboard: boolean;
  isLoadingOffers: boolean;
  isLoadingEarnings: boolean;
  isLoadingSchedule: boolean;
  isTogglingStatus: boolean;

  // Error
  error: string | null;

  // Actions
  fetchDashboard: () => Promise<void>;
  fetchOffers: () => Promise<void>;
  fetchEarnings: () => Promise<void>;
  fetchSchedule: () => Promise<void>;
  toggleOnline: () => Promise<void>;
  toggleOnCall: () => Promise<void>;
  acceptOffer: (offerId: string) => Promise<void>;
  declineOffer: (offerId: string) => Promise<void>;
  updateJobStatus: (jobId: string, status: JobStatus) => Promise<void>;
  fetchActiveJob: (jobId: string) => Promise<void>;
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
  isLoadingDashboard: false,
  isLoadingOffers: false,
  isLoadingEarnings: false,
  isLoadingSchedule: false,
  isTogglingStatus: false,
  error: null,
};

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useProviderStore = create<ProviderState>((set, getState) => ({
  ...initialState,

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
        isOnline: dashboard.profile.isOnline,
        isOnCall: dashboard.profile.isOnCall,
        activeJob: dashboard.activeJob,
        pendingOffers: dashboard.pendingOffers,
        earnings: dashboard.earnings,
        performanceScore: dashboard.performanceScore,
        isLoadingDashboard: false,
      });
    } catch (err: unknown) {
      const message =
        err && typeof err === 'object' && 'message' in err
          ? (err as { message: string }).message
          : 'Failed to load dashboard';
      set({ isLoadingDashboard: false, error: message });
    }
  },

  fetchOffers: async () => {
    set({ isLoadingOffers: true, error: null });
    try {
      const offers = await get<JobOffer[]>('/provider/offers');
      set({ pendingOffers: offers, isLoadingOffers: false });
    } catch (err: unknown) {
      const message =
        err && typeof err === 'object' && 'message' in err
          ? (err as { message: string }).message
          : 'Failed to load offers';
      set({ isLoadingOffers: false, error: message });
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
      const message =
        err && typeof err === 'object' && 'message' in err
          ? (err as { message: string }).message
          : 'Failed to load earnings';
      set({ isLoadingEarnings: false, error: message });
    }
  },

  fetchSchedule: async () => {
    set({ isLoadingSchedule: true, error: null });
    try {
      const data = await get<{
        scheduledJobs: ScheduledJob[];
        onCallShifts: OnCallShift[];
      }>('/provider/schedule');

      set({
        scheduledJobs: data.scheduledJobs,
        onCallShifts: data.onCallShifts,
        isLoadingSchedule: false,
      });
    } catch (err: unknown) {
      const message =
        err && typeof err === 'object' && 'message' in err
          ? (err as { message: string }).message
          : 'Failed to load schedule';
      set({ isLoadingSchedule: false, error: message });
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
      const message =
        err && typeof err === 'object' && 'message' in err
          ? (err as { message: string }).message
          : 'Failed to update status';
      set({ isTogglingStatus: false, error: message });
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
      const message =
        err && typeof err === 'object' && 'message' in err
          ? (err as { message: string }).message
          : 'Failed to update on-call status';
      set({ isTogglingStatus: false, error: message });
    }
  },

  acceptOffer: async (offerId: string) => {
    set({ error: null });
    try {
      const job = await post<Job>(`/provider/offers/${offerId}/accept`);
      set((state) => ({
        activeJob: job,
        pendingOffers: state.pendingOffers.filter((o) => o.id !== offerId),
      }));
    } catch (err: unknown) {
      const message =
        err && typeof err === 'object' && 'message' in err
          ? (err as { message: string }).message
          : 'Failed to accept offer';
      set({ error: message });
    }
  },

  declineOffer: async (offerId: string) => {
    set({ error: null });
    try {
      await post(`/provider/offers/${offerId}/decline`);
      set((state) => ({
        pendingOffers: state.pendingOffers.filter((o) => o.id !== offerId),
      }));
    } catch (err: unknown) {
      const message =
        err && typeof err === 'object' && 'message' in err
          ? (err as { message: string }).message
          : 'Failed to decline offer';
      set({ error: message });
    }
  },

  updateJobStatus: async (jobId: string, status: JobStatus) => {
    set({ error: null });
    try {
      const updatedJob = await patch<Job>(`/provider/jobs/${jobId}/status`, {
        status,
      });
      if (status === 'completed') {
        set({ activeJob: null });
      } else {
        set({ activeJob: updatedJob });
      }
    } catch (err: unknown) {
      const message =
        err && typeof err === 'object' && 'message' in err
          ? (err as { message: string }).message
          : 'Failed to update job status';
      set({ error: message });
    }
  },

  fetchActiveJob: async (jobId: string) => {
    set({ error: null });
    try {
      const job = await get<Job>(`/provider/jobs/${jobId}`);
      set({ activeJob: job });
    } catch (err: unknown) {
      const message =
        err && typeof err === 'object' && 'message' in err
          ? (err as { message: string }).message
          : 'Failed to load job details';
      set({ error: message });
    }
  },

  clearError: () => set({ error: null }),

  reset: () => set(initialState),
}));
