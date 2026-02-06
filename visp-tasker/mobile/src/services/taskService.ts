/**
 * VISP/Tasker - Task Service
 *
 * Handles all API calls related to the task catalog, categories,
 * task details, booking, and predefined notes.
 * CRITICAL: Closed task catalog only. No free-text task descriptions.
 */

import { get, post } from './apiClient';
import type {
  ServiceCategory,
  ServiceTask,
  ServiceTaskDetail,
  ServiceLevel,
  BookingRequest,
  PredefinedNote,
  TimeSlot,
  PriorityOption,
  AddressInfo,
} from '../types';
import { Colors } from '../theme/colors';

// ──────────────────────────────────────────────
// Static Data
// ──────────────────────────────────────────────

export const LEVEL_LABELS: Record<ServiceLevel, string> = {
  1: 'Helper',
  2: 'Experienced',
  3: 'Certified Pro',
  4: 'Emergency',
};

export const LEVEL_DESCRIPTIONS: Record<ServiceLevel, string> = {
  1: 'Basic tasks, ideal for general help around the house',
  2: 'Technical light work requiring some experience',
  3: 'Licensed and regulated professional services',
  4: '24/7 on-call emergency response',
};

export const PRIORITY_OPTIONS: PriorityOption[] = [
  {
    value: 'standard',
    label: 'Standard',
    description: 'Scheduled at your convenience. Best availability.',
    multiplier: 1.0,
    color: Colors.success,
  },
  {
    value: 'priority',
    label: 'Priority',
    description: 'Faster matching, usually within 2 hours.',
    multiplier: 1.3,
    color: Colors.warning,
  },
  {
    value: 'urgent',
    label: 'Urgent',
    description: 'Immediate dispatch. Higher rate applies.',
    multiplier: 1.6,
    color: Colors.emergencyRed,
  },
];

export const PREDEFINED_NOTES: PredefinedNote[] = [
  { id: 'note_pet', label: 'I have pets on the property' },
  { id: 'note_parking', label: 'Street parking available' },
  { id: 'note_driveway', label: 'Driveway parking available' },
  { id: 'note_gate', label: 'Gate code required for entry' },
  { id: 'note_doorbell', label: 'Please ring doorbell on arrival' },
  { id: 'note_knock', label: 'Please knock on arrival' },
  { id: 'note_shoes', label: 'Please remove shoes indoors' },
  { id: 'note_kids', label: 'Children present in the home' },
  { id: 'note_elderly', label: 'Elderly person present in the home' },
  { id: 'note_access', label: 'Provide specific access instructions at booking' },
  { id: 'note_materials', label: 'I will provide materials' },
  { id: 'note_photos', label: 'Photos of the issue attached' },
  { id: 'note_recurring', label: 'This may be a recurring service' },
  { id: 'note_second_floor', label: 'Work is on the second floor or higher' },
  { id: 'note_basement', label: 'Work is in the basement' },
  { id: 'note_outdoor', label: 'Work is outdoors' },
];

// ──────────────────────────────────────────────
// API Methods
// ──────────────────────────────────────────────

/**
 * Fetch all service categories.
 */
async function fetchCategories(): Promise<ServiceCategory[]> {
  return get<ServiceCategory[]>('/categories');
}

/**
 * Fetch tasks for a specific category, optionally filtered by level.
 */
async function fetchCategoryTasks(
  categoryId: string,
  level?: ServiceLevel,
): Promise<ServiceTask[]> {
  const params: Record<string, unknown> = { categoryId };
  if (level !== undefined) {
    params.level = level;
  }
  return get<ServiceTask[]>(`/categories/${categoryId}/tasks`, params);
}

/**
 * Fetch full task details for the subcategory/detail view.
 */
async function fetchTaskDetail(taskId: string): Promise<ServiceTaskDetail> {
  return get<ServiceTaskDetail>(`/tasks/${taskId}`);
}

/**
 * Fetch available time slots for a given date and task.
 */
async function fetchTimeSlots(
  taskId: string,
  date: string,
): Promise<TimeSlot[]> {
  return get<TimeSlot[]>(`/tasks/${taskId}/time-slots`, { date });
}

/**
 * Calculate price estimate based on task, priority, and location.
 */
async function calculatePriceEstimate(
  taskId: string,
  priority: string,
  address: AddressInfo,
): Promise<{ estimatedPrice: number; breakdown: string }> {
  return post<{ estimatedPrice: number; breakdown: string }>(
    '/bookings/estimate',
    { taskId, priority, address },
  );
}

/**
 * Submit a booking request. Returns the created booking ID.
 */
async function createBooking(
  request: BookingRequest,
): Promise<{ bookingId: string; estimatedPrice: number }> {
  return post<{ bookingId: string; estimatedPrice: number }>(
    '/bookings',
    request,
  );
}

/**
 * Search tasks by keyword within a category.
 * Searches the predefined task catalog only (closed catalog).
 */
async function searchTasks(
  categoryId: string,
  query: string,
): Promise<ServiceTask[]> {
  return get<ServiceTask[]>(`/categories/${categoryId}/tasks/search`, {
    q: query,
  });
}

// ──────────────────────────────────────────────
// Export
// ──────────────────────────────────────────────

export const taskService = {
  fetchCategories,
  fetchCategoryTasks,
  fetchTaskDetail,
  fetchTimeSlots,
  calculatePriceEstimate,
  createBooking,
  searchTasks,
};

export default taskService;
