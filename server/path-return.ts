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
import { publiclyVisible } from "./visibility";
import { isAuthenticated } from "./replit_integrations/auth/replitAuth";
import { projects, projectMembers, feedPosts, projectKanbanTasks } from "@shared/schema";
import { pathStatus, listTracks } from "./phase-trees";
import { mainLineMilestones, resolveTree } from "@shared/phase-trees";
import type { ProjectGoal } from "@shared/goals";
import { weekStartOf } from "@shared/weeks";
import { notify } from "./notifications";
import { notifyScouts } from "./scouting-alerts";

/** Away this many days with a step waiting, and the path sends one nudge for that step. */
export const NUDGE_AFTER_DAYS = 2;
/** The home card shows at most this many sections, across projects. */
const MAX_ITEMS = 5;
/**
 * How many projects one request will walk.
 *
 * This runs on every home-screen load and does a handful of queries per
 * section of every project someone belongs to. Someone on thirty projects
 * turned the home feed into a hundred-odd round trips for a card that shows
 * five rows. Newest projects first, since that is the one a builder is most
 * likely to be working, and the card itself only shows five sections anyway.
 */
const MAX_PROJECTS = 8;

export interface NextStepItem {
  project: { id: string; title: string; logoUrl: string | null };
  /** The section this step is on: each started section of a project is its own item. */
  track: { goal: ProjectGoal; label: string; short: string; primary: boolean };
  phase: string;
  progress: { done: number; total: number };
  next: { id: string; title: string; actor: string; estimateMinutes: number | null; step: string | null } | null;
  daysSinceActivity: number;
  projectedAt: string | null;
  /** The step finished most recently, if it can still be shared for feedback. */
  lastDone: { taskId: string; title: string; completedAt: string; sharedPostId: string | null } | null;
  /** This week's progress update: finished steps nobody has shared yet. Due when there's at least one. */
  weekly: WeeklyUpdate;
}

export interface WeeklyUpdate { due: boolean; steps: { taskId: string; title: string; completedAt: string }[] }

/** Steps count toward this week's update for this long after they're finished. */
export const WEEKLY_WINDOW_DAYS = 7;
/**
 * A task carries this tag once a post has shared it, so the weekly update never
 * offers it twice. Not "shared:" — path tasks already use that prefix for the
 * milestones shared between paths (shared:SH-01).
 */
export const postedTag = (postId: string) => `posted:${postId}`;
const isPathTask = (tags: string[] | null) => (tags ?? []).some((t) => t.startsWith("backbone:") || t.startsWith("parent:") || t.startsWith("injected:"))
  && !(tags ?? []).some((t) => t.startsWith("archived:") || t === "kind:loop");

/**
 * A milestone with steps or loops under it is finished when they are, as the
 * path counts it — ticking the milestone's own card doesn't finish it. Given a
 * project's tasks, says whether a task is such a milestone with work still open.
 */
function unfinishedParentCheck(all: { status: string; tags: string[] | null }[]) {
  const openChildren = new Set(all.filter((t) => t.status !== "done" && !(t.tags ?? []).some((x) => x.startsWith("archived:")))
    .flatMap((t) => (t.tags ?? []).filter((x) => x.startsWith("parent:")).map((x) => x.slice("parent:".length))));
  return (tags: string[] | null) => (tags ?? []).some((x) => x.startsWith("backbone:") && openChildren.has(x.slice("backbone:".length)));
}

/**
 * The weekly progress update, replacing the retired check-in: the steps
 * finished on the path in the last week that no post has shared yet. Tracked
 * by a tag on each task rather than by comparing a post's time to a task's —
 * the two are written by different clocks — so a step is offered until it's
 * shared, and never again after.
 */
export async function weeklyUpdateFor(projectId: string): Promise<WeeklyUpdate> {
  const all = await db.select({ id: projectKanbanTasks.id, title: projectKanbanTasks.title, status: projectKanbanTasks.status, tags: projectKanbanTasks.tags, completedAt: projectKanbanTasks.completedAt })
    .from(projectKanbanTasks).where(eq(projectKanbanTasks.projectId, projectId));
  const unfinishedParent = unfinishedParentCheck(all);
  const tasks = all.filter((t) => t.status === "done");
  const cutoff = Date.now() - WEEKLY_WINDOW_DAYS * 86_400_000;
  const steps = tasks
    .filter((t) => isPathTask(t.tags) && !unfinishedParent(t.tags) && t.completedAt && new Date(t.completedAt).getTime() >= cutoff && !(t.tags ?? []).some((x) => x.startsWith("posted:")))
    .sort((a, b) => new Date(a.completedAt!).getTime() - new Date(b.completedAt!).getTime())
    .slice(0, 12)
    .map((t) => ({ taskId: t.id, title: t.title, completedAt: new Date(t.completedAt!).toISOString() }));
  return { due: steps.length > 0, steps };
}

/** Marks tasks as shared by a post, so they drop out of the weekly update. */
export async function markStepsShared(postId: string, taskIds: string[]): Promise<void> {
  for (const id of taskIds) {
    const [task] = await db.select({ tags: projectKanbanTasks.tags }).from(projectKanbanTasks).where(eq(projectKanbanTasks.id, id));
    if (!task) continue;
    await db.update(projectKanbanTasks).set({ tags: [...(task.tags ?? []).filter((t) => t !== postedTag(postId)), postedTag(postId)] }).where(eq(projectKanbanTasks.id, id));
  }
}

/** Validates steps offered for a weekly update: finished, on this project's path, not shared already. */
export async function shareableSteps(projectId: string, raw: unknown): Promise<{ ids: string[] } | { error: string }> {
  if (!Array.isArray(raw)) return { error: "pathStepIds must be a list." };
  const ids = [...new Set(raw.map(String).filter(Boolean))].slice(0, 12);
  if (!ids.length) return { error: "Pick at least one finished step." };
  const rows = await db.select({ id: projectKanbanTasks.id, projectId: projectKanbanTasks.projectId, status: projectKanbanTasks.status, tags: projectKanbanTasks.tags })
    .from(projectKanbanTasks).where(inArray(projectKanbanTasks.id, ids));
  if (rows.length !== ids.length || rows.some((r) => r.projectId !== projectId || !isPathTask(r.tags))) return { error: "Those aren't all steps on this project's path." };
  if (rows.some((r) => r.status !== "done")) return { error: "Share steps once they're done." };
  const siblings = await db.select({ status: projectKanbanTasks.status, tags: projectKanbanTasks.tags }).from(projectKanbanTasks).where(eq(projectKanbanTasks.projectId, projectId));
  if (rows.some((r) => unfinishedParentCheck(siblings)(r.tags))) return { error: "Share steps once they're done." };
  return { ids };
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
export async function afterPathStepDone(task: { id: string; projectId: string; title: string; completedById?: string | null; tags?: string[] | null }): Promise<void> {
  /*
   * Companies following the project hear about milestones only — a task
   * tagged with its own backbone id — not every sub-step under one. A busy
   * project finishes a dozen sub-steps a day, and a company that follows ten
   * of them would learn to ignore the whole feed.
   */
  if (task.tags?.some((t) => t.startsWith("backbone:"))) {
    void notifyScouts(task.projectId, { key: `step:${task.id}`, text: `finished "${task.title}"` });
  }
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
    const [task] = await db.select({ id: projectKanbanTasks.id, title: projectKanbanTasks.title, status: projectKanbanTasks.status, completedAt: projectKanbanTasks.completedAt, tags: projectKanbanTasks.tags })
      .from(projectKanbanTasks).where(and(eq(projectKanbanTasks.id, e.taskId), eq(projectKanbanTasks.projectId, projectId)));
    if (!task || task.status !== "done") continue;
    // Shared on its own or in a weekly update: either way the task carries the post that shared it.
    const sharedBy = [...(task.tags ?? [])].reverse().find((t) => t.startsWith("posted:"))?.slice("posted:".length) ?? null;
    const [shared] = sharedBy
      ? await db.select({ id: feedPosts.id }).from(feedPosts).where(and(eq(feedPosts.id, sharedBy), publiclyVisible.feedPost())).limit(1)
      : [];
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
  return (await pathProgress(projectId))?.next ?? null;
}

/** The main line's progress and next milestone, read without syncing anything — safe on public, anonymous reads. */
export async function pathProgress(projectId: string): Promise<{ done: number; total: number; next: string | null; nextId: string | null } | null> {
  const [project] = await db.select({ goal: projects.goal, subcategory: projects.subcategory, capitalRoute: projects.capitalRoute }).from(projects).where(eq(projects.id, projectId));
  if (!project) return null;
  const main = mainLineMilestones(resolveTree(project.goal as ProjectGoal, project.subcategory, project.capitalRoute));
  const tasks = await db.select({ status: projectKanbanTasks.status, tags: projectKanbanTasks.tags }).from(projectKanbanTasks).where(eq(projectKanbanTasks.projectId, projectId));
  const done = new Set(tasks.filter((t) => t.status === "done" && !(t.tags ?? []).some((x) => x.startsWith("archived:")))
    .map((t) => (t.tags ?? []).find((x) => x.startsWith("backbone:"))?.slice("backbone:".length)).filter(Boolean) as string[]);
  const present = new Set(tasks.map((t) => (t.tags ?? []).find((x) => x.startsWith("backbone:"))?.slice("backbone:".length)).filter(Boolean) as string[]);
  if (!present.size) return null;
  const nextMilestone = main.find((m) => present.has(m.id) && !done.has(m.id)) ?? null;
  return {
    done: main.filter((m) => done.has(m.id)).length,
    total: main.length,
    next: nextMilestone?.title ?? null,
    /** The milestone's id, for a link that opens the section it's on (shared/notifications.ts). */
    nextId: nextMilestone?.id ?? null,
  };
}

/** Each of someone's projects with a path, what's next on it, and how long since they worked it. */
export async function nextStepsFor(userId: string): Promise<NextStepItem[]> {
  const owned = await db.select({ id: projects.id, title: projects.title, logoUrl: projects.logoUrl, status: projects.status, createdAt: projects.createdAt })
    .from(projects).where(eq(projects.ownerId, userId));
  const memberOf = await db.select({ id: projectMembers.projectId }).from(projectMembers).where(eq(projectMembers.userId, userId));
  const joined = memberOf.length
    ? await db.select({ id: projects.id, title: projects.title, logoUrl: projects.logoUrl, status: projects.status, createdAt: projects.createdAt })
      .from(projects).where(inArray(projects.id, memberOf.map((m) => m.id).filter((id) => !owned.some((o) => o.id === id))))
    : [];
  const candidates = [...owned, ...joined].filter((p) => p.status !== "completed")
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, MAX_PROJECTS);

  const items: NextStepItem[] = [];
  for (const p of candidates) {
    const sections = (await listTracks(p.id).catch(() => null))?.tracks.filter((s) => s.started) ?? [];
    // The weekly update is the project's, not a section's: offered once, on its first item.
    const weekly = await weeklyUpdateFor(p.id);
    let first = true;
    for (const section of sections) {
    // Read-only: a GET of the home screen must never create path tasks. See pathStatus.
    const status = await pathStatus(p.id, section.goal, { sync: false }).catch(() => null);
    if (!status?.adopted) continue;
    const lastDone = await lastDoneStep(p.id, status.events);
    items.push({
      project: { id: p.id, title: p.title, logoUrl: p.logoUrl },
      track: { goal: section.goal, label: section.label, short: section.short, primary: section.primary },
      phase: status.current.title,
      progress: status.mainLine,
      next: status.next ? {
        id: status.next.id, title: status.next.title, actor: status.next.step?.actor ?? status.next.actor,
        estimateMinutes: status.next.estimateMinutes, step: status.next.step?.title ?? null,
      } : null,
      daysSinceActivity: Math.floor(status.pace?.daysSinceActivity ?? 0),
      projectedAt: status.pace?.projectedAt ? new Date(status.pace.projectedAt).toISOString() : null,
      lastDone,
      weekly: first ? weekly : { due: false, steps: [] },
    });
    first = false;
    }
  }
  // Most recently worked first: the path someone is in the middle of leads.
  return items.sort((a, b) => a.daysSinceActivity - b.daysSinceActivity).slice(0, MAX_ITEMS);
}

/**
 * One nudge per waiting step, after a couple of days away — and never the same
 * step twice. It lands in the bell, so it's there on every device the next time
 * they open the app.
 */
export async function nudgeIfAway(userId: string, items: NextStepItem[]): Promise<void> {
  // The weekly update: one reminder per project per week, while there are finished steps nobody has shared.
  const week = weekStartOf().toISOString().slice(0, 10);
  for (const item of items) {
    if (!item.weekly.due) continue;
    await notify({
      recipients: [userId], actorId: userId, allowSelf: true, once: true,
      kind: "weekly_update", targetId: `${item.project.id}:${week}`, projectId: item.project.id,
      excerpt: `${item.weekly.steps.length} step${item.weekly.steps.length === 1 ? "" : "s"} finished: ${item.weekly.steps.map((s) => s.title).join(", ")}`,
    });
  }
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
