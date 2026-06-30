/**
 * VISP - Task Service
 *
 * Handles all API calls related to the task catalog, categories,
 * task details, booking, and predefined notes.
 * CRITICAL: Closed task catalog only. No free-text task descriptions.
 */

import apiClient, { get, post } from './apiClient';
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
  Job,
  JobStatus,
  JobTrackingData,
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

// Backend response shapes (snake_case)
interface BackendCategory {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  icon_url?: string | null;
  display_order: number;
  is_active: boolean;
  parent_id?: string | null;
  task_count: number;
}

interface BackendTask {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  level: string;
  category_id: string;
  emergency_eligible: boolean;
  base_price_min_cents?: number | null;
  base_price_max_cents?: number | null;
  estimated_duration_min?: number | null;
  icon_url?: string | null;
  display_order: number;
  is_active: boolean;
}

function mapCategory(cat: BackendCategory): ServiceCategory {
  return {
    id: cat.id,
    name: cat.name,
    slug: cat.slug,
    icon: cat.icon_url ?? '',
    taskCount: cat.task_count ?? 0,
    isEmergency: false,
    sortOrder: cat.display_order ?? 0,
  };
}

function mapTask(task: BackendTask): ServiceTask {
  // Handle "LEVEL_1" string format from backend enum
  let levelNum = Number(task.level);
  if (isNaN(levelNum) && typeof task.level === 'string' && task.level.startsWith('LEVEL_')) {
    levelNum = Number(task.level.split('_')[1]);
  }
  // Default to level 1 if parsing fails
  const safeLevel = (isNaN(levelNum) ? 1 : levelNum) as ServiceLevel;

  return {
    id: task.id,
    categoryId: task.category_id,
    name: task.name,
    description: task.description ?? '',
    level: safeLevel,
    estimatedDurationMinutes: task.estimated_duration_min ?? 60,
    basePrice: (task.base_price_min_cents ?? 0) / 100,
  };
}

/**
 * Fetch all service categories.
 */
async function fetchCategories(): Promise<ServiceCategory[]> {
  const raw = await get<BackendCategory[]>('/categories');
  return (raw ?? []).map(mapCategory);
}

/**
 * Fetch tasks for a specific category, optionally filtered by level.
 */
async function fetchCategoryTasks(
  categoryId: string,
  level?: ServiceLevel,
): Promise<ServiceTask[]> {
  const params: Record<string, unknown> = {};
  if (level !== undefined) {
    params.level = level;
  }
  const raw = await get<BackendTask[]>(`/categories/${categoryId}/tasks`, params);
  return (raw ?? []).map(mapTask);
}

interface BackendTaskDetail extends BackendTask {
  base_price_min_cents: number;
  base_price_max_cents: number;
  estimated_duration_min: number;
  escalation_keywords: string[];
  regulated: boolean;
  license_required: boolean;
  hazardous: boolean;
  structural: boolean;
  emergency_eligible: boolean;
  // PP5 — charge unit + quantity
  pricing_unit?: string | null;
  allows_quantity?: boolean;
  min_quantity?: number | null;
  // Detail endpoint returns nested category object instead of category_id
  category?: { id: string; slug: string; name: string; icon_url?: string | null };
}

function mapTaskDetail(task: BackendTaskDetail): ServiceTaskDetail {
  // Detail endpoint returns category as nested object, not category_id
  // Normalize so mapTask can read category_id
  const normalizedTask = {
    ...task,
    category_id: task.category_id || task.category?.id || '',
  };

  return {
    ...mapTask(normalizedTask),
    fullDescription: task.description ?? 'No detailed description available.',
    requirements: [
      'Provider must arrive on time',
      'Standard tools required',
      'Clean up after work completion',
    ],
    examplePhotos: [],
    priceRangeMin: (task.base_price_min_cents ?? 0) / 100,
    priceRangeMax: (task.base_price_max_cents ?? 0) / 100,
    autoEscalationKeywords: task.escalation_keywords ?? [],
    pricingUnit: task.pricing_unit ?? null,
    allowsQuantity: task.allows_quantity ?? false,
    minQuantity: task.min_quantity ?? null,
  };
}

/**
 * Fetch full task details for the subcategory/detail view.
 */
async function fetchTaskDetail(taskId: string): Promise<ServiceTaskDetail> {
  // Use apiClient directly because single resource endpoints return unwrapped object
  const response = await apiClient.get<BackendTaskDetail>(`/tasks/${taskId}`);
  if (!response.data) {
    throw new Error('Empty response from server');
  }
  return mapTaskDetail(response.data);
}

/**
 * Fetch available time slots for a given date and task.
 */
/**
 * Fetch available time slots for a given date and task.
 */
async function fetchTimeSlots(
  taskId: string,
  date: string,
): Promise<TimeSlot[]> {
  // The time-slots endpoint returns a bare array, NOT wrapped in {data: [...]},
  // so we must use apiClient.get directly instead of the get() helper
  // (the get() helper does response.data.data which would be undefined here).
  const response = await apiClient.get(`/tasks/${taskId}/time-slots`, { params: { date } });
  const raw: any[] = response.data ?? [];

  return raw.map(slot => ({
    id: slot.id,
    label: slot.label,
    startTime: slot.startTime ?? slot.start_time,
    endTime: slot.endTime ?? slot.end_time,
    available: slot.available ?? true,
  }));
}

/**
 * Calculate price estimate using the real backend pricing engine.
 * GET /api/v1/pricing/estimate
 */
async function calculatePriceEstimate(
  taskId: string,
  priority: string,
  address: AddressInfo,
): Promise<{ estimatedPrice: number; priceMin: number; priceMax: number; breakdown: string }> {
  try {
    const params: Record<string, unknown> = {
      task_id: taskId,
      latitude: address.latitude || 45.4215,
      longitude: address.longitude || -75.6972,
      is_emergency: priority === 'urgent',
    };

    const response = await apiClient.get('/pricing/estimate', { params });
    const data: any = response.data;

    const minCents = data.final_price_min_cents ?? data.base_price_min_cents ?? 0;
    const maxCents = data.final_price_max_cents ?? data.base_price_max_cents ?? 0;
    const priceMin = minCents / 100;
    const priceMax = maxCents / 100;
    // Use the average as the estimated price
    const estimatedPrice = (priceMin + priceMax) / 2;

    const multiplier = parseFloat(data.dynamic_multiplier ?? '1.0');
    const breakdown = multiplier > 1
      ? `Base: $${priceMin}-$${priceMax} × ${multiplier}x dynamic`
      : `Estimated: $${priceMin} - $${priceMax}`;

    return { estimatedPrice, priceMin, priceMax, breakdown };
  } catch (err) {
    console.warn('[taskService] Price estimate API failed, using base prices', err);
    // Fallback: return 0 so the UI knows to show the range instead
    return { estimatedPrice: 0, priceMin: 0, priceMax: 0, breakdown: 'Estimate unavailable' };
  }
}

/**
 * Submit a booking request. Returns the created booking ID.
 * Uses raw axios to bypass apiClient interceptor for debugging.
 */
async function createBooking(
  request: BookingRequest,
): Promise<{ bookingId: string; estimatedPrice: number }> {
  // Combine date and time
  const scheduledAt = request.scheduledDate && request.scheduledTimeSlot
    ? `${request.scheduledDate}T${request.scheduledTimeSlot}:00`
    : undefined;

  // Use default coordinates if missing (backend validation requires them)
  const lat = request.address.latitude || 45.4215; // Ottawa default
  const lng = request.address.longitude || -75.6972;

  // Convert full country name to 2-letter ISO code (DB column is VARCHAR(2))
  const rawCountry = (request.address.country || 'CA').trim();
  const COUNTRY_MAP: Record<string, string> = {
    'canada': 'CA', 'ca': 'CA',
    'united states': 'US', 'usa': 'US', 'us': 'US',
    'united states of america': 'US',
    'mexico': 'MX', 'mx': 'MX',
  };
  const countryCode = COUNTRY_MAP[rawCountry.toLowerCase()] ?? rawCountry.substring(0, 2).toUpperCase();

  const payload = {
    serviceTaskId: request.taskId,
    locationAddress: request.address.formattedAddress || request.address.street || 'Address not provided',
    locationLat: lat,
    locationLng: lng,
    city: request.address.city || undefined,
    provinceState: request.address.province || undefined,
    postalZip: request.address.postalCode || undefined,
    country: countryCode,
    scheduledAt,
    isEmergency: request.priority === 'urgent',
    notes: (request.selectedNotes && request.selectedNotes.length > 0) ? request.selectedNotes : undefined,
    quantity: (request.quantity && request.quantity > 0) ? request.quantity : undefined,
  };

  console.log('[taskService] createBooking payload:', JSON.stringify(payload));

  try {
    // Use apiClient.post directly — the backend wraps response in { data: { job, estimatedPrice } }
    const response = await apiClient.post('/jobs/book', payload);
    const data = response.data?.data ?? response.data;

    console.log('[taskService] createBooking response:', JSON.stringify(data));

    return {
      bookingId: data.job?.id ?? data.id ?? 'unknown',
      estimatedPrice: (data.estimatedPrice?.minCents ?? 0) / 100,
    };
  } catch (err: any) {
    // Capture the FULL error for debugging
    const status = err?.statusCode ?? err?.response?.status ?? 'unknown';
    const detail = err?.message ?? err?.response?.data?.detail ?? JSON.stringify(err);
    const responseBody = err?.response?.data ? JSON.stringify(err.response.data) : 'N/A';
    console.error(`[taskService] createBooking FAILED: status=${status} detail=${detail} body=${responseBody}`);
    throw err;
  }
}

/**
 * Search tasks by keyword within a category.
 * Searches the predefined task catalog only (closed catalog).
 */
async function searchTasks(
  categoryId: string,
  query: string,
): Promise<ServiceTask[]> {
  // Use the global search endpoint with category filter
  const raw = await get<BackendTask[]>('/tasks/search', {
    q: query,
    category_id: categoryId,
  });
  return (raw ?? []).map(mapTask);
}

/**
 * Natural-language-ish search across the WHOLE catalog (no category filter).
 * Backend ranks tasks by token/alias overlap. Closed catalog — results are
 * always predefined tasks. Used by the HomeScreen "What needs doing?" box.
 */
async function searchAllTasks(query: string): Promise<ServiceTask[]> {
  const raw = await get<BackendTask[]>('/tasks/search', { q: query });
  return (raw ?? []).map(mapTask);
}

// ──────────────────────────────────────────────
// Active Jobs (Real Backend)
// ──────────────────────────────────────────────

/** Fetch currently active jobs for the logged‑in customer. */
async function getActiveJobs(): Promise<Job[]> {
  const response = await apiClient.get('/jobs/active');
  const data = response.data?.data ?? response.data;
  const items: any[] = data?.items ?? [];

  return items.map((j: any) => ({
    id: j.id,
    customerId: j.customerId,
    providerId: null,
    taskId: j.taskId,
    taskName: j.taskName ?? j.referenceNumber ?? 'Job',
    categoryName: j.categoryName ?? '',
    status: ((j.status ?? 'pending') as string).toLowerCase() as JobStatus,
    level: 1 as ServiceLevel,
    scheduledAt: j.scheduledAt ?? null,
    startedAt: j.startedAt ?? null,
    completedAt: j.completedAt ?? null,
    estimatedPrice: (j.quotedPriceCents ?? 0) / 100,
    finalPrice: j.finalPriceCents ? j.finalPriceCents / 100 : null,
    provider: null,
    address: {
      street: j.serviceAddress ?? '',
      city: j.serviceCity ?? '',
      province: j.provinceState ?? '',
      postalCode: j.postalZip ?? '',
      latitude: Number(j.serviceLatitude ?? 0),
      longitude: Number(j.serviceLongitude ?? 0),
    },
    slaDeadline: null,
    pricingModel: j.pricingModel ?? j.pricing_model ?? null,
    hourlyRateCents: j.hourlyRateCents ?? j.hourly_rate_cents ?? null,
    actualDurationMinutes: j.actualDurationMinutes ?? j.actual_duration_minutes ?? null,
    estimatedDurationMinutes: j.estimatedDurationMinutes ?? j.estimated_duration_minutes ?? null,
    createdAt: j.createdAt,
    updatedAt: j.createdAt,
  }));
}

/** Fetch a single job by ID. */
async function getJobDetail(jobId: string): Promise<Job> {
  const response = await apiClient.get(`/jobs/${jobId}`);
  const data = response.data?.data ?? response.data;
  const j = data?.job ?? data;

  // Read provider from /jobs/{id} response
  const providerInfo = data?.provider ?? null;

  return {
    id: j.id,
    customerId: j.customer_id ?? j.customerId ?? '',
    providerId: providerInfo?.id ?? null,
    taskId: j.task_id ?? j.taskId ?? '',
    taskName: j.task_name ?? j.taskName ?? j.reference_number ?? j.referenceNumber ?? 'Job',
    categoryName: j.category_name ?? j.categoryName ?? '',
    status: ((j.status ?? 'pending') as string).toLowerCase() as JobStatus,
    level: 1 as ServiceLevel,
    scheduledAt: j.scheduled_at ?? j.scheduledAt ?? null,
    startedAt: j.started_at ?? j.startedAt ?? null,
    completedAt: j.completed_at ?? j.completedAt ?? null,
    estimatedPrice: ((j.quoted_price_cents ?? j.quotedPriceCents ?? 0) / 100),
    finalPrice: (j.final_price_cents ?? j.finalPriceCents)
      ? (j.final_price_cents ?? j.finalPriceCents) / 100
      : null,
    provider: providerInfo ? {
      id: providerInfo.id,
      firstName: (providerInfo.displayName ?? 'Provider').split(' ')[0],
      lastName: (providerInfo.displayName ?? '').split(' ').slice(1).join(' ') || '',
      avatarUrl: providerInfo.avatarUrl ?? null,
      rating: providerInfo.rating ?? 0,
      completedJobs: providerInfo.completedJobs ?? 0,
    } : null,
    address: {
      street: j.service_address ?? j.serviceAddress ?? '',
      city: j.service_city ?? j.serviceCity ?? '',
      province: j.service_province_state ?? j.provinceState ?? '',
      postalCode: j.service_postal_zip ?? j.postalZip ?? '',
      latitude: Number(j.service_latitude ?? j.serviceLatitude ?? 0),
      longitude: Number(j.service_longitude ?? j.serviceLongitude ?? 0),
    },
    slaDeadline: null,
    pricingModel: j.pricing_model ?? j.pricingModel ?? null,
    hourlyRateCents: j.hourly_rate_cents ?? j.hourlyRateCents ?? null,
    actualDurationMinutes: j.actual_duration_minutes ?? j.actualDurationMinutes ?? null,
    estimatedDurationMinutes: j.estimated_duration_minutes ?? j.estimatedDurationMinutes ?? null,
    createdAt: j.created_at ?? j.createdAt ?? new Date().toISOString(),
    updatedAt: j.updated_at ?? j.updatedAt ?? j.created_at ?? j.createdAt ?? new Date().toISOString(),
  };
}

/** Fetch real‑time tracking data for a job (provider position, ETA). */
async function getJobTracking(jobId: string): Promise<JobTrackingData> {
  const response = await apiClient.get(`/jobs/${jobId}/tracking`);
  const data = response.data?.data ?? response.data;

  return {
    providerLat: data.providerLat != null ? Number(data.providerLat) : null,
    providerLng: data.providerLng != null ? Number(data.providerLng) : null,
    etaMinutes: data.etaMinutes ?? null,
    status: data.status ?? 'unknown',
    providerName: data.providerName ?? null,
    providerPhone: data.providerPhone ?? null,
    providerLevel: data.providerLevel ?? null,
    updatedAt: data.updatedAt ?? null,
  };
}

async function queueJob(jobId: string): Promise<void> {
  await apiClient.post(`/jobs/${jobId}/queue`);
}

// ──────────────────────────────────────────────
// Customer Provider Approval
// ──────────────────────────────────────────────

interface PendingProviderInfo {
  providerId: string;
  displayName: string;
  level: number;
  yearsExperience: number | null;
  rating: number | null;
  profilePhotoUrl: string | null;
  bio: string | null;
  // PP4 — the provider's own price for this job (null when they use catalog
  // pricing or the task is custom-quote).
  quotedPriceCents: number | null;
  rateCents: number | null;
  pricingUnit: string | null;
  estimatedQuantity: number | null;
  // PP3 tax + PP4c service fee snapshot (what the customer actually pays).
  serviceTaxCents: number | null;
  taxJurisdiction: string | null;
  serviceFeeCents: number | null;
  totalChargedCents: number | null;
}

async function getPendingProvider(jobId: string): Promise<PendingProviderInfo | null> {
  const resp = await apiClient.get<{ data: PendingProviderInfo | null }>(`/jobs/${jobId}/pending-provider`);
  return resp.data?.data ?? null;
}

async function approveProvider(jobId: string): Promise<void> {
  await apiClient.post(`/jobs/${jobId}/approve-provider`);
}

async function rejectProvider(jobId: string): Promise<void> {
  await apiClient.post(`/jobs/${jobId}/reject-provider`);
}

// ── PP5-3/4 — payment authorize / capture / overage ──────────────────────
interface AuthorizePaymentResult {
  paymentIntentId: string;
  clientSecret: string | null;
  status: string;
  authorizedCents: number;
  amountCapturableCents: number;
  applicationFeeCents: number;
}

/** Place the manual-capture hold (total × 1.30) when the customer approves the
 * provider. Pass a saved paymentMethod id to confirm server-side (current app
 * pattern); omit it to get a clientSecret for on-device confirmation. */
async function authorizePayment(jobId: string, paymentMethodId?: string): Promise<AuthorizePaymentResult> {
  const resp = await apiClient.post<{ data: AuthorizePaymentResult }>(
    `/jobs/${jobId}/authorize-payment`,
    paymentMethodId ? { paymentMethod: paymentMethodId } : {},
  );
  return resp.data.data;
}

interface CapturePaymentResult {
  status: string;
  capturedCents: number;
  applicationFeeCents: number;
  actualTotalCents: number | null;
  finalPriceCents: number | null;
}

/** Capture the actual amount at completion (≤ the held ceiling). When the actual
 * exceeds the ceiling and the overage isn't approved, the backend returns 409
 * with { error:'overage_approval_required', actualCents, authorizedCents,
 * overageCents } — surfaced as OverageRequired below. */
interface OverageRequired {
  overage: true;
  actualCents: number;
  authorizedCents: number;
  overageCents: number;
}

async function capturePayment(
  jobId: string,
  opts?: { finalTotalCents?: number; paymentMethodId?: string },
): Promise<CapturePaymentResult | OverageRequired> {
  try {
    const resp = await apiClient.post<{ data: CapturePaymentResult }>(
      `/jobs/${jobId}/capture-payment`,
      {
        finalTotalCents: opts?.finalTotalCents,
        paymentMethod: opts?.paymentMethodId,
      },
    );
    return resp.data.data;
  } catch (err: any) {
    const detail = err?.response?.data?.detail;
    if (err?.response?.status === 409 && detail?.error === 'overage_approval_required') {
      return {
        overage: true,
        actualCents: detail.actualCents,
        authorizedCents: detail.authorizedCents,
        overageCents: detail.overageCents,
      };
    }
    throw err;
  }
}

/** Customer approves charging above the held ceiling (then capture again). */
async function approveOverage(jobId: string): Promise<void> {
  await apiClient.post(`/jobs/${jobId}/approve-overage`);
}

// ── Provider-set-pricing: available providers in zone w/ their prices ──────
export interface AvailableProvider {
  providerId: string;
  displayName: string;
  level: number | null;
  distanceKm: number | null;
  rateCents: number | null;       // the provider's own rate (null = prices per-job)
  pricingUnit: string | null;
  quotedPriceCents: number | null; // estimate for this job at their rate
}

export interface AvailableProvidersResult {
  providers: AvailableProvider[];
  count: number;
  catalogMinCents: number | null;  // the level guardrail range the customer sees
  catalogMaxCents: number | null;
  pricingUnit: string | null;
}

/** Qualified providers in the customer's zone for a booked job, each with their
 * own price. Empty => none available now → job waits for offers (existing flow). */
async function getAvailableProviders(jobId: string): Promise<AvailableProvidersResult> {
  const resp = await apiClient.get<{ data: AvailableProvidersResult }>(
    `/jobs/${jobId}/available-providers`,
  );
  return resp.data.data;
}

export const taskService = {
  fetchCategories,
  fetchCategoryTasks,
  fetchTaskDetail,
  fetchTimeSlots,
  calculatePriceEstimate,
  createBooking,
  searchTasks,
  searchAllTasks,
  getActiveJobs,
  getJobDetail,
  getJobTracking,
  queueJob,
  getPendingProvider,
  approveProvider,
  rejectProvider,
  authorizePayment,
  capturePayment,
  approveOverage,
  getAvailableProviders,
};

export default taskService;
