/**
 * VISP for Business - Company Service
 *
 * API calls for the collaborator (company member) flows:
 *   - redeemCompanyInvite: link the authenticated user to a company via an
 *     8-character invite code (POST /companies/redeem-invite).
 *   - getMyCompany: fetch the caller's company membership, if any
 *     (GET /companies/me -> 404 when the user has no company).
 *
 * Both calls rely on the apiClient request interceptor attaching the user's
 * Bearer token automatically.
 */

import { get, post } from './apiClient';

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

export type CompanyRole =
  | 'admin'
  | 'supervisor'
  | 'collaborator'
  | 'member'
  | string;

/** Result of redeeming an invite code. */
export interface RedeemInviteResult {
  companyId: string;
  role: CompanyRole;
}

/** A member row inside the company payload. */
export interface CompanyMember {
  userId: string;
  role: CompanyRole;
  status: string;
}

/** Raw member row as returned by the backend (snake_case). */
interface RawCompanyMember {
  user_id: string;
  role: CompanyRole;
  status: string;
}

/** The company payload returned by GET /companies/me. */
export interface MyCompany {
  id: string;
  legalName: string;
  status: string;
  members: CompanyMember[];
  enabledTaskIds: string[];
}

/** Raw GET /companies/me data (snake_case from backend). */
interface RawMyCompany {
  id: string;
  legal_name: string;
  status: string;
  members?: RawCompanyMember[];
  enabled_task_ids?: string[];
  // The backend may include extra fields; we only map what we need.
}

// ──────────────────────────────────────────────
// Job-assignment flow (SP4 Stage 2)
// ──────────────────────────────────────────────

/** Company assignment statuses returned by the backend (CompanyJobStatus). */
export type CompanyAssignmentStatus =
  | 'claimed'
  | 'assigned'
  | 'accepted'
  | 'declined'
  | string;

/** A job the company is eligible to claim (supervisor view). */
export interface ClaimableJob {
  jobId: string;
  referenceNumber: string;
  taskId: string;
  taskName: string | null;
  status: string;
  serviceCity: string | null;
  requestedDate: string | null;
}

interface RawClaimableJob {
  job_id: string;
  reference_number: string;
  task_id: string;
  task_name: string | null;
  status: string;
  service_city: string | null;
  requested_date: string | null;
}

/** An eligible collaborator for a claimed job (supervisor assign view). */
export interface EligibleCollaborator {
  userId: string;
  email: string | null;
  providerId: string;
  hasRequiredCredential: boolean;
}

interface RawEligibleCollaborator {
  user_id: string;
  email: string | null;
  provider_id: string;
  has_required_credential: boolean;
}

/** A company job assignment row (shared by supervisor + collaborator views). */
export interface CompanyAssignment {
  id: string;
  jobId: string;
  companyId: string;
  claimedBy: string;
  assignedCollaboratorId: string | null;
  status: CompanyAssignmentStatus;
  payoutTarget: string;
  declineReason: string | null;
}

interface RawCompanyAssignment {
  id: string;
  job_id: string;
  company_id: string;
  claimed_by: string;
  assigned_collaborator_id: string | null;
  status: string;
  payout_target: string;
  decline_reason: string | null;
}

function mapClaimableJob(r: RawClaimableJob): ClaimableJob {
  return {
    jobId: r.job_id,
    referenceNumber: r.reference_number,
    taskId: r.task_id,
    taskName: r.task_name ?? null,
    status: r.status,
    serviceCity: r.service_city ?? null,
    requestedDate: r.requested_date ?? null,
  };
}

function mapEligibleCollaborator(r: RawEligibleCollaborator): EligibleCollaborator {
  return {
    userId: r.user_id,
    email: r.email ?? null,
    providerId: r.provider_id,
    hasRequiredCredential: r.has_required_credential,
  };
}

function mapAssignment(r: RawCompanyAssignment): CompanyAssignment {
  return {
    id: r.id,
    jobId: r.job_id,
    companyId: r.company_id,
    claimedBy: r.claimed_by,
    assignedCollaboratorId: r.assigned_collaborator_id ?? null,
    status: r.status,
    payoutTarget: r.payout_target,
    declineReason: r.decline_reason ?? null,
  };
}

// ──────────────────────────────────────────────
// Service
// ──────────────────────────────────────────────

export const companyService = {
  /**
   * Redeem an 8-character company invite code for the authenticated user.
   * The invite is bound to the user's email, so the account email MUST match
   * the email the company admin invited.
   *
   * On a 400 the apiClient surfaces the backend `detail` string as
   * `error.message` (e.g. "Invalid invite code.", "This invite has expired.",
   * "...already been redeemed.", "...different email address."). Callers should
   * display that message inline.
   */
  redeemInvite: async (code: string): Promise<RedeemInviteResult> => {
    const data = await post<{ company_id: string; role: CompanyRole }>(
      '/companies/redeem-invite',
      { code: code.trim() },
    );
    return { companyId: data.company_id, role: data.role };
  },

  /**
   * Fetch the caller's company, or null when the user is not a member.
   * A 404 from the backend (no company) is normalized to null; other errors
   * propagate so callers can decide whether to surface them.
   */
  getMyCompany: async (): Promise<MyCompany | null> => {
    try {
      const raw = await get<RawMyCompany>('/companies/me');
      if (!raw) return null;
      return {
        id: raw.id,
        legalName: raw.legal_name,
        status: raw.status,
        members: (raw.members ?? []).map((m) => ({
          userId: m.user_id,
          role: m.role,
          status: m.status,
        })),
        enabledTaskIds: raw.enabled_task_ids ?? [],
      };
    } catch (err) {
      // 404 => the user has no company. Treat as "not a collaborator".
      const statusCode =
        err && typeof err === 'object' && 'statusCode' in err
          ? (err as { statusCode: number }).statusCode
          : 0;
      if (statusCode === 404) {
        return null;
      }
      throw err;
    }
  },

  // ──────────────────────────────────────────────
  // Supervisor / admin endpoints
  // ──────────────────────────────────────────────

  /**
   * List jobs the company may claim (status PENDING_MATCH/MATCHED, task enabled
   * for the company, not already claimed).
   * GET /companies/{companyId}/claimable-jobs
   * Requires the caller to be an active admin/supervisor of a validated company
   * (backend returns 403 otherwise — surfaced as error.message).
   */
  listClaimableJobs: async (companyId: string): Promise<ClaimableJob[]> => {
    const data = await get<RawClaimableJob[]>(
      `/companies/${companyId}/claimable-jobs`,
    );
    return (data ?? []).map(mapClaimableJob);
  },

  /**
   * Claim a claimable job on behalf of the company.
   * POST /companies/{companyId}/jobs/{jobId}/claim
   */
  claimJob: async (
    companyId: string,
    jobId: string,
  ): Promise<CompanyAssignment> => {
    const data = await post<RawCompanyAssignment>(
      `/companies/${companyId}/jobs/${jobId}/claim`,
    );
    return mapAssignment(data);
  },

  /**
   * List collaborators eligible to be assigned a claimed job (only those with
   * the required credential when the task requires one).
   * GET /companies/{companyId}/jobs/{jobId}/eligible-collaborators
   */
  listEligibleCollaborators: async (
    companyId: string,
    jobId: string,
  ): Promise<EligibleCollaborator[]> => {
    const data = await get<RawEligibleCollaborator[]>(
      `/companies/${companyId}/jobs/${jobId}/eligible-collaborators`,
    );
    return (data ?? []).map(mapEligibleCollaborator);
  },

  /**
   * Assign a claimed job to an eligible collaborator.
   * POST /companies/{companyId}/jobs/{jobId}/assign
   */
  assignJob: async (
    companyId: string,
    jobId: string,
    collaboratorUserId: string,
  ): Promise<CompanyAssignment> => {
    const data = await post<RawCompanyAssignment>(
      `/companies/${companyId}/jobs/${jobId}/assign`,
      { collaborator_user_id: collaboratorUserId },
    );
    return mapAssignment(data);
  },

  // ──────────────────────────────────────────────
  // Collaborator endpoints
  // ──────────────────────────────────────────────

  /**
   * List the authenticated collaborator's own assignments.
   * GET /companies/my-assignments
   */
  listMyAssignments: async (): Promise<CompanyAssignment[]> => {
    const data = await get<RawCompanyAssignment[]>('/companies/my-assignments');
    return (data ?? []).map(mapAssignment);
  },

  /**
   * Accept an ASSIGNED assignment.
   * POST /companies/assignments/{assignmentId}/accept
   */
  acceptAssignment: async (
    assignmentId: string,
  ): Promise<CompanyAssignment> => {
    const data = await post<RawCompanyAssignment>(
      `/companies/assignments/${assignmentId}/accept`,
    );
    return mapAssignment(data);
  },

  /**
   * Decline an ASSIGNED assignment (optional reason).
   * POST /companies/assignments/{assignmentId}/decline
   */
  declineAssignment: async (
    assignmentId: string,
    reason?: string,
  ): Promise<CompanyAssignment> => {
    const data = await post<RawCompanyAssignment>(
      `/companies/assignments/${assignmentId}/decline`,
      { reason: reason ?? null },
    );
    return mapAssignment(data);
  },

  /**
   * Customer-facing: which collaborator (and company) was assigned to a job.
   * GET /companies/jobs/{jobId}/assigned-collaborator
   * Returns null when the job is not a company assignment.
   */
  getAssignedCollaborator: async (
    jobId: string,
  ): Promise<{
    companyId: string;
    assignedCollaboratorId: string | null;
    status: string;
    collaboratorFirstName: string | null;
    collaboratorLastName: string | null;
    collaboratorName: string | null;
  } | null> => {
    const data = await get<{
      company_id: string;
      assigned_collaborator_id: string | null;
      status: string;
      collaborator_first_name?: string | null;
      collaborator_last_name?: string | null;
      collaborator_name?: string | null;
    } | null>(`/companies/jobs/${jobId}/assigned-collaborator`);
    if (!data) return null;
    return {
      companyId: data.company_id,
      assignedCollaboratorId: data.assigned_collaborator_id ?? null,
      status: data.status,
      collaboratorFirstName: data.collaborator_first_name ?? null,
      collaboratorLastName: data.collaborator_last_name ?? null,
      collaboratorName: data.collaborator_name ?? null,
    };
  },
};

export default companyService;
