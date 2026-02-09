/**
 * VISP/Tasker - Provider Zustand Store
 *
 * Manages all provider-side state: online status, on-call status,
 * active job, pending offers, earnings, and performance score.
 * Includes __DEV__ mock data fallbacks for MVP demo purposes.
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
// Mock data for __DEV__ fallbacks
// ---------------------------------------------------------------------------

const MOCK_PROFILE: ProviderProfile = {
  id: 'provider-001',
  userId: 'demo-provider-001',
  level: 2,
  performanceScore: 87,
  isOnline: true,
  isOnCall: false,
  completedJobs: 42,
  rating: 4.8,
  stripeConnectStatus: 'active',
  credentials: [
    {
      id: 'cred-001',
      type: 'criminal_record_check',
      label: 'Criminal Record Check',
      status: 'approved',
      documentUrl: null,
      expiresAt: '2027-01-15T00:00:00Z',
      rejectionReason: null,
      uploadedAt: '2025-06-01T10:00:00Z',
      reviewedAt: '2025-06-03T14:00:00Z',
    },
  ],
};

const MOCK_ACTIVE_JOB: Job = {
  id: 'job-active-001',
  customerId: 'customer-001',
  providerId: 'provider-001',
  taskId: 'task-010',
  taskName: 'Kitchen Faucet Replacement',
  categoryName: 'Plumbing',
  status: 'accepted',
  level: 2,
  scheduledAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
  startedAt: null,
  completedAt: null,
  estimatedPrice: 85.0,
  finalPrice: null,
  provider: null,
  address: {
    street: '123 Maple Street',
    city: 'Toronto',
    province: 'ON',
    postalCode: 'M5V 2T6',
    latitude: 43.6426,
    longitude: -79.3871,
  },
  slaDeadline: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

function createMockOffers(): JobOffer[] {
  const now = Date.now();
  return [
    {
      id: 'offer-001',
      jobId: 'job-pending-001',
      taskName: 'Bathroom Cleaning - Deep',
      categoryName: 'Cleaning',
      level: 1,
      customerArea: 'North York, ON',
      distanceKm: 3.2,
      estimatedPrice: 45.0,
      slaDeadline: null,
      expiresAt: new Date(now + 10 * 60 * 1000).toISOString(),
      address: {
        street: '456 Elm Avenue',
        city: 'North York',
        province: 'ON',
        postalCode: 'M2N 6K1',
        latitude: 43.7615,
        longitude: -79.4111,
      },
      createdAt: new Date(now - 2 * 60 * 1000).toISOString(),
    },
    {
      id: 'offer-002',
      jobId: 'job-pending-002',
      taskName: 'Ceiling Fan Installation',
      categoryName: 'Electrical',
      level: 2,
      customerArea: 'Scarborough, ON',
      distanceKm: 8.7,
      estimatedPrice: 120.0,
      slaDeadline: null,
      expiresAt: new Date(now + 15 * 60 * 1000).toISOString(),
      address: {
        street: '789 Kennedy Road',
        city: 'Scarborough',
        province: 'ON',
        postalCode: 'M1K 2C3',
        latitude: 43.7315,
        longitude: -79.2631,
      },
      createdAt: new Date(now - 5 * 60 * 1000).toISOString(),
    },
    {
      id: 'offer-003',
      jobId: 'job-pending-003',
      taskName: 'Emergency Pipe Burst Repair',
      categoryName: 'Plumbing',
      level: 4,
      customerArea: 'Etobicoke, ON',
      distanceKm: 5.1,
      estimatedPrice: 250.0,
      slaDeadline: new Date(now + 45 * 60 * 1000).toISOString(),
      expiresAt: new Date(now + 5 * 60 * 1000).toISOString(),
      address: {
        street: '100 The Queensway',
        city: 'Etobicoke',
        province: 'ON',
        postalCode: 'M8Z 1N6',
        latitude: 43.6291,
        longitude: -79.4951,
      },
      createdAt: new Date(now - 1 * 60 * 1000).toISOString(),
    },
  ];
}

const MOCK_EARNINGS: EarningsSummary = {
  today: 165.0,
  thisWeek: 742.5,
  thisMonth: 2850.0,
  pendingPayout: 320.0,
  totalEarned: 12450.0,
};

const MOCK_WEEKLY_EARNINGS: WeeklyEarnings[] = [
  { weekLabel: 'Dec 30', amount: 580 },
  { weekLabel: 'Jan 6', amount: 720 },
  { weekLabel: 'Jan 13', amount: 650 },
  { weekLabel: 'Jan 20', amount: 890 },
  { weekLabel: 'Jan 27', amount: 742.5 },
];

const MOCK_PAYOUTS: EarningsPayout[] = [
  {
    id: 'payout-001',
    jobId: 'job-comp-001',
    taskName: 'Kitchen Faucet Repair',
    grossAmount: 90.0,
    commissionRate: 0.15,
    commissionAmount: 13.5,
    netAmount: 76.5,
    status: 'paid',
    paidAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'payout-002',
    jobId: 'job-comp-002',
    taskName: 'Bathroom Tile Grouting',
    grossAmount: 120.0,
    commissionRate: 0.15,
    commissionAmount: 18.0,
    netAmount: 102.0,
    status: 'paid',
    paidAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
    createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'payout-003',
    jobId: 'job-comp-003',
    taskName: 'Deep House Cleaning',
    grossAmount: 65.0,
    commissionRate: 0.15,
    commissionAmount: 9.75,
    netAmount: 55.25,
    status: 'pending',
    paidAt: null,
    createdAt: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'payout-004',
    jobId: 'job-comp-004',
    taskName: 'Ceiling Fan Installation',
    grossAmount: 130.0,
    commissionRate: 0.12,
    commissionAmount: 15.6,
    netAmount: 114.4,
    status: 'pending',
    paidAt: null,
    createdAt: new Date().toISOString(),
  },
];

function createMockScheduledJobs(): ScheduledJob[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return [
    {
      id: 'sched-001',
      taskName: 'Bathroom Renovation Consult',
      customerArea: 'Midtown, Toronto',
      scheduledAt: new Date(
        today.getTime() + 10 * 60 * 60 * 1000,
      ).toISOString(),
      estimatedDurationMinutes: 60,
      status: 'accepted',
      level: 2,
    },
    {
      id: 'sched-002',
      taskName: 'Furnace Inspection',
      customerArea: 'Don Mills, ON',
      scheduledAt: new Date(
        today.getTime() + 14 * 60 * 60 * 1000,
      ).toISOString(),
      estimatedDurationMinutes: 90,
      status: 'accepted',
      level: 2,
    },
    {
      id: 'sched-003',
      taskName: 'Window Caulking',
      customerArea: 'Mississauga, ON',
      scheduledAt: new Date(
        today.getTime() + 24 * 60 * 60 * 1000 + 9 * 60 * 60 * 1000,
      ).toISOString(),
      estimatedDurationMinutes: 45,
      status: 'accepted',
      level: 1,
    },
  ];
}

const MOCK_ON_CALL_SHIFTS: OnCallShift[] = [
  {
    id: 'shift-001',
    startTime: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    endTime: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
    isActive: true,
  },
  {
    id: 'shift-002',
    startTime: new Date(
      Date.now() + 24 * 60 * 60 * 1000 + 18 * 60 * 60 * 1000,
    ).toISOString(),
    endTime: new Date(
      Date.now() + 25 * 60 * 60 * 1000 + 6 * 60 * 60 * 1000,
    ).toISOString(),
    isActive: false,
  },
];

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
      if (__DEV__) {
        console.warn(
          'DEV: Using mock data for provider dashboard:',
          extractErrorMessage(err),
        );
        const mockOffers = createMockOffers();
        set({
          providerProfile: MOCK_PROFILE,
          isOnline: MOCK_PROFILE.isOnline,
          isOnCall: MOCK_PROFILE.isOnCall,
          activeJob: MOCK_ACTIVE_JOB,
          pendingOffers: mockOffers,
          earnings: MOCK_EARNINGS,
          performanceScore: MOCK_PROFILE.performanceScore,
          isLoadingDashboard: false,
          error: null,
        });
        return;
      }
      set({
        isLoadingDashboard: false,
        error: extractErrorMessage(err),
      });
    }
  },

  fetchOffers: async () => {
    set({ isLoadingOffers: true, error: null });
    try {
      const offers = await get<JobOffer[]>('/provider/offers');
      set({ pendingOffers: offers, isLoadingOffers: false });
    } catch (err: unknown) {
      if (__DEV__) {
        console.warn(
          'DEV: Using mock data for provider offers:',
          extractErrorMessage(err),
        );
        set({
          pendingOffers: createMockOffers(),
          isLoadingOffers: false,
          error: null,
        });
        return;
      }
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
      if (__DEV__) {
        console.warn(
          'DEV: Using mock data for provider earnings:',
          extractErrorMessage(err),
        );
        set({
          earnings: MOCK_EARNINGS,
          weeklyEarnings: MOCK_WEEKLY_EARNINGS,
          payouts: MOCK_PAYOUTS,
          isLoadingEarnings: false,
          error: null,
        });
        return;
      }
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
        scheduledJobs: ScheduledJob[];
        onCallShifts: OnCallShift[];
      }>('/provider/schedule');

      set({
        scheduledJobs: data.scheduledJobs,
        onCallShifts: data.onCallShifts,
        isLoadingSchedule: false,
      });
    } catch (err: unknown) {
      if (__DEV__) {
        console.warn(
          'DEV: Using mock data for provider schedule:',
          extractErrorMessage(err),
        );
        set({
          scheduledJobs: createMockScheduledJobs(),
          onCallShifts: MOCK_ON_CALL_SHIFTS,
          isLoadingSchedule: false,
          error: null,
        });
        return;
      }
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
      if (__DEV__) {
        console.warn(
          'DEV: Mock toggling online status:',
          extractErrorMessage(err),
        );
        set({ isOnline: newStatus, isTogglingStatus: false, error: null });
        return;
      }
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
      if (__DEV__) {
        console.warn(
          'DEV: Mock toggling on-call status:',
          extractErrorMessage(err),
        );
        set({ isOnCall: newStatus, isTogglingStatus: false, error: null });
        return;
      }
      set({
        isTogglingStatus: false,
        error: extractErrorMessage(err),
      });
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
      if (__DEV__) {
        console.warn(
          'DEV: Mock accepting offer:',
          extractErrorMessage(err),
        );
        const currentOffers = getState().pendingOffers;
        const accepted = currentOffers.find((o) => o.id === offerId);
        if (accepted) {
          const mockJob: Job = {
            id: accepted.jobId,
            customerId: 'customer-001',
            providerId: 'provider-001',
            taskId: 'task-' + offerId,
            taskName: accepted.taskName,
            categoryName: accepted.categoryName,
            status: 'accepted',
            level: accepted.level,
            scheduledAt: null,
            startedAt: null,
            completedAt: null,
            estimatedPrice: accepted.estimatedPrice,
            finalPrice: null,
            provider: null,
            address: accepted.address,
            slaDeadline: accepted.slaDeadline,
            createdAt: accepted.createdAt,
            updatedAt: new Date().toISOString(),
          };
          set({
            activeJob: mockJob,
            pendingOffers: currentOffers.filter((o) => o.id !== offerId),
            error: null,
          });
        }
        return;
      }
      set({ error: extractErrorMessage(err) });
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
      if (__DEV__) {
        console.warn(
          'DEV: Mock declining offer:',
          extractErrorMessage(err),
        );
        set((state) => ({
          pendingOffers: state.pendingOffers.filter((o) => o.id !== offerId),
          error: null,
        }));
        return;
      }
      set({ error: extractErrorMessage(err) });
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
      if (__DEV__) {
        console.warn(
          'DEV: Mock updating job status:',
          extractErrorMessage(err),
        );
        if (status === 'completed') {
          set({ activeJob: null, error: null });
        } else {
          const current = getState().activeJob;
          if (current) {
            set({
              activeJob: {
                ...current,
                status,
                startedAt:
                  status === 'in_progress'
                    ? new Date().toISOString()
                    : current.startedAt,
                updatedAt: new Date().toISOString(),
              },
              error: null,
            });
          }
        }
        return;
      }
      set({ error: extractErrorMessage(err) });
    }
  },

  fetchActiveJob: async (jobId: string) => {
    set({ error: null });
    try {
      const job = await get<Job>(`/provider/jobs/${jobId}`);
      set({ activeJob: job });
    } catch (err: unknown) {
      if (__DEV__) {
        console.warn(
          'DEV: Using mock data for active job:',
          extractErrorMessage(err),
        );
        set({
          activeJob: { ...MOCK_ACTIVE_JOB, id: jobId },
          error: null,
        });
        return;
      }
      set({ error: extractErrorMessage(err) });
    }
  },

  clearError: () => set({ error: null }),

  reset: () => set(initialState),
}));
