/**
 * What every company feature agrees on: who may do what, and what a company is.
 *
 * A company account is an existing business that comes here for things only an
 * organisation needs — private simulation seasons to train its people, a way to
 * find people who have *shown* commercial judgement, challenges it sponsors,
 * and startups it keeps an eye on. See `companies` in shared/schema.ts.
 */
import { PROJECT_CATEGORIES } from "./categories";

export const COMPANY_ROLES = ["owner", "admin", "member"] as const;
export type CompanyRole = (typeof COMPANY_ROLES)[number];

/**
 * What each role may do, said once.
 *
 * Members can see everything and take part — join a training season, read the
 * talent search. Changing what the company says or spends, inviting people,
 * approaching candidates and judging challenges is an admin's; deleting the
 * company is the owner's alone.
 */
export const COMPANY_POWERS = {
  view: ["owner", "admin", "member"],
  manage: ["owner", "admin"],
  delete: ["owner"],
} as const satisfies Record<string, readonly CompanyRole[]>;
export type CompanyPower = keyof typeof COMPANY_POWERS;

export const canCompany = (role: CompanyRole | null | undefined, power: CompanyPower): boolean =>
  !!role && (COMPANY_POWERS[power] as readonly string[]).includes(role);

export const COMPANY_SIZES = ["1-10", "11-50", "51-200", "201-1000", "1000+"] as const;

/**
 * The industries a company can watch and a challenge can be filed under.
 *
 * The project categories, so "watch Fintech" means exactly the projects that
 * call themselves Fintech — a second list that drifted from the first would
 * make scouting quietly miss things.
 */
export const INDUSTRIES = PROJECT_CATEGORIES;

/** A URL-safe name, with a short suffix so two companies called "Acme" can both exist. */
export function slugify(name: string, suffix: string): string {
  const base = name.toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_-]+/g, "-").slice(0, 40) || "company";
  return `${base}-${suffix.slice(0, 6).toLowerCase()}`;
}

// ─── Powers ──────────────────────────────────────────────────────────────────

/**
 * The individual things a company can let somebody do.
 *
 * Owners and admins — the business's leaders — hold every power by virtue of
 * their role. A member holds only the powers a leader has given them, so a
 * company can let one person run its training seasons and another post on the
 * feed in its name without making either an admin. Stored on
 * `companyMembers.permissions`.
 */
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

export const isCompanyPermission = (v: unknown): v is CompanyPermission =>
  typeof v === "string" && (COMPANY_PERMISSION_IDS as string[]).includes(v);

/** How senior a role is: an owner outranks an admin outranks a member. */
export const ROLE_RANK: Record<CompanyRole, number> = { owner: 3, admin: 2, member: 1 };

/** Whether this member may do this. Leaders may do everything; members only what they were given. */
export function hasPower(member: { role: CompanyRole; permissions?: readonly string[] | null } | null | undefined, power: CompanyPermission): boolean {
  if (!member) return false;
  if (member.role === "owner" || member.role === "admin") return true;
  return (member.permissions ?? []).includes(power);
}

/**
 * Whether `actor` may add, remove or change the powers of `target`.
 *
 * Anyone with "manage the team" can look after members. Only a leader can
 * touch another leader, and nobody can act on somebody who outranks them — an
 * admin cannot remove the owner, and a member who manages the team cannot
 * remove an admin. Giving the "manage the team" power itself, or changing
 * anybody's role, is a leader's call alone: otherwise a member could hand the
 * whole company to a friend.
 */
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
