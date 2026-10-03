/**
 * What a company lets somebody do, restated for the phone.
 *
 * A copy of the parts of `shared/companies.ts` the app needs, because Metro
 * will not resolve `@shared`. `test/unit/company-rules-parity.test.ts` holds
 * every value here against the web's, field for field, so a power added on the
 * server cannot quietly go missing on a phone.
 *
 * The rules are restated and not re-decided. `hasPower` and `canActOn` are the
 * web's, line for line, and they exist here for one purpose: to grey out a
 * control before somebody taps it. The server enforces the same rules again and
 * is the only thing that decides — two implementations of a permission rule is
 * one implementation and one bug, so this one is never the answer, only the
 * warning.
 */

export const COMPANY_ROLES = ["owner", "admin", "member"] as const;
export type CompanyRole = (typeof COMPANY_ROLES)[number];

export const COMPANY_SIZES = ["1-10", "11-50", "51-200", "201-1000", "1000+"] as const;

/** The individual things a company can let somebody do. Stored on `companyMembers.permissions`. */
export const COMPANY_PERMISSIONS = [
  { id: "manage_team", label: "Manage the team", help: "Add and remove members, and give other members powers." },
  { id: "run_seasons", label: "Run training seasons", help: "Set up private simulation seasons, invite people, end a year early and read the staff report." },
  { id: "recruit", label: "Recruit", help: "Search the talent pool and invite people to talk in the company's name." },
  { id: "challenges", label: "Run challenges", help: "Post challenges, judge entries and announce winners." },
  { id: "scouting", label: "Scout startups", help: "Follow projects and choose which industries to watch." },
  { id: "post_as_company", label: "Post as the company", help: "Publish on the feed under the company's name." },
  { id: "run_business", label: "Run the business", help: "Weekly check-ins, recurring jobs and the quarter's goals on the Run a company path." },
] as const;
export type CompanyPermission = (typeof COMPANY_PERMISSIONS)[number]["id"];
export const COMPANY_PERMISSION_IDS = COMPANY_PERMISSIONS.map((p) => p.id) as CompanyPermission[];

/** How senior a role is: an owner outranks an admin outranks a member. */
export const ROLE_RANK: Record<CompanyRole, number> = { owner: 3, admin: 2, member: 1 };

/** Whether this member may do this. Leaders may do everything; members only what they were given. */
export function hasPower(
  member: { role: CompanyRole; permissions?: readonly string[] | null } | null | undefined,
  power: CompanyPermission,
): boolean {
  if (!member) return false;
  if (member.role === "owner" || member.role === "admin") return true;
  return (member.permissions ?? []).includes(power);
}

/** Whether `actor` may add, remove or change the powers of `target`. The web's `canActOn`. */
export function canActOn(
  actor: { role: CompanyRole; permissions?: readonly string[] | null },
  target: { role: CompanyRole } | null,
  what: "add" | "remove" | "powers" | "role" | "grant_manage_team",
): boolean {
  if (what === "role" || what === "grant_manage_team") return actor.role === "owner" || actor.role === "admin";
  if (!hasPower(actor, "manage_team")) return false;
  if (!target) return what === "add";
  if (actor.role === "owner") return true;
  return ROLE_RANK[actor.role] > ROLE_RANK[target.role];
}

/** What a role means, in a line under somebody's name. The web's ROLE_HELP. */
export const ROLE_HELP: Record<CompanyRole, string> = {
  owner: "Can do anything, including deleting the company",
  admin: "Can do anything except delete the company",
  member: "Can see everything and join seasons",
};

export const isLeader = (r: CompanyRole) => r === "owner" || r === "admin";
export const powerLabel = (p: string) => COMPANY_PERMISSIONS.find((x) => x.id === p)?.label ?? p;

/**
 * Why `me` cannot change this person's powers or remove them, or null if they
 * can. The web's `blockedOn` in company/admin-tab.tsx, which is in turn
 * `mayActOn` in server/company-access.ts.
 *
 * A sentence rather than a boolean, because a disabled control that does not
 * say why is worse than one that refuses.
 */
export function blockedOn(
  me: { userId: string; role: CompanyRole; permissions?: readonly string[] | null },
  target: { userId: string; role: CompanyRole },
): string | null {
  if (!hasPower(me, "manage_team")) return "You don't manage the team.";
  if (target.userId === me.userId) return "Ask another leader to change your own access.";
  if (me.role !== "owner" && ROLE_RANK[target.role] > ROLE_RANK[me.role]) {
    return target.role === "owner" ? "Only an owner can change an owner." : "Only an owner or admin can change a leader.";
  }
  return null;
}
