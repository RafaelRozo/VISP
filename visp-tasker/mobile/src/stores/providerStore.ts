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
      assignmentId: 'assign-001',
      jobId: 'job-pending-001',
      referenceNumber: 'TSK-MOCK01',
      status: 'offered',
      isEmergency: false,
      serviceAddress: '456 Elm Avenue',
      serviceCity: 'North York',
      serviceLatitude: 43.7615,
      serviceLongitude: -79.4111,
      task: { id: 'task-001', name: 'Bathroom Cleaning - Deep', level: '1', categoryName: 'Cleaning' },
      customer: { id: 'cust-001', displayName: 'John Smith', rating: 4.5 },
      pricing: { quotedPriceCents: 6000, commissionRate: 0.25, estimatedPayoutCents: 4500, currency: 'CAD' },
      sla: { responseTimeMin: 30, arrivalTimeMin: 60, completionTimeMin: 120 },
      distanceKm: 3.2,
      offeredAt: new Date(now - 2 * 60 * 1000).toISOString(),
      offerExpiresAt: new Date(now + 10 * 60 * 1000).toISOString(),
    },
    {
      assignmentId: 'assign-002',
      jobId: 'job-pending-002',
      referenceNumber: 'TSK-MOCK02',
      status: 'offered',
      isEmergency: false,
      serviceAddress: '789 Kennedy Road',
      serviceCity: 'Scarborough',
      serviceLatitude: 43.7315,
      serviceLongitude: -79.2631,
      task: { id: 'task-002', name: 'Ceiling Fan Installation', level: '2', categoryName: 'Electrical' },
      customer: { id: 'cust-002', displayName: 'Jane Doe', rating: 4.8 },
      pricing: { quotedPriceCents: 16000, commissionRate: 0.20, estimatedPayoutCents: 12000, currency: 'CAD' },
      sla: { responseTimeMin: null as any, arrivalTimeMin: null as any, completionTimeMin: null as any },
      distanceKm: 8.7,
      offeredAt: new Date(now - 5 * 60 * 1000).toISOString(),
      offerExpiresAt: new Date(now + 15 * 60 * 1000).toISOString(),
    },
    {
      assignmentId: 'assign-003',
      jobId: 'job-pending-003',
      referenceNumber: 'TSK-MOCK03',
      status: 'offered',
      isEmergency: true,
      serviceAddress: '100 The Queensway',
      serviceCity: 'Etobicoke',
      serviceLatitude: 43.6291,
      serviceLongitude: -79.4951,
      task: { id: 'task-003', name: 'Emergency Pipe Burst Repair', level: '4', categoryName: 'Plumbing' },
      customer: { id: 'cust-003', displayName: 'Bob Wilson' },
      pricing: { quotedPriceCents: 35000, commissionRate: 0.15, estimatedPayoutCents: 25000, currency: 'CAD' },
      sla: { responseTimeMin: 15, arrivalTimeMin: 30, completionTimeMin: 60 },
      distanceKm: 5.1,
      offeredAt: new Date(now - 1 * 60 * 1000).toISOString(),
      offerExpiresAt: new Date(now + 5 * 60 * 1000).toISOString(),
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

  fetchProviderProfile: async () => {
    try {
      const response = await get<{ data: ProviderProfile }>('/provider/profile');
      set({ providerProfile: response.data });
    } catch (error) {
      console.error('Failed to fetch provider profile:', error);
      // Fallback to mock if dev?
      if (__DEV__) {
        set({ providerProfile: MOCK_PROFILE });
      }
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

  clearError: () => set({ error: null }),

  reset: () => set(initialState),
}));
