/**
 * VISP/Tasker - Emergency Service
 *
 * Handles all API calls for the emergency (Level 4) flow:
 * type selection, location, pricing, job lifecycle, and cancellation.
 * All emergency tasks are SLA-bound with zero tolerance.
 */

import { get, post } from './apiClient';
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
    taskIds: ['emg_plumbing_001', 'emg_plumbing_002'],
  },
  {
    type: 'electrical',
    label: 'Electrical Emergency',
    icon: 'flash',
    description: 'Power outage, sparking outlets, exposed wiring',
    taskIds: ['emg_electrical_001', 'emg_electrical_002'],
  },
  {
    type: 'hvac',
    label: 'HVAC Emergency',
    icon: 'thermometer',
    description: 'No heat in winter, AC failure in extreme heat',
    taskIds: ['emg_hvac_001'],
  },
  {
    type: 'gas',
    label: 'Gas Leak',
    icon: 'flame',
    description: 'Gas smell, suspected gas leak. Call 911 if immediate danger.',
    taskIds: ['emg_gas_001'],
  },
  {
    type: 'structural',
    label: 'Structural Damage',
    icon: 'home',
    description: 'Collapsed ceiling, wall damage, foundation issues',
    taskIds: ['emg_structural_001'],
  },
  {
    type: 'locksmith',
    label: 'Locksmith Emergency',
    icon: 'key',
    description: 'Locked out, broken locks, security breach',
    taskIds: ['emg_locksmith_001'],
  },
  {
    type: 'flooding',
    label: 'Flooding',
    icon: 'water',
    description: 'Water flooding, sump pump failure, drainage backup',
    taskIds: ['emg_flooding_001'],
  },
  {
    type: 'fire_damage',
    label: 'Fire Damage',
    icon: 'flame',
    description: 'Post-fire damage assessment and emergency boarding',
    taskIds: ['emg_fire_001'],
  },
  {
    type: 'broken_window',
    label: 'Broken Window',
    icon: 'grid',
    description: 'Shattered or broken window, emergency boarding',
    taskIds: ['emg_window_001'],
  },
  {
    type: 'roof_leak',
    label: 'Roof Leak',
    icon: 'umbrella',
    description: 'Active roof leak, emergency tarping',
    taskIds: ['emg_roof_001'],
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
 */
async function fetchEmergencyPricing(
  emergencyType: EmergencyType,
  location: AddressInfo,
): Promise<EmergencyPricing> {
  return post<EmergencyPricing>('/emergency/pricing', {
    emergencyType,
    location,
  });
}

/**
 * Fetch SLA terms for the emergency type and location.
 */
async function fetchEmergencySLA(
  emergencyType: EmergencyType,
  location: AddressInfo,
): Promise<EmergencySLA> {
  return post<EmergencySLA>('/emergency/sla', {
    emergencyType,
    location,
  });
}

/**
 * Submit an emergency request. Returns the created emergency job.
 */
async function createEmergencyRequest(
  request: EmergencyRequest,
): Promise<EmergencyJob> {
  return post<EmergencyJob>('/emergency/request', request);
}

/**
 * Get the current status of an emergency job.
 */
async function fetchEmergencyJob(jobId: string): Promise<EmergencyJob> {
  return get<EmergencyJob>(`/emergency/jobs/${jobId}`);
}

/**
 * Cancel an emergency job with a reason.
 */
async function cancelEmergencyJob(
  jobId: string,
  reasonId: string,
): Promise<{ cancellationFee: number; refundAmount: number }> {
  return post<{ cancellationFee: number; refundAmount: number }>(
    `/emergency/jobs/${jobId}/cancel`,
    { reasonId },
  );
}

/**
 * Submit a rating for a completed emergency job.
 */
async function rateEmergencyJob(
  jobId: string,
  overallRating: number,
  dimensions: Array<{ id: string; value: number }>,
  comment?: string,
): Promise<void> {
  return post<void>(`/emergency/jobs/${jobId}/rate`, {
    overallRating,
    dimensions,
    comment,
  });
}

/**
 * Confirm payment for a completed emergency job.
 */
async function confirmEmergencyPayment(jobId: string): Promise<void> {
  return post<void>(`/emergency/jobs/${jobId}/confirm-payment`);
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
