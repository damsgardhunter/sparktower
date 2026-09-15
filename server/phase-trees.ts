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
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "./db";
import { storage } from "./storage";
import { projects, projectKanbanTasks, projectCheckIns, projectRoadmaps, pathPace, pathPaceEvents, pathWork, projectCodeAudits, projectTracks } from "@shared/schema";
import {
  resolveTree, treeFor, mainLineMilestones, computePace, admitInjections, NEXT_PATHS, loopsAlike, splitMergedPaths,
  type ResolvedMilestone, type Artifact, type InjectionProposal, type PaceState, type WorkPayload, type Actor,
  authoredTextFor, renderPlanAnswer, validateIntake, renderIntake, allMilestoneIds, LOOP_TYPES, LOOP_TYPE_INFO, LOOP_ORDER, isLoopType, loopTypeTag, loopTypeOf, loopTypeRefusal, loopCoverage, byLoopOrder, loopAuditStale,
  type LoopType, type LoopCompetitiveAudit, type LoopClosureRead,
} from "@shared/phase-trees";
import { withRunGroups } from "@shared/phase-trees/run-steps";
import { describeOp } from "@shared/audit-catchup";
import { afterPathStepDone } from "./path-return";
import { PROJECT_GOALS, GOAL_BACKBONE_PREFIX, goalOfBackboneId, isProjectGoal } from "@shared/goals";
import { capitalProfile, renderCapitalProfile, businessHistoryFromResume, CAPITAL_MILESTONES, CAPITAL_ROUTES, type CapitalAnswers } from "@shared/capital";
import type { ProfileExperience } from "@shared/schema";
import type { ProjectGoal } from "@shared/goals";

/** Tags let the actor and tier ride on the existing task row. */
export const tagsFor = (m: ResolvedMilestone) => [
  `actor:${m.actor}`, `tier:${m.tier}`, `backbone:${m.id}`,
  ...(goalOfBackboneId(m.id) ? [`track:${goalOfBackboneId(m.id)}`] : []),
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

// --- Sections: the three paths side by side ----------------------------------

/**
 * Which section a path task belongs to: its `track:` tag; otherwise its
 * milestone's prefix (its own backbone id, or its parent's for steps and
 * loops); otherwise — an injected task from before sections — the primary.
 */
export function trackOfTask(tags: string[] | null | undefined, primary: ProjectGoal): ProjectGoal {
  const tagged = tagValue(tags, "track:");
  if (isProjectGoal(tagged)) return tagged;
  return goalOfBackboneId(backboneIdOf(tags) ?? parentOf(tags)) ?? primary;
}

export interface TrackState {
  goal: ProjectGoal;
  subcategory: string;
  capitalRoute: string | null;
  activeBranch: string | null;
  /** The project's primary path: its state lives on `projects` and its pace in `path_pace`. */
  primary: boolean;
  primaryGoal: ProjectGoal;
  createdAt: Date;
  pace: Record<string, unknown> | null;
}

/**
 * A section's state. The primary path's comes from the project row; any other
 * section's from `project_tracks`. Null when the project doesn't exist or
 * hasn't started that section.
 */
export async function trackState(projectId: string, goal?: ProjectGoal | null): Promise<TrackState | null> {
  const [project] = await db.select({ goal: projects.goal, subcategory: projects.subcategory, capitalRoute: projects.capitalRoute, activeBranch: projects.activeBranch, createdAt: projects.createdAt })
    .from(projects).where(eq(projects.id, projectId));
  if (!project) return null;
  const primaryGoal = project.goal as ProjectGoal;
  const want = goal ?? primaryGoal;
  if (want === primaryGoal) {
    return { goal: primaryGoal, subcategory: project.subcategory, capitalRoute: project.capitalRoute, activeBranch: project.activeBranch, primary: true, primaryGoal, createdAt: project.createdAt, pace: null };
  }
  const [row] = await db.select().from(projectTracks).where(and(eq(projectTracks.projectId, projectId), eq(projectTracks.goal, want)));
  if (!row) return null;
  return { goal: want, subcategory: row.subcategory, capitalRoute: row.capitalRoute, activeBranch: row.activeBranch, primary: false, primaryGoal, createdAt: row.createdAt, pace: (row.pace as Record<string, unknown> | null) ?? null };
}

/** Writes a section's route or branch where that section keeps them. */
async function setTrackFields(projectId: string, goal: ProjectGoal, patch: { capitalRoute?: string | null; activeBranch?: string | null }) {
  const state = await trackState(projectId, goal);
  if (!state) throw Object.assign(new Error("That section hasn't been started on this project."), { status: 400, code: "track_not_started" });
  if (state.primary) await db.update(projects).set(patch).where(eq(projects.id, projectId));
  else await db.update(projectTracks).set({ ...patch, updatedAt: new Date() }).where(and(eq(projectTracks.projectId, projectId), eq(projectTracks.goal, goal)));
}

/** The goal a milestone or phase request is about: the id's prefix, else the one asked for, else the primary. */
async function goalFor(projectId: string, opts: { backboneId?: string | null; goal?: unknown }): Promise<ProjectGoal | null> {
  const fromId = goalOfBackboneId(opts.backboneId);
  if (fromId) return fromId;
  if (isProjectGoal(opts.goal)) return opts.goal;
  const [project] = await db.select({ goal: projects.goal }).from(projects).where(eq(projects.id, projectId));
  return (project?.goal as ProjectGoal | undefined) ?? null;
}

/**
 * Every section, started or not: for the manager's three section buttons.
 * Progress is read without syncing anything, so it's cheap to poll.
 */
export async function listTracks(projectId: string) {
  const [project] = await db.select({ goal: projects.goal }).from(projects).where(eq(projects.id, projectId));
  if (!project) return null;
  const primaryGoal = project.goal as ProjectGoal;
  const rows = await db.select({ status: projectKanbanTasks.status, tags: projectKanbanTasks.tags }).from(projectKanbanTasks).where(eq(projectKanbanTasks.projectId, projectId));
  const out = [];
  for (const g of PROJECT_GOALS) {
    const state = await trackState(projectId, g.id);
    if (!state) { out.push({ goal: g.id, label: g.label, short: g.short, started: false as const, primary: false }); continue; }
    const main = mainLineMilestones(resolveTree(g.id, state.subcategory, state.capitalRoute));
    const live = rows.filter((r) => !isArchivedPath(r.tags) && backboneIdOf(r.tags) && trackOfTask(r.tags, primaryGoal) === g.id);
    const done = new Set(live.filter((r) => r.status === "done").map((r) => backboneIdOf(r.tags)));
    const present = new Set(live.map((r) => backboneIdOf(r.tags)));
    out.push({
      goal: g.id, label: g.label, short: g.short, started: true as const, primary: state.primary, subcategory: state.subcategory,
      done: main.filter((m) => done.has(m.id)).length, total: main.length,
      next: main.find((m) => present.has(m.id) && !done.has(m.id))?.title ?? null,
    });
  }
  return { primary: primaryGoal, tracks: out };
}

/**
 * Starting a section: its state row and its path on the board. A section the
 * project left through an old path switch comes back as it was, rather than
 * being built a second time.
 */
export async function startTrack(projectId: string, goal: ProjectGoal, subcategory: string) {
  const existing = await trackState(projectId, goal);
  if (existing) return { started: false, goal, subcategory: existing.subcategory };
  await db.insert(projectTracks).values({ projectId, goal, subcategory }).onConflictDoNothing();
  const prefix = `${GOAL_BACKBONE_PREFIX[goal]}.`;
  const all = await db.select({ id: projectKanbanTasks.id, tags: projectKanbanTasks.tags }).from(projectKanbanTasks).where(eq(projectKanbanTasks.projectId, projectId));
  let restored = 0;
  for (const row of all) {
    if (!row.tags?.includes(`archived:${goal}`)) continue;
    const id = backboneIdOf(row.tags) ?? parentOf(row.tags);
    if (!id?.startsWith(prefix)) continue;
    await storage.updateKanbanTask(row.id, { tags: row.tags.filter((x) => x !== `archived:${goal}`) } as any);
    restored++;
  }
  const built = restored ? { created: false, phases: 0, milestones: 0 } : await instantiatePathTree(projectId, goal, subcategory, { keepRoadmap: true });
  if (restored) await syncPathTree(projectId, goal, subcategory, null);
  await refreshPace(projectId, undefined, goal);
  return { started: true, goal, subcategory, restored, ...built };
}

export async function instantiatePathTree(projectId: string, goal: ProjectGoal, subcategory: string, opts: { keepRoadmap?: boolean } = {}) {
  // The path already exists when its backbone tasks do. A roadmap alone is
  // not the path: projects made before paths existed have an AI roadmap and
  // no tree, and adoption must get past that.
  if ((await pathTasks(projectId, goal)).length) return { created: false, phases: 0, milestones: 0 };

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
  // A building path starts with the five loops a business runs on, as empty
  // slots: named by kind, written by the builder or drafted by Nova.
  for (const sourceId of loopSourcesOf(phases)) {
    for (const type of LOOP_ORDER) await createLoop(projectId, sourceId, { title: LOOP_TYPE_INFO[type].label, type });
  }
  return { created: true, roadmapId: roadmap?.id ?? null, phases: phases.length, milestones: count };
}

/**
 * The milestones a business's loops hang off: what a main-line fan-out
 * expands from (the core loops). The keep-building branch fans out too, from
 * its own choice of what to build — those aren't the five loops.
 */
const loopSourcesOf = (phases: { optional?: boolean; milestones: ResolvedMilestone[] }[]) =>
  [...new Set(phases.filter((p) => !p.optional).flatMap((p) => p.milestones).map((m) => m.expandsFrom).filter(Boolean) as string[])];

/**
 * Brings a project's tasks in line with its tree.
 *
 * - The tree grew (new weeks at the front of a path, a milestone added): the
 *   missing tasks are created, so every step on the map can be worked.
 * - The project chose a route: that route's phases appear. A route it left is
 *   archived, not deleted, and comes back as it was if the project returns.
 * - A milestone no path authors any more (a path rewritten) is archived, so
 *   the board keeps the work but the path stops counting it.
 *
 * A project with no path yet is left for adoption.
 */
export async function syncPathTree(projectId: string, goal: ProjectGoal, subcategory: string, route?: string | null) {
  // One section's tasks only: the other sections' milestones aren't on this tree, and must never read as retired.
  const [owner] = await db.select({ goal: projects.goal }).from(projects).where(eq(projects.id, projectId));
  const primary = (owner?.goal ?? goal) as ProjectGoal;
  const all = (await db.select().from(projectKanbanTasks).where(eq(projectKanbanTasks.projectId, projectId)))
    .filter((t) => trackOfTask(t.tags, primary) === goal);
  const live = all.filter((t) => !isArchivedPath(t.tags) && (backboneIdOf(t.tags) || parentOf(t.tags) || injectedPhaseOf(t.tags)));
  if (!live.length) return { added: [] as string[], archived: [] as string[], restored: [] as string[] };

  const phases = resolveTree(goal, subcategory, route);
  const current = new Set(phases.flatMap((p) => p.milestones.map((m) => m.id)));
  const authored = allMilestoneIds(goal);
  const routeOf = new Map(treeFor(goal).phases.flatMap((p) => p.milestones.map((m) => [m.id, p.route ?? null] as const)));

  // Archive: a route's tasks when the project is on another (or none), and milestones no longer authored.
  const archived: string[] = [];
  for (const t of live) {
    const id = backboneIdOf(t.tags);
    if (!id || current.has(id)) continue;
    const taskRoute = routeOf.get(id);
    const mark = !authored.has(id) ? "archived:retired" : taskRoute ? `archived:route-${taskRoute}` : null;
    if (!mark) continue;
    await storage.updateKanbanTask(t.id, { tags: [...(t.tags ?? []), mark] } as any);
    archived.push(id);
  }

  // Restore: this route's tasks from an earlier visit, as they were.
  const restored: string[] = [];
  if (route) {
    for (const t of all) {
      if (!t.tags?.includes(`archived:route-${route}`)) continue;
      const id = backboneIdOf(t.tags);
      if (!id || !current.has(id) || restored.includes(id)) continue;
      await storage.updateKanbanTask(t.id, { tags: t.tags.filter((x) => x !== `archived:route-${route}`) } as any);
      restored.push(id);
    }
  }

  const have = new Set([...live.map((t) => backboneIdOf(t.tags)), ...restored].filter(Boolean));
  const missing = phases.flatMap((p) => p.milestones.map((m) => ({ phase: p, m }))).filter(({ m }) => !have.has(m.id));
  const added: string[] = [];
  for (const { phase, m } of missing) {
    // Placed by its position in the tree, so the board reads in path order.
    const position = phases.flatMap((p) => p.milestones).findIndex((x) => x.id === m.id);
    const milestone = await storage.createMilestone({
      projectId, title: m.title,
      description: `${m.description}\n\n${phase.title}${phase.optional ? " (optional)" : ""}`,
      status: "planned", order: position,
    } as any);
    await storage.createKanbanTask({
      projectId, milestoneId: milestone.id, title: m.title, description: m.description,
      status: "todo", priority: phase.optional ? "low" : "medium", order: position,
      tags: tagsFor(m),
      estimateHours: m.estimateMinutes == null ? null : Math.max(1, Math.ceil(m.estimateMinutes / 60)),
    } as any);
    added.push(m.id);
  }
  return { added, archived, restored };
}

/**
 * Saves tapped answers to a milestone's questions: the answers as the task's
 * written answer (what Nova reads on every later step), the raw choices as its
 * work so they can be changed, and the milestone done. No model, no credit.
 */
export async function saveIntake(projectId: string, taskId: string, raw: unknown) {
  const ctx = await pathTaskContext(projectId, taskId);
  if (!ctx) throw Object.assign(new Error("That task isn't on this project's path."), { status: 400, code: "not_on_path" });
  const questions = ctx.milestone?.intake;
  if (!questions?.length) throw Object.assign(new Error("That step isn't answered by choosing."), { status: 400, code: "invalid_input" });
  const checked = validateIntake(questions, raw);
  if (!checked.ok) throw Object.assign(new Error(checked.message), { status: 400, code: "invalid_input", field: checked.field });
  const summary = renderIntake(questions, checked.answers);
  const row = await saveWork(projectId, ctx.task.id, { kind: "intake", answers: checked.answers, summary });
  // A route question chooses which route's phases the path shows.
  let route: string | null = null;
  if (ctx.milestone?.routeQuestion) {
    route = checked.answers[ctx.milestone.routeQuestion]?.[0] ?? null;
    await setTrackFields(projectId, ctx.project.goal as ProjectGoal, { capitalRoute: route });
    await syncPathTree(projectId, ctx.project.goal as ProjectGoal, ctx.project.subcategory, route);
  }
  const wasDone = ctx.task.status === "done";
  const updated = await storage.updateKanbanTask(ctx.task.id, {
    description: summary,
    ...(wasDone ? {} : { status: "done", completedAt: new Date(), ...(ctx.task.startedAt ? {} : { startedAt: new Date() }) }),
  } as any);
  if (!wasDone) await onPathTaskDone(updated as any);
  return { work: row, answers: checked.answers, summary, route };
}

/**
 * Suggested answers for a step, from somewhere other than the builder typing
 * them — for now the business-history step, from the résumé on the asking
 * person's profile. Suggestions only: nothing is saved until they confirm.
 */
export async function prefillFor(projectId: string, taskId: string, userId: string) {
  const ctx = await pathTaskContext(projectId, taskId);
  if (!ctx?.milestone?.prefill) throw Object.assign(new Error("That step has nothing to fill in from."), { status: 400, code: "invalid_input" });
  const profile = await storage.getUserProfile(userId).catch(() => null);
  const experience = ((profile as any)?.experience ?? []) as ProfileExperience[];
  if (!(profile as any)?.resumeParsedAt && !experience.length) {
    return { source: "resume" as const, hasResume: false, answers: null, found: [] as string[] };
  }
  const read = businessHistoryFromResume(experience);
  return { source: "resume" as const, hasResume: true, answers: read?.answers ?? { owned: ["never"] }, found: read?.found ?? [] };
}

/** The latest tapped answers on each capital-profile step, for the score and Nova. */
export async function capitalAnswersFor(projectId: string): Promise<CapitalAnswers> {
  const tasks = await pathTasks(projectId);
  const out: CapitalAnswers = {};
  for (const [key, id] of Object.entries(CAPITAL_MILESTONES)) {
    if (key === "route") continue;
    const task = tasks.find((t) => backboneIdOf(t.tags) === id);
    const work = task ? await latestWork(task.id) : null;
    if (work?.payload.kind === "intake") (out as any)[key] = work.payload.answers;
  }
  return out;
}

export async function capitalProfileFor(projectId: string) {
  return capitalProfile(await capitalAnswersFor(projectId));
}

/** Every live task with a backbone, parent or injected tag — on every section, or on one when `goal` is given. */
async function pathTasks(projectId: string, goal?: ProjectGoal) {
  const rows = await db.select().from(projectKanbanTasks).where(eq(projectKanbanTasks.projectId, projectId));
  const live = rows.filter((t) => !isArchivedPath(t.tags) && (backboneIdOf(t.tags) || parentOf(t.tags) || injectedPhaseOf(t.tags)));
  if (!goal) return live;
  const [project] = await db.select({ goal: projects.goal }).from(projects).where(eq(projects.id, projectId));
  const primary = (project?.goal ?? goal) as ProjectGoal;
  return live.filter((t) => trackOfTask(t.tags, primary) === goal);
}

/**
 * Recalculates pace and writes it down. Called on every sign of effort
 * (a backbone task done, a check-in) and lazily on read, so absence decays
 * the date without anyone having to trigger it. With `effort` it also logs
 * the recalculation event the builder can scroll back through.
 */
export async function refreshPace(projectId: string, effort?: {
  taskId: string; backboneId: string | null; title: string; estimateMinutes: number | null; actualMinutes: number | null;
}, goalArg?: ProjectGoal | null) {
  // The section the effort was on (from the milestone id), else the one asked for, else the primary.
  const project = await trackState(projectId, goalOfBackboneId(effort?.backboneId) ?? goalArg ?? null);
  if (!project) return null;
  const goal = project.goal;
  const tree = treeFor(goal);
  const main = mainLineMilestones(resolveTree(goal, project.subcategory, project.capitalRoute));
  const mainIds = new Set(main.map((m) => m.id));
  const tasks = await pathTasks(projectId, goal);
  const plan = planShape(main, tasks);

  // Work carried across from another path counts toward progress, not pace:
  // it was done there, at that pace, and this path starts fresh.
  const carried = (t: { tags: string[] | null }) => !!t.tags?.some((x) => x.startsWith("carried:"));
  // Extending is activity: any path task counts, main line or branch.
  const completions = tasks
    .filter((t) => t.status === "done" && t.completedAt && !carried(t) && (backboneIdOf(t.tags) || parentOf(t.tags) || injectedPhaseOf(t.tags)))
    .map((t) => ({ at: new Date(t.completedAt!), estimateMinutes: minutesOf(t) }));
  const checkIns = await db.select({ at: projectCheckIns.createdAt }).from(projectCheckIns).where(eq(projectCheckIns.projectId, projectId));
  // Code evidence: an audit whose delta shows the code moved is a day of activity.
  const audits = await db.select({ at: projectCodeAudits.createdAt, delta: projectCodeAudits.delta }).from(projectCodeAudits).where(eq(projectCodeAudits.projectId, projectId));
  const codeActivity = audits.filter((a) => (a.delta as any)?.changed).map((a) => new Date(a.at));

  const totalMinutes = plan.totalMinutes;
  const doneMinutes = plan.doneMinutes;
  const [primaryPrev] = project.primary ? await db.select().from(pathPace).where(eq(pathPace.projectId, projectId)) : [];
  const trackPrev = !project.primary && project.pace ? project.pace as { projectedAt?: string | null; state?: string } : null;
  const prev = primaryPrev ?? (trackPrev ? { projectedAt: trackPrev.projectedAt ? new Date(trackPrev.projectedAt) : null, state: trackPrev.state } as any : undefined);

  // In market is a pipeline: once a milestone that puts the builder in front of funders is done.
  const inMarket = main.some((m) => m.inMarket && tasks.some((t) => t.status === "done" && backboneIdOf(t.tags) === m.id));

  const result = computePace({
    now: new Date(), createdAt: new Date(project.createdAt), completions,
    activityDates: [...checkIns.map((c) => new Date(c.at)), ...codeActivity],
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
  if (project.primary) await db.insert(pathPace).values({ projectId, ...row }).onConflictDoUpdate({ target: pathPace.projectId, set: row });
  else await db.update(projectTracks).set({ pace: row, updatedAt: new Date() }).where(and(eq(projectTracks.projectId, projectId), eq(projectTracks.goal, goal)));
  if (effort) {
    await db.insert(pathPaceEvents).values({
      projectId, taskId: effort.taskId, backboneId: effort.backboneId, title: effort.title,
      estimateMinutes: effort.estimateMinutes, actualMinutes: effort.actualMinutes,
      projectedBefore: prev?.projectedAt ?? null, projectedAfter: result.projectedAt,
    });
  }
  return { ...result, mode: result.mode, plan: { loops: plan.loops, productLoops: plan.productLoops, authoredDays: plan.authoredDays, totalMinutes, doneMinutes } };
}

/**
 * The plan's size, given the loops the builder is going for. A fan-out
 * milestone ("loop steps") is one authored estimate per loop until its
 * steps exist, then the sum of them; the month stretches a week per extra
 * product loop, because that is where the time actually goes.
 */
export function planShape(main: ResolvedMilestone[], tasks: { status: string; tags: string[] | null; estimateHours: number | null }[]) {
  const loopsBy = new Map<string, number>();
  const productBy = new Map<string, number>();
  const stepsBy = new Map<string, { total: number; done: number }>();
  for (const t of tasks) {
    const p = parentOf(t.tags);
    if (!p) continue;
    if (isLoop(t.tags)) {
      loopsBy.set(p, (loopsBy.get(p) ?? 0) + 1);
      if (loopTypeOf(t.tags) === "product") productBy.set(p, (productBy.get(p) ?? 0) + 1);
    }
    else {
      const cur = stepsBy.get(p) ?? { total: 0, done: 0 };
      cur.total += minutesOf(t); if (t.status === "done") cur.done += minutesOf(t);
      stepsBy.set(p, cur);
    }
  }
  const doneIds = new Set(tasks.filter((t) => t.status === "done").map((t) => backboneIdOf(t.tags)).filter(Boolean) as string[]);
  let totalMinutes = 0, doneMinutes = 0, loops = 1, productLoops = 1;
  for (const m of main) {
    const authored = m.estimateMinutes ?? 60;
    if (m.expandsFrom) {
      const n = Math.max(1, loopsBy.get(m.expandsFrom) ?? 1);
      loops = Math.max(loops, n);
      productLoops = Math.max(productLoops, productBy.get(m.expandsFrom) ?? 1);
      const steps = stepsBy.get(m.id);
      const size = steps?.total ? Math.max(steps.total, authored) : authored * n;
      totalMinutes += size;
      doneMinutes += doneIds.has(m.id) ? size : steps?.done ?? 0;
    } else {
      totalMinutes += authored;
      if (doneIds.has(m.id)) doneMinutes += authored;
    }
  }
  // The four business loops are what weeks 3 and 4 already budget for (pricing,
  // analytics, the first ten); each product loop past the first is its own week.
  return { loops, productLoops, totalMinutes, doneMinutes, authoredDays: 28 + 7 * (productLoops - 1) };
}

/** Called from the task board when a task on the path is finished. */
export async function onPathTaskDone(task: { id: string; projectId: string; title: string; tags: string[] | null; estimateHours: number | null; startedAt: Date | null; completedAt: Date | null; completedById?: string | null }) {
  if (isArchivedPath(task.tags)) return;
  const backboneId = backboneIdOf(task.tags) ?? parentOf(task.tags);
  if (!backboneId && !injectedPhaseOf(task.tags)) return;
  // The retention loop's way back: the rest of the team hears the path moved, and what's next.
  void afterPathStepDone(task);
  const started = task.startedAt ? new Date(task.startedAt).getTime() : null;
  const finished = task.completedAt ? new Date(task.completedAt).getTime() : Date.now();
  const actual = started && finished - started > 60_000 ? Math.round((finished - started) / 60_000) : null;
  const [owner] = await db.select({ goal: projects.goal }).from(projects).where(eq(projects.id, task.projectId));
  await refreshPace(task.projectId, {
    taskId: task.id, backboneId, title: task.title,
    estimateMinutes: task.estimateHours ? task.estimateHours * 60 : null, actualMinutes: actual,
  }, owner ? trackOfTask(task.tags, owner.goal as ProjectGoal) : null);
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
      tags: [`parent:${backboneId}`, ...(loopTaskId ? [`loop:${loopTaskId}`] : []), ...(parent.tags ?? []).filter((t) => t.startsWith("actor:") || t.startsWith("tier:") || t.startsWith("track:"))],
      estimateHours: Math.min(3, Math.max(1, Math.ceil(Number(step.estimateHours) || 1))),
    } as any));
  }
  return { created, existing };
}

/**
 * What a fan-out milestone would expand from, resolved.
 *
 * Fiddly enough to be worth having once. "One per step of the core loop"
 * doesn't know how many steps there are until an earlier milestone has been
 * answered, so expanding means finding that answer: either a loop's own
 * write-up, or the source milestone's — and distinguishing a real answer from
 * the authored placeholder still sitting in the description, which is the part
 * that gets got wrong.
 *
 * Returns `written: ""` when there's nothing to expand from yet. That isn't an
 * error; it's the branch where Nova offers to draft it.
 */
export async function expansionSource(
  projectId: string,
  backboneId: string,
  opts: { loopTaskId?: string | null; artifact?: string } = {},
) {
  const project = await trackState(projectId, await goalFor(projectId, { backboneId }));
  if (!project) throw Object.assign(new Error("That milestone isn't on this project's path."), { code: "not_on_path", status: 400 });

  const all = resolveTree(project.goal, project.subcategory, project.capitalRoute).flatMap((p) => p.milestones);
  const milestone = all.find((m) => m.id === backboneId);
  if (!milestone?.expandsFrom) {
    throw Object.assign(new Error("That milestone doesn't break into steps."), { code: "not_expandable", status: 400 });
  }

  const tasks = await pathTasks(projectId);
  const loopTaskId = opts.loopTaskId || null;
  const source = loopTaskId
    ? tasks.find((t) => t.id === loopTaskId && isLoop(t.tags))
    : tasks.find((t) => backboneIdOf(t.tags) === milestone.expandsFrom);
  if (loopTaskId && !source) {
    throw Object.assign(new Error("That loop isn't on this project."), { code: "not_on_path", status: 400 });
  }

  // Without a loop, the answer is whatever has replaced the authored text on
  // the source milestone's task. Still equal to the authored text means
  // nobody has answered it, however long the description is.
  const authored = loopTaskId ? null : all.find((m) => m.id === milestone.expandsFrom) ?? null;
  const supplied = typeof opts.artifact === "string" ? opts.artifact.trim() : "";
  const written = supplied
    ? supplied
    : source?.description && source.description.trim() !== authoredTextFor(authored, source.description)
    ? source.description.trim()
    : "";

  return {
    milestone,
    source: source ?? null,
    authored,
    written,
    sourceTitle: loopTaskId ? source!.title : authored?.title ?? "that milestone",
  };
}

/**
 * Another loop. A business runs on five kinds — growth, retention, revenue,
 * referral and product — and may have several product loops. Each is written
 * down on its own, then broken into its own steps. Loops hang off the source
 * milestone (the core loop), so that milestone is done when all five kinds
 * are there and every loop is written.
 */
export async function createLoop(projectId: string, sourceBackboneId: string, loop: { title: string; description?: string; type?: unknown }) {
  const tasks = await pathTasks(projectId);
  const source = tasks.find((t) => backboneIdOf(t.tags) === sourceBackboneId);
  if (!source) throw Object.assign(new Error("That milestone isn't on this project's path."), { code: "not_on_path", status: 400 });
  const title = String(loop.title ?? "").trim();
  if (!title) throw Object.assign(new Error("Give the loop a name."), { code: "invalid_input", field: "title", status: 400 });
  if (loop.type != null && !isLoopType(loop.type)) {
    throw Object.assign(new Error(`A loop is one of: ${LOOP_TYPES.join(", ")}.`), { code: "invalid_input", field: "type", status: 400 });
  }
  const type: LoopType = isLoopType(loop.type) ? loop.type : "product";
  const siblings = tasks.filter((t) => parentOf(t.tags) === sourceBackboneId && isLoop(t.tags));
  const refusal = loopTypeRefusal(siblings.map((t) => ({ type: loopTypeOf(t.tags) })), type);
  if (refusal) throw Object.assign(new Error(refusal.message), { code: refusal.code, status: 409 });
  // Only now is the name safe to take off the rejected list: a refused loop leaves it there.
  await db.update(projects).set({ rejectedLoops: sql`array_remove(${projects.rejectedLoops}, ${title})` }).where(eq(projects.id, projectId));
  return storage.createKanbanTask({
    projectId, milestoneId: source.milestoneId, title, description: String(loop.description ?? "").trim(),
    status: "todo", priority: "medium", order: (source.order ?? 0) + siblings.length + 1,
    tags: [`parent:${sourceBackboneId}`, "kind:loop", loopTypeTag(type), ...(source.tags ?? []).filter((t) => t.startsWith("actor:") || t.startsWith("tier:") || t.startsWith("track:"))],
    estimateHours: 1,
  } as any);
}

/** Saying what kind of loop an existing one is. The same limits as creating it. */
export async function setLoopType(projectId: string, loopTaskId: string, type: unknown) {
  if (!isLoopType(type)) throw Object.assign(new Error(`A loop is one of: ${LOOP_TYPES.join(", ")}.`), { code: "invalid_input", field: "type", status: 400 });
  const tasks = await pathTasks(projectId);
  const loop = tasks.find((t) => t.id === loopTaskId && isLoop(t.tags));
  if (!loop) throw Object.assign(new Error("That loop isn't on this project."), { code: "not_on_path", status: 404 });
  if (loopTypeOf(loop.tags) === type) return loop;
  const source = parentOf(loop.tags);
  const others = tasks.filter((t) => t.id !== loop.id && parentOf(t.tags) === source && isLoop(t.tags));
  const lastOfItsKind = !others.some((t) => loopTypeOf(t.tags) === loopTypeOf(loop.tags));
  if (lastOfItsKind) throw lastLoopRefusal(loopTypeOf(loop.tags));
  // Checked against the others: retyping doesn't add a loop, so the overall cap can't trip.
  const refusal = loopTypeRefusal(others.map((t) => ({ type: loopTypeOf(t.tags) })), type);
  if (refusal) throw Object.assign(new Error(refusal.message), { code: refusal.code, status: 409 });
  return storage.updateKanbanTask(loop.id, { tags: [...(loop.tags ?? []).filter((t) => !t.startsWith("loop-type:")), loopTypeTag(type)] } as any);
}

const lastLoopRefusal = (type: LoopType) => Object.assign(
  new Error(`Every business needs a ${LOOP_TYPE_INFO[type].label.toLowerCase()}, and this is the only one. Rewrite it instead of removing it.`),
  { code: "loop_required", status: 409 },
);

/**
 * The loops Nova found on re-evaluation. Each comes with its kind: one that
 * fits an empty slot of that kind (the "Growth loop" a new project starts
 * with) fills it; a new product loop is created; a kind already written stays
 * as the builder wrote it. Existing loops are matched by name, never
 * duplicated, never overwritten.
 */
export async function reconcileLoops(projectId: string, foundRaw: { title: string; steps: string; state: "built" | "partly" | "planned"; evidence: string; type?: LoopType }[], sourceBackboneId = "SHIP.M1.2") {
  const found = splitMergedPaths(foundRaw);
  const tasks = await pathTasks(projectId);
  const source = tasks.find((t) => backboneIdOf(t.tags) === sourceBackboneId);
  if (!source) return { created: [], updated: [] };
  const norm = (x: string) => x.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const existing = tasks.filter((t) => parentOf(t.tags) === sourceBackboneId && isLoop(t.tags));
  const [proj] = await db.select({ rejected: projects.rejectedLoops }).from(projects).where(eq(projects.id, projectId));
  const rejected = (proj?.rejected ?? []).map(norm);
  // A removed loop stays removed under a new name: "post a weekly check-in and
  // get feedback" and "ship weekly check-ins on a project" share most of their
  // words, and that is the test — not the exact title.
  const isRejected = (title: string) => rejected.some((r) => r && loopsAlike(r, norm(title)));
  const created: string[] = [];
  const updated: string[] = [];
  const filled = new Set<string>();
  const markBuilt = (t: { id: string; tags: string[] | null }) =>
    storage.updateKanbanTask(t.id, { status: "done", completedAt: new Date(), tags: [...(t.tags ?? []), "carried:reconciled"] } as any);
  for (const f of found) {
    if (isRejected(f.title)) continue;
    const type: LoopType = f.type ?? "product";
    const match = existing.find((e) => !filled.has(e.id) && (norm(e.title) === norm(f.title) || norm(e.title).includes(norm(f.title)) || norm(f.title).includes(norm(e.title))));
    if (match) {
      if (!match.description?.trim() && f.steps) { await storage.updateKanbanTask(match.id, { description: f.steps } as any); updated.push(match.id); }
      if (match.status !== "done" && f.state === "built") { await markBuilt(match); updated.push(match.id); }
      filled.add(match.id);
      continue;
    }
    // An empty slot of this kind — nothing written, nothing built — is this loop's place.
    const slot = existing.find((e) => !filled.has(e.id) && loopTypeOf(e.tags) === type && !e.description?.trim() && e.status !== "done");
    if (slot) {
      await storage.updateKanbanTask(slot.id, { title: f.title, description: f.steps } as any);
      if (f.state === "built") await markBuilt(slot);
      filled.add(slot.id); updated.push(slot.id);
      continue;
    }
    if (loopTypeRefusal(existing.map((e) => ({ type: loopTypeOf(e.tags) })), type)) continue;
    const loop = await createLoop(projectId, sourceBackboneId, { title: f.title, description: f.steps, type });
    if (f.state === "built") await markBuilt(loop);
    existing.push(loop as any); filled.add(loop.id);
    created.push(loop.id);
  }
  if (created.length || updated.length) await refreshPace(projectId);
  return { created, updated };
}

export interface LoopDraft { type?: unknown; title?: unknown; steps?: unknown; closes?: unknown; loopTaskId?: string | null }

/**
 * Nova writing loops for the builder, because they asked it to — from the
 * loop tree's "Nova writes it", or from Nova chat. Each draft lands on an
 * unwritten loop of its kind (the one named, if one is), or becomes a new
 * loop when that kind isn't on the tree yet. A written loop is never
 * overwritten: that's the builder's, and rewriting it is their call. What
 * Nova wrote is marked done and tagged, so it reads as Nova's and reopens
 * like anything else.
 */
export async function applyLoopDrafts(projectId: string, drafts: LoopDraft[], opts: { only?: string[] | null } = {}) {
  // Loops are the Ship section's; a project without one works its primary path's.
  const project = (await trackState(projectId, "ship_mvp")) ?? (await trackState(projectId));
  if (!project) throw Object.assign(new Error("Project not found"), { status: 404 });
  const sourceId = loopSourcesOf(resolveTree(project.goal, project.subcategory, project.capitalRoute))[0];
  if (!sourceId) throw Object.assign(new Error("This path doesn't work in loops."), { code: "not_expandable", status: 400 });
  const tasks = await pathTasks(projectId);
  const loops = tasks.filter((t) => isLoop(t.tags) && parentOf(t.tags) === sourceId);
  const unwritten = (t: typeof loops[number]) => t.status !== "done" && !t.description?.trim();
  const only = opts.only?.length ? new Set(opts.only) : null;
  const used = new Set<string>();
  const written: string[] = [], created: string[] = [];
  const skipped: { title: string; reason: string }[] = [];

  for (const d of drafts.slice(0, LOOP_TYPES.length + 4)) {
    const title = String(d.title ?? "").trim().slice(0, 80);
    const steps = String(d.steps ?? "").trim().slice(0, 2000);
    if (!isLoopType(d.type) || !steps) { skipped.push({ title: title || "(untitled)", reason: "no kind or no steps" }); continue; }
    const type = d.type;
    const closes = String(d.closes ?? "").trim().slice(0, 400);
    const description = closes ? `${steps}\n\nCloses when: ${closes}` : steps;
    const open = (t: typeof loops[number]) => !used.has(t.id) && unwritten(t) && (!only || only.has(t.id));
    const target = (d.loopTaskId ? loops.find((t) => t.id === d.loopTaskId && open(t)) : null)
      ?? loops.find((t) => open(t) && loopTypeOf(t.tags) === type);
    if (target) {
      used.add(target.id);
      // The kind's placeholder name gives way to Nova's; a name the builder chose stays.
      const placeholder = target.title.trim() === LOOP_TYPE_INFO[loopTypeOf(target.tags)].label;
      await storage.updateKanbanTask(target.id, {
        ...(placeholder && title ? { title } : {}), description, status: "done", completedAt: new Date(),
        tags: [...(target.tags ?? []).filter((x) => x !== "drafted:nova"), "drafted:nova"],
      } as any);
      written.push(target.id);
      continue;
    }
    if (only) { skipped.push({ title, reason: "not one of the loops asked for" }); continue; }
    const refusal = loopTypeRefusal(loops.map((t) => ({ type: loopTypeOf(t.tags) })), type);
    if (refusal) { skipped.push({ title, reason: refusal.code === "loop_type_taken" ? `the ${LOOP_TYPE_INFO[type].label.toLowerCase()} is already written` : refusal.message }); continue; }
    const loop = await createLoop(projectId, sourceId, { title: title || LOOP_TYPE_INFO[type].label, description, type });
    const done = await storage.updateKanbanTask(loop.id, { status: "done", completedAt: new Date(), tags: [...(loop.tags ?? []), "drafted:nova"] } as any);
    loops.push((done ?? loop) as any); used.add(loop.id);
    created.push(loop.id);
  }
  if (written.length || created.length) await refreshPace(projectId);
  return { written, created, skipped };
}

/**
 * Removing a loop that isn't one. Its unfinished steps go with it; finished
 * steps stay on the board as work that happened, just no longer filed
 * under a loop. The last loop of a kind can't go — every business has one of
 * each — so the answer to a wrong growth loop is rewriting it.
 */
export async function deleteLoop(projectId: string, loopTaskId: string) {
  const tasks = await pathTasks(projectId);
  const loop = tasks.find((t) => t.id === loopTaskId && isLoop(t.tags));
  if (!loop) throw Object.assign(new Error("That loop isn't on this project."), { code: "not_on_path", status: 404 });
  const type = loopTypeOf(loop.tags);
  if (!tasks.some((t) => t.id !== loop.id && isLoop(t.tags) && parentOf(t.tags) === parentOf(loop.tags) && loopTypeOf(t.tags) === type)) throw lastLoopRefusal(type);
  const steps = tasks.filter((t) => loopOf(t.tags) === loopTaskId);
  let removed = 0, kept = 0;
  for (const s of steps) {
    if (s.status === "done") { await storage.updateKanbanTask(s.id, { tags: (s.tags ?? []).filter((x) => x !== `loop:${loopTaskId}`) } as any); kept++; }
    else { await storage.deleteKanbanTask(s.id); removed++; }
  }
  await storage.deleteKanbanTask(loop.id);
  // Removing a loop is the builder saying "not this one" — remembered, so the next read doesn't propose it again.
  await db.update(projects).set({ rejectedLoops: sql`array_append(array_remove(${projects.rejectedLoops}, ${loop.title}), ${loop.title})` }).where(eq(projects.id, projectId));
  await refreshPace(projectId, undefined, goalOfBackboneId(parentOf(loop.tags)));
  return { removedSteps: removed, keptSteps: kept };
}

/**
 * Entering or leaving an optional phase. Nine builders in ten want to keep
 * building after week 2; choosing it is what makes Nova work the extension
 * instead of asking week-3 questions. Leaving is the same explicit act.
 */
export async function setBranch(projectId: string, phaseId: string | null, goal?: ProjectGoal | null) {
  const project = await trackState(projectId, goal);
  if (!project) throw Object.assign(new Error("Project not found"), { status: 404 });
  if (phaseId) {
    const phase = resolveTree(project.goal, project.subcategory, project.capitalRoute).find((p) => p.id === phaseId);
    if (!phase?.optional) throw Object.assign(new Error("That isn't an optional phase on this path."), { code: "not_on_path", status: 400 });
  }
  await setTrackFields(projectId, project.goal, { activeBranch: phaseId });
  return { activeBranch: phaseId };
}

/** Extending again: the branch's own tasks reopen for another round, with the round recorded. */
export async function extendBranch(projectId: string, phaseId: string, goal?: ProjectGoal | null) {
  const project = await trackState(projectId, goal);
  if (!project) throw Object.assign(new Error("Project not found"), { status: 404 });
  const phase = resolveTree(project.goal, project.subcategory, project.capitalRoute).find((p) => p.id === phaseId);
  if (!phase?.optional) throw Object.assign(new Error("That isn't an optional phase on this path."), { code: "not_on_path", status: 400 });
  const tasks = await pathTasks(projectId, project.goal);
  const ids = new Set(phase.milestones.map((m) => m.id));
  let round = 1;
  for (const t of tasks.filter((t) => ids.has(backboneIdOf(t.tags) ?? ""))) {
    round = Math.max(round, Number(tagValue(t.tags, "round:") ?? 1) + (t.status === "done" ? 1 : 0));
  }
  for (const t of tasks.filter((t) => ids.has(backboneIdOf(t.tags) ?? "") && t.status === "done")) {
    await storage.updateKanbanTask(t.id, { status: "todo", tags: [...(t.tags ?? []).filter((x) => !x.startsWith("round:")), `round:${round}`] } as any);
  }
  await setTrackFields(projectId, project.goal, { activeBranch: phaseId });
  return { activeBranch: phaseId, round };
}

/**
 * Marks backbone milestones done on evidence that predates the path: a
 * project's existing tasks, audits and check-ins, read by Nova, or the
 * builder saying so. Counted as progress, not as pace — the work happened
 * before the path was watching.
 */
export async function reconcileMilestones(projectId: string, done: { id: string; evidence: string; answer?: string }[], source: "nova" | "builder") {
  // Milestone ids name their section, so one call can mark across sections.
  const milestones = new Map<string, ResolvedMilestone>();
  for (const g of new Set(done.map((d) => goalOfBackboneId(d.id)).filter(Boolean) as ProjectGoal[])) {
    const state = await trackState(projectId, g);
    if (state) for (const m of resolveTree(g, state.subcategory, state.capitalRoute).flatMap((p) => p.milestones)) milestones.set(m.id, m);
  }
  const tasks = await pathTasks(projectId);
  const marked: string[] = [];
  const filled: string[] = [];
  for (const d of done) {
    const t = tasks.find((x) => backboneIdOf(x.tags) === d.id);
    if (!t) continue;
    const written = (t.description ?? "").trim();
    const authored = authoredTextFor(milestones.get(d.id), written);
    // "Written" means something beyond the authored text and beyond a bare recognition note.
    const hasAnswer = written && written !== authored && !/^(.*\n\n)?(Nova recognised this as already done|Marked done by you): /s.test(written.replace(authored, "").trim());
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
  for (const g of new Set(marked.map((id) => goalOfBackboneId(id)).filter(Boolean) as ProjectGoal[])) await refreshPace(projectId, undefined, g);
  return { marked, filled };
}

/** The task a work request is about, with its actor and tier read off the path. */
export async function pathTaskContext(projectId: string, taskId: string) {
  const task = (await pathTasks(projectId)).find((t) => t.id === taskId);
  if (!task) return null;
  const [owner] = await db.select({ goal: projects.goal }).from(projects).where(eq(projects.id, projectId));
  if (!owner) return null;
  // The task's own section: its tree, kind and route, whichever section is primary.
  const project = await trackState(projectId, trackOfTask(task.tags, owner.goal as ProjectGoal));
  if (!project) return null;
  const backbone = resolveTree(project.goal, project.subcategory, project.capitalRoute).flatMap((p) => p.milestones);
  const milestone = backbone.find((m) => m.id === (backboneIdOf(task.tags) ?? parentOf(task.tags)));
  const actor = (tagValue(task.tags, "actor:") ?? milestone?.actor ?? "nova-builds") as Actor;
  const tier = tagValue(task.tags, "tier:") ?? milestone?.tier ?? "artifact";
  return { task, project, milestone, actor, tier };
}

export async function latestWork(taskId: string) {
  const [row] = await db.select().from(pathWork).where(and(eq(pathWork.taskId, taskId), ne(pathWork.kind, "loop-audit"))).orderBy(desc(pathWork.createdAt)).limit(1);
  // Every screen reads packets through here or saveWork, so this is where an
  // older packet gets its run steps as blocks — derived on read, never rewritten.
  return row ? { ...row, payload: withRunGroups(row.payload as WorkPayload) } : null;
}

/** Nova's latest competitive read of the loops, kept on the core-loop task. */
export async function latestLoopAudit(sourceTaskId: string | null) {
  if (!sourceTaskId) return null;
  const [row] = await db.select().from(pathWork).where(and(eq(pathWork.taskId, sourceTaskId), eq(pathWork.kind, "loop-audit"))).orderBy(desc(pathWork.createdAt)).limit(1);
  return row ? { id: row.id, createdAt: row.createdAt, audit: row.payload as LoopCompetitiveAudit } : null;
}

export async function saveLoopAudit(projectId: string, sourceTaskId: string, audit: LoopCompetitiveAudit) {
  const [row] = await db.insert(pathWork).values({ projectId, taskId: sourceTaskId, kind: "loop-audit", payload: audit }).returning();
  return { id: row.id, createdAt: row.createdAt, audit: row.payload as LoopCompetitiveAudit };
}

/**
 * The loops as Nova reads them, for either audit: in display order, each with
 * a short key (L1, L2…) the model answers by, so a reworded title can't
 * attach a verdict to the wrong loop.
 */
export async function loopsForAudit(projectId: string) {
  // The product's loops live on the Ship section; a project without one reads its primary path's.
  const project = (await trackState(projectId, "ship_mvp")) ?? (await trackState(projectId));
  if (!project) return null;
  const phases = resolveTree(project.goal, project.subcategory, project.capitalRoute);
  const sourceId = loopSourcesOf(phases)[0];
  if (!sourceId) return null;
  const fanOutId = phases.flatMap((p) => p.milestones).find((m) => m.expandsFrom === sourceId)?.id;
  const tasks = await pathTasks(projectId);
  const sourceTask = tasks.find((t) => backboneIdOf(t.tags) === sourceId) ?? null;
  const loops = tasks.filter((t) => isLoop(t.tags) && parentOf(t.tags) === sourceId)
    .map((t) => ({ taskId: t.id, title: t.title, description: (t.description ?? "").trim(), type: loopTypeOf(t.tags), status: t.status }))
    .sort(byLoopOrder)
    .map((l, i) => ({
      ...l, key: `L${i + 1}`,
      steps: tasks.filter((t) => parentOf(t.tags) === fanOutId && loopOf(t.tags) === l.taskId).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map((t) => ({ title: t.title, status: t.status })),
    }));
  const coverage = loopCoverage(loops.map((l) => ({ type: l.type, written: l.status === "done" || !!l.description })));
  return { sourceId, sourceTask, loops, coverage };
}

/**
 * What the latest codebase audit did to the project, for the dashboard: what
 * it changed on its own, and what's waiting — loop changes above all, since a
 * change of direction is the builder's to accept. Only a recent audit; an old
 * one is history, not news.
 */
export function auditUpdateOf(audit: { id: string; createdAt: Date; findings: unknown; operations: unknown } | undefined, now = new Date()) {
  if (!audit || now.getTime() - new Date(audit.createdAt).getTime() > 14 * 86_400_000) return null;
  const catchUp = (audit.findings as any)?.catchUp;
  if (!catchUp) return null;
  const pending = ((audit.operations as any[]) ?? []).filter((o) => !o?._status || o._status === "pending");
  const applied: string[] = catchUp.applied ?? [];
  if (!applied.length && !pending.length) return null;
  return {
    auditId: audit.id, at: audit.createdAt,
    applied: applied.slice(0, 6), appliedCount: applied.length,
    pendingCount: pending.length,
    pendingLoops: pending.filter((o) => o._section === "loops").map((o) => describeOp(o)).slice(0, 4),
  };
}

/**
 * Where the project is on its path, for the audit to keep it true: the phase
 * and the next action, every main-line milestone still open (by id, for
 * complete_path_milestone), each loop with its build steps (by id, for
 * update_task and add_loop_steps), and the loops the builder removed.
 */
export async function renderPathForAudit(projectId: string): Promise<string | null> {
  const status = await pathStatus(projectId);
  if (!status?.adopted) return null;
  const open = status.phases.filter((p) => !p.optional).flatMap((p) => p.milestones.filter((m) => !m.done).map((m) => `- ${m.id} — ${m.title}`));
  const tree = status.loopTree;
  const loops = tree?.loops.map((l) => [
    `- id=${l.taskId} ${LOOP_TYPE_INFO[l.type].label} "${l.title}" [${l.state}]`,
    ...l.steps.map((st) => `    step id=${st.taskId} [${st.status}] ${st.title}`),
  ].join("\n")) ?? [];
  return [
    `THE PATH — ${status.promise} (${status.target})`,
    `Now: ${status.current.title}, step ${status.current.step} of ${status.current.of}. Next: ${status.next ? `${status.next.id} — ${status.next.title}` : "the main line is done"}. ${status.mainLine.done}/${status.mainLine.total} main-line milestones done.`,
    open.length ? `Open milestones:\n${open.join("\n")}` : "Every main-line milestone is done.",
    loops.length ? `Loops and their build steps (fan-out ${tree!.fanOutId}):\n${loops.join("\n")}` : null,
    status.rejectedLoops.length ? `REMOVED BY THE BUILDER — not loops, never propose them again in any wording: ${status.rejectedLoops.join("; ")}` : null,
  ].filter(Boolean).join("\n");
}

/** The loops as prompt lines, with their kind and what closing that kind means. */
export function renderLoopsForPrompt(loops: NonNullable<Awaited<ReturnType<typeof loopsForAudit>>>["loops"]) {
  return loops.map((l) => [
    `[${l.key}] ${LOOP_TYPE_INFO[l.type].label}: "${l.title}"`,
    `  Written as: ${l.description || "(not written yet)"}`,
    l.steps.length ? `  Build steps: ${l.steps.map((s) => `${s.title}${s.status === "done" ? " (done)" : ""}`).join("; ")}` : null,
    `  Closes when: ${LOOP_TYPE_INFO[l.type].closes}`,
  ].filter(Boolean).join("\n")).join("\n");
}

export async function saveWork(projectId: string, taskId: string, payload: WorkPayload) {
  const [row] = await db.insert(pathWork).values({ projectId, taskId, kind: payload.kind, payload }).returning();
  return { ...row, payload: withRunGroups(row.payload as WorkPayload) };
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
  } else if (payload.kind === "plan") {
    if (!answer) answer = renderPlanAnswer(payload);
  } else if (payload.kind === "intake") {
    if (!answer) answer = payload.summary;
  } else if (!answer) {
    answer = payload.template;
  }
  await db.update(pathWork).set({ chosenIndex: index }).where(eq(pathWork.id, row.id));
  const task = await storage.getKanbanTask(row.taskId);
  if (!task) throw Object.assign(new Error("Task not found"), { status: 404 });
  const updates: any = { description: answer };
  // A loop still wearing its kind's placeholder name takes the name of the option picked.
  if (isLoop(task.tags) && payload.kind === "options" && index != null && payload.options[index]?.title
    && task.title.trim() === LOOP_TYPE_INFO[loopTypeOf(task.tags)].label) updates.title = payload.options[index].title;
  if (choice.done !== false) { updates.status = "done"; updates.completedAt = new Date(); if (!task.startedAt) updates.startedAt = new Date(); }
  const updated = await storage.updateKanbanTask(row.taskId, updates);
  if (updates.status === "done") await onPathTaskDone(updated as any);
  return { task: updated, answer };
}

/** How a task came to be done, read off its tags — so the map can say so. */
export function howDone(t: { status: string; tags: string[] | null }): "not-done" | "verified" | "nova-recognised" | "you-marked" | "carried" | "done" {
  if (t.status !== "done") return "not-done";
  if (t.tags?.some((x) => x.startsWith("verified:"))) return "verified";
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
  const project = await trackState(projectId, await goalFor(projectId, { backboneId }));
  if (!project) return null;
  const phases = resolveTree(project.goal, project.subcategory, project.capitalRoute);
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
  for (const k of kids.filter((t) => isLoop(t.tags))) loops.push({ ...(await describe(k, "")), type: loopTypeOf(k.tags) });
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
    task: task ? await describe(task, authoredTextFor(milestone, task.description)) : null,
    loops,
    sourceLoops,
    steps,
  };
}

/** The artifacts Nova may ground an injected task in: written answers, check-ins, decisions. */
export async function collectArtifacts(projectId: string): Promise<Artifact[]> {
  const goal = await trackState(projectId);
  if (!goal) return [];
  const backbone = new Map<string, ResolvedMilestone>();
  for (const g of PROJECT_GOALS) {
    const state = await trackState(projectId, g.id);
    if (state) for (const m of resolveTree(g.id, state.subcategory, state.capitalRoute).flatMap((p) => p.milestones)) backbone.set(m.id, m);
  }
  const out: Artifact[] = [];
  for (const t of await pathTasks(projectId)) {
    const id = backboneIdOf(t.tags);
    const authored = id ? authoredTextFor(backbone.get(id), t.description) : "";
    // An answer exists when the description is no longer the authored text.
    if (id && t.status === "done" && t.description && t.description.trim() !== authored) {
      out.push({ label: `milestone:${id}`, kind: "milestone", text: `${t.title}: ${t.description.slice(0, 600)}` });
    }
  }
  // On the funding path, the scored profile and chosen route: what every funding plan is built on.
  const funding = await trackState(projectId, "raise_funding");
  if (funding) {
    const profile = await capitalProfileFor(projectId);
    if (profile.answered > 0) out.push({ label: "capital-profile", kind: "milestone", text: renderCapitalProfile(profile).slice(0, 2000) });
    if (funding.capitalRoute) out.push({ label: "capital-route", kind: "milestone", text: `Chosen route: ${CAPITAL_ROUTES.find((r) => r.id === funding.capitalRoute)?.label ?? funding.capitalRoute}` });
  }
  const checkIns = await storage.getProjectCheckIns(projectId).catch(() => []);
  for (const c of checkIns.slice(0, 4)) out.push({ label: `check-in:${c.id}`, kind: "check-in", text: `Goal: ${c.goal}. Proof: ${c.proof}. Next: ${c.nextStep ?? ""}`.slice(0, 600) });
  const decisions = await storage.getProjectDecisions(projectId).catch(() => []);
  for (const d of decisions.slice(0, 4)) out.push({ label: `decision:${d.id}`, kind: "decision", text: `${(d as any).title ?? ""}: ${(d as any).description ?? (d as any).rationale ?? ""}`.slice(0, 600) });
  return out;
}

/** Layer 3b: injected tasks for a phase, capped and grounded. Admission is the pure rule; this writes what passed. */
export async function createInjections(projectId: string, phaseId: string, proposals: InjectionProposal[], artifacts: Artifact[], goal?: ProjectGoal | null) {
  const project = await trackState(projectId, goal);
  if (!project) throw Object.assign(new Error("Project not found"), { status: 404 });
  const phase = resolveTree(project.goal, project.subcategory, project.capitalRoute).find((p) => p.id === phaseId);
  if (!phase) throw Object.assign(new Error("That phase isn't on this path."), { code: "not_on_path", status: 400 });
  const tasks = await pathTasks(projectId, project.goal);
  const existing = tasks.filter((t) => injectedPhaseOf(t.tags) === phaseId).length;
  const { admitted, dropped } = admitInjections(proposals, artifacts, existing);
  const anchor = tasks.find((t) => backboneIdOf(t.tags) === phase.milestones[phase.milestones.length - 1]?.id);
  const created = [];
  for (const a of admitted) {
    created.push(await storage.createKanbanTask({
      projectId, milestoneId: anchor?.milestoneId ?? null, title: a.title,
      description: `${a.description}\n\nNova added this from: ${a.artifact}`,
      status: "todo", priority: "medium", order: (anchor?.order ?? 0) + 1,
      tags: [`injected:${phaseId}`, `track:${project.goal}`, `artifact:${a.artifact}`, "actor:nova-builds", "tier:artifact"],
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
  const [project] = await db.select({ goal: projects.goal, subcategory: projects.subcategory, capitalRoute: projects.capitalRoute }).from(projects).where(eq(projects.id, projectId));
  if (!project) throw Object.assign(new Error("Project not found"), { status: 404 });
  const from = { goal: project.goal as ProjectGoal, subcategory: project.subcategory };

  const old = await pathTasks(projectId, from.goal);
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
  // A section already started becomes the primary: its route and branch move onto the project row, and its row goes.
  const [asTrack] = goal !== from.goal ? await db.select().from(projectTracks).where(and(eq(projectTracks.projectId, projectId), eq(projectTracks.goal, goal))) : [];
  if (asTrack) await db.delete(projectTracks).where(eq(projectTracks.id, asTrack.id));
  const keepsTrack = !!asTrack && asTrack.subcategory === subcategory;
  await db.update(projects).set({ goal, subcategory, capitalRoute: keepsTrack ? asTrack.capitalRoute : null, activeBranch: keepsTrack ? asTrack.activeBranch : null }).where(eq(projects.id, projectId));
  if (asTrack && !keepsTrack) {
    const stale = await pathTasks(projectId, goal);
    if (stale.length) await db.update(projectKanbanTasks).set({ tags: sql`array_append(${projectKanbanTasks.tags}, ${"archived:" + goal})` }).where(inArray(projectKanbanTasks.id, stale.map((t) => t.id)));
  }

  const result = await instantiatePathTree(projectId, goal, subcategory);

  let carriedCount = 0;
  const fromLabel = PROJECT_GOALS.find((g) => g.id === from.goal)?.label ?? from.goal;
  for (const t of await pathTasks(projectId, goal)) {
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
export async function pathStatus(projectId: string, goalArg?: ProjectGoal | null) {
  const [row] = await db.select({ novaNotes: projects.novaNotes, rejectedLoops: projects.rejectedLoops }).from(projects).where(eq(projects.id, projectId));
  if (!row) return null;
  const state = await trackState(projectId, goalArg);
  if (!state) {
    // A section the project hasn't started: what it would be, so the manager can offer to start it.
    const g = goalArg as ProjectGoal;
    return { adopted: false as const, started: false as const, goal: g, subcategory: null, promise: treeFor(g).promise, existingTasks: 0, existingDone: 0 };
  }
  const project = { ...state, novaNotes: row.novaNotes, rejectedLoops: row.rejectedLoops };

  const goal = project.goal;
  const phases = resolveTree(goal, project.subcategory, project.capitalRoute);
  const tree = treeFor(goal);
  await syncPathTree(projectId, goal, project.subcategory, project.capitalRoute);
  const tasks = await pathTasks(projectId, goal);
  if (tasks.length === 0) {
    // Made before paths existed. The dashboard offers adoption rather than
    // pretending a project with fifty finished tasks is on week 1, step 1.
    const all = await storage.getProjectKanbanTasks(projectId).catch(() => []);
    return { adopted: false as const, started: true as const, goal, subcategory: project.subcategory, promise: tree.promise, existingTasks: all.length, existingDone: all.filter((t) => t.status === "done").length };
  }

  const taskByBackbone = new Map<string, typeof tasks[number]>();
  const children = new Map<string, typeof tasks>();
  const injected = new Map<string, typeof tasks>();
  for (const t of tasks) {
    const b = backboneIdOf(t.tags); if (b) taskByBackbone.set(b, t);
    const p = parentOf(t.tags); if (p) children.set(p, [...(children.get(p) ?? []), t]);
    const i = injectedPhaseOf(t.tags); if (i) injected.set(i, [...(injected.get(i) ?? []), t]);
  }
  // Rows come back in whatever order the table holds them; loops and steps read in the order they were placed.
  for (const kids of children.values()) kids.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const loopSources = new Set(loopSourcesOf(phases));
  const isDone = (id: string) => {
    const own = taskByBackbone.get(id)?.status === "done";
    const kids = children.get(id);
    // Loops and steps: a source milestone is done when all five kinds of loop
    // are there and every loop is written; a fan-out milestone when every step
    // of every loop is done.
    if (loopSources.has(id) && kids?.some((k) => isLoop(k.tags))) {
      return kids.every((k) => k.status === "done") && loopCoverage(kids.filter((k) => isLoop(k.tags)).map((k) => ({ type: loopTypeOf(k.tags), written: true }))).complete;
    }
    return own || (!!kids?.length && kids.every((k) => k.status === "done"));
  };
  const loopsOf = (id: string) => (children.get(id) ?? []).filter((k) => isLoop(k.tags)).map((k) => ({
    taskId: k.id, title: k.title, description: k.description ?? "", status: k.status, type: loopTypeOf(k.tags),
  })).sort(byLoopOrder);
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
  const [latestAudit] = await db.select({ id: projectCodeAudits.id, createdAt: projectCodeAudits.createdAt, findings: projectCodeAudits.findings, operations: projectCodeAudits.operations })
    .from(projectCodeAudits).where(eq(projectCodeAudits.projectId, projectId)).orderBy(desc(projectCodeAudits.createdAt)).limit(1);
  const closures = new Map(((latestAudit?.findings as any)?.loops as LoopClosureRead[] | undefined ?? []).map((c) => [c.loopTaskId, c]));
  // The loop tree: the source milestone, its loops, and each loop's steps
  // (children of the fan-out milestone tagged with that loop). Week 2's UI.
  const loopTree = await (async () => {
    const fanOut = phases.flatMap((p) => p.milestones).find((m) => m.expandsFrom && loopsOf(m.expandsFrom).length);
    if (!fanOut) return null;
    const sourceId = fanOut.expandsFrom!;
    const stepTasks = children.get(fanOut.id) ?? [];
    const loopNodes = (children.get(sourceId) ?? []).filter((k) => isLoop(k.tags)).map((k) => {
      const steps = stepTasks.filter((t) => loopOf(t.tags) === k.id).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      const done = steps.filter((t) => t.status === "done").length;
      return {
        taskId: k.id, title: k.title, description: k.description ?? "", written: k.status === "done" || !!k.description?.trim(),
        type: loopTypeOf(k.tags),
        status: k.status, actor: (tagValue(k.tags, "actor:") ?? "nova-drafts") as Actor,
        state: steps.length ? (done === steps.length ? "built" : done > 0 ? "building" : "planned") : k.status === "done" || k.description?.trim() ? "written" : "unwritten",
        steps: steps.map((t) => ({ taskId: t.id, title: t.title, description: t.description ?? "", status: t.status, actor: (tagValue(t.tags, "actor:") ?? fanOut.actor) as Actor, estimateHours: t.estimateHours })),
        done, total: steps.length,
        closure: closures.get(k.id) ?? null,
      };
    }).sort(byLoopOrder);
    const unassigned = stepTasks.filter((t) => !loopOf(t.tags)).map((t) => ({ taskId: t.id, title: t.title, status: t.status }));
    const coverage = loopCoverage(loopNodes);
    const competition = await latestLoopAudit(taskByBackbone.get(sourceId)?.id ?? null);
    // Stale when a loop was added, removed, renamed, retyped or rewritten since the audit read it.
    const stale = !!competition && loopAuditStale(competition.audit, loopNodes);
    return {
      sourceId, sourceTitle: phases.flatMap((p) => p.milestones).find((m) => m.id === sourceId)?.title ?? "The core loop", fanOutId: fanOut.id, fanOutTitle: fanOut.title, loops: loopNodes, unassigned,
      coverage,
      /** Nova's latest read of the loops against competitors, and whether the loops have changed since. */
      competition: competition ? { ...competition, stale } : null,
      /** Every loop written, and Nova hasn't compared them with the competition yet (or they've changed). */
      competitionDue: coverage.complete && (!competition || stale),
      /** When the closure verdicts were read, from the latest codebase audit. */
      closureAuditAt: latestAudit?.createdAt ?? null,
    };
  })();
  const pace = await refreshPace(projectId, undefined, goal);
  // This section's events: its milestone ids share its prefix. Events with none, or from a
  // section the project isn't working (a path it switched away from), are the primary's history.
  const recent = await db.select().from(pathPaceEvents).where(eq(pathPaceEvents.projectId, projectId))
    .orderBy(desc(pathPaceEvents.createdAt)).limit(40);
  const startedGoals = new Set<ProjectGoal>([state.primaryGoal]);
  for (const g of new Set(recent.map((e) => goalOfBackboneId(e.backboneId)).filter(Boolean) as ProjectGoal[])) {
    if (g !== state.primaryGoal && await trackState(projectId, g)) startedGoals.add(g);
  }
  const sectionOfEvent = (backboneId: string | null) => {
    const g = goalOfBackboneId(backboneId);
    return g && startedGoals.has(g) ? g : state.primaryGoal;
  };
  const events = recent.filter((e) => sectionOfEvent(e.backboneId) === goal).slice(0, 10);
  const complete = doneCount === main.length;

  return {
    adopted: true as const,
    started: true as const,
    primary: project.primary,
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
      /** On the core-loop milestone: the kinds of loop still to add. The milestone isn't done without them. */
      missingLoopTypes: loopSources.has(next.id) && nextLoops.length ? loopCoverage(nextLoops.map((l) => ({ type: l.type, written: true }))).missing : [],
      workTaskId,
      /** What Nova produces on this milestone (its `work`), kept apart from the saved work below. */
      workKind: next.work ?? null,
      work: work ? { id: work.id, kind: work.kind, payload: work.payload, chosenIndex: work.chosenIndex, createdAt: work.createdAt } : null,
    } : null,
    mainLine: { done: doneCount, total: main.length },
    pace, events,
    plan: pace?.plan ?? null,
    loopTree,
    novaNotes: project.novaNotes ?? "",
    rejectedLoops: project.rejectedLoops ?? [],
    auditUpdate: auditUpdateOf(latestAudit),
    proposal: complete ? NEXT_PATHS[goal] : null,
    /** The funding path's capital profile: the fundability score, its parts, and how each route fits. */
    capital: goal === "raise_funding" ? { ...(await capitalProfileFor(projectId)), route: project.capitalRoute ?? null } : null,
  };
}
