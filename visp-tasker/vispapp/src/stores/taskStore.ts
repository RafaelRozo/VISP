/**
 * VISP - Task Selection Zustand Store
 *
 * Manages state for the task selection flow: browsing categories,
 * viewing task details, selecting options, and creating bookings.
 * CRITICAL: Closed task catalog. No free-text task descriptions.
 */

import { create } from 'zustand';
import { taskService } from '../services/taskService';
import type {
  ServiceCategory,
  ServiceTask,
  ServiceTaskDetail,
  ServiceLevel,
  AddressInfo,
  PriorityLevel,
  TimeSlot,
  BookingRequest,
} from '../types';

// ──────────────────────────────────────────────
// State shape
// ──────────────────────────────────────────────

interface TaskState {
  // Category browsing
  categories: ServiceCategory[];
  categoryTasks: ServiceTask[];
  selectedCategory: ServiceCategory | null;
  selectedLevelFilter: ServiceLevel | null;
  searchQuery: string;
  filteredTasks: ServiceTask[];

  // Task detail
  taskDetail: ServiceTaskDetail | null;

  // Booking form
  selectedTask: ServiceTaskDetail | null;
  address: AddressInfo | null;
  scheduledDate: string;
  scheduledTimeSlot: string;
  availableTimeSlots: TimeSlot[];
  isFlexibleSchedule: boolean;
  priority: PriorityLevel;
  selectedNotes: string[];
  estimatedPrice: number;

  // Loading flags
  isLoadingCategories: boolean;
  isLoadingTasks: boolean;
  isLoadingDetail: boolean;
  isLoadingTimeSlots: boolean;
  isLoadingEstimate: boolean;
  isSubmittingBooking: boolean;

  // Error
  error: string | null;

  // Actions
  fetchCategories: () => Promise<void>;
  fetchCategoryTasks: (categoryId: string, level?: ServiceLevel) => Promise<void>;
  fetchTaskDetail: (taskId: string) => Promise<void>;
  fetchTimeSlots: (taskId: string, date: string) => Promise<void>;
  calculateEstimate: () => Promise<void>;
  submitBooking: () => Promise<{ bookingId: string }>;

  setSelectedCategory: (category: ServiceCategory) => void;
  setLevelFilter: (level: ServiceLevel | null) => void;
  setSearchQuery: (query: string) => void;
  setAddress: (address: AddressInfo) => void;
  setScheduledDate: (date: string) => void;
  setScheduledTimeSlot: (slot: string) => void;
  setFlexibleSchedule: (flexible: boolean) => void;
  setPriority: (priority: PriorityLevel) => void;
  toggleNote: (noteId: string) => void;
  clearError: () => void;
  resetBookingForm: () => void;
  reset: () => void;
}

// ──────────────────────────────────────────────
// Initial state
// ──────────────────────────────────────────────

const initialBookingState = {
  selectedTask: null,
  address: null,
  scheduledDate: '',
  scheduledTimeSlot: '',
  availableTimeSlots: [],
  isFlexibleSchedule: false,
  priority: 'standard' as PriorityLevel,
  selectedNotes: [],
  estimatedPrice: 0,
};

const initialState = {
  categories: [],
  categoryTasks: [],
  selectedCategory: null,
  selectedLevelFilter: null,
  searchQuery: '',
  filteredTasks: [],
  taskDetail: null,
  ...initialBookingState,
  isLoadingCategories: false,
  isLoadingTasks: false,
  isLoadingDetail: false,
  isLoadingTimeSlots: false,
  isLoadingEstimate: false,
  isSubmittingBooking: false,
  error: null,
};

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function filterTasks(
  tasks: ServiceTask[],
  query: string,
  level: ServiceLevel | null,
): ServiceTask[] {
  let filtered = tasks;

  if (level !== null) {
    filtered = filtered.filter((t) => t.level === level);
  }

  if (query.trim().length > 0) {
    const lowerQuery = query.toLowerCase().trim();
    filtered = filtered.filter(
      (t) =>
        t.name.toLowerCase().includes(lowerQuery) ||
        t.description.toLowerCase().includes(lowerQuery),
    );
  }

  return filtered;
}

function extractErrorMessage(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) {
    return (err as { message: string }).message;
  }
  return 'An unexpected error occurred';
}

// ──────────────────────────────────────────────
// Store
// ──────────────────────────────────────────────

export const useTaskStore = create<TaskState>((set, getState) => ({
  ...initialState,

  fetchCategories: async () => {
    set({ isLoadingCategories: true, error: null });
    try {
      const categories = await taskService.fetchCategories();
      set({ categories, isLoadingCategories: false });
    } catch (err: unknown) {
      set({
        isLoadingCategories: false,
        error: extractErrorMessage(err),
      });
    }
  },

  fetchCategoryTasks: async (categoryId: string, level?: ServiceLevel) => {
    set({ isLoadingTasks: true, error: null });
    try {
      const tasks = await taskService.fetchCategoryTasks(categoryId, level);
      const state = getState();
      const filtered = filterTasks(tasks, state.searchQuery, state.selectedLevelFilter);
      set({
        categoryTasks: tasks,
        filteredTasks: filtered,
        isLoadingTasks: false,
      });
    } catch (err: unknown) {
      set({
        isLoadingTasks: false,
        error: extractErrorMessage(err),
      });
    }
  },

  fetchTaskDetail: async (taskId: string) => {
    set({ isLoadingDetail: true, error: null });
    try {
      const detail = await taskService.fetchTaskDetail(taskId);
      set({
        taskDetail: detail,
        selectedTask: detail,
        isLoadingDetail: false,
      });
    } catch (err: unknown) {
      set({
        isLoadingDetail: false,
        error: extractErrorMessage(err),
      });
    }
  },

  fetchTimeSlots: async (taskId: string, date: string) => {
    set({ isLoadingTimeSlots: true, error: null });
    try {
      const slots = await taskService.fetchTimeSlots(taskId, date);
      set({ availableTimeSlots: slots, isLoadingTimeSlots: false });
    } catch (err: unknown) {
      set({
        isLoadingTimeSlots: false,
        error: extractErrorMessage(err),
      });
    }
  },

  calculateEstimate: async () => {
    const state = getState();
    if (!state.selectedTask || !state.address) {
      return;
    }

    set({ isLoadingEstimate: true, error: null });
    try {
      const result = await taskService.calculatePriceEstimate(
        state.selectedTask.id,
        state.priority,
        state.address,
      );
      set({ estimatedPrice: result.estimatedPrice, isLoadingEstimate: false });
    } catch (err: unknown) {
      set({
        isLoadingEstimate: false,
        error: extractErrorMessage(err),
      });
    }
  },

  submitBooking: async () => {
    const state = getState();
    if (!state.selectedTask || !state.address) {
      throw new Error('Missing required booking information');
    }

    const request: BookingRequest = {
      taskId: state.selectedTask.id,
      address: state.address,
      scheduledDate: state.scheduledDate,
      scheduledTimeSlot: state.scheduledTimeSlot,
      isFlexibleSchedule: state.isFlexibleSchedule,
      priority: state.priority,
      selectedNotes: state.selectedNotes,
      estimatedPrice: state.estimatedPrice,
    };

    set({ isSubmittingBooking: true, error: null });
    try {
      const result = await taskService.createBooking(request);
      set({ isSubmittingBooking: false });
      return { bookingId: result.bookingId };
    } catch (err: unknown) {
      set({
        isSubmittingBooking: false,
        error: extractErrorMessage(err),
      });
      throw err;
    }
  },

  setSelectedCategory: (category: ServiceCategory) => {
    set({ selectedCategory: category });
  },

  setLevelFilter: (level: ServiceLevel | null) => {
    const state = getState();
    const filtered = filterTasks(state.categoryTasks, state.searchQuery, level);
    set({ selectedLevelFilter: level, filteredTasks: filtered });
  },

  setSearchQuery: (query: string) => {
    const state = getState();
    const filtered = filterTasks(state.categoryTasks, query, state.selectedLevelFilter);
    set({ searchQuery: query, filteredTasks: filtered });
  },

  setAddress: (address: AddressInfo) => {
    set({ address });
  },

  setScheduledDate: (date: string) => {
    set({ scheduledDate: date });
  },

  setScheduledTimeSlot: (slot: string) => {
    set({ scheduledTimeSlot: slot });
  },

  setFlexibleSchedule: (flexible: boolean) => {
    set({ isFlexibleSchedule: flexible });
  },

  setPriority: (priority: PriorityLevel) => {
    set({ priority });
  },

  toggleNote: (noteId: string) => {
    set((state) => {
      const exists = state.selectedNotes.includes(noteId);
      return {
        selectedNotes: exists
          ? state.selectedNotes.filter((id) => id !== noteId)
          : [...state.selectedNotes, noteId],
      };
    });
  },

  clearError: () => set({ error: null }),

  resetBookingForm: () => set(initialBookingState),

  reset: () => set(initialState),
}));
