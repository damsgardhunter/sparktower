/**
 * The shapes every company tab reads, and the small helpers they share.
 *
 * `GET /api/companies/:id` is "the shape every tab relies on" by its own
 * comment on the server, so it is typed once here rather than in each tab.
 */
import type { CompanyPermission, CompanyRole } from "../../companies";

export interface CompanyMember {
  userId: string;
  role: CompanyRole;
  permissions: CompanyPermission[] | null;
  joinedAt: string;
  firstName: string | null;
  lastName: string | null;
  displayName: string | null;
  avatarUrl: string | null;
}

export interface Company {
  id: string;
  name: string;
  slug: string;
  website: string | null;
  industry: string | null;
  size: string | null;
  description: string | null;
  projectId: string | null;
  verifiedDomain: string | null;
  verifiedAt: string | null;
  verifiedMethod: string | null;
}

export interface CompanyView {
  company: Company;
  role: CompanyRole;
  members: CompanyMember[];
  me: { userId: string; role: CompanyRole; permissions: CompanyPermission[]; powers: Record<string, boolean> };
}

/** The key every tab invalidates, so a change in one is seen by the others. */
export const companyKey = (id: string) => ["company", id] as const;

export const memberName = (m: CompanyMember) =>
  m.displayName || [m.firstName, m.lastName].filter(Boolean).join(" ") || "Member";
