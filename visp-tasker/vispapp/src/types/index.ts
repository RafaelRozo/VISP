/**
 * VISP - Shared TypeScript type definitions
 */

// ──────────────────────────────────────────────
// User & Auth
// ──────────────────────────────────────────────

export type UserRole = 'customer' | 'provider' | 'both';

export interface UserDefaultAddress {
  street: string;
  city: string;
  province: string;
  postalCode: string;
  country: string;
  latitude: number | null;
  longitude: number | null;
  formattedAddress?: string;
}

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
  defaultAddress?: UserDefaultAddress | null;
  stripeCustomerId?: string | null;
}

export interface PaymentMethodInfo {
  id: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
  isDefault: boolean;
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
  phone: string;
  password: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  acceptedTermsVersion: string;
}

export interface AuthResponse {
  user: User;
  tokens: AuthTokens;
  recoveryCode?: string | null;
}

// ──────────────────────────────────────────────
// Service Levels
// ──────────────────────────────────────────────

/**
 * L0 is the base level introduced by the L0-L3 restructuring and is the LARGEST
 * group of active services in the v1 beta, so every level-indexed map must cover
 * it or it renders `undefined`.
 *
 * L4 (Emergency) is dead as a product but stays in the union: historical jobs
 * still reference L4 services, and dropping it would make those screens crash
 * instead of rendering a legacy badge.
 */
export type ServiceLevel = 0 | 1 | 2 | 3 | 4;

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
  /**
   * Rango y unidad del catálogo. Van en el LISTADO y no solo en el detalle
   * porque "desde $45" no dice si son 45 por hora, por mueble o por el trabajo
   * entero — y es exactamente lo que el cliente compara al elegir.
   */
  priceRangeMin?: number;
  priceRangeMax?: number;
  pricingUnit?: string | null;
}

// ──────────────────────────────────────────────
// Jobs
// ──────────────────────────────────────────────

export type JobStatus =
  | 'pending'
  | 'draft'
  | 'pending_match'
  | 'matched'
  | 'pending_approval'
  | 'pending_price_agreement'
  | 'scheduled'
  | 'accepted'
  | 'provider_accepted'
  | 'en_route'
  | 'provider_en_route'
  | 'in_progress'
  | 'completed'
  | 'cancelled'
  | 'cancelled_by_customer'
  | 'cancelled_by_provider'
  | 'cancelled_by_system'
  | 'disputed'
  | 'refunded'
  // Se le pasó el plazo: venció la ventana de ofertas o llegó la hora del
  // servicio sin que nadie fuera elegido. No es una cancelación.
  | 'expired';

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
  pricingModel: PricingModel | null;
  hourlyRateCents: number | null;
  actualDurationMinutes: number | null;
  estimatedDurationMinutes: number | null;
  /** Cierre de la ventana de ofertas (48 h). NULL en trabajos anteriores al
   *  modelo de ofertas. Es lo que define si un trabajo abierto sigue vivo. */
  offersCloseAt?: string | null;
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
  CompanyJoin: undefined;
  ForgotPassword: undefined;
  CustomerHome: undefined;
  ProviderHome: undefined;
  // VISP for Business (SP4 Stage 2) — reachable from the customer dashboard
  CompanySupervisor: undefined;
  CompanyAssignments: undefined;
  CategoryDetail: { categoryId: string; categoryName: string };
  JobDetail: { jobId: string };
  /** Ofertas recibidas. Alcanzable desde My Jobs y desde el flujo de reserva. */
  Offers: { jobId: string; taskName?: string };
  JobTracking: { jobId: string };
  EmergencyFlow: undefined;
  Chat: { jobId: string; otherUserName: string };
  PayoutsOnboarding: undefined;
  PayoutsPersonalInfo: undefined;
  PayoutsTax: undefined;
  PayoutsBank: undefined;
  PayoutsIdentityDoc: undefined;
  PayoutsTos: undefined;
  __DesignSystem: undefined;
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

export interface OfferTaskInfo {
  id: string;
  name: string;
  level: string;
  categoryName?: string;
}

export interface OfferCustomerInfo {
  id: string;
  displayName?: string;
  rating?: number;
}

export interface OfferPricingInfo {
  quotedPriceCents?: number;
  commissionRate?: number;
  estimatedPayoutCents?: number;
  currency: string;
}

export interface OfferSLAInfo {
  responseTimeMin?: number;
  arrivalTimeMin?: number;
  completionTimeMin?: number;
}

export type PricingModel = 'TIME_BASED' | 'NEGOTIATED' | 'EMERGENCY_NEGOTIATED';

export interface JobOffer {
  assignmentId: string;
  jobId: string;
  referenceNumber: string;
  status: string;
  isEmergency: boolean;
  serviceAddress: string;
  serviceCity?: string;
  serviceLatitude: number;
  serviceLongitude: number;
  requestedDate?: string;
  requestedTimeStart?: string;
  task: OfferTaskInfo;
  customer: OfferCustomerInfo;
  pricing: OfferPricingInfo;
  sla: OfferSLAInfo;
  distanceKm?: number;
  offeredAt: string;
  offerExpiresAt?: string;
  pricingModel?: PricingModel;
}

// ──────────────────────────────────────────────
// Service Catalog (Provider)
// ──────────────────────────────────────────────

export interface ServiceCatalogItem {
  id: string;
  name: string;
  categoryId: string;
  categoryName: string;
  level: string;
  estimatedDurationMin: number;
  rateDescription: string;
  isAvailable: boolean;
  // Section-based credential gating (backend migration 029).
  requiresCredential: boolean;   // the section needs a document
  helpMessageEn: string | null;  // per-section upload instructions
  helpMessageFr: string | null;
  /** El servicio exige seguro CGL (checkbox del admin). */
  requiresInsurance?: boolean;
  /** Lo exige y el proveedor no tiene póliza vigente: por eso está bloqueado. */
  insuranceMissing?: boolean;
  locked: boolean;               // gated section not yet unlocked at this level
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

export type CredentialStatus = 'awaiting_upload' | 'pending' | 'approved' | 'expired' | 'rejected';

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
  stripeAccountId?: string | null;
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
// Chat
// ──────────────────────────────────────────────

export interface ChatMessage {
  id: string;
  jobId: string;
  senderId: string;
  senderName: string;
  message: string;
  createdAt: string;
  isOwnMessage: boolean;
}

// ──────────────────────────────────────────────
// Tips
// ──────────────────────────────────────────────

export type TipStatus = 'pending' | 'paid' | 'failed';

export interface Tip {
  id: string;
  jobId: string;
  amountCents: number;
  status: TipStatus;
  paidAt: string | null;
  createdAt: string;
}

// ──────────────────────────────────────────────
// Price Proposals
// ──────────────────────────────────────────────

export type ProposalStatus = 'pending' | 'accepted' | 'rejected' | 'expired';

export interface PriceProposal {
  id: string;
  jobId: string;
  proposedById: string;
  proposedByRole: 'provider' | 'customer';
  proposedPriceCents: number;
  description: string;
  status: ProposalStatus;
  respondedAt: string | null;
  createdAt: string;
}

// ──────────────────────────────────────────────
// Extended Navigation
// ──────────────────────────────────────────────

export type ProviderTabParamList = {
  Dashboard: undefined;
  JobsTab: undefined;
  ActiveJob: { jobId: string };
  Earnings: undefined;
  Schedule: undefined;
  ProviderProfile: undefined;
  Chat: { jobId: string; otherUserName: string };
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
  ProviderOnboarding: undefined;
  MyPrices: undefined;
  PaymentMethods: undefined;
  PrivacyPolicy: undefined;
  TermsOfService: undefined;
  AddressEdit: undefined;
};

export type AuthStackParamList = {
  Login: undefined;
  Register: undefined;
  CompanyJoin: undefined;
  ForgotPassword: undefined;
  ProviderOnboarding: undefined;
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
  // PP5 — charge unit + quantity (drives the booking quantity picker)
  pricingUnit?: string | null;
  allowsQuantity?: boolean;
  minQuantity?: number | null;
  /**
   * Qué debe aportar el cliente al reservar (migración 038). Los detalles y las
   * fotos son SOPORTE DE DECISIÓN para el proveedor —los ve antes de aceptar,
   * para juzgar si le interesa el trabajo con su rango de precio— y no cambian
   * el servicio ni el precio, que salen del catálogo cerrado.
   */
  requiresDetails?: boolean;
  requiresEvidence?: boolean;
  /** Placeholder por servicio. Guía a describir escala y acceso, no a pedir extras. */
  detailsPromptEn?: string | null;
  detailsPromptFr?: string | null;
  /** Preguntas que el cliente responde al reservar (migraciones 039/040). */
  questions?: ServiceQuestion[];
  /**
   * Materiales (migración 043). Si está activo, al reservar se le pregunta al
   * cliente si quiere que el proveedor los compre y cuánto tenía pensado gastar.
   *
   * Ese importe es una REFERENCIA para el proveedor, no el techo del cobro: quien
   * cotiza el material —con justificación— es el proveedor en su oferta, porque es
   * quien lo va a comprar y sabe lo que cuesta.
   */
  materialsEnabled?: boolean;
  materialsBudgetMinCents?: number | null;
  materialsBudgetMaxCents?: number | null;
  materialsNoteEn?: string | null;
  materialsNoteFr?: string | null;
}

/** Opción de una pregunta cerrada. EN y FR en el mismo objeto. */
export interface ServiceQuestionOption {
  en: string;
  fr?: string;
}

export interface ServiceQuestion {
  id: string;
  questionEn: string;
  questionFr?: string | null;
  /**
   * TEXT = textarea libre. SINGLE_CHOICE = elegir una de `options`.
   * IMAGE = la respuesta es una foto y se guarda su URL (el color de pintura
   * descrito con palabras no sirve; la foto de la pared sí).
   */
  answerType: 'TEXT' | 'SINGLE_CHOICE' | 'IMAGE';
  options: ServiceQuestionOption[];
  isRequired: boolean;
  displayOrder: number;
  /** Solo se muestra —y solo se exige— si el cliente pide material. */
  materialsOnly?: boolean;
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
  // PP5 — customer-confirmed quantity for per-unit/per-area tasks.
  quantity?: number;
  /**
   * Detalles, evidencia y nota que aporta el cliente (migración 038). El
   * proveedor los ve ANTES de aceptar, para decidir si le interesa el trabajo
   * con su rango de precio. No cambian el servicio ni el precio.
   */
  details?: string;
  evidence?: string[];
  extraNote?: string;
  /** [{questionId, answer}] — el backend valida contra la tabla de preguntas. */
  answers?: { questionId: string; answer: string }[];
  /**
   * Materiales (migración 043). El presupuesto es una REFERENCIA que verá el
   * proveedor, no el techo del cobro: quien cotiza el material —con
   * justificación— es él, en su oferta.
   */
  materialsRequested?: boolean;
  materialsBudgetCents?: number;
  /**
   * PER_CONTRACT: la tarifa/hora que ofrece EL CLIENTE. Es la inversión del resto
   * del catálogo, donde el precio lo pone el proveedor. Acotada por el rango del
   * admin igual que la tarifa del proveedor: cambia a quién acota, no la
   * protección.
   */
  customerRateCents?: number;
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

// ──────────────────────────────────────────────
// Job Assignment (for matching/tracking)
// ──────────────────────────────────────────────

export interface JobAssignment {
  id: string;
  jobId: string;
  providerId: string;
  providerName: string;
  providerRating: number;
  providerPhoto: string | null;
  providerCompletedJobs: number;
  providerLevel: ServiceLevel;
  acceptedAt: string | null;
  eta: number | null;
}

export interface JobTrackingData {
  providerLat: number | null;
  providerLng: number | null;
  etaMinutes: number | null;
  status: string;
  providerName: string | null;
  providerPhone: string | null;
  providerLevel: string | null;
  updatedAt: string | null;
}

// ──────────────────────────────────────────────
// Booking Flow Data (passed between screens)
// ──────────────────────────────────────────────

export interface BookingTaskSummary {
  taskId: string;
  taskName: string;
  categoryName: string;
  level: ServiceLevel;
  estimatedDurationMinutes: number;
  priceRangeMin: number;
  priceRangeMax: number;
  description: string;
  // Booking details from TaskSelectionScreen
  address?: AddressInfo;
  scheduledDate?: string;
  scheduledTimeSlot?: string;
  isFlexibleSchedule?: boolean;
  priority?: PriorityLevel;
  selectedNotes?: string[];
}

export type CustomerFlowParamList = {
  CustomerHome: undefined;
  Category: { categoryId: string; categoryName: string };
  Subcategory: { taskId: string };
  TaskSelection: { taskId: string };
  /** "More info": recoge detalles/fotos/nota y PASA DE LARGO el mismo payload
   *  que espera Booking, para no cambiar su contrato. */
  BookingDetails: { task: BookingTaskSummary };
  Booking: { task: BookingTaskSummary };
  Matching: { jobId: string; taskName: string };
  /** Ofertas recibidas para un trabajo posteado. El cliente elige una aquí. */
  Offers: { jobId: string; taskName?: string };
  JobTracking: { jobId: string };
  Rating: { jobId: string; taskName: string; finalPrice: number };
  Tip: { jobId: string; taskName: string; finalPrice: number; providerName?: string };
  PriceProposal: { jobId: string; taskName: string; level: ServiceLevel; guideMin?: number; guideMax?: number };
  Chat: { jobId: string; otherUserName: string };
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
