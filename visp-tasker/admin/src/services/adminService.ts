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

/** Un código del catálogo de requisitos (306A, ESA_LEC, CGL, ...). */
export interface CredentialRequirementOption {
  code: string;
  kind: CredentialRequirementKind;
  labelEn: string;
  labelFr: string | null;
  authority: string | null;
  registryName: string | null;
  registryUrl: string | null;
  verificationMethod: 'REGISTRY' | 'DOCUMENT' | 'SELF_DECLARED';
  description: string | null;
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

export const adminService = {
  login: (email: string, password: string) =>
    apiPost<{ user: AdminUser; tokens: AdminTokens }>('/admin/auth/login', { email, password }),

  me: () => apiGet<AdminUser>('/admin/me'),

  dashboardStats: () => apiGet<DashboardStats>('/admin/dashboard/stats'),

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

  /** Catálogo de códigos de credencial que un servicio L2/L3 puede exigir. */
  credentialRequirementOptions: () =>
    apiGet<CredentialRequirementOption[]>('/admin/taxonomy/credential-requirements'),

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
