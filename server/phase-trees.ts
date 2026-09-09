/**
 * Instantiating a project's path.
 *
 * The backbone is data (shared/phase-trees); this turns it into rows the
 * project manager already renders: a roadmap whose phases are the weeks,
 * a milestone per backbone milestone, and a task per milestone carrying the
 * actor, verification tier and backbone id as tags — so the milestones tab,
 * the kanban and the roadmap all light up from one call, and the first slice
 * needs no new columns.
 *
 * Called once, at creation. Re-running would duplicate the tree; the roadmap
 * container's presence is the guard.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "./db";
import { storage } from "./storage";
import { projects, projectKanbanTasks, projectCheckIns, projectRoadmaps, pathPace, pathPaceEvents } from "@shared/schema";
import {
  resolveTree, treeFor, mainLineMilestones, computePace, admitInjections, NEXT_PATHS,
  type ResolvedMilestone, type Artifact, type InjectionProposal, type PaceState,
} from "@shared/phase-trees";
import { PROJECT_GOALS } from "@shared/goals";
import type { ProjectGoal } from "@shared/goals";

/** Tags let the actor and tier ride on the existing task row. */
export const tagsFor = (m: ResolvedMilestone) => [
  `actor:${m.actor}`, `tier:${m.tier}`, `backbone:${m.id}`,
  ...(m.sharedId ? [`shared:${m.sharedId}`] : []),
  ...(m.expandsFrom ? [`expands:${m.expandsFrom}`] : []),
];

const tagValue = (tags: string[] | null | undefined, prefix: string) =>
  tags?.find((t) => t.startsWith(prefix))?.slice(prefix.length) ?? null;
export const backboneIdOf = (tags: string[] | null | undefined) => tagValue(tags, "backbone:");
/** An expansion step's parent milestone, if this task is one. */
export const parentOf = (tags: string[] | null | undefined) => tagValue(tags, "parent:");
export const injectedPhaseOf = (tags: string[] | null | undefined) => tagValue(tags, "injected:");
/** Tasks from a path the project has since left stay on the board, marked, and out of the maths. */
export const isArchivedPath = (tags: string[] | null | undefined) => !!tags?.some((t) => t.startsWith("archived:"));
const minutesOf = (t: { estimateHours: number | null }) => (t.estimateHours ?? 1) * 60;

export async function instantiatePathTree(projectId: string, goal: ProjectGoal, subcategory: string) {
  const existing = await storage.getProjectRoadmap(projectId).catch(() => null);
  if (existing) return { created: false, phases: 0, milestones: 0 };

  const tree = treeFor(goal);
  const phases = resolveTree(goal, subcategory);

  const roadmap = await storage.createRoadmap(
    {
      projectId,
      goal: tree.promise,
      summary: `${tree.target}. ${tree.promise}.`,
      generatedOnTier: "backbone",
    } as any,
    phases.map((p, i) => ({
      title: p.title,
      description: p.checkpoint ?? (p.optional ? "Optional. Offered, never imposed." : null),
      estimatedDuration: p.optional ? "1–3 weeks" : "1 week",
      outcomes: p.milestones.map((m) => m.title),
      skillsNeeded: [],
      status: i === 0 ? ("in-progress" as const) : ("upcoming" as const),
      order: i,
    })),
  );

  let order = 0; let count = 0;
  for (const phase of phases) {
    for (const m of phase.milestones) {
      const milestone = await storage.createMilestone({
        projectId,
        title: m.title,
        description: `${m.description}\n\n${phase.title}${phase.optional ? " (optional)" : ""}`,
        status: "planned",
        order: order++,
      } as any);
      await storage.createKanbanTask({
        projectId,
        milestoneId: milestone.id,
        title: m.title,
        description: m.description,
        status: "todo",
        priority: phase.optional ? "low" : "medium",
        order: order,
        tags: tagsFor(m),
        estimateHours: m.estimateMinutes == null ? null : Math.max(1, Math.ceil(m.estimateMinutes / 60)),
      } as any);
      count++;
    }
  }
  return { created: true, roadmapId: roadmap.id, phases: phases.length, milestones: count };
}

/** Every live task with a backbone, parent or injected tag, i.e. everything on the current path. */
async function pathTasks(projectId: string) {
  const rows = await db.select().from(projectKanbanTasks).where(eq(projectKanbanTasks.projectId, projectId));
  return rows.filter((t) => !isArchivedPath(t.tags) && (backboneIdOf(t.tags) || parentOf(t.tags) || injectedPhaseOf(t.tags)));
}

/**
 * Recalculates pace and writes it down. Called on every sign of effort
 * (a backbone task done, a check-in) and lazily on read, so absence decays
 * the date without anyone having to trigger it. With `effort` it also logs
 * the recalculation event the builder can scroll back through.
 */
export async function refreshPace(projectId: string, effort?: {
  taskId: string; backboneId: string | null; title: string; estimateMinutes: number | null; actualMinutes: number | null;
}) {
  const [project] = await db.select({ goal: projects.goal, subcategory: projects.subcategory, createdAt: projects.createdAt })
    .from(projects).where(eq(projects.id, projectId));
  if (!project) return null;
  const goal = project.goal as ProjectGoal;
  const tree = treeFor(goal);
  const main = mainLineMilestones(resolveTree(goal, project.subcategory));
  const mainIds = new Set(main.map((m) => m.id));
  const tasks = await pathTasks(projectId);

  // Work carried across from another path counts toward progress, not pace:
  // it was done there, at that pace, and this path starts fresh.
  const carried = (t: { tags: string[] | null }) => !!t.tags?.some((x) => x.startsWith("carried:"));
  const completions = tasks
    .filter((t) => t.status === "done" && t.completedAt && !carried(t) && (mainIds.has(backboneIdOf(t.tags) ?? "") || mainIds.has(parentOf(t.tags) ?? "")))
    .map((t) => ({ at: new Date(t.completedAt!), estimateMinutes: minutesOf(t) }));
  const checkIns = await db.select({ at: projectCheckIns.createdAt }).from(projectCheckIns).where(eq(projectCheckIns.projectId, projectId));

  const totalMinutes = main.reduce((n, m) => n + (m.estimateMinutes ?? 60), 0);
  const doneMinutes = tasks
    .filter((t) => t.status === "done" && mainIds.has(backboneIdOf(t.tags) ?? ""))
    .reduce((n, t) => n + (main.find((m) => m.id === backboneIdOf(t.tags))?.estimateMinutes ?? 60), 0);
  const [prev] = await db.select().from(pathPace).where(eq(pathPace.projectId, projectId));

  // A raise in market is a pipeline: week 4 reached on the funding path.
  const week4 = tree.phases.find((p) => p.id === "week-4");
  const inMarket = goal === "raise_funding" && !!week4 && tasks.some((t) => t.status === "done" && week4.milestones.some((m) => m.id === backboneIdOf(t.tags)));

  const result = computePace({
    now: new Date(), createdAt: new Date(project.createdAt), completions,
    activityDates: checkIns.map((c) => new Date(c.at)),
    remainingMinutes: Math.max(0, totalMinutes - doneMinutes), totalMinutes,
    tier: tree.defaultTier, pipeline: inMarket,
    previous: prev ? { projectedAt: prev.projectedAt, state: prev.state as PaceState } : null,
  });

  const row = {
    state: result.state, multiplier: result.multiplier, projectedAt: result.projectedAt,
    projectedLow: result.projectedLow, projectedHigh: result.projectedHigh,
    lastActivityAt: new Date(Date.now() - result.daysSinceActivity * 86_400_000), updatedAt: new Date(),
  };
  await db.insert(pathPace).values({ projectId, ...row }).onConflictDoUpdate({ target: pathPace.projectId, set: row });
  if (effort) {
    await db.insert(pathPaceEvents).values({
      projectId, taskId: effort.taskId, backboneId: effort.backboneId, title: effort.title,
      estimateMinutes: effort.estimateMinutes, actualMinutes: effort.actualMinutes,
      projectedBefore: prev?.projectedAt ?? null, projectedAfter: result.projectedAt,
    });
  }
  return { ...result, mode: result.mode };
}

/** Called from the task board when a task on the path is finished. */
export async function onPathTaskDone(task: { id: string; projectId: string; title: string; tags: string[] | null; estimateHours: number | null; startedAt: Date | null; completedAt: Date | null }) {
  if (isArchivedPath(task.tags)) return;
  const backboneId = backboneIdOf(task.tags) ?? parentOf(task.tags);
  if (!backboneId && !injectedPhaseOf(task.tags)) return;
  const started = task.startedAt ? new Date(task.startedAt).getTime() : null;
  const finished = task.completedAt ? new Date(task.completedAt).getTime() : Date.now();
  const actual = started && finished - started > 60_000 ? Math.round((finished - started) / 60_000) : null;
  await refreshPace(task.projectId, {
    taskId: task.id, backboneId, title: task.title,
    estimateMinutes: task.estimateHours ? task.estimateHours * 60 : null, actualMinutes: actual,
  });
}

/**
 * Layer 3a: a milestone that fans out — "one per step of the core loop" —
 * becomes real steps, each its own task under the parent. The parent counts
 * as done when every step is. The artifact the steps come from is the
 * parent milestone's own written answer.
 */
export async function createExpansion(projectId: string, backboneId: string, steps: { title: string; description: string; estimateHours?: number }[]) {
  const tasks = await pathTasks(projectId);
  const parent = tasks.find((t) => backboneIdOf(t.tags) === backboneId);
  if (!parent) throw Object.assign(new Error("That milestone isn't on this project's path."), { code: "not_on_path", status: 400 });
  const existing = tasks.filter((t) => parentOf(t.tags) === backboneId);
  if (existing.length) return { created: [], existing };
  const created = [];
  let order = parent.order ?? 0;
  for (const step of steps.slice(0, 8)) {
    const title = String(step.title ?? "").trim();
    if (!title) continue;
    created.push(await storage.createKanbanTask({
      projectId, milestoneId: parent.milestoneId, title, description: String(step.description ?? "").trim(),
      status: "todo", priority: "medium", order: ++order,
      tags: [`parent:${backboneId}`, ...(parent.tags ?? []).filter((t) => t.startsWith("actor:") || t.startsWith("tier:"))],
      estimateHours: Math.min(3, Math.max(1, Math.ceil(Number(step.estimateHours) || 1))),
    } as any));
  }
  return { created, existing: [] };
}

/** The artifacts Nova may ground an injected task in: written answers, check-ins, decisions. */
export async function collectArtifacts(projectId: string): Promise<Artifact[]> {
  const goal = (await db.select({ goal: projects.goal, subcategory: projects.subcategory }).from(projects).where(eq(projects.id, projectId)))[0];
  if (!goal) return [];
  const backbone = new Map(resolveTree(goal.goal as ProjectGoal, goal.subcategory).flatMap((p) => p.milestones).map((m) => [m.id, m]));
  const out: Artifact[] = [];
  for (const t of await pathTasks(projectId)) {
    const id = backboneIdOf(t.tags);
    const authored = id ? backbone.get(id)?.description : null;
    // An answer exists when the description is no longer the authored text.
    if (id && t.status === "done" && t.description && t.description.trim() !== (authored ?? "").trim()) {
      out.push({ label: `milestone:${id}`, kind: "milestone", text: `${t.title}: ${t.description.slice(0, 600)}` });
    }
  }
  const checkIns = await storage.getProjectCheckIns(projectId).catch(() => []);
  for (const c of checkIns.slice(0, 4)) out.push({ label: `check-in:${c.id}`, kind: "check-in", text: `Goal: ${c.goal}. Proof: ${c.proof}. Next: ${c.nextStep ?? ""}`.slice(0, 600) });
  const decisions = await storage.getProjectDecisions(projectId).catch(() => []);
  for (const d of decisions.slice(0, 4)) out.push({ label: `decision:${d.id}`, kind: "decision", text: `${(d as any).title ?? ""}: ${(d as any).description ?? (d as any).rationale ?? ""}`.slice(0, 600) });
  return out;
}

/** Layer 3b: injected tasks for a phase, capped and grounded. Admission is the pure rule; this writes what passed. */
export async function createInjections(projectId: string, phaseId: string, proposals: InjectionProposal[], artifacts: Artifact[]) {
  const [project] = await db.select({ goal: projects.goal, subcategory: projects.subcategory }).from(projects).where(eq(projects.id, projectId));
  if (!project) throw Object.assign(new Error("Project not found"), { status: 404 });
  const phase = resolveTree(project.goal as ProjectGoal, project.subcategory).find((p) => p.id === phaseId);
  if (!phase) throw Object.assign(new Error("That phase isn't on this path."), { code: "not_on_path", status: 400 });
  const tasks = await pathTasks(projectId);
  const existing = tasks.filter((t) => injectedPhaseOf(t.tags) === phaseId).length;
  const { admitted, dropped } = admitInjections(proposals, artifacts, existing);
  const anchor = tasks.find((t) => backboneIdOf(t.tags) === phase.milestones[phase.milestones.length - 1]?.id);
  const created = [];
  for (const a of admitted) {
    created.push(await storage.createKanbanTask({
      projectId, milestoneId: anchor?.milestoneId ?? null, title: a.title,
      description: `${a.description}\n\nNova added this from: ${a.artifact}`,
      status: "todo", priority: "medium", order: (anchor?.order ?? 0) + 1,
      tags: [`injected:${phaseId}`, `artifact:${a.artifact}`, "actor:nova-builds", "tier:artifact"],
      estimateHours: a.estimateHours,
    } as any));
  }
  return { created, dropped, capRemaining: Math.max(0, 3 - existing - created.length) };
}

/**
 * Moving to another path. Visible, not hidden: the old path's tasks stay on
 * the board marked as such, the new tree is instantiated, and shared
 * milestones (SH-*) already done carry across as done — work is not asked
 * for twice. Pace starts fresh on the new path.
 */
export async function switchPath(projectId: string, goal: ProjectGoal, subcategory: string) {
  const [project] = await db.select({ goal: projects.goal, subcategory: projects.subcategory }).from(projects).where(eq(projects.id, projectId));
  if (!project) throw Object.assign(new Error("Project not found"), { status: 404 });
  const from = { goal: project.goal as ProjectGoal, subcategory: project.subcategory };

  const old = await pathTasks(projectId);
  const carried = new Map<string, typeof old[number]>();
  for (const t of old) {
    const shared = tagValue(t.tags, "shared:");
    if (shared && t.status === "done") carried.set(shared, t);
  }
  if (old.length) {
    await db.update(projectKanbanTasks)
      .set({ tags: sql`array_append(${projectKanbanTasks.tags}, ${"archived:" + from.goal})` })
      .where(inArray(projectKanbanTasks.id, old.map((t) => t.id)));
  }
  await db.update(projectRoadmaps).set({ status: "archived" })
    .where(and(eq(projectRoadmaps.projectId, projectId), eq(projectRoadmaps.status, "active")));
  await db.update(projects).set({ goal, subcategory }).where(eq(projects.id, projectId));

  const result = await instantiatePathTree(projectId, goal, subcategory);

  let carriedCount = 0;
  const fromLabel = PROJECT_GOALS.find((g) => g.id === from.goal)?.label ?? from.goal;
  for (const t of await pathTasks(projectId)) {
    const shared = tagValue(t.tags, "shared:");
    const source = shared ? carried.get(shared) : null;
    if (!source) continue;
    await storage.updateKanbanTask(t.id, {
      status: "done", completedAt: source.completedAt ?? new Date(), completedById: source.completedById,
      description: `${t.description ?? ""}\n\nCarried over from ${fromLabel}: ${source.description ?? source.title}`.trim(),
      tags: [...(t.tags ?? []), `carried:${from.goal}`],
    } as any);
    carriedCount++;
  }
  await db.delete(pathPace).where(eq(pathPace.projectId, projectId));
  await refreshPace(projectId);
  return { from, to: { goal, subcategory }, ...result, carried: carriedCount };
}

/**
 * Where the project is on its path, for the dashboard: the current phase,
 * progress within it as "step 4 of 7", the one next action with who acts,
 * pace, the recalculation log, and — at the end — Nova's case for what's next.
 */
export async function pathStatus(projectId: string) {
  const [project] = await db.select({ goal: projects.goal, subcategory: projects.subcategory })
    .from(projects).where(eq(projects.id, projectId));
  if (!project) return null;

  const goal = project.goal as ProjectGoal;
  const phases = resolveTree(goal, project.subcategory);
  const tree = treeFor(goal);
  const tasks = await pathTasks(projectId);

  const taskByBackbone = new Map<string, typeof tasks[number]>();
  const children = new Map<string, typeof tasks>();
  const injected = new Map<string, typeof tasks>();
  for (const t of tasks) {
    const b = backboneIdOf(t.tags); if (b) taskByBackbone.set(b, t);
    const p = parentOf(t.tags); if (p) children.set(p, [...(children.get(p) ?? []), t]);
    const i = injectedPhaseOf(t.tags); if (i) injected.set(i, [...(injected.get(i) ?? []), t]);
  }
  const isDone = (id: string) => {
    const own = taskByBackbone.get(id)?.status === "done";
    const kids = children.get(id);
    return own || (!!kids?.length && kids.every((k) => k.status === "done"));
  };
  const withTask = (m: ResolvedMilestone) => {
    const kids = children.get(m.id) ?? [];
    return {
      ...m, done: isDone(m.id),
      taskId: taskByBackbone.get(m.id)?.id ?? null, taskStatus: taskByBackbone.get(m.id)?.status ?? null,
      steps: kids.length ? { done: kids.filter((k) => k.status === "done").length, total: kids.length } : null,
    };
  };

  const main = mainLineMilestones(phases);
  const doneCount = main.filter((m) => isDone(m.id)).length;
  const current = phases.find((p) => !p.optional && p.milestones.some((m) => !isDone(m.id))) ?? phases[phases.length - 1];
  const inPhaseDone = current.milestones.filter((m) => isDone(m.id)).length;
  const next = current.milestones.find((m) => !isDone(m.id)) ?? null;

  const pace = await refreshPace(projectId);
  const events = await db.select().from(pathPaceEvents).where(eq(pathPaceEvents.projectId, projectId))
    .orderBy(desc(pathPaceEvents.createdAt)).limit(10);
  const complete = doneCount === main.length;

  return {
    goal, subcategory: project.subcategory, promise: tree.promise, target: tree.target, tier: tree.defaultTier,
    phases: phases.map((p) => ({
      id: p.id, title: p.title, optional: !!p.optional, checkpoint: p.checkpoint ?? null,
      total: p.milestones.length, done: p.milestones.filter((m) => isDone(m.id)).length,
      milestones: p.milestones.map(withTask),
      injected: (injected.get(p.id) ?? []).map((t) => ({ id: t.id, title: t.title, status: t.status, artifact: tagValue(t.tags, "artifact:") })),
      injectRoom: Math.max(0, 3 - (injected.get(p.id)?.length ?? 0)),
    })),
    current: { id: current.id, title: current.title, step: Math.min(inPhaseDone + 1, current.milestones.length), of: current.milestones.length },
    next: next ? withTask(next) : null,
    mainLine: { done: doneCount, total: main.length },
    pace, events,
    proposal: complete ? NEXT_PATHS[goal] : null,
  };
}
