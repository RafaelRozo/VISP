/**
 * VISP for Business - Company (collaborator) Zustand Store
 *
 * Lightweight, app-wide membership info. After login/register we can call
 * `refreshMembership()` to detect whether the authenticated user is a company
 * collaborator and expose `{ companyId, companyName, role }`.
 *
 * SCOPE: this only exposes membership info. It deliberately does NOT change
 * which services/screens a collaborator sees — service filtering and the
 * assignment flow are a separate sub-task.
 */

import { create } from 'zustand';
import { companyService } from '../services/companyService';
import type { CompanyRole } from '../services/companyService';
import { useAuthStore } from './authStore';

export interface CompanyMembership {
  companyId: string;
  companyName: string;
  role: CompanyRole;
  status: string;
}

interface CompanyState {
  /** The caller's company membership, or null if they are not a member. */
  membership: CompanyMembership | null;

  /** True while a membership lookup is in flight. */
  isLoading: boolean;

  /**
   * True once a membership lookup has completed at least once (success OR a
   * normalized "no company" result). Screens use this to distinguish
   * "membership still loading" (show spinner) from "definitely no company"
   * (show empty state) instead of treating an unloaded null as an error.
   */
  hasLoaded: boolean;

  /**
   * Fetch the caller's company membership from the backend. Best-effort:
   * swallows errors (returns null membership) so it never blocks the UI.
   * Requires a valid auth token to already be set on the API client.
   */
  refreshMembership: () => Promise<CompanyMembership | null>;

  /** Clear membership (call on logout). */
  clearMembership: () => void;
}

/**
 * Resolve THIS user's own role within the company. The /companies/me payload
 * returns every member, so we match on the authenticated user's id. Falling
 * back to members[0] (the old behavior) would, for a collaborator account,
 * wrongly surface the supervisor's role and route them to the supervisor
 * screen (which then errors). 'member' is the last-resort default.
 */
function resolveOwnRole(
  members: { userId: string; role: CompanyRole }[],
): CompanyRole {
  const myUserId = useAuthStore.getState().user?.id;
  if (myUserId) {
    const self = members.find((m) => m.userId === myUserId);
    if (self) return self.role;
  }
  return members[0]?.role ?? 'member';
}

export const useCompanyStore = create<CompanyState>((set) => ({
  membership: null,
  isLoading: false,
  hasLoaded: false,

  refreshMembership: async (): Promise<CompanyMembership | null> => {
    set({ isLoading: true });
    try {
      const company = await companyService.getMyCompany();
      if (!company) {
        set({ membership: null, isLoading: false, hasLoaded: true });
        return null;
      }
      const membership: CompanyMembership = {
        companyId: company.id,
        companyName: company.legalName,
        role: resolveOwnRole(company.members),
        status: company.status,
      };
      set({ membership, isLoading: false, hasLoaded: true });
      return membership;
    } catch {
      // Best-effort: never block the app on a membership lookup. Mark loaded so
      // screens stop showing a spinner forever; they fall back to empty state.
      set({ membership: null, isLoading: false, hasLoaded: true });
      return null;
    }
  },

  clearMembership: () => set({ membership: null, hasLoaded: false }),
}));

export default useCompanyStore;
