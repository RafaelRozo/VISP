/**
 * VISP - Emergency Service
 *
 * Handles all API calls for the emergency (Level 4) flow:
 * type selection, location, pricing, job lifecycle, and cancellation.
 * All emergency tasks are SLA-bound with zero tolerance.
 *
 * Emergency jobs use the standard /jobs/book endpoint with isEmergency: true.
 * Pricing and SLA are served from local defaults (Level 4 business rules).
 */

import apiClient, { get, post } from './apiClient';
import { Colors } from '../theme/colors';
import type {
  EmergencyType,
  EmergencyTypeConfig,
  EmergencySLA,
  EmergencyPricing,
  EmergencyRequest,
  EmergencyJob,
  CancellationReason,
  AddressInfo,
} from '../types';

// ──────────────────────────────────────────────
// Static Data
// ──────────────────────────────────────────────

export const EMERGENCY_TYPES: EmergencyTypeConfig[] = [
  {
    type: 'plumbing',
    label: 'Plumbing Emergency',
    icon: 'water',
    description: 'Burst pipes, major leaks, sewage backup',
    taskIds: [
      'b4000000-0000-4000-8000-000000000001', // Emergency Burst Pipe Repair
      'b4000000-0000-4000-8000-000000000002', // Emergency Sewer Backup
    ],
  },
  {
    type: 'electrical',
    label: 'Electrical Emergency',
    icon: 'flash',
    description: 'Power outage, sparking outlets, exposed wiring',
    taskIds: [
      'b4000000-0000-4000-8000-000000000006', // Emergency Total Power Loss
      'b4000000-0000-4000-8000-000000000022', // Emergency Electrical Hazard Make-Safe
    ],
  },
  {
    type: 'hvac',
    label: 'HVAC Emergency',
    icon: 'thermometer',
    description: 'No heat in winter, AC failure in extreme heat',
    taskIds: [
      'b4000000-0000-4000-8000-000000000009', // Emergency No Heat (Furnace Failure)
      'b4000000-0000-4000-8000-000000000012', // Emergency AC Failure (Extreme Heat)
    ],
  },
  {
    type: 'gas',
    label: 'Gas Leak',
    icon: 'flame',
    description: 'Gas smell, suspected gas leak. Call 911 if immediate danger.',
    taskIds: [
      'b4000000-0000-4000-8000-000000000005', // Emergency Gas Leak Response
    ],
  },
  {
    type: 'structural',
    label: 'Structural Damage',
    icon: 'home',
    description: 'Collapsed ceiling, wall damage, foundation issues',
    taskIds: [
      'b4000000-0000-4000-8000-000000000023', // Emergency Structural Assessment
      'b4000000-0000-4000-8000-000000000014', // Emergency Tree on House
    ],
  },
  {
    type: 'locksmith',
    label: 'Locksmith Emergency',
    icon: 'key',
    description: 'Locked out, broken locks, security breach',
    taskIds: [
      'b4000000-0000-4000-8000-000000000019', // Emergency Door / Lock Repair
    ],
  },
  {
    type: 'flooding',
    label: 'Flooding',
    icon: 'water',
    description: 'Water flooding, sump pump failure, drainage backup',
    taskIds: [
      'b4000000-0000-4000-8000-000000000017', // Emergency Flood Water Extraction
      'b4000000-0000-4000-8000-000000000021', // Emergency Sump Pump Failure
    ],
  },
  {
    type: 'fire_damage',
    label: 'Fire Damage',
    icon: 'flame',
    description: 'Post-fire damage assessment and emergency boarding',
    taskIds: [
      'b4000000-0000-4000-8000-000000000018', // Emergency Fire Damage Board-Up
    ],
  },
  {
    type: 'broken_window',
    label: 'Broken Window',
    icon: 'grid',
    description: 'Shattered or broken window, emergency boarding',
    taskIds: [
      'b4000000-0000-4000-8000-000000000020', // Emergency Window Board-Up
    ],
  },
  {
    type: 'roof_leak',
    label: 'Roof Leak',
    icon: 'umbrella',
    description: 'Active roof leak, emergency tarping',
    taskIds: [
      'b4000000-0000-4000-8000-000000000015', // Emergency Roof Leak / Tarping
    ],
  },
];

export const DEFAULT_SLA: EmergencySLA = {
  responseTimeMinutes: 5,
  arrivalTimeMinutes: 45,
  guaranteeText:
    'Provider will respond within 5 minutes and arrive within 45 minutes, or your emergency fee is waived.',
};

export const DEFAULT_PRICING: EmergencyPricing = {
  baseMultiplier: 2.5,
  minimumCharge: 150,
  estimatedRange: '$150 - $500+',
  disclosureText:
    'Emergency services are billed at 2.5x the standard rate with a $150 minimum charge. ' +
    'Final price depends on the scope of work. You will receive a detailed breakdown upon completion. ' +
    'The provider cannot add scope without creating a new job.',
};

export const CANCELLATION_REASONS: CancellationReason[] = [
  { id: 'cr_resolved', label: 'Issue resolved on its own' },
  { id: 'cr_called_other', label: 'Called another service' },
  { id: 'cr_not_emergency', label: 'Not actually an emergency' },
  { id: 'cr_wrong_type', label: 'Selected wrong emergency type' },
  { id: 'cr_cost', label: 'Emergency pricing too high' },
  { id: 'cr_wait', label: 'Wait time too long' },
  { id: 'cr_other', label: 'Other reason' },
];

export const EMERGENCY_CONSENT_VERSION = '2026-02-01';

// ──────────────────────────────────────────────
// API Methods
// ──────────────────────────────────────────────

/**
 * Fetch emergency pricing for a specific type and location.
 * Returns local defaults — Level 4 pricing is fixed by business rules.
 */
async function fetchEmergencyPricing(
  _emergencyType: EmergencyType,
  _location: AddressInfo,
): Promise<EmergencyPricing> {
  // Emergency pricing is defined by Level 4 business rules and does not
  // vary by type or location at this stage. Return the defaults directly.
  return DEFAULT_PRICING;
}

/**
 * Fetch SLA terms for the emergency type and location.
 * Returns local defaults — Level 4 SLA is fixed by business rules.
 */
async function fetchEmergencySLA(
  _emergencyType: EmergencyType,
  _location: AddressInfo,
): Promise<EmergencySLA> {
  return DEFAULT_SLA;
}

/**
 * Submit an emergency request via the standard /jobs/book endpoint
 * with isEmergency: true. Returns the created emergency job.
 */
async function createEmergencyRequest(
  request: EmergencyRequest,
): Promise<EmergencyJob> {
  // Resolve the service task ID from the emergency type config
  const typeConfig = EMERGENCY_TYPES.find((t) => t.type === request.emergencyType);
  const serviceTaskId = typeConfig?.taskIds[0] ?? `emg_${request.emergencyType}_001`;

  // Convert country to 2-letter ISO code
  const rawCountry = (request.location.country || 'CA').trim();
  const COUNTRY_MAP: Record<string, string> = {
    'canada': 'CA', 'ca': 'CA',
    'united states': 'US', 'usa': 'US', 'us': 'US',
  };
  const countryCode = COUNTRY_MAP[rawCountry.toLowerCase()] ?? rawCountry.substring(0, 2).toUpperCase();

  const payload = {
    serviceTaskId,
    locationAddress: request.location.formattedAddress || request.location.street || 'Emergency location',
    locationLat: request.location.latitude || 43.6532,
    locationLng: request.location.longitude || -79.3832,
    city: request.location.city || undefined,
    provinceState: request.location.province || undefined,
    postalZip: request.location.postalCode || undefined,
    country: countryCode,
    isEmergency: true,
    notes: [
      `emergency_type:${request.emergencyType}`,
      `consent_version:${request.consentVersion}`,
      `consent_at:${request.consentTimestamp}`,
    ],
  };

  console.log('[emergencyService] createEmergencyRequest payload:', JSON.stringify(payload));

  try {
    const response = await apiClient.post('/jobs/book', payload);
    const data = response.data?.data ?? response.data;

    console.log('[emergencyService] createEmergencyRequest response:', JSON.stringify(data));

    const jobId = data.job?.id ?? data.id ?? 'unknown';

    // Build SLA deadline (arrival time from now)
    const slaDeadline = new Date(
      Date.now() + DEFAULT_SLA.arrivalTimeMinutes * 60 * 1000,
    ).toISOString();

    // Map the /jobs/book response to EmergencyJob shape
    const emergencyJob: EmergencyJob = {
      id: jobId,
      emergencyType: request.emergencyType,
      status: 'searching',
      location: request.location,
      slaDeadline,
    };

    return emergencyJob;
  } catch (err: any) {
    const status = err?.statusCode ?? err?.response?.status ?? 'unknown';
    const detail = err?.message ?? err?.response?.data?.detail ?? JSON.stringify(err);
    console.error(`[emergencyService] createEmergencyRequest FAILED: status=${status} detail=${detail}`);
    throw err;
  }
}

/**
 * Get the current status of an emergency job.
 * Uses the standard /jobs/{id} endpoint.
 */
async function fetchEmergencyJob(jobId: string): Promise<EmergencyJob> {
  try {
    const response = await apiClient.get(`/jobs/${jobId}`);
    const data = response.data?.data ?? response.data;
    const job = data.job ?? data;

    // Map backend status to emergency status
    const statusMap: Record<string, string> = {
      'draft': 'searching',
      'pending_match': 'searching',
      'matched': 'matched',
      'pending_approval': 'matched',
      'provider_accepted': 'matched',
      'scheduled': 'matched',
      'provider_en_route': 'en_route',
      'in_progress': 'in_progress',
      'completed': 'completed',
      'cancelled_by_customer': 'cancelled',
      'cancelled_by_provider': 'cancelled',
      'cancelled_by_system': 'cancelled',
    };

    const rawStatus = job.status ?? 'searching';
    const emergencyStatus = statusMap[rawStatus] ?? 'searching';

    // Build provider info if available
    const provider = data.provider
      ? {
          id: data.provider.id,
          firstName: data.provider.displayName?.split(' ')[0] ?? '',
          lastName: data.provider.displayName?.split(' ').slice(1).join(' ') ?? '',
          photoUrl: data.provider.avatarUrl ?? '',
          rating: data.provider.rating ?? 0,
          reviewCount: data.provider.completedJobs ?? 0,
          level: data.provider.level ?? 4,
          yearsExperience: 0,
          completedJobs: data.provider.completedJobs ?? 0,
          specializations: [],
        }
      : undefined;

    const emergencyJob: EmergencyJob = {
      id: jobId,
      emergencyType: 'plumbing', // Type not stored in job, use default
      status: emergencyStatus as any,
      location: {
        placeId: '',
        formattedAddress: job.service_address ?? job.serviceAddress ?? '',
        latitude: parseFloat(job.service_latitude ?? job.serviceLatitude ?? '0'),
        longitude: parseFloat(job.service_longitude ?? job.serviceLongitude ?? '0'),
        streetNumber: '',
        street: job.service_address ?? job.serviceAddress ?? '',
        city: job.service_city ?? job.serviceCity ?? '',
        province: job.service_province_state ?? job.serviceProvinceState ?? '',
        postalCode: job.service_postal_zip ?? job.servicePostalZip ?? '',
        country: job.service_country ?? job.serviceCountry ?? 'CA',
      },
      slaDeadline: new Date(
        Date.now() + DEFAULT_SLA.arrivalTimeMinutes * 60 * 1000,
      ).toISOString(),
      provider,
      startedAt: job.started_at ?? job.startedAt,
      completedAt: job.completed_at ?? job.completedAt,
    };

    return emergencyJob;
  } catch (err: any) {
    console.error('[emergencyService] fetchEmergencyJob FAILED:', err?.message);
    throw err;
  }
}

/**
 * Cancel an emergency job with a reason.
 * Uses the standard /jobs/{id}/cancel endpoint.
 */
async function cancelEmergencyJob(
  jobId: string,
  reasonId: string,
): Promise<{ cancellationFee: number; refundAmount: number }> {
  try {
    await apiClient.post(`/jobs/${jobId}/cancel`, {
      cancelled_by: 'customer',
      actor_type: 'customer',
      reason: reasonId,
    });
    // Emergency cancellation fee is a flat business rule
    return { cancellationFee: 50, refundAmount: 0 };
  } catch (err: any) {
    console.error('[emergencyService] cancelEmergencyJob FAILED:', err?.message);
    throw err;
  }
}

/**
 * Submit a rating for a completed emergency job.
 * Uses the standard /jobs/{id}/rating endpoint.
 */
async function rateEmergencyJob(
  jobId: string,
  overallRating: number,
  dimensions: Array<{ id: string; value: number }>,
  comment?: string,
): Promise<void> {
  const tags = dimensions
    .filter((d) => d.value > 0)
    .map((d) => d.id);

  await apiClient.post(`/jobs/${jobId}/rating`, {
    rating: overallRating,
    tags,
    feedback: comment,
  });
}

/**
 * Confirm payment for a completed emergency job.
 */
async function confirmEmergencyPayment(jobId: string): Promise<void> {
  // Payment confirmation flows through Stripe — this is a no-op placeholder.
  console.log('[emergencyService] confirmEmergencyPayment for job:', jobId);
}

// ──────────────────────────────────────────────
// Export
// ──────────────────────────────────────────────

export const emergencyService = {
  fetchEmergencyPricing,
  fetchEmergencySLA,
  createEmergencyRequest,
  fetchEmergencyJob,
  cancelEmergencyJob,
  rateEmergencyJob,
  confirmEmergencyPayment,
};

export default emergencyService;
