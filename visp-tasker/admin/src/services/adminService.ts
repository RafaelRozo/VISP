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

export interface TaxonomyTask {
  id: string;
  categoryId: string;
  slug: string;
  name: string;
  description: string | null;
  level: '1' | '2' | '3' | '4';
  regulated: boolean;
  licenseRequired: boolean;
  certificationRequired: boolean;
  hazardous: boolean;
  structural: boolean;
  emergencyEligible: boolean;
  basePriceMinCents: number | null;
  basePriceMaxCents: number | null;
  estimatedDurationMin: number | null;
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
}

export interface TaskUpsertBody {
  categoryId: string;
  slug: string;
  name: string;
  description?: string | null;
  level: '1' | '2' | '3' | '4';
  regulated?: boolean;
  licenseRequired?: boolean;
  certificationRequired?: boolean;
  hazardous?: boolean;
  structural?: boolean;
  emergencyEligible?: boolean;
  basePriceMinCents?: number | null;
  basePriceMaxCents?: number | null;
  estimatedDurationMin?: number | null;
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

  approveCredential: (id: string, note?: string) =>
    apiPost<{ id: string; status: string }>(`/admin/credentials/${id}/approve`, { note }),

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
