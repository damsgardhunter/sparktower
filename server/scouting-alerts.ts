/**
 * Telling a company when a startup it keeps an eye on moves.
 *
 * Called fire-and-forget from the places a project visibly moves — a path
 * step finished, an update posted — and where a public project is created.
 * Nothing here may fail or slow the request that caused it, so both functions
 * swallow their own errors and the callers never await them.
 *
 * Only public projects ever produce an alert. A project that went private
 * after a company followed it stops reporting: following cannot see through
 * privacy, for a company any more than for a person.
 */
import { and, eq, inArray } from "drizzle-orm";
import { db } from "./db";
import { projects, companyFollows, companyWatches, companyMembers } from "@shared/schema";
import { notify } from "./notifications";

/** Company id → the people who act for it. */
async function membersOf(companyIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (!companyIds.length) return out;
  const rows = await db.select({ companyId: companyMembers.companyId, userId: companyMembers.userId })
    .from(companyMembers).where(inArray(companyMembers.companyId, companyIds));
  for (const r of rows) out.set(r.companyId, [...(out.get(r.companyId) ?? []), r.userId]);
  return out;
}

/**
 * A followed project moved.
 *
 * `event.key` names the thing that happened (a task id, a post id), and it is
 * part of the notification's target — so the same event reported twice, or a
 * step reopened and finished again, reaches each person once rather than
 * stacking.
 */
export async function notifyScouts(projectId: string, event: { key: string; text: string }): Promise<void> {
  try {
    const [project] = await db.select({ id: projects.id, title: projects.title, ownerId: projects.ownerId, isPrivate: projects.isPrivate })
      .from(projects).where(eq(projects.id, projectId));
    if (!project || project.isPrivate) return;
    const follows = await db.select({ companyId: companyFollows.companyId }).from(companyFollows).where(eq(companyFollows.projectId, projectId));
    if (!follows.length) return;
    const members = await membersOf(follows.map((f) => f.companyId));
    for (const f of follows) {
      await notify({
        recipients: members.get(f.companyId) ?? [],
        actorId: project.ownerId,
        kind: "scout_update",
        targetId: `${f.companyId}:${projectId}:${event.key}`,
        projectId,
        excerpt: `${project.title}: ${event.text}`,
        once: true,
      });
    }
  } catch (err) {
    console.error("[scouting] couldn't tell the followers (non-fatal):", err);
  }
}

/** A new public project, to every company watching its category. */
export async function notifyWatchersOfNewProject(projectId: string): Promise<void> {
  try {
    const [project] = await db.select({
      id: projects.id, title: projects.title, category: projects.category, ownerId: projects.ownerId,
      isPrivate: projects.isPrivate, oneLiner: projects.oneLiner, description: projects.description,
    }).from(projects).where(eq(projects.id, projectId));
    if (!project || project.isPrivate) return;
    const watching = await db.select({ companyId: companyWatches.companyId }).from(companyWatches)
      .where(and(eq(companyWatches.industry, project.category)));
    if (!watching.length) return;
    const members = await membersOf(watching.map((w) => w.companyId));
    const about = project.oneLiner || project.description;
    for (const w of watching) {
      await notify({
        recipients: members.get(w.companyId) ?? [],
        actorId: project.ownerId,
        kind: "scout_new_project",
        targetId: `${w.companyId}:${projectId}`,
        projectId,
        excerpt: `${project.category}: ${project.title}${about ? ` — ${about}` : ""}`,
        once: true,
      });
    }
  } catch (err) {
    console.error("[scouting] couldn't tell the watchers (non-fatal):", err);
  }
}
