/**
 * Business service — wraps the standard-user /auth endpoints and the
 * /companies endpoints for "VISP for Business".
 *
 * Response envelopes are unwrapped by businessApi (`data.data ?? data`), so
 * the helpers here receive the already-unwrapped payloads. /auth responses
 * use camelCase; /companies responses use snake_case.
 */
import { bizDelete, bizGet, bizGetEnvelope, bizPost, bizPut, bizUpload } from './businessApi';

export type CompanyRole = 'admin' | 'supervisor' | 'collaborator';

/* ───────────────────────── Auth ───────────────────────── */

export interface BizUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  phone?: string | null;
}

export interface BizTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
}

export interface AuthPayload {
  user: BizUser;
  tokens: BizTokens;
  recoveryCode?: string;
}

/* ───────────────────────── Company ───────────────────────── */

export type CompanyStatus = 'draft' | 'pending_review' | 'validated' | 'rejected';

export type DocType =
  | 'legal_info'
  | 'business_registration'
  | 'business_number_tax'
  | 'owner_id'
  | 'authority_proof'
  | 'address_proof'
  | 'banking'
  | 'insurance'
  | 'license_cert'
  | 'operational_profile';

export interface CompanyMember {
  id: string;
  user_id: string;
  role: CompanyRole;
  status: 'active' | 'invited' | 'disabled';
  first_name?: string | null;
  last_name?: string | null;
  display_name?: string | null;
  email?: string | null;
}

export interface CompanyDocument {
  id: string;
  doc_type: DocType;
  status: 'pending' | 'approved' | 'rejected';
  document_url?: string | null;
  rejection_reason?: string | null;
}

export interface Company {
  id: string;
  legal_name: string;
  trade_name?: string | null;
  status: CompanyStatus;
  stripe_account_id?: string | null;
  rejection_reason?: string | null;
  members: CompanyMember[];
  documents: CompanyDocument[];
  enabled_task_ids: string[];
  services?: CompanyServicePrice[];
}

export interface CompanyServicePrice {
  taskId: string;
  rateCents: number | null;
  unit: string | null;
}

export interface CompanyCreateBody {
  legal_name: string;
  trade_name?: string;
  business_address?: string;
  phone?: string;
  email?: string;
  website?: string;
}

export interface CompanyInvite {
  id: string;
  email: string;
  role: string;
  code: string;
  status: string;
  expires_at: string;
}

/** A pending invite as returned by GET /companies/me/invites. */
export interface PendingInvite {
  id: string;
  email: string;
  role: CompanyRole;
  code: string;
  status: string;
  expires_at: string;
  created_at: string;
}

/* ───────────────────────── Catalog ───────────────────────── */

export interface CatalogTask {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  level: string;
  category_id: string;
  base_price_min_cents?: number | null;
  base_price_max_cents?: number | null;
  pricing_unit?: string | null;
}

export interface CatalogCategory {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  tasks: CatalogTask[];
}

export const businessService = {
  /* ── Auth (standard user) ── */
  register: (body: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    phone?: string;
    role?: string;
  }) =>
    bizPost<AuthPayload>('/auth/register', {
      email: body.email,
      password: body.password,
      firstName: body.firstName,
      lastName: body.lastName,
      phone: body.phone,
      role: body.role ?? 'provider',
    }),

  login: (email: string, password: string) =>
    bizPost<AuthPayload>('/auth/login', { email, password }),

  me: () => bizGet<{ user: BizUser }>('/auth/me'),

  /* ── Company ── */
  createCompany: (body: CompanyCreateBody) => bizPost<Company>('/companies', body),

  getMyCompany: () => bizGet<Company>('/companies/me'),

  uploadDocument: (docType: DocType, file: File) => {
    const form = new FormData();
    form.append('doc_type', docType);
    form.append('file', file);
    return bizUpload<{ id: string; doc_type: DocType; status: string }>(
      '/companies/me/documents',
      form,
    );
  },

  submitForReview: () => bizPost<{ status: CompanyStatus }>('/companies/me/submit'),

  setServices: (services: { taskId: string; rateCents: number | null }[]) =>
    bizPut<{ enabled_task_ids: string[]; services: CompanyServicePrice[] }>('/companies/me/services', {
      all: false,
      services: services.map((s) => ({ task_id: s.taskId, rate_cents: s.rateCents })),
    }),

  createInvite: (email: string, role: CompanyRole = 'collaborator') =>
    bizPost<CompanyInvite>('/companies/me/invites', { email, role }),

  /** Pending invites for the current company. */
  listInvites: () => bizGet<PendingInvite[]>('/companies/me/invites'),

  /** Revoke a pending invite (204 No Content). */
  revokeInvite: (inviteId: string) => bizDelete<void>(`/companies/me/invites/${inviteId}`),

  /** Soft-disable a member. Returns `{ id, status: 'disabled' }`. */
  removeMember: (memberId: string) =>
    bizDelete<{ id: string; status: string }>(`/companies/me/members/${memberId}`),

  /* ── Catalog (public taxonomy) ── */
  async getCatalog(): Promise<CatalogCategory[]> {
    // Categories and tasks are paginated and the backend caps `page_size` at
    // `settings.max_page_size` (100) — requesting more returns 422. Loop
    // through every page using the envelope's `meta.total_pages`.
    const cats = await fetchAllPages<{
      id: string;
      slug: string;
      name: string;
      description?: string | null;
    }>('/categories');

    const result = await Promise.all(
      cats.map(async (c) => {
        const tasks = await fetchAllPages<CatalogTask>(`/categories/${c.id}/tasks`);
        return {
          id: c.id,
          slug: c.slug,
          name: c.name,
          description: c.description ?? null,
          tasks,
        } as CatalogCategory;
      }),
    );
    return result;
  },
};

/**
 * Fetch every page of a paginated list endpoint, looping until
 * `meta.total_pages` is reached. Uses the largest page size the backend
 * accepts (`max_page_size` = 100) to minimise round-trips.
 */
const CATALOG_PAGE_SIZE = 100;

async function fetchAllPages<T>(url: string): Promise<T[]> {
  const items: T[] = [];
  let page = 1;
  let totalPages = 1;
  do {
    const res = await bizGetEnvelope<T>(url, { page, page_size: CATALOG_PAGE_SIZE });
    if (Array.isArray(res.data)) items.push(...res.data);
    totalPages = res.meta?.total_pages ?? 1;
    page += 1;
  } while (page <= totalPages);
  return items;
}

export const DOC_TYPES: DocType[] = [
  'legal_info',
  'business_registration',
  'business_number_tax',
  'owner_id',
  'authority_proof',
  'address_proof',
  'banking',
  'insurance',
  'license_cert',
  'operational_profile',
];

export const DOC_LABELS: Record<DocType, string> = {
  legal_info: 'Legal information',
  business_registration: 'Business registration',
  business_number_tax: 'Business / tax number',
  owner_id: 'Owner ID',
  authority_proof: 'Proof of authority',
  address_proof: 'Proof of address',
  banking: 'Banking details',
  insurance: 'Insurance certificate',
  license_cert: 'License / certification',
  operational_profile: 'Operational profile',
};
