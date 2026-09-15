/**
 * The retention loop: come back to the next step.
 *
 *   Open SparkTower → see each project's next step → do it (the answer is the
 *   step's artifact) → share it for feedback, or just see the path move → come
 *   back when the next step is ready.
 *
 * The path already advanced on every completion (`onPathTaskDone`) — what was
 * missing was anything that brought the builder back to it. This adds the
 * three ways back: the "Continue your path" card at the top of the home feed
 * (web and mobile), a notification to the rest of the team when a step is
 * finished (or to everyone, when Nova or an audit finished it), and a single
 * nudge when someone has been away from a path with a step waiting.
 */
import type { Express } from "express";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "./db";
import { isAuthenticated } from "./replit_integrations/auth/replitAuth";
import { projects, projectMembers, feedPosts, projectKanbanTasks } from "@shared/schema";
import { pathStatus } from "./phase-trees";
import { mainLineMilestones, resolveTree } from "@shared/phase-trees";
import type { ProjectGoal } from "@shared/goals";
import { notify } from "./notifications";

/** Away this many days with a step waiting, and the path sends one nudge for that step. */
export const NUDGE_AFTER_DAYS = 2;
/** The home card shows at most this many projects. */
const MAX_PROJECTS = 3;

export interface NextStepItem {
  project: { id: string; title: string; logoUrl: string | null };
  phase: string;
  progress: { done: number; total: number };
  next: { id: string; title: string; actor: string; estimateMinutes: number | null; step: string | null } | null;
  daysSinceActivity: number;
  projectedAt: string | null;
  /** The step finished most recently, if it can still be shared for feedback. */
  lastDone: { taskId: string; title: string; completedAt: string; sharedPostId: string | null } | null;
}

async function teamOf(projectId: string): Promise<{ ownerId: string; members: string[] } | null> {
  const [project] = await db.select({ ownerId: projects.ownerId }).from(projects).where(eq(projects.id, projectId));
  if (!project) return null;
  const members = await db.select({ id: projectMembers.userId }).from(projectMembers).where(eq(projectMembers.projectId, projectId));
  return { ownerId: project.ownerId, members: members.map((m) => m.id) };
}

/**
 * A step on the path was finished. Whoever finished it knows; everyone else on
 * the project hears, with what's next. When nobody did — Nova's answer was
 * chosen, an audit found it done — the whole team hears, owner included.
 */
export async function afterPathStepDone(task: { id: string; projectId: string; title: string; completedById?: string | null }): Promise<void> {
  try {
    const team = await teamOf(task.projectId);
    if (!team) return;
    const everyone = [team.ownerId, ...team.members];
    const actor = task.completedById && everyone.includes(task.completedById) ? task.completedById : null;
    if (actor && everyone.length === 1) return; // A solo builder finished their own step: nothing to tell anyone.
    const next = await nextOpenMilestone(task.projectId);
    const excerpt = next ? `${task.title} — next: ${next}` : `${task.title} — that was the last step on the main line`;
    await notify({
      recipients: everyone, actorId: actor ?? team.ownerId, allowSelf: !actor,
      kind: "path_step_done", targetId: task.id, projectId: task.projectId, excerpt,
    });
  } catch (err) {
    console.error("[path-return] couldn't tell the team (non-fatal):", err);
  }
}

/**
 * The step finished most recently on a project's path, from its pace log, if
 * it was in the last week and is still a finished task on this project — with
 * the post that shared it, if one did. (The log also carries audits, which
 * aren't steps, so the task is checked rather than trusted.)
 */
export async function lastDoneStep(projectId: string, events: { taskId: string | null; title: string; createdAt: Date | string }[]): Promise<NextStepItem["lastDone"]> {
  for (const e of events) {
    if (!e.taskId || Date.now() - new Date(e.createdAt).getTime() > 7 * 86_400_000) continue;
    const [task] = await db.select({ id: projectKanbanTasks.id, title: projectKanbanTasks.title, status: projectKanbanTasks.status, completedAt: projectKanbanTasks.completedAt })
      .from(projectKanbanTasks).where(and(eq(projectKanbanTasks.id, e.taskId), eq(projectKanbanTasks.projectId, projectId)));
    if (!task || task.status !== "done") continue;
    const [shared] = await db.select({ id: feedPosts.id }).from(feedPosts)
      .where(and(eq(feedPosts.entityType, "path_step"), eq(feedPosts.entityId, task.id), isNull(feedPosts.hiddenAt))).limit(1);
    return { taskId: task.id, title: task.title, completedAt: new Date(task.completedAt ?? e.createdAt).toISOString(), sharedPostId: shared?.id ?? null };
  }
  return null;
}

/**
 * The next open main-line milestone's title, read without side effects.
 * `pathStatus` also brings the tree up to date (creating any steps a project is
 * missing), so running it in the background of a completion raced the next
 * request's own sync and created those steps twice.
 */
async function nextOpenMilestone(projectId: string): Promise<string | null> {
  const [project] = await db.select({ goal: projects.goal, subcategory: projects.subcategory, capitalRoute: projects.capitalRoute }).from(projects).where(eq(projects.id, projectId));
  if (!project) return null;
  const main = mainLineMilestones(resolveTree(project.goal as ProjectGoal, project.subcategory, project.capitalRoute));
  const tasks = await db.select({ status: projectKanbanTasks.status, tags: projectKanbanTasks.tags }).from(projectKanbanTasks).where(eq(projectKanbanTasks.projectId, projectId));
  const done = new Set(tasks.filter((t) => t.status === "done" && !(t.tags ?? []).some((x) => x.startsWith("archived:")))
    .map((t) => (t.tags ?? []).find((x) => x.startsWith("backbone:"))?.slice("backbone:".length)).filter(Boolean) as string[]);
  const present = new Set(tasks.map((t) => (t.tags ?? []).find((x) => x.startsWith("backbone:"))?.slice("backbone:".length)).filter(Boolean) as string[]);
  return main.find((m) => present.has(m.id) && !done.has(m.id))?.title ?? null;
}

/** Each of someone's projects with a path, what's next on it, and how long since they worked it. */
export async function nextStepsFor(userId: string): Promise<NextStepItem[]> {
  const owned = await db.select({ id: projects.id, title: projects.title, logoUrl: projects.logoUrl, status: projects.status })
    .from(projects).where(eq(projects.ownerId, userId));
  const memberOf = await db.select({ id: projectMembers.projectId }).from(projectMembers).where(eq(projectMembers.userId, userId));
  const joined = memberOf.length
    ? await db.select({ id: projects.id, title: projects.title, logoUrl: projects.logoUrl, status: projects.status })
      .from(projects).where(inArray(projects.id, memberOf.map((m) => m.id).filter((id) => !owned.some((o) => o.id === id))))
    : [];
  const candidates = [...owned, ...joined].filter((p) => p.status !== "completed");

  const items: NextStepItem[] = [];
  for (const p of candidates) {
    const status = await pathStatus(p.id).catch(() => null);
    if (!status?.adopted) continue;
    const lastDone = await lastDoneStep(p.id, status.events);
    items.push({
      project: { id: p.id, title: p.title, logoUrl: p.logoUrl },
      phase: status.current.title,
      progress: status.mainLine,
      next: status.next ? {
        id: status.next.id, title: status.next.title, actor: status.next.step?.actor ?? status.next.actor,
        estimateMinutes: status.next.estimateMinutes, step: status.next.step?.title ?? null,
      } : null,
      daysSinceActivity: Math.floor(status.pace?.daysSinceActivity ?? 0),
      projectedAt: status.pace?.projectedAt ? new Date(status.pace.projectedAt).toISOString() : null,
      lastDone,
    });
  }
  // Most recently worked first: the path someone is in the middle of leads.
  return items.sort((a, b) => a.daysSinceActivity - b.daysSinceActivity).slice(0, MAX_PROJECTS);
}

/**
 * One nudge per waiting step, after a couple of days away — and never the same
 * step twice. It lands in the bell, so it's there on every device the next time
 * they open the app.
 */
export async function nudgeIfAway(userId: string, items: NextStepItem[]): Promise<void> {
  for (const item of items) {
    if (!item.next || item.daysSinceActivity < NUDGE_AFTER_DAYS) continue;
    await notify({
      recipients: [userId], actorId: userId, allowSelf: true, once: true,
      kind: "next_step", targetId: `${item.project.id}:${item.next.id}`, projectId: item.project.id,
      excerpt: item.next.step ?? item.next.title,
    });
  }
}

export function registerPathReturnRoutes(app: Express) {
  /** The home screen's "Continue your path": each project's next step, most recently worked first. */
  app.get("/api/me/next-steps", isAuthenticated, async (req: any, res) => {
    try {
      const items = await nextStepsFor(req.user.id);
      void nudgeIfAway(req.user.id, items).catch(() => {});
      res.json({ items });
    } catch (error) {
      console.error("Next steps error:", error);
      res.status(500).json({ message: "Couldn't load your next steps" });
    }
  });
}
