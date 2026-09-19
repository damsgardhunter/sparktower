/**
 * What has to happen elsewhere when a company's people change.
 *
 * A company on the Run a company path runs through an ordinary project — the
 * one that holds its cash, check-ins and recurring jobs — and that project's
 * own member list is what decides who can read it. So the two lists are kept
 * in step here: joining the company puts you on the project, and leaving or
 * being removed takes you off it. Without this, somebody shown the door kept
 * reading the company's numbers for as long as the project existed.
 *
 * Projects are owned by a person, not a company, so the Run project's owner
 * is always one of the company's people. When that person leaves, ownership
 * moves to the company's most senior remaining person rather than going with
 * them.
 */
import { and, asc, eq, ne } from "drizzle-orm";
import type { PoolClient } from "pg";
import { db } from "./db";
import { companies, companyMembers, feedPosts, projectMembers, projects } from "@shared/schema";
import type { CompanyRole } from "@shared/companies";

/** The project roles a company role maps to. The project's owner keeps "Owner" whatever their company role. */
const projectRoleFor = (role: CompanyRole) => (role === "member" ? "Member" : "Admin");
const RANK_SQL_ORDER = { owner: 0, admin: 1, member: 2 } as const;

/**
 * Put this person on the company's Run project with the right role, or take
 * them off it (`role` null). A company with no Run project has nothing to do.
 */
export async function syncRunProjectMember(companyId: string, userId: string, role: CompanyRole | null): Promise<void> {
  const [company] = await db.select({ projectId: companies.projectId }).from(companies).where(eq(companies.id, companyId));
  if (!company?.projectId) return;
  const projectId = company.projectId;
  const [project] = await db.select({ ownerId: projects.ownerId }).from(projects).where(eq(projects.id, projectId));
  if (!project) return;
  const [row] = await db.select({ id: projectMembers.id, role: projectMembers.role }).from(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)));

  if (role) {
    if (project.ownerId === userId) return; // The owner's row says "Owner" and stays that way.
    if (!row) await db.insert(projectMembers).values({ projectId, userId, role: projectRoleFor(role) });
    else if (row.role !== projectRoleFor(role)) await db.update(projectMembers).set({ role: projectRoleFor(role) }).where(eq(projectMembers.id, row.id));
    return;
  }

  if (project.ownerId === userId) {
    // Hand the project on before they go: the company's most senior remaining person, longest-serving first.
    const people = await db.select({ userId: companyMembers.userId, role: companyMembers.role }).from(companyMembers)
      .where(and(eq(companyMembers.companyId, companyId), ne(companyMembers.userId, userId)))
      .orderBy(asc(companyMembers.joinedAt));
    const heir = people.sort((a, b) => RANK_SQL_ORDER[a.role] - RANK_SQL_ORDER[b.role])[0];
    // Nobody left to take it: the company is empty, and the project stays with its owner as a personal one.
    if (!heir) return;
    await db.update(projects).set({ ownerId: heir.userId }).where(eq(projects.id, projectId));
    const [heirRow] = await db.select({ id: projectMembers.id }).from(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, heir.userId)));
    if (heirRow) await db.update(projectMembers).set({ role: "Owner" }).where(eq(projectMembers.id, heirRow.id));
    else await db.insert(projectMembers).values({ projectId, userId: heir.userId, role: "Owner" });
  }
  if (row) await db.delete(projectMembers).where(eq(projectMembers.id, row.id));
}

/**
 * Delete a company, and the posts it published.
 *
 * A post's `company_id` is set null when its company goes, which would turn
 * every company announcement into a personal post by whoever typed it — words
 * they wrote for their employer, suddenly under their own name. So the posts
 * go first, in the same transaction.
 */
export async function deleteCompany(companyId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(feedPosts).where(eq(feedPosts.companyId, companyId));
    await tx.delete(companies).where(eq(companies.id, companyId));
  });
}

/**
 * The company side of closing an account, run inside that transaction.
 *
 * The account row is kept as a tombstone, so nothing cascades on its own: the
 * person's memberships are removed here. A company whose last owner this was
 * gets a new owner — its longest-serving admin, otherwise its longest-serving
 * member — because the app's "every company needs an owner" rule would
 * otherwise be broken by the one path that doesn't go through the app's
 * routes. A company nobody is left in goes, with its posts.
 *
 * The Run project is handed to the new owner here too, before the account's
 * own projects are dealt with, so it stays with the company rather than going
 * to whichever project member happens to have the oldest account.
 */
export async function companiesOnAccountClose(client: PoolClient, userId: string): Promise<void> {
  const mine = await client.query<{ company_id: string; role: CompanyRole; project_id: string | null }>(
    `SELECT m.company_id, m.role, c.project_id FROM company_members m JOIN companies c ON c.id = m.company_id WHERE m.user_id = $1`,
    [userId],
  );
  // Nobody to remind any more: an unowned job reminds the project's owner, and an unowned goal is still the company's.
  await client.query("UPDATE recurring_jobs SET owner_id = NULL WHERE owner_id = $1", [userId]);
  await client.query("UPDATE recurring_jobs SET backup_id = NULL WHERE backup_id = $1", [userId]);
  await client.query("UPDATE quarter_goals SET owner_id = NULL WHERE owner_id = $1", [userId]);
  for (const { company_id: companyId, role, project_id: projectId } of mine.rows) {
    await client.query("DELETE FROM company_members WHERE company_id = $1 AND user_id = $2", [companyId, userId]);
    const rest = await client.query<{ user_id: string; role: CompanyRole }>(
      `SELECT m.user_id, m.role FROM company_members m JOIN users u ON u.id = m.user_id
        WHERE m.company_id = $1 AND u.deleted_at IS NULL
        ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, m.joined_at ASC, m.user_id ASC`,
      [companyId],
    );
    if (rest.rows.length === 0) {
      await client.query("DELETE FROM feed_posts WHERE company_id = $1", [companyId]);
      await client.query("DELETE FROM companies WHERE id = $1", [companyId]);
      continue;
    }
    const heir = rest.rows[0];
    // Written the way Drizzle writes a JS Date (UTC, ISO), so this row sorts with the ones the app writes.
    if (role === "owner" && heir.role !== "owner") {
      await client.query("UPDATE company_members SET role = 'owner', permissions = '{}' WHERE company_id = $1 AND user_id = $2", [companyId, heir.user_id]);
      await client.query(
        `INSERT INTO company_audit_log (company_id, actor_id, action, target_user_id, detail, created_at) VALUES ($1, NULL, 'owner_succeeded', $2, $3, $4)`,
        [companyId, heir.user_id, JSON.stringify({ from: heir.role, reason: "the last owner closed their account" }), new Date().toISOString()],
      );
    }
    if (projectId) {
      const moved = await client.query("UPDATE projects SET owner_id = $1 WHERE id = $2 AND owner_id = $3", [heir.user_id, projectId, userId]);
      if (moved.rowCount) {
        const updated = await client.query("UPDATE project_members SET role = 'Owner' WHERE project_id = $1 AND user_id = $2", [projectId, heir.user_id]);
        if (!updated.rowCount) await client.query("INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, 'Owner')", [projectId, heir.user_id]);
      }
    }
  }
}
