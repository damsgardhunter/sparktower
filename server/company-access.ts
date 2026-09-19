/**
 * Whether the person asking may act for this company.
 *
 * One place, used by every company route, so the rule cannot be written
 * slightly differently in five places. A stranger is told the company does
 * not exist (404), not that they are forbidden (403): whether a company has an
 * account here is its own business until it chooses to show up somewhere
 * public, like a challenge.
 *
 * Two ways in. `companyCan` asks for one specific power ("run training
 * seasons", "recruit", …) — what a route should ask for, because a leader can
 * hand a single power to a member without making them an admin. `companyFor`
 * is the older, coarser question (view / manage / delete by role) and stays
 * for the few things that really are a leader's alone, like editing what the
 * company says about itself.
 */
import { and, eq } from "drizzle-orm";
import type { Response } from "express";
import { db } from "./db";
import { companies, companyAuditLog, companyMembers } from "@shared/schema";
import {
  canActOn, canCompany, hasPower, isCompanyPermission, COMPANY_PERMISSIONS, ROLE_RANK,
  type CompanyPermission, type CompanyPower, type CompanyRole,
} from "@shared/companies";

export type CompanyMember = { role: CompanyRole; permissions: CompanyPermission[] };

/** This person's place in the company — their role and the powers given to them — or null if they aren't in it. */
export async function companyMember(companyId: string, userId: string): Promise<CompanyMember | null> {
  const [row] = await db.select({ role: companyMembers.role, permissions: companyMembers.permissions }).from(companyMembers)
    .where(and(eq(companyMembers.companyId, companyId), eq(companyMembers.userId, userId)));
  if (!row) return null;
  // A power that has since been retired from the list stays in the column harmlessly; it just isn't reported.
  return { role: row.role as CompanyRole, permissions: (row.permissions ?? []).filter(isCompanyPermission) };
}

export async function companyRole(companyId: string, userId: string): Promise<CompanyRole | null> {
  return (await companyMember(companyId, userId))?.role ?? null;
}

/**
 * `canActOn` from shared/companies.ts, with the equal-rank case its own
 * comment describes.
 *
 * As written, `canActOn` compares ranks strictly, so a member who manages the
 * team could not look after any other member, and one admin could not act on
 * another — though its comment says anyone with "manage the team" looks after
 * members and only somebody who *outranks* you is off limits. Equal rank is
 * allowed here; acting on yourself is not, so nobody hands themselves powers.
 * (Reported for the shared rule to be corrected, after which this can go.)
 */
export function mayActOn(
  actor: CompanyMember & { userId?: string },
  target: (CompanyMember & { userId?: string }) | null,
  what: "add" | "remove" | "powers" | "role" | "grant_manage_team",
): boolean {
  if (target && actor.userId && actor.userId === target.userId && what !== "role") return false;
  if (canActOn(actor, target, what)) return true;
  if (!target || what === "role" || what === "grant_manage_team") return false;
  return hasPower(actor, "manage_team") && ROLE_RANK[actor.role] >= ROLE_RANK[target.role];
}

/** Everything this member can effectively do: every power for a leader, the given ones for a member. */
export const powersOf = (member: CompanyMember): CompanyPermission[] =>
  COMPANY_PERMISSIONS.map((p) => p.id).filter((p) => hasPower(member, p));

async function load(companyId: string, userId: string) {
  const [company] = await db.select().from(companies).where(eq(companies.id, companyId));
  const member = company ? await companyMember(companyId, userId) : null;
  return company && member ? { company, member } : null;
}

const notFound = (res: Response) => res.status(404).json({ message: "No such company." });

/**
 * The company and this person's place in it, if they hold `power` there;
 * otherwise the response is sent and null comes back. "view" is anyone in the
 * company. A member without the power gets 403 naming it, so the page can say
 * exactly what to ask a leader for; a stranger gets 404.
 */
export async function companyCan(res: Response, companyId: string, userId: string, power: CompanyPermission | "view") {
  const found = await load(companyId, userId);
  if (!found) {
    notFound(res);
    return null;
  }
  if (power !== "view" && !hasPower(found.member, power)) {
    const label = COMPANY_PERMISSIONS.find((p) => p.id === power)?.label ?? power;
    res.status(403).json({ message: `That needs the "${label}" power in this company. Ask one of its leaders.`, code: "missing_power", power });
    return null;
  }
  return found;
}

/**
 * The company, if this person may do `power` to it by their role; otherwise
 * the response is sent and null comes back. A member asking to manage gets
 * 403 — they already know it exists; a stranger gets 404.
 *
 * Kept for the decisions that are about role rather than a single power.
 * Prefer `companyCan` for anything a member could be trusted with.
 */
export async function companyFor(res: Response, companyId: string, userId: string, power: CompanyPower) {
  const found = await load(companyId, userId);
  if (!found) {
    notFound(res);
    return null;
  }
  if (!canCompany(found.member.role, power)) {
    res.status(403).json({ message: "That needs an admin of this company.", code: "not_admin" });
    return null;
  }
  return { company: found.company, role: found.member.role, member: found.member };
}

/**
 * Write down something done to or for a company.
 *
 * Never allowed to fail the thing it records: the action has already
 * happened, and refusing it after the fact because the log was unreachable
 * would be worse than a gap in the log. The failure is reported instead.
 */
export async function logCompany(
  companyId: string, actorId: string | null, action: string, targetUserId?: string | null, detail?: Record<string, unknown> | null,
): Promise<void> {
  try {
    await db.insert(companyAuditLog).values({
      companyId, actorId, action, targetUserId: targetUserId ?? null, detail: detail ?? null, createdAt: new Date(),
    });
  } catch (error) {
    console.error("Company audit log error:", error);
  }
}
