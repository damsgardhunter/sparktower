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
