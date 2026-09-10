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
import { projects, projectKanbanTasks, projectCheckIns, projectRoadmaps, pathPace, pathPaceEvents, pathWork } from "@shared/schema";
import {
  resolveTree, treeFor, mainLineMilestones, computePace, admitInjections, NEXT_PATHS,
  type ResolvedMilestone, type Artifact, type InjectionProposal, type PaceState, type WorkPayload, type Actor,
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
/** A loop is a named child of a source milestone (the core loop); steps belong to one via loop:<taskId>. */
export const isLoop = (tags: string[] | null | undefined) => !!tags?.includes("kind:loop");
export const loopOf = (tags: string[] | null | undefined) => tagValue(tags, "loop:");
/** Tasks from a path the project has since left stay on the board, marked, and out of the maths. */
export const isArchivedPath = (tags: string[] | null | undefined) => !!tags?.some((t) => t.startsWith("archived:"));
const minutesOf = (t: { estimateHours: number | null }) => (t.estimateHours ?? 1) * 60;

export async function instantiatePathTree(projectId: string, goal: ProjectGoal, subcategory: string, opts: { keepRoadmap?: boolean } = {}) {
  // The path already exists when its backbone tasks do. A roadmap alone is
  // not the path: projects made before paths existed have an AI roadmap and
  // no tree, and adoption must get past that.
  if ((await pathTasks(projectId)).length) return { created: false, phases: 0, milestones: 0 };

  const tree = treeFor(goal);
  const phases = resolveTree(goal, subcategory);

  const roadmap = opts.keepRoadmap && (await storage.getProjectRoadmap(projectId).catch(() => null)) ? null : await storage.createRoadmap(
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
  return { created: true, roadmapId: roadmap?.id ?? null, phases: phases.length, milestones: count };
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
  const plan = planShape(main, tasks);

  // Work carried across from another path counts toward progress, not pace:
  // it was done there, at that pace, and this path starts fresh.
  const carried = (t: { tags: string[] | null }) => !!t.tags?.some((x) => x.startsWith("carried:"));
  // Extending is activity: any path task counts, main line or branch.
  const completions = tasks
    .filter((t) => t.status === "done" && t.completedAt && !carried(t) && (backboneIdOf(t.tags) || parentOf(t.tags) || injectedPhaseOf(t.tags)))
    .map((t) => ({ at: new Date(t.completedAt!), estimateMinutes: minutesOf(t) }));
  const checkIns = await db.select({ at: projectCheckIns.createdAt }).from(projectCheckIns).where(eq(projectCheckIns.projectId, projectId));

  const totalMinutes = plan.totalMinutes;
  const doneMinutes = plan.doneMinutes;
  const [prev] = await db.select().from(pathPace).where(eq(pathPace.projectId, projectId));

  // A raise in market is a pipeline: week 4 reached on the funding path.
  const week4 = tree.phases.find((p) => p.id === "week-4");
  const inMarket = goal === "raise_funding" && !!week4 && tasks.some((t) => t.status === "done" && week4.milestones.some((m) => m.id === backboneIdOf(t.tags)));

  const result = computePace({
    now: new Date(), createdAt: new Date(project.createdAt), completions,
    activityDates: checkIns.map((c) => new Date(c.at)),
    remainingMinutes: Math.max(0, totalMinutes - doneMinutes), totalMinutes,
    authoredDays: plan.authoredDays,
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
  return { ...result, mode: result.mode, plan: { loops: plan.loops, authoredDays: plan.authoredDays, totalMinutes, doneMinutes } };
}

/**
 * The plan's size, given the loops the builder is going for. A fan-out
 * milestone ("loop steps") is one authored estimate per loop until its
 * steps exist, then the sum of them; the month stretches a week per extra
 * loop, because that is where the time actually goes.
 */
export function planShape(main: ResolvedMilestone[], tasks: { status: string; tags: string[] | null; estimateHours: number | null }[]) {
  const loopsBy = new Map<string, number>();
  const stepsBy = new Map<string, { total: number; done: number }>();
  for (const t of tasks) {
    const p = parentOf(t.tags);
    if (!p) continue;
    if (isLoop(t.tags)) loopsBy.set(p, (loopsBy.get(p) ?? 0) + 1);
    else {
      const cur = stepsBy.get(p) ?? { total: 0, done: 0 };
      cur.total += minutesOf(t); if (t.status === "done") cur.done += minutesOf(t);
      stepsBy.set(p, cur);
    }
  }
  const doneIds = new Set(tasks.filter((t) => t.status === "done").map((t) => backboneIdOf(t.tags)).filter(Boolean) as string[]);
  let totalMinutes = 0, doneMinutes = 0, loops = 1;
  for (const m of main) {
    const authored = m.estimateMinutes ?? 60;
    if (m.expandsFrom) {
      const n = Math.max(1, loopsBy.get(m.expandsFrom) ?? 1);
      loops = Math.max(loops, n);
      const steps = stepsBy.get(m.id);
      const size = steps?.total ? Math.max(steps.total, authored) : authored * n;
      totalMinutes += size;
      doneMinutes += doneIds.has(m.id) ? size : steps?.done ?? 0;
    } else {
      totalMinutes += authored;
      if (doneIds.has(m.id)) doneMinutes += authored;
    }
  }
  return { loops, totalMinutes, doneMinutes, authoredDays: 28 + 7 * (loops - 1) };
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
export async function createExpansion(
  projectId: string, backboneId: string, steps: { title: string; description: string; estimateHours?: number }[],
  opts: { loopTaskId?: string | null; append?: boolean } = {},
) {
  const tasks = await pathTasks(projectId);
  const parent = tasks.find((t) => backboneIdOf(t.tags) === backboneId);
  if (!parent) throw Object.assign(new Error("That milestone isn't on this project's path."), { code: "not_on_path", status: 400 });
  const loopTaskId = opts.loopTaskId ?? null;
  if (loopTaskId && !tasks.some((t) => t.id === loopTaskId && isLoop(t.tags))) {
    throw Object.assign(new Error("That loop isn't on this project."), { code: "not_on_path", status: 400 });
  }
  // Steps exist per loop: expanding a second loop adds its own set.
  const existing = tasks.filter((t) => parentOf(t.tags) === backboneId && loopOf(t.tags) === loopTaskId);
  if (existing.length && !opts.append) return { created: [], existing };
  const created = [];
  let order = Math.max(parent.order ?? 0, ...existing.map((t) => t.order ?? 0));
  for (const step of steps.slice(0, 8)) {
    const title = String(step.title ?? "").trim();
    if (!title) continue;
    created.push(await storage.createKanbanTask({
      projectId, milestoneId: parent.milestoneId, title, description: String(step.description ?? "").trim(),
      status: "todo", priority: "medium", order: ++order,
      tags: [`parent:${backboneId}`, ...(loopTaskId ? [`loop:${loopTaskId}`] : []), ...(parent.tags ?? []).filter((t) => t.startsWith("actor:") || t.startsWith("tier:"))],
      estimateHours: Math.min(3, Math.max(1, Math.ceil(Number(step.estimateHours) || 1))),
    } as any));
  }
  return { created, existing };
}

/**
 * Another loop. A product can have several — the feed people come back to,
 * the thing they build, the thing they buy — and each is written down on
 * its own, then broken into its own steps. Loops hang off the source
 * milestone (the core loop), so that milestone is done when every loop is.
 */
export async function createLoop(projectId: string, sourceBackboneId: string, loop: { title: string; description?: string }) {
  const tasks = await pathTasks(projectId);
  const source = tasks.find((t) => backboneIdOf(t.tags) === sourceBackboneId);
  if (!source) throw Object.assign(new Error("That milestone isn't on this project's path."), { code: "not_on_path", status: 400 });
  const title = String(loop.title ?? "").trim();
  if (!title) throw Object.assign(new Error("Give the loop a name."), { code: "invalid_input", field: "title", status: 400 });
  const siblings = tasks.filter((t) => parentOf(t.tags) === sourceBackboneId && isLoop(t.tags));
  if (siblings.length >= 6) throw Object.assign(new Error("Six loops is already a lot for one month. Finish some first."), { code: "loop_cap", status: 409 });
  return storage.createKanbanTask({
    projectId, milestoneId: source.milestoneId, title, description: String(loop.description ?? "").trim(),
    status: "todo", priority: "medium", order: (source.order ?? 0) + siblings.length + 1,
    tags: [`parent:${sourceBackboneId}`, "kind:loop", ...(source.tags ?? []).filter((t) => t.startsWith("actor:") || t.startsWith("tier:"))],
    estimateHours: 1,
  } as any);
}

/**
 * The loops Nova found on re-evaluation. New ones are created under the
 * core loop with their steps written; a built one is done. Existing loops
 * are matched by name, never duplicated, never overwritten.
 */
export async function reconcileLoops(projectId: string, found: { title: string; steps: string; state: "built" | "partly" | "planned"; evidence: string }[], sourceBackboneId = "SHIP.M1.2") {
  const tasks = await pathTasks(projectId);
  const source = tasks.find((t) => backboneIdOf(t.tags) === sourceBackboneId);
  if (!source) return { created: [], updated: [] };
  const norm = (x: string) => x.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const existing = tasks.filter((t) => parentOf(t.tags) === sourceBackboneId && isLoop(t.tags));
  const created: string[] = [];
  const updated: string[] = [];
  for (const f of found) {
    const match = existing.find((e) => norm(e.title) === norm(f.title) || norm(e.title).includes(norm(f.title)) || norm(f.title).includes(norm(e.title)));
    if (match) {
      if (!match.description?.trim() && f.steps) { await storage.updateKanbanTask(match.id, { description: f.steps } as any); updated.push(match.id); }
      if (match.status !== "done" && f.state === "built") { await storage.updateKanbanTask(match.id, { status: "done", completedAt: new Date(), tags: [...(match.tags ?? []), "carried:reconciled"] } as any); updated.push(match.id); }
      continue;
    }
    if (existing.length + created.length >= 6) break;
    const loop = await createLoop(projectId, sourceBackboneId, { title: f.title, description: f.steps });
    if (f.state === "built") await storage.updateKanbanTask(loop.id, { status: "done", completedAt: new Date(), tags: [...(loop.tags ?? []), "carried:reconciled"] } as any);
    created.push(loop.id);
  }
  if (created.length || updated.length) await refreshPace(projectId);
  return { created, updated };
}

/**
 * Entering or leaving an optional phase. Nine builders in ten want to keep
 * building after week 2; choosing it is what makes Nova work the extension
 * instead of asking week-3 questions. Leaving is the same explicit act.
 */
export async function setBranch(projectId: string, phaseId: string | null) {
  const [project] = await db.select({ goal: projects.goal, subcategory: projects.subcategory }).from(projects).where(eq(projects.id, projectId));
  if (!project) throw Object.assign(new Error("Project not found"), { status: 404 });
  if (phaseId) {
    const phase = resolveTree(project.goal as ProjectGoal, project.subcategory).find((p) => p.id === phaseId);
    if (!phase?.optional) throw Object.assign(new Error("That isn't an optional phase on this path."), { code: "not_on_path", status: 400 });
  }
  await db.update(projects).set({ activeBranch: phaseId }).where(eq(projects.id, projectId));
  return { activeBranch: phaseId };
}

/** Extending again: the branch's own tasks reopen for another round, with the round recorded. */
export async function extendBranch(projectId: string, phaseId: string) {
  const [project] = await db.select({ goal: projects.goal, subcategory: projects.subcategory }).from(projects).where(eq(projects.id, projectId));
  if (!project) throw Object.assign(new Error("Project not found"), { status: 404 });
  const phase = resolveTree(project.goal as ProjectGoal, project.subcategory).find((p) => p.id === phaseId);
  if (!phase?.optional) throw Object.assign(new Error("That isn't an optional phase on this path."), { code: "not_on_path", status: 400 });
  const tasks = await pathTasks(projectId);
  const ids = new Set(phase.milestones.map((m) => m.id));
  let round = 1;
  for (const t of tasks.filter((t) => ids.has(backboneIdOf(t.tags) ?? ""))) {
    round = Math.max(round, Number(tagValue(t.tags, "round:") ?? 1) + (t.status === "done" ? 1 : 0));
  }
  for (const t of tasks.filter((t) => ids.has(backboneIdOf(t.tags) ?? "") && t.status === "done")) {
    await storage.updateKanbanTask(t.id, { status: "todo", tags: [...(t.tags ?? []).filter((x) => !x.startsWith("round:")), `round:${round}`] } as any);
  }
  await db.update(projects).set({ activeBranch: phaseId }).where(eq(projects.id, projectId));
  return { activeBranch: phaseId, round };
}

/**
 * Marks backbone milestones done on evidence that predates the path: a
 * project's existing tasks, audits and check-ins, read by Nova, or the
 * builder saying so. Counted as progress, not as pace — the work happened
 * before the path was watching.
 */
export async function reconcileMilestones(projectId: string, done: { id: string; evidence: string; answer?: string }[], source: "nova" | "builder") {
  const [project] = await db.select({ goal: projects.goal, subcategory: projects.subcategory }).from(projects).where(eq(projects.id, projectId));
  const authored = new Map(project ? resolveTree(project.goal as ProjectGoal, project.subcategory).flatMap((p) => p.milestones).map((m) => [m.id, m.description.trim()]) : []);
  const tasks = await pathTasks(projectId);
  const marked: string[] = [];
  const filled: string[] = [];
  for (const d of done) {
    const t = tasks.find((x) => backboneIdOf(x.tags) === d.id);
    if (!t) continue;
    const written = (t.description ?? "").trim();
    // "Written" means something beyond the authored text and beyond a bare recognition note.
    const hasAnswer = written && written !== authored.get(d.id) && !/^(.*\n\n)?(Nova recognised this as already done|Marked done by you): /s.test(written.replace(authored.get(d.id) ?? "", "").trim());
    const answer = d.answer?.trim();
    if (t.status === "done") {
      // Already done: fill in the content if it's missing and the read found it.
      if (!hasAnswer && answer) {
        await storage.updateKanbanTask(t.id, { description: answer } as any);
        filled.push(d.id);
      }
      continue;
    }
    await storage.updateKanbanTask(t.id, {
      status: "done", completedAt: new Date(),
      description: answer && !hasAnswer ? answer : `${t.description ?? ""}\n\n${source === "nova" ? "Nova recognised this as already done" : "Marked done by you"}: ${d.evidence}`.trim(),
      tags: [...(t.tags ?? []), `carried:${source === "nova" ? "reconciled" : "builder"}`],
    } as any);
    marked.push(d.id);
    if (answer && !hasAnswer) filled.push(d.id);
  }
  if (marked.length) await refreshPace(projectId);
  return { marked, filled };
}

/** The task a work request is about, with its actor and tier read off the path. */
export async function pathTaskContext(projectId: string, taskId: string) {
  const task = (await pathTasks(projectId)).find((t) => t.id === taskId);
  if (!task) return null;
  const [project] = await db.select({ goal: projects.goal, subcategory: projects.subcategory }).from(projects).where(eq(projects.id, projectId));
  if (!project) return null;
  const backbone = resolveTree(project.goal as ProjectGoal, project.subcategory).flatMap((p) => p.milestones);
  const milestone = backbone.find((m) => m.id === (backboneIdOf(task.tags) ?? parentOf(task.tags)));
  const actor = (tagValue(task.tags, "actor:") ?? milestone?.actor ?? "nova-builds") as Actor;
  const tier = tagValue(task.tags, "tier:") ?? milestone?.tier ?? "artifact";
  return { task, project, milestone, actor, tier };
}

export async function latestWork(taskId: string) {
  const [row] = await db.select().from(pathWork).where(eq(pathWork.taskId, taskId)).orderBy(desc(pathWork.createdAt)).limit(1);
  return row ?? null;
}

export async function saveWork(projectId: string, taskId: string, payload: WorkPayload) {
  const [row] = await db.insert(pathWork).values({ projectId, taskId, kind: payload.kind, payload }).returning();
  return row;
}

/**
 * The builder picking (and possibly editing) an option, or accepting a
 * build or template. What they chose becomes the task's written answer —
 * the artifact — and the task is done. Their edit wins over Nova's text.
 */
export async function chooseWork(projectId: string, workId: string, choice: { index?: number; text?: string; done?: boolean }) {
  const [row] = await db.select().from(pathWork).where(and(eq(pathWork.id, workId), eq(pathWork.projectId, projectId)));
  if (!row) throw Object.assign(new Error("That work isn't on this project."), { status: 404 });
  const payload = row.payload as WorkPayload;
  let answer = (choice.text ?? "").trim();
  let index: number | null = null;
  if (payload.kind === "options") {
    index = Number.isInteger(choice.index) ? Number(choice.index) : null;
    const option = index != null ? payload.options[index] : null;
    if (!option && !answer) throw Object.assign(new Error("Pick an option, or write your own."), { status: 400, code: "invalid_input" });
    if (!answer && option) answer = option.body;
  } else if (payload.kind === "build") {
    if (!answer) answer = `${payload.summary}\n\nFiles: ${payload.files.map((f) => f.path).join(", ")}\nVerified by: ${payload.verify}`;
  } else if (!answer) {
    answer = payload.template;
  }
  await db.update(pathWork).set({ chosenIndex: index }).where(eq(pathWork.id, row.id));
  const task = await storage.getKanbanTask(row.taskId);
  if (!task) throw Object.assign(new Error("Task not found"), { status: 404 });
  const updates: any = { description: answer };
  if (choice.done !== false) { updates.status = "done"; updates.completedAt = new Date(); if (!task.startedAt) updates.startedAt = new Date(); }
  const updated = await storage.updateKanbanTask(row.taskId, updates);
  if (updates.status === "done") await onPathTaskDone(updated as any);
  return { task: updated, answer };
}

/** How a task came to be done, read off its tags — so the map can say so. */
export function howDone(t: { status: string; tags: string[] | null }): "not-done" | "nova-recognised" | "you-marked" | "carried" | "done" {
  if (t.status !== "done") return "not-done";
  if (t.tags?.includes("carried:reconciled")) return "nova-recognised";
  if (t.tags?.includes("carried:builder")) return "you-marked";
  if (t.tags?.some((x) => x.startsWith("carried:"))) return "carried";
  return "done";
}

/**
 * One milestone, in full: the authored text, what is written on it, what
 * Nova produced, how it came to be done, and its steps — each with the
 * same. This is what opens when a step in the map is clicked.
 */
export async function milestoneDetail(projectId: string, backboneId: string) {
  const [project] = await db.select({ goal: projects.goal, subcategory: projects.subcategory }).from(projects).where(eq(projects.id, projectId));
  if (!project) return null;
  const phases = resolveTree(project.goal as ProjectGoal, project.subcategory);
  const phase = phases.find((p) => p.milestones.some((m) => m.id === backboneId));
  const milestone = phase?.milestones.find((m) => m.id === backboneId);
  if (!phase || !milestone) return null;
  const tasks = await pathTasks(projectId);
  const task = tasks.find((t) => backboneIdOf(t.tags) === backboneId) ?? null;
  const describe = async (t: typeof tasks[number], authored: string) => {
    const w = await latestWork(t.id);
    const written = (t.description ?? "").trim();
    return {
      taskId: t.id, title: t.title, status: t.status, completedAt: t.completedAt, how: howDone(t),
      actor: (tagValue(t.tags, "actor:") ?? milestone.actor) as Actor,
      // The answer is whatever is written beyond the authored text. A bare
      // recognition note ("Nova recognised this as already done: …") is
      // evidence, not content, and shows under "how", not here.
      answer: written && written !== authored.trim() && !/^(Nova recognised this as already done|Marked done by you): /.test(written.replace(authored.trim(), "").trim()) ? written : null,
      work: w ? { id: w.id, kind: w.kind, payload: w.payload, chosenIndex: w.chosenIndex, createdAt: w.createdAt } : null,
    };
  };
  const kids = tasks.filter((t) => parentOf(t.tags) === backboneId).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const loops = [];
  for (const k of kids.filter((t) => isLoop(t.tags))) loops.push(await describe(k, ""));
  const steps: (Awaited<ReturnType<typeof describe>> & { loopTaskId: string | null })[] = [];
  for (const k of kids.filter((t) => !isLoop(t.tags))) steps.push({ ...(await describe(k, "")), loopTaskId: loopOf(k.tags) });
  // A fan-out milestone shows the loops it expands from, so steps can be added per loop.
  const sourceLoops = milestone.expandsFrom
    ? tasks.filter((t) => parentOf(t.tags) === milestone.expandsFrom && isLoop(t.tags)).map((t) => ({ taskId: t.id, title: t.title, status: t.status, expanded: steps.some((s) => s.loopTaskId === t.id) }))
    : [];
  return {
    phase: { id: phase.id, title: phase.title, optional: !!phase.optional },
    milestone,
    /** Something expands from this milestone, so it can hold several loops. */
    isSource: phases.some((p) => p.milestones.some((m) => m.expandsFrom === backboneId)),
    task: task ? await describe(task, milestone.description) : null,
    loops,
    sourceLoops,
    steps,
  };
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
  const [project] = await db.select({ goal: projects.goal, subcategory: projects.subcategory, activeBranch: projects.activeBranch })
    .from(projects).where(eq(projects.id, projectId));
  if (!project) return null;

  const goal = project.goal as ProjectGoal;
  const phases = resolveTree(goal, project.subcategory);
  const tree = treeFor(goal);
  const tasks = await pathTasks(projectId);
  if (tasks.length === 0) {
    // Made before paths existed. The dashboard offers adoption rather than
    // pretending a project with fifty finished tasks is on week 1, step 1.
    const all = await storage.getProjectKanbanTasks(projectId).catch(() => []);
    return { adopted: false as const, goal, subcategory: project.subcategory, promise: tree.promise, existingTasks: all.length, existingDone: all.filter((t) => t.status === "done").length };
  }

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
    // Loops and steps: a source milestone is done when every loop is written;
    // a fan-out milestone when every step of every loop is done.
    return own || (!!kids?.length && kids.every((k) => k.status === "done"));
  };
  const loopsOf = (id: string) => (children.get(id) ?? []).filter((k) => isLoop(k.tags)).map((k) => ({
    taskId: k.id, title: k.title, description: k.description ?? "", status: k.status,
  }));
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
  const branch = project.activeBranch ? phases.find((p) => p.id === project.activeBranch && p.optional) ?? null : null;
  const branchOpen = !!branch && branch.milestones.some((m) => !isDone(m.id));
  const mainCurrent = phases.find((p) => !p.optional && p.milestones.some((m) => !isDone(m.id))) ?? phases[phases.length - 1];
  const current = branchOpen ? branch! : mainCurrent;
  const inPhaseDone = current.milestones.filter((m) => isDone(m.id)).length;
  const next = current.milestones.find((m) => !isDone(m.id)) ?? null;
  // Offer an optional phase at the checkpoint before it, when the builder
  // isn't already in it: the phase just before the branch is complete and
  // the main line would otherwise move past it.
  const offer = (() => {
    if (branchOpen) return null;
    const i = phases.findIndex((p) => p.id === mainCurrent.id);
    const before = phases[i - 1];
    if (!before?.optional) return null;
    const preceding = phases[i - 2];
    // Once they've been in the branch and left, leaving sticks: the map offers a way back, the dashboard doesn't nag.
    const visited = before.milestones.some((m) => taskByBackbone.get(m.id)?.status === "done" || tagValue(taskByBackbone.get(m.id)?.tags, "round:"));
    if (!visited && preceding && preceding.milestones.every((m) => isDone(m.id)) && mainCurrent.milestones.every((m) => !isDone(m.id))) {
      return { phaseId: before.id, title: before.title, milestones: before.milestones.map((m) => m.title) };
    }
    return null;
  })();

  // When the next milestone has been broken into steps, the next action is
  // the first unfinished step — Nova works step by step, not on the whole.
  // A loop that hasn't been written yet is a step too: write it first.
  const nextStepTask = next ? (children.get(next.id) ?? []).find((k) => k.status !== "done") ?? null : null;
  const nextLoops = next ? loopsOf(next.expandsFrom ?? next.id) : [];
  const stepLoopId = nextStepTask ? loopOf(nextStepTask.tags) : null;
  const stepLoop = stepLoopId ? nextLoops.find((l) => l.taskId === stepLoopId) ?? null : null;
  const workTaskId = nextStepTask?.id ?? taskByBackbone.get(next?.id ?? "")?.id ?? null;
  const work = workTaskId ? await latestWork(workTaskId) : null;
  // The loop tree: the source milestone, its loops, and each loop's steps
  // (children of the fan-out milestone tagged with that loop). Week 2's UI.
  const loopTree = (() => {
    const fanOut = phases.flatMap((p) => p.milestones).find((m) => m.expandsFrom && loopsOf(m.expandsFrom).length);
    if (!fanOut) return null;
    const sourceId = fanOut.expandsFrom!;
    const stepTasks = children.get(fanOut.id) ?? [];
    const loopNodes = (children.get(sourceId) ?? []).filter((k) => isLoop(k.tags)).map((k) => {
      const steps = stepTasks.filter((t) => loopOf(t.tags) === k.id).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      const done = steps.filter((t) => t.status === "done").length;
      return {
        taskId: k.id, title: k.title, description: k.description ?? "", written: k.status === "done" || !!k.description?.trim(),
        status: k.status, actor: (tagValue(k.tags, "actor:") ?? "nova-drafts") as Actor,
        state: steps.length ? (done === steps.length ? "built" : done > 0 ? "building" : "planned") : k.status === "done" || k.description?.trim() ? "written" : "unwritten",
        steps: steps.map((t) => ({ taskId: t.id, title: t.title, description: t.description ?? "", status: t.status, actor: (tagValue(t.tags, "actor:") ?? fanOut.actor) as Actor, estimateHours: t.estimateHours })),
        done, total: steps.length,
      };
    });
    const unassigned = stepTasks.filter((t) => !loopOf(t.tags)).map((t) => ({ taskId: t.id, title: t.title, status: t.status }));
    return { sourceId, sourceTitle: phases.flatMap((p) => p.milestones).find((m) => m.id === sourceId)?.title ?? "The core loop", fanOutId: fanOut.id, fanOutTitle: fanOut.title, loops: loopNodes, unassigned };
  })();
  const pace = await refreshPace(projectId);
  const events = await db.select().from(pathPaceEvents).where(eq(pathPaceEvents.projectId, projectId))
    .orderBy(desc(pathPaceEvents.createdAt)).limit(10);
  const complete = doneCount === main.length;

  return {
    adopted: true as const,
    goal, subcategory: project.subcategory, promise: tree.promise, target: tree.target, tier: tree.defaultTier,
    phases: phases.map((p) => ({
      id: p.id, title: p.title, optional: !!p.optional, checkpoint: p.checkpoint ?? null,
      total: p.milestones.length, done: p.milestones.filter((m) => isDone(m.id)).length,
      milestones: p.milestones.map(withTask),
      injected: (injected.get(p.id) ?? []).map((t) => ({ id: t.id, title: t.title, status: t.status, artifact: tagValue(t.tags, "artifact:") })),
      injectRoom: Math.max(0, 3 - (injected.get(p.id)?.length ?? 0)),
    })),
    current: { id: current.id, title: current.title, optional: !!current.optional, step: Math.min(inPhaseDone + 1, current.milestones.length), of: current.milestones.length },
    branch: branch ? { phaseId: branch.id, title: branch.title, open: branchOpen, round: Math.max(1, ...tasks.filter((t) => branch.milestones.some((m) => m.id === backboneIdOf(t.tags))).map((t) => Number(tagValue(t.tags, "round:") ?? 1))) } : null,
    offer,
    next: next ? {
      ...withTask(next),
      step: nextStepTask ? { taskId: nextStepTask.id, title: nextStepTask.title, description: nextStepTask.description ?? "", actor: (tagValue(nextStepTask.tags, "actor:") ?? next.actor) as Actor, isLoop: isLoop(nextStepTask.tags), loop: stepLoop ? { taskId: stepLoop.taskId, title: stepLoop.title } : null } : null,
      // The loops behind this milestone (its own, or its source's), each with whether it has steps yet.
      loops: nextLoops.map((l) => ({ ...l, expanded: next.expandsFrom ? (children.get(next.id) ?? []).some((k) => loopOf(k.tags) === l.taskId) : false })),
      workTaskId,
      work: work ? { id: work.id, kind: work.kind, payload: work.payload, chosenIndex: work.chosenIndex, createdAt: work.createdAt } : null,
    } : null,
    mainLine: { done: doneCount, total: main.length },
    pace, events,
    plan: pace?.plan ?? null,
    loopTree,
    proposal: complete ? NEXT_PATHS[goal] : null,
  };
}
