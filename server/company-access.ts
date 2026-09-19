/**
 * Whether the person asking may act for this company.
 *
 * One function, used by every company route, so the rule cannot be written
 * slightly differently in five places. A stranger is told the company does
 * not exist (404), not that they are forbidden (403): whether a company has an
 * account here is its own business until it chooses to show up somewhere
 * public, like a challenge.
 */
import { and, eq } from "drizzle-orm";
import type { Response } from "express";
import { db } from "./db";
import { companies, companyMembers } from "@shared/schema";
import { canCompany, type CompanyPower, type CompanyRole } from "@shared/companies";

export async function companyRole(companyId: string, userId: string): Promise<CompanyRole | null> {
  const [row] = await db.select({ role: companyMembers.role }).from(companyMembers)
    .where(and(eq(companyMembers.companyId, companyId), eq(companyMembers.userId, userId)));
  return (row?.role as CompanyRole) ?? null;
}

/**
 * The company, if this person may do `power` to it; otherwise the response is
 * sent and null comes back. A member asking to manage gets 403 — they already
 * know it exists; a stranger gets 404.
 */
export async function companyFor(res: Response, companyId: string, userId: string, power: CompanyPower) {
  const [company] = await db.select().from(companies).where(eq(companies.id, companyId));
  const role = company ? await companyRole(companyId, userId) : null;
  if (!company || !role) {
    res.status(404).json({ message: "No such company." });
    return null;
  }
  if (!canCompany(role, power)) {
    res.status(403).json({ message: "That needs an admin of this company.", code: "not_admin" });
    return null;
  }
  return { company, role };
}
