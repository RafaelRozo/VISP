/**
 * VISP/Tasker - Shared TypeScript type definitions
 */

// ──────────────────────────────────────────────
// User & Auth
// ──────────────────────────────────────────────

export type UserRole = 'customer' | 'provider' | 'both';

export interface User {
  id: string;
  email: string;
  phone: string | null;
  firstName: string;
  lastName: string;
  role: UserRole;
  avatarUrl: string | null;
  isVerified: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface RegisterData {
  email: string;
  phone?: string;
  password: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  acceptedTermsVersion: string;
}

export interface AuthResponse {
  user: User;
  tokens: AuthTokens;
}

// ──────────────────────────────────────────────
// Service Levels
// ──────────────────────────────────────────────

export type ServiceLevel = 1 | 2 | 3 | 4;

export interface ServiceLevelInfo {
  level: ServiceLevel;
  name: string;
  description: string;
  color: string;
  hourlyRateMin: number;
  hourlyRateMax: number;
}

// ──────────────────────────────────────────────
// Categories & Tasks
// ──────────────────────────────────────────────

export interface ServiceCategory {
  id: string;
  name: string;
  slug: string;
  icon: string;
  taskCount: number;
  isEmergency: boolean;
  sortOrder: number;
}

export interface ServiceTask {
  id: string;
  categoryId: string;
  name: string;
  description: string;
  level: ServiceLevel;
  estimatedDurationMinutes: number;
  basePrice: number;
}

// ──────────────────────────────────────────────
// Jobs
// ──────────────────────────────────────────────

export type JobStatus =
  | 'pending'
  | 'matched'
  | 'accepted'
  | 'en_route'
  | 'in_progress'
  | 'completed'
  | 'cancelled'
  | 'disputed';

export interface Job {
  id: string;
  customerId: string;
  providerId: string | null;
  taskId: string;
  taskName: string;
  categoryName: string;
  status: JobStatus;
  level: ServiceLevel;
  scheduledAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  estimatedPrice: number;
  finalPrice: number | null;
  provider: JobProvider | null;
  address: JobAddress;
  slaDeadline: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface JobProvider {
  id: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  rating: number;
  completedJobs: number;
}

export interface JobAddress {
  street: string;
  city: string;
  province: string;
  postalCode: string;
  latitude: number;
  longitude: number;
}

// ──────────────────────────────────────────────
// Navigation
// ──────────────────────────────────────────────

export type RootStackParamList = {
  Auth: undefined;
  Login: undefined;
  Register: undefined;
  ForgotPassword: undefined;
  CustomerHome: undefined;
  ProviderHome: undefined;
  CategoryDetail: { categoryId: string; categoryName: string };
  JobDetail: { jobId: string };
  EmergencyFlow: undefined;
  Profile: undefined;
};

// ──────────────────────────────────────────────
// API
// ──────────────────────────────────────────────

export interface ApiError {
  message: string;
  code: string;
  statusCode: number;
  details?: Record<string, string[]>;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

// ──────────────────────────────────────────────
// Job Offers (Provider)
// ──────────────────────────────────────────────

export interface JobOffer {
  id: string;
  jobId: string;
  taskName: string;
  categoryName: string;
  level: ServiceLevel;
  customerArea: string;
  distanceKm: number;
  estimatedPrice: number;
  slaDeadline: string | null;
  expiresAt: string;
  address: JobAddress;
  createdAt: string;
}

// ──────────────────────────────────────────────
// Earnings
// ──────────────────────────────────────────────

export interface EarningsSummary {
  today: number;
  thisWeek: number;
  thisMonth: number;
  pendingPayout: number;
  totalEarned: number;
}

export interface EarningsPayout {
  id: string;
  jobId: string;
  taskName: string;
  grossAmount: number;
  commissionRate: number;
  commissionAmount: number;
  netAmount: number;
  status: 'pending' | 'paid' | 'failed';
  paidAt: string | null;
  createdAt: string;
}

export interface WeeklyEarnings {
  weekLabel: string;
  amount: number;
}

// ──────────────────────────────────────────────
// Provider Profile & Credentials
// ──────────────────────────────────────────────

export type CredentialStatus = 'pending' | 'approved' | 'expired' | 'rejected';

export type CredentialType =
  | 'criminal_record_check'
  | 'trade_license'
  | 'insurance_certificate'
  | 'portfolio'
  | 'certification'
  | 'drivers_license';

export interface Credential {
  id: string;
  type: CredentialType;
  label: string;
  status: CredentialStatus;
  documentUrl: string | null;
  expiresAt: string | null;
  rejectionReason: string | null;
  uploadedAt: string;
  reviewedAt: string | null;
}

export interface ProviderProfile {
  id: string;
  userId: string;
  level: ServiceLevel;
  performanceScore: number;
  isOnline: boolean;
  isOnCall: boolean;
  completedJobs: number;
  rating: number;
  stripeConnectStatus: 'not_connected' | 'pending' | 'active' | 'restricted';
  credentials: Credential[];
}

export interface LevelRequirement {
  label: string;
  description: string;
  isMet: boolean;
}

export interface LevelProgressInfo {
  currentLevel: ServiceLevel;
  nextLevel: ServiceLevel | null;
  progressPercent: number;
  requirements: LevelRequirement[];
}

// ──────────────────────────────────────────────
// Schedule
// ──────────────────────────────────────────────

export interface ScheduledJob {
  id: string;
  taskName: string;
  customerArea: string;
  scheduledAt: string;
  estimatedDurationMinutes: number;
  status: JobStatus;
  level: ServiceLevel;
}

export interface OnCallShift {
  id: string;
  startTime: string;
  endTime: string;
  isActive: boolean;
}

export interface TimeOffRequest {
  id: string;
  startDate: string;
  endDate: string;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
}

// ──────────────────────────────────────────────
// Settings
// ──────────────────────────────────────────────

export interface NotificationPreferences {
  pushEnabled: boolean;
  jobOffers: boolean;
  jobUpdates: boolean;
  promotions: boolean;
  emergencyAlerts: boolean;
}

export interface PaymentMethod {
  id: string;
  type: 'card' | 'bank_account';
  last4: string;
  brand: string | null;
  isDefault: boolean;
  expiresAt: string | null;
}

// ──────────────────────────────────────────────
// Extended Navigation
// ──────────────────────────────────────────────

export type ProviderTabParamList = {
  Dashboard: undefined;
  JobOffers: undefined;
  ActiveJob: { jobId: string };
  Earnings: undefined;
  Schedule: undefined;
  ProviderProfile: undefined;
};

export type CustomerTabParamList = {
  Home: undefined;
  MyJobs: undefined;
  CustomerProfile: undefined;
};

export type ProfileStackParamList = {
  ProfileMain: undefined;
  Credentials: undefined;
  Verification: undefined;
  Settings: undefined;
};

export type AuthStackParamList = {
  Login: undefined;
  Register: undefined;
  ForgotPassword: undefined;
};

// ──────────────────────────────────────────────
// Extended Task Types (Task Selection Flow)
// ──────────────────────────────────────────────

export interface ServiceTaskDetail extends ServiceTask {
  fullDescription: string;
  requirements: string[];
  examplePhotos: string[];
  priceRangeMin: number;
  priceRangeMax: number;
  autoEscalationKeywords: string[];
}

export interface PredefinedNote {
  id: string;
  label: string;
  categoryId?: string;
}

export type PriorityLevel = 'standard' | 'priority' | 'urgent';

export interface PriorityOption {
  value: PriorityLevel;
  label: string;
  description: string;
  multiplier: number;
  color: string;
}

export interface BookingRequest {
  taskId: string;
  address: AddressInfo;
  scheduledDate: string;
  scheduledTimeSlot: string;
  isFlexibleSchedule: boolean;
  priority: PriorityLevel;
  selectedNotes: string[];
  estimatedPrice: number;
}

export interface AddressInfo {
  placeId: string;
  formattedAddress: string;
  latitude: number;
  longitude: number;
  streetNumber: string;
  street: string;
  city: string;
  province: string;
  postalCode: string;
  country: string;
}

export interface TimeSlot {
  id: string;
  label: string;
  startTime: string;
  endTime: string;
  available: boolean;
}

// ──────────────────────────────────────────────
// Emergency Flow Types
// ──────────────────────────────────────────────

export type EmergencyType =
  | 'plumbing'
  | 'electrical'
  | 'hvac'
  | 'gas'
  | 'structural'
  | 'locksmith'
  | 'flooding'
  | 'fire_damage'
  | 'broken_window'
  | 'roof_leak';

export interface EmergencyTypeConfig {
  type: EmergencyType;
  label: string;
  icon: string;
  description: string;
  taskIds: string[];
}

export interface EmergencySLA {
  responseTimeMinutes: number;
  arrivalTimeMinutes: number;
  guaranteeText: string;
}

export interface EmergencyPricing {
  baseMultiplier: number;
  minimumCharge: number;
  estimatedRange: string;
  disclosureText: string;
}

export interface EmergencyRequest {
  emergencyType: EmergencyType;
  location: AddressInfo;
  pricingAccepted: boolean;
  legalConsentAccepted: boolean;
  consentTimestamp: string;
  consentVersion: string;
}

export interface ProviderDetail {
  id: string;
  firstName: string;
  lastName: string;
  photoUrl: string;
  rating: number;
  reviewCount: number;
  level: ServiceLevel;
  yearsExperience: number;
  completedJobs: number;
  specializations: string[];
}

export interface EmergencyJob {
  id: string;
  emergencyType: EmergencyType;
  status: EmergencyJobStatus;
  provider?: ProviderDetail;
  location: AddressInfo;
  slaDeadline: string;
  etaMinutes?: number;
  providerLocation?: {
    latitude: number;
    longitude: number;
  };
  startedAt?: string;
  completedAt?: string;
  finalPrice?: number;
  timeBreakdown?: TimeBreakdown;
  cancellationFee?: number;
}

export type EmergencyJobStatus =
  | 'searching'
  | 'matched'
  | 'en_route'
  | 'arrived'
  | 'in_progress'
  | 'completed'
  | 'cancelled';

export interface TimeBreakdown {
  responseTimeMinutes: number;
  travelTimeMinutes: number;
  workTimeMinutes: number;
  totalTimeMinutes: number;
}

export interface CancellationReason {
  id: string;
  label: string;
}

export interface RatingDimension {
  id: string;
  label: string;
  value: number;
}

// ──────────────────────────────────────────────
// Customer & Emergency Navigation
// ──────────────────────────────────────────────

export type CustomerFlowParamList = {
  CustomerHome: undefined;
  Category: { categoryId: string; categoryName: string };
  Subcategory: { taskId: string };
  TaskSelection: { taskId: string };
  BookingConfirmation: { bookingId: string };
};

export type EmergencyFlowParamList = {
  EmergencyTypeSelect: undefined;
  EmergencyLocation: { emergencyType: EmergencyType };
  EmergencyConfirm: { emergencyType: EmergencyType; location: AddressInfo };
  EmergencySearching: { jobId: string };
  EmergencyMatched: { jobId: string };
  EmergencyTracking: { jobId: string };
  EmergencyInProgress: { jobId: string };
  EmergencyCompletion: { jobId: string };
  EmergencyCancel: { jobId: string };
};
