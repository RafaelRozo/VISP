/**
 * VISP - Emergency Flow Zustand Store
 *
 * Manages all state for the Level 4 emergency flow: type selection,
 * location, pricing consent, job searching, tracking, completion,
 * and cancellation. SLA-bound with zero tolerance.
 */

import { create } from 'zustand';
import { emergencyService, DEFAULT_SLA, DEFAULT_PRICING, EMERGENCY_CONSENT_VERSION } from '../services/emergencyService';
import type {
  EmergencyType,
  EmergencySLA,
  EmergencyPricing,
  EmergencyJob,
  EmergencyJobStatus,
  AddressInfo,
  RatingDimension,
} from '../types';

// ──────────────────────────────────────────────
// State shape
// ──────────────────────────────────────────────

interface EmergencyState {
  // Selection
  selectedType: EmergencyType | null;
  location: AddressInfo | null;

  // Pricing & SLA
  sla: EmergencySLA;
  pricing: EmergencyPricing;
  pricingAccepted: boolean;
  legalConsentAccepted: boolean;

  // Active job
  activeJob: EmergencyJob | null;
  jobStatus: EmergencyJobStatus | null;

  // Rating (completion)
  overallRating: number;
  ratingDimensions: RatingDimension[];

  // Cancellation
  selectedCancellationReason: string | null;
  cancellationFee: number;

  // Loading flags
  isLoadingPricing: boolean;
  isLoadingSLA: boolean;
  isSubmittingRequest: boolean;
  isLoadingJob: boolean;
  isCancelling: boolean;
  isSubmittingRating: boolean;

  // Polling
  pollingInterval: ReturnType<typeof setInterval> | null;

  // Error
  error: string | null;

  // Actions
  setSelectedType: (type: EmergencyType) => void;
  setLocation: (location: AddressInfo) => void;
  setPricingAccepted: (accepted: boolean) => void;
  setLegalConsentAccepted: (accepted: boolean) => void;
  fetchPricingAndSLA: () => Promise<void>;
  submitEmergencyRequest: () => Promise<string>;
  fetchJobStatus: (jobId: string) => Promise<void>;
  startPolling: (jobId: string) => void;
  stopPolling: () => void;
  cancelJob: (jobId: string, reasonId: string) => Promise<void>;
  setOverallRating: (rating: number) => void;
  setRatingDimension: (dimensionId: string, value: number) => void;
  submitRating: (jobId: string) => Promise<void>;
  confirmPayment: (jobId: string) => Promise<void>;
  setSelectedCancellationReason: (reasonId: string) => void;
  clearError: () => void;
  reset: () => void;
}

// ──────────────────────────────────────────────
// Initial state
// ──────────────────────────────────────────────

const DEFAULT_RATING_DIMENSIONS: RatingDimension[] = [
  { id: 'response_time', label: 'Response Time', value: 0 },
  { id: 'professionalism', label: 'Professionalism', value: 0 },
  { id: 'quality_of_work', label: 'Quality of Work', value: 0 },
  { id: 'communication', label: 'Communication', value: 0 },
  { id: 'value_for_money', label: 'Value for Money', value: 0 },
];

const initialState = {
  selectedType: null,
  location: null,
  sla: DEFAULT_SLA,
  pricing: DEFAULT_PRICING,
  pricingAccepted: false,
  legalConsentAccepted: false,
  activeJob: null,
  jobStatus: null,
  overallRating: 0,
  ratingDimensions: DEFAULT_RATING_DIMENSIONS.map((d) => ({ ...d })),
  selectedCancellationReason: null,
  cancellationFee: 0,
  isLoadingPricing: false,
  isLoadingSLA: false,
  isSubmittingRequest: false,
  isLoadingJob: false,
  isCancelling: false,
  isSubmittingRating: false,
  pollingInterval: null,
  error: null,
};

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function extractErrorMessage(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) {
    return (err as { message: string }).message;
  }
  return 'An unexpected error occurred';
}

// ──────────────────────────────────────────────
// Store
// ──────────────────────────────────────────────

export const useEmergencyStore = create<EmergencyState>((set, getState) => ({
  ...initialState,

  setSelectedType: (type: EmergencyType) => {
    set({ selectedType: type });
  },

  setLocation: (location: AddressInfo) => {
    set({ location });
  },

  setPricingAccepted: (accepted: boolean) => {
    set({ pricingAccepted: accepted });
  },

  setLegalConsentAccepted: (accepted: boolean) => {
    set({ legalConsentAccepted: accepted });
  },

  fetchPricingAndSLA: async () => {
    const state = getState();
    if (!state.selectedType || !state.location) {
      return;
    }

    set({ isLoadingPricing: true, isLoadingSLA: true, error: null });
    try {
      const [pricing, sla] = await Promise.all([
        emergencyService.fetchEmergencyPricing(state.selectedType, state.location),
        emergencyService.fetchEmergencySLA(state.selectedType, state.location),
      ]);
      set({
        pricing,
        sla,
        isLoadingPricing: false,
        isLoadingSLA: false,
      });
    } catch (err: unknown) {
      set({
        isLoadingPricing: false,
        isLoadingSLA: false,
        error: extractErrorMessage(err),
      });
    }
  },

  submitEmergencyRequest: async () => {
    const state = getState();
    if (!state.selectedType || !state.location) {
      throw new Error('Missing emergency type or location');
    }
    if (!state.pricingAccepted || !state.legalConsentAccepted) {
      throw new Error('You must accept pricing and legal terms');
    }

    set({ isSubmittingRequest: true, error: null });
    try {
      const job = await emergencyService.createEmergencyRequest({
        emergencyType: state.selectedType,
        location: state.location,
        pricingAccepted: state.pricingAccepted,
        legalConsentAccepted: state.legalConsentAccepted,
        consentTimestamp: new Date().toISOString(),
        consentVersion: EMERGENCY_CONSENT_VERSION,
      });
      set({
        activeJob: job,
        jobStatus: job.status,
        isSubmittingRequest: false,
      });
      return job.id;
    } catch (err: unknown) {
      set({
        isSubmittingRequest: false,
        error: extractErrorMessage(err),
      });
      throw err;
    }
  },

  fetchJobStatus: async (jobId: string) => {
    set({ isLoadingJob: true, error: null });
    try {
      const job = await emergencyService.fetchEmergencyJob(jobId);
      set({
        activeJob: job,
        jobStatus: job.status,
        isLoadingJob: false,
      });
    } catch (err: unknown) {
      set({
        isLoadingJob: false,
        error: extractErrorMessage(err),
      });
    }
  },

  startPolling: (jobId: string) => {
    const state = getState();
    if (state.pollingInterval) {
      clearInterval(state.pollingInterval);
    }

    const interval = setInterval(async () => {
      try {
        const job = await emergencyService.fetchEmergencyJob(jobId);
        set({ activeJob: job, jobStatus: job.status });

        // Auto-stop polling on terminal states
        if (job.status === 'completed' || job.status === 'cancelled') {
          const currentState = getState();
          if (currentState.pollingInterval) {
            clearInterval(currentState.pollingInterval);
            set({ pollingInterval: null });
          }
        }
      } catch {
        // Polling errors are silently ignored; next tick will retry
      }
    }, 3000);

    set({ pollingInterval: interval });
  },

  stopPolling: () => {
    const state = getState();
    if (state.pollingInterval) {
      clearInterval(state.pollingInterval);
      set({ pollingInterval: null });
    }
  },

  cancelJob: async (jobId: string, reasonId: string) => {
    set({ isCancelling: true, error: null });
    try {
      const result = await emergencyService.cancelEmergencyJob(jobId, reasonId);
      set({
        isCancelling: false,
        cancellationFee: result.cancellationFee,
        jobStatus: 'cancelled',
      });
      // Stop polling after cancellation
      const state = getState();
      if (state.pollingInterval) {
        clearInterval(state.pollingInterval);
        set({ pollingInterval: null });
      }
    } catch (err: unknown) {
      set({
        isCancelling: false,
        error: extractErrorMessage(err),
      });
    }
  },

  setOverallRating: (rating: number) => {
    set({ overallRating: rating });
  },

  setRatingDimension: (dimensionId: string, value: number) => {
    set((state) => ({
      ratingDimensions: state.ratingDimensions.map((d) =>
        d.id === dimensionId ? { ...d, value } : d,
      ),
    }));
  },

  submitRating: async (jobId: string) => {
    const state = getState();
    set({ isSubmittingRating: true, error: null });
    try {
      await emergencyService.rateEmergencyJob(
        jobId,
        state.overallRating,
        state.ratingDimensions.map((d) => ({ id: d.id, value: d.value })),
      );
      set({ isSubmittingRating: false });
    } catch (err: unknown) {
      set({
        isSubmittingRating: false,
        error: extractErrorMessage(err),
      });
    }
  },

  confirmPayment: async (jobId: string) => {
    set({ error: null });
    try {
      await emergencyService.confirmEmergencyPayment(jobId);
    } catch (err: unknown) {
      set({ error: extractErrorMessage(err) });
    }
  },

  setSelectedCancellationReason: (reasonId: string) => {
    set({ selectedCancellationReason: reasonId });
  },

  clearError: () => set({ error: null }),

  reset: () => {
    const state = getState();
    if (state.pollingInterval) {
      clearInterval(state.pollingInterval);
    }
    set({ ...initialState, pollingInterval: null });
  },
}));
