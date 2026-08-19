import { apiGet, apiPost, apiPatch, apiDelete } from './apiClient';

export interface AdminUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: 'admin' | 'super_admin';
  isActive: boolean;
  lastLoginAt: string | null;
}

export interface AdminTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export interface DashboardStats {
  users: {
    total: number;
    customers: number;
    providers: number;
    both: number;
    active7d: number;
  };
  jobs: {
    total: number;
    today: number;
    inProgress: number;
    completed: number;
  };
  revenue: { totalCents: number; last30dCents: number };
  credentials: { pendingReview: number };
}

export interface DashboardCharts {
  period: '7d' | '30d' | '90d';
  newUsers: { date: string; count: number }[];
  completedJobs: { date: string; count: number; revenueCents: number }[];
}

export interface PendingCredential {
  id: string;
  credentialType: string;
  name: string;
  documentUrl: string | null;
  uploadedAt: string | null;
  // The SECTION this document is for (drives the L1->L2 flip on approval).
  section: { id: string; name: string } | null;
  licenseClass: string | null;
  task: {
    id: string;
    name: string;
    level: number | null;
    category: string | null;
  } | null;
  provider: {
    id: string;
    userId: string;
    firstName: string;
    lastName: string;
    email: string;
    level: number;
  };
}

export interface UserProviderInfo {
  providerId: string;
  providerStatus: string;
  providerLevel: string;
  stripeAccountId: string | null;
  stripeConnected: boolean;
  backgroundCheckStatus: string;
  internalScore: number | null;
  isOnline: boolean;
  availableForEmergency: boolean;
  activatedAt: string | null;
}

export interface UserAddress {
  street: string | null;
  city: string | null;
  province: string | null;
  postalCode: string | null;
  country: string | null;
}

export interface UserListItem {
  id: string;
  email: string;
  phone: string | null;
  firstName: string;
  lastName: string;
  displayName: string | null;
  avatarUrl: string | null;
  role: 'customer' | 'provider' | 'both';
  status: string;
  emailVerified: boolean;
  phoneVerified: boolean;
  authProvider: string;
  stripeCustomerId: string | null;
  hasCard: boolean;
  stripeConnected: boolean;
  address: UserAddress;
  timezone: string | null;
  locale: string | null;
  provider: UserProviderInfo | null;
  createdAt: string | null;
  lastLoginAt: string | null;
  deletedAt: string | null;
}

export interface UserListResponse {
  items: UserListItem[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

/**
 * Escala de niveles L0..L3 (reestructuración 2026-08-04). L4/Emergency salió
 * del producto: no se ofrece en el admin ni existe en el catálogo activo.
 */
export const SERVICE_LEVELS = [
  { value: '0', label: 'L0 — Basic Assistance', color: '#8AB4F8' },
  { value: '1', label: 'L1 — Skilled, Non-Regulated', color: 'var(--t-ok)' },
  { value: '2', label: 'L2 — Verified Regulated / Supervised', color: '#F6AD55' },
  { value: '3', label: 'L3 — Advanced Regulated / Professional', color: '#A78BFA' },
] as const;

export type ServiceLevel = (typeof SERVICE_LEVELS)[number]['value'];

export function levelColor(level: string): string {
  return SERVICE_LEVELS.find((l) => l.value === level)?.color ?? 'var(--t-text-3)';
}

/** El acceso a L2/L3 se abre con una credencial que coincide con el servicio. */
export const CREDENTIAL_GATED_LEVELS: readonly string[] = ['2', '3'];

/**
 * Qué clase de requisito es un código, porque el motor lo verifica en sitios
 * distintos:
 *  - CREDENTIAL: credencial del proveedor (306A, ESA_LEC, Smart Serve...).
 *  - INSURANCE:  póliza (CGL). Vive en provider_insurance_policies.
 *  - PERMIT:     permiso del TRABAJO, no del proveedor (building permit).
 */
export type CredentialRequirementKind = 'CREDENTIAL' | 'INSURANCE' | 'PERMIT';

export const REQUIREMENT_KIND_ORDER: CredentialRequirementKind[] = [
  'CREDENTIAL',
  'INSURANCE',
  'PERMIT',
];

export type VerificationMethod = 'REGISTRY' | 'DOCUMENT' | 'SELF_DECLARED';

export const VERIFICATION_METHODS: VerificationMethod[] = [
  'REGISTRY',
  'DOCUMENT',
  'SELF_DECLARED',
];

/** Un código del catálogo de requisitos (306A, ESA_LEC, CGL, ...). */
export interface CredentialRequirementOption {
  code: string;
  kind: CredentialRequirementKind;
  labelEn: string;
  labelFr: string | null;
  authority: string | null;
  registryName: string | null;
  registryUrl: string | null;
  verificationMethod: VerificationMethod;
  description: string | null;
  isActive?: boolean;
  /** Cuántos servicios exigen este código. Bloquea el borrado si > 0. */
  usageCount?: number;
}

export interface CredentialRequirementUpsertBody {
  /** Solo al crear: es la PK y la referencian los servicios. Inmutable después. */
  code?: string;
  labelEn: string;
  labelFr?: string | null;
  kind: CredentialRequirementKind;
  authority?: string | null;
  registryName?: string | null;
  registryUrl?: string | null;
  verificationMethod: VerificationMethod;
  description?: string | null;
  isActive?: boolean;
}

/**
 * Requisito de credencial de un servicio.
 * `mandatory: false` = condicional o alternativo (los casos "306A y/o 309A").
 */
export interface TaskCredentialRequirement {
  code: string;
  mandatory: boolean;
  kind?: CredentialRequirementKind;
  labelEn?: string;
  labelFr?: string | null;
  authority?: string | null;
  notes?: string | null;
}

/** Opción de una pregunta cerrada. EN y FR en el MISMO objeto para que no se
 *  puedan desincronizar (dos arrays paralelos por posición sí se desincronizan). */
export interface TaskQuestionOption {
  en: string;
  fr?: string;
}

/** Pregunta que el cliente responde al reservar. */
export interface TaskQuestion {
  /** Vacío en una pregunta recién añadida en el formulario. */
  id?: string;
  questionEn: string;
  questionFr?: string | null;
  /**
   * TEXT = textarea libre. SINGLE_CHOICE = elige una de `options`.
   * IMAGE = la respuesta es una foto (el color de pintura descrito con palabras
   * no sirve; la foto de la pared sí).
   */
  answerType: 'TEXT' | 'SINGLE_CHOICE' | 'IMAGE';
  options: TaskQuestionOption[];
  isRequired: boolean;
  displayOrder: number;
  /** Solo se muestra —y solo se exige— si el cliente pidió material. */
  materialsOnly?: boolean;
}

export interface TaxonomyTask {
  id: string;
  categoryId: string;
  slug: string;
  name: string;
  description: string | null;
  level: ServiceLevel;
  credentialRequirements: TaskCredentialRequirement[];
  regulated: boolean;
  licenseRequired: boolean;
  certificationRequired: boolean;
  hazardous: boolean;
  structural: boolean;
  emergencyEligible: boolean;
  basePriceMinCents: number | null;
  basePriceMaxCents: number | null;
  estimatedDurationMin: number | null;
  pricingUnit: string | null;
  allowsQuantity: boolean;
  minQuantity: number | null;
  escalationKeywords: string[];
  /**
   * Requisitos de ENTRADA DE LA RESERVA (migración 038). No confundir con
   * credentialRequirements: eso es lo que debe tener el PROVEEDOR, esto es lo
   * que debe aportar el CLIENTE al reservar para que el proveedor pueda decidir
   * si acepta el trabajo con su rango de precio.
   */
  requiresDetails: boolean;
  /** Marca el requisito CGL del servicio. Por debajo NO es una columna: escribe
   *  la fila de service_credential_requirements que ya lee el motor. */
  requiresInsurance: boolean;
  questions: TaskQuestion[];
  requiresEvidence: boolean;
  /**
   * Placeholder del campo de detalles para ESTE servicio. Es lo que mantiene el
   * texto libre dentro de la regla del catálogo cerrado: guía al cliente a
   * describir escala y acceso del servicio elegido, no a pedir tareas nuevas.
   * Obligatorio si requiresDetails está activo (la API devuelve 400 sin él).
   */
  detailsPromptEn: string | null;
  detailsPromptFr: string | null;
  /**
   * Materiales (migración 043): el proveedor los compra y el cliente se los
   * reembolsa. El rango acota lo que el cliente puede autorizar al reservar; la
   * nota es el mensaje del admin PARA EL PROVEEDOR, que la lee antes de ofertar.
   * El material no lleva impuesto encima ni paga comisión.
   */
  materialsEnabled: boolean;
  materialsBudgetMinCents: number | null;
  materialsBudgetMaxCents: number | null;
  materialsNoteEn: string | null;
  materialsNoteFr: string | null;
  iconUrl: string | null;
  displayOrder: number;
  isActive: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface TaxonomyCategory {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  iconUrl: string | null;
  displayOrder: number;
  isActive: boolean;
  parentId: string | null;
  // Section-based gating (migration 029): whole section locked to L2+ providers.
  requiresCredential: boolean;
  // Bilingual help pop-up shown in-app before uploading this section's document.
  helpMessageEn: string | null;
  helpMessageFr: string | null;
  taskCount: number;
  tasks: TaxonomyTask[];
  createdAt: string | null;
  updatedAt: string | null;
}

export interface CategoryUpsertBody {
  slug: string;
  name: string;
  description?: string | null;
  iconUrl?: string | null;
  displayOrder?: number;
  isActive?: boolean;
  parentId?: string | null;
  requiresCredential?: boolean;
  helpMessageEn?: string | null;
  helpMessageFr?: string | null;
}

/** Documento del expediente de experiencia (L1) pendiente de validar. */
export interface ExperienceRecord {
  id: string;
  providerId: string;
  providerName: string;
  kind: string;
  title: string | null;
  description: string | null;
  documentUrl: string | null;
  status: string;
  rejectionReason: string | null;
  categoryId: string | null;
  submittedAt: string | null;
}

/** Póliza de seguro pendiente de verificar. */
export interface InsurancePolicyRow {
  id: string;
  providerId: string;
  providerName: string;
  policyNumber: string;
  insurerName: string;
  policyType: string;
  coverageAmountCents: number;
  effectiveDate: string;
  expiryDate: string;
  /** La póliza ya venció: no debe aprobarse aunque esté pendiente. */
  isExpired: boolean;
  status: string;
  documentUrl: string | null;
  createdAt: string | null;
}

/** Cancelación con motivo pendiente de revisar. */
export interface CancellationReport {
  id: string;
  jobId: string;
  referenceNumber: string;
  taskName: string;
  reporterRole: 'customer' | 'provider';
  reporterName: string;
  reasonCode: string;
  note: string | null;
  status: 'PENDING' | 'UPHELD' | 'DISMISSED';
  ratingImpact: boolean;
  adminNote: string | null;
  createdAt: string | null;
}

/** Ontario driver's licence classes. Only G2 and G are used in practice. */
export const LICENSE_CLASSES = ['G1', 'G2', 'G', 'A', 'AR', 'D', 'B', 'C', 'E', 'F'] as const;
export type LicenseClass = (typeof LICENSE_CLASSES)[number];

export interface TaskUpsertBody {
  categoryId: string;
  slug: string;
  name: string;
  description?: string | null;
  level: ServiceLevel;
  /** Cuando viene, REEMPLAZA el conjunto completo de requisitos del servicio. */
  credentialRequirements?: { code: string; mandatory: boolean; notes?: string | null }[];
  regulated?: boolean;
  licenseRequired?: boolean;
  certificationRequired?: boolean;
  hazardous?: boolean;
  structural?: boolean;
  emergencyEligible?: boolean;
  basePriceMinCents?: number | null;
  basePriceMaxCents?: number | null;
  estimatedDurationMin?: number | null;
  pricingUnit?: string | null;
  allowsQuantity?: boolean;
  minQuantity?: number | null;
  escalationKeywords?: string[];
  requiresDetails?: boolean;
  requiresInsurance?: boolean;
  /** Cuando viene, REEMPLAZA el conjunto completo de preguntas del servicio. */
  questions?: TaskQuestion[];
  requiresEvidence?: boolean;
  detailsPromptEn?: string | null;
  detailsPromptFr?: string | null;
  /** Materiales: ver TaxonomyTask. El rango es obligatorio si materialsEnabled. */
  materialsEnabled?: boolean;
  materialsBudgetMinCents?: number | null;
  materialsBudgetMaxCents?: number | null;
  materialsNoteEn?: string | null;
  materialsNoteFr?: string | null;
  iconUrl?: string | null;
  displayOrder?: number;
  isActive?: boolean;
}

export interface CompanyListItem {
  id: string;
  legal_name: string;
  status: string;
  created_at: string | null;
}

export interface CompanyDocument {
  id: string;
  doc_type: string;
  status: string;
  document_url: string | null;
  rejection_reason: string | null;
}

export interface CompanyDetail {
  id: string;
  legal_name: string;
  trade_name: string | null;
  status: string;
  business_address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  rejection_reason: string | null;
  documents: CompanyDocument[];
}

export interface Promotion {
  id: string;
  code: string;
  title: string;
  description: string | null;
  discountType: 'percentage' | 'fixed_amount';
  discountValue: number;
  startsAt: string;
  endsAt: string;
  maxRedemptions: number | null;
  redemptionsCount: number;
  isActive: boolean;
  createdAt: string;
}

/** Fila de la lista de trabajos del admin (ofertas v2). */
export interface AdminJobRow {
  id: string;
  referenceNumber: string | null;
  status: string;
  taskName: string;
  pricingUnit: string | null;
  customerName: string;
  city: string | null;
  requestedDate: string | null;
  /** Ofertas vivas. Un trabajo abierto con 0 es el caso que hay que investigar. */
  offerCount: number;
  offersCloseAt: string | null;
  quotedPriceCents: number | null;
  totalChargedCents: number | null;
  materialsRequested: boolean;
  materialsBudgetCents: number | null;
  materialsSpentCents: number | null;
  createdAt: string | null;
}

export interface AdminJobOffer {
  offerId: string;
  providerName: string;
  providerId: string;
  status: string;
  unit: string;
  magnitude: number;
  magnitudeSource: string;
  rateCents: number;
  subtotalCents: number;
  totalCents: number;
  message: string | null;
  createdAt: string | null;
}

export interface AdminJobDetail {
  id: string;
  referenceNumber: string | null;
  status: string;
  taskName: string | null;
  pricingUnit: string | null;
  catalogMinCents: number | null;
  catalogMaxCents: number | null;
  /** Cuántos proveedores tienen tarifa para este servicio. Es EL dato para
   *  explicar un trabajo sin ofertas: casi siempre nadie ha puesto precio. */
  providersWithARate: number;
  details: string | null;
  extraNote: string | null;
  evidence: string[];
  answers: { question: string; answer: string; answerType?: string }[];
  quantity: number | null;
  offersCloseAt: string | null;
  acceptedOfferId: string | null;
  materials: {
    requested: boolean;
    budgetCents: number | null;
    spentCents: number | null;
    overageCents: number;
    needsApproval: boolean;
    receipts: {
      receiptId: string;
      amountCents: number;
      fileUrl: string;
      merchant: string | null;
      note: string | null;
      voided: boolean;
      voidReason: string | null;
      createdAt: string | null;
    }[];
  };
  money: {
    subtotalCents: number | null;
    serviceTaxCents: number | null;
    serviceFeeCents: number | null;
    commissionCents: number | null;
    providerPayoutCents: number | null;
    totalChargedCents: number | null;
  };
  offers: AdminJobOffer[];
}

export const adminService = {
  login: (email: string, password: string) =>
    apiPost<{ user: AdminUser; tokens: AdminTokens }>('/admin/auth/login', { email, password }),

  me: () => apiGet<AdminUser>('/admin/me'),

  dashboardStats: () => apiGet<DashboardStats>('/admin/dashboard/stats'),

  // Trabajos y ofertas (ofertas v2)
  listJobs: (params: { onlyOpen?: boolean; statusFilter?: string; limit?: number } = {}) =>
    apiGet<{ jobs: AdminJobRow[]; count: number }>('/admin/jobs', {
      only_open: params.onlyOpen ? 'true' : undefined,
      status_filter: params.statusFilter,
      limit: params.limit,
    }),

  jobDetail: (jobId: string) => apiGet<AdminJobDetail>(`/admin/jobs/${jobId}`),

  voidMaterialReceipt: (receiptId: string, reason: string) =>
    apiPost<unknown>(`/admin/material-receipts/${receiptId}/void?reason=${encodeURIComponent(reason)}`, {}),

  dashboardCharts: (period: '7d' | '30d' | '90d' = '30d') =>
    apiGet<DashboardCharts>('/admin/dashboard/charts', { period }),

  listUsers: (params: {
    page?: number;
    pageSize?: number;
    search?: string;
    role?: 'customer' | 'provider' | 'both';
  }) => apiGet<UserListResponse>('/admin/users', params),

  patchUser: (id: string, body: { role?: string; status?: string }) =>
    apiPatch<UserListItem>(`/admin/users/${id}`, body),

  /**
   * Read the recovery code for a single user. Super admin only. NEVER
   * generates — returns recoveryCode=null if the user hasn't yet viewed it
   * in the mobile app. Generating from the dashboard would create a code
   * the user doesn't know about, breaking their own recovery flow.
   */
  getUserRecoveryCode: (id: string) =>
    apiGet<{ userId: string; recoveryCode: string | null }>(
      `/admin/users/${id}/recovery-code`,
    ),

  pendingCredentials: () => apiGet<PendingCredential[]>('/admin/credentials/pending'),

  approveCredential: (id: string, note?: string, licenseClass?: string) =>
    apiPost<{ id: string; status: string }>(`/admin/credentials/${id}/approve`, {
      note,
      licenseClass,
    }),

  rejectCredential: (id: string, note: string) =>
    apiPost<{ id: string; status: string }>(`/admin/credentials/${id}/reject`, { note }),

  // ── Cancelaciones con motivo ──
  // La cancelación ya ocurrió y fue gratis. Aquí se decide si el reporte debe
  // afectar la calificación del reportado — nunca es automático.
  cancellationReports: (status?: string) =>
    apiGet<CancellationReport[]>(
      '/admin/cancellation-reports',
      status ? { status_filter: status } : undefined,
    ),

  reviewCancellation: (
    id: string,
    body: { status: 'UPHELD' | 'DISMISSED'; ratingImpact: boolean; adminNote?: string },
  ) =>
    apiPost<{ id: string; status: string; ratingImpact: boolean }>(
      `/admin/cancellation-reports/${id}/review`,
      body,
    ),

  // ── Expediente de experiencia (L1) ──
  // La validación es DOCUMENTAL, no de competencia: se confirma que la evidencia
  // existe y es legible. Rechazar significa "ilegible o incompleto", nunca
  // "no eres competente" — el copy que ve el proveedor debe reflejarlo.
  experienceRecords: (status?: string) =>
    apiGet<ExperienceRecord[]>(
      '/admin/experience-records',
      status ? { status_filter: status } : undefined,
    ),

  validateExperience: (id: string) =>
    apiPost<{ id: string; status: string }>(`/admin/experience-records/${id}/validate`, {}),

  rejectExperience: (id: string, note: string) =>
    apiPost<{ id: string; status: string }>(`/admin/experience-records/${id}/reject`, { note }),

  // ── Pólizas de seguro ──
  insurancePolicies: (status?: string) =>
    apiGet<InsurancePolicyRow[]>(
      '/admin/insurance-policies',
      status ? { status_filter: status } : undefined,
    ),

  approveInsurance: (id: string) =>
    apiPost<{ id: string; status: string }>(`/admin/insurance-policies/${id}/approve`, {}),

  rejectInsurance: (id: string, note: string) =>
    apiPost<{ id: string; status: string }>(`/admin/insurance-policies/${id}/reject`, { note }),

  // ── Businesses (VISP for Business) validation ──
  listCompanies: (status?: string) =>
    apiGet<CompanyListItem[]>('/admin/companies', status ? { status } : undefined),

  getCompany: (id: string) => apiGet<CompanyDetail>(`/admin/companies/${id}`),

  approveCompanyDocument: (docId: string) =>
    apiPost<{ id: string; status: string }>(`/admin/companies/documents/${docId}/approve`),

  rejectCompanyDocument: (docId: string, reason: string) =>
    apiPost<{ id: string; status: string; rejection_reason: string }>(
      `/admin/companies/documents/${docId}/reject`,
      { reason },
    ),

  validateCompany: (id: string) =>
    apiPost<{ status: string }>(`/admin/companies/${id}/validate`),

  rejectCompany: (id: string, reason: string) =>
    apiPost<{ status: string; rejection_reason: string }>(
      `/admin/companies/${id}/reject`,
      { reason },
    ),

  listPromotions: () => apiGet<Promotion[]>('/admin/promotions'),

  createPromotion: (body: Omit<Promotion, 'id' | 'redemptionsCount' | 'createdAt'>) =>
    apiPost<Promotion>('/admin/promotions', body),

  updatePromotion: (id: string, body: Partial<Promotion>) =>
    apiPatch<Promotion>(`/admin/promotions/${id}`, body),

  deletePromotion: (id: string) => apiDelete<void>(`/admin/promotions/${id}`),

  // ── Taxonomy (service categories + tasks) ──
  taxonomyFull: () => apiGet<TaxonomyCategory[]>('/admin/taxonomy/full'),

  /** Catálogo de requisitos que un servicio puede exigir (credenciales, seguros, permisos). */
  credentialRequirementOptions: (includeInactive = false) =>
    apiGet<CredentialRequirementOption[]>(
      '/admin/taxonomy/credential-requirements',
      includeInactive ? { include_inactive: true } : undefined,
    ),

  createCredentialRequirement: (body: CredentialRequirementUpsertBody) =>
    apiPost<CredentialRequirementOption>('/admin/taxonomy/credential-requirements', body),

  updateCredentialRequirement: (
    code: string,
    body: Partial<CredentialRequirementUpsertBody>,
  ) =>
    apiPatch<CredentialRequirementOption>(
      `/admin/taxonomy/credential-requirements/${encodeURIComponent(code)}`,
      body,
    ),

  deleteCredentialRequirement: (code: string) =>
    apiDelete<void>(`/admin/taxonomy/credential-requirements/${encodeURIComponent(code)}`),

  createCategory: (body: CategoryUpsertBody) =>
    apiPost<TaxonomyCategory>('/admin/taxonomy/categories', body),

  updateCategory: (id: string, body: Partial<CategoryUpsertBody>) =>
    apiPatch<TaxonomyCategory>(`/admin/taxonomy/categories/${id}`, body),

  deleteCategory: (id: string) => apiDelete<void>(`/admin/taxonomy/categories/${id}`),

  createTask: (body: TaskUpsertBody) =>
    apiPost<TaxonomyTask>('/admin/taxonomy/tasks', body),

  updateTask: (id: string, body: Partial<TaskUpsertBody>) =>
    apiPatch<TaxonomyTask>(`/admin/taxonomy/tasks/${id}`, body),

  deleteTask: (id: string) => apiDelete<void>(`/admin/taxonomy/tasks/${id}`),

  // ── Superusers management (super_admin only) ──
  listSuperusers: () =>
    apiGet<SuperuserRow[]>('/admin/superusers'),

  inviteSuperuser: (body: {
    email: string;
    role: 'admin' | 'super_admin';
    firstName: string;
    lastName: string;
  }) =>
    apiPost<GeneratedCode>('/admin/superusers/invite', body),

  createResetCode: (id: string) =>
    apiPost<GeneratedCode>(`/admin/superusers/${id}/reset-code`),

  toggleSuperuserActive: (id: string) =>
    apiPatch<{ id: string; isActive: boolean }>(`/admin/superusers/${id}/active`, {}),

  deleteSuperuser: (id: string) =>
    apiDelete<void>(`/admin/superusers/${id}`),

  // ── Public redeem (no auth required, used from /console pages) ──
  redeemInvite: (body: { email: string; code: string; password: string }) =>
    apiPost<{ user: AdminUser; tokens: AdminTokens }>('/admin/auth/redeem-invite', body),

  redeemReset: (body: { email: string; code: string; password: string }) =>
    apiPost<{ user: AdminUser; tokens: AdminTokens }>('/admin/auth/redeem-reset', body),
};

export interface SuperuserRow {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: 'admin' | 'super_admin';
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string | null;
}

export interface GeneratedCode {
  id: string;
  email: string;
  code: string;
  expiresAt: string;
  role?: string;
}
