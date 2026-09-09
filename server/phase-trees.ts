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
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "./db";
import { storage } from "./storage";
import { projects, projectRoadmaps, roadmapPhases, projectMilestones, projectKanbanTasks } from "@shared/schema";
import { resolveTree, treeFor, mainLineMilestones, type ResolvedMilestone, type ResolvedPhase } from "@shared/phase-trees";
import type { ProjectGoal } from "@shared/goals";

/** Tags let the actor and tier ride on the existing task row. */
export const tagsFor = (m: ResolvedMilestone) => [
  `actor:${m.actor}`, `tier:${m.tier}`, `backbone:${m.id}`,
  ...(m.sharedId ? [`shared:${m.sharedId}`] : []),
  ...(m.expandsFrom ? [`expands:${m.expandsFrom}`] : []),
];

export const backboneIdOf = (tags: string[] | null | undefined) =>
  tags?.find((t) => t.startsWith("backbone:"))?.slice("backbone:".length) ?? null;

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

/**
 * Where the project is on its path, for the dashboard: the current phase,
 * progress within it as "step 4 of 7", and the one next action with who acts.
 */
export async function pathStatus(projectId: string) {
  const [project] = await db.select({ goal: projects.goal, subcategory: projects.subcategory })
    .from(projects).where(eq(projects.id, projectId));
  if (!project) return null;

  const goal = project.goal as ProjectGoal;
  const phases = resolveTree(goal, project.subcategory);
  const tree = treeFor(goal);

  const tasks = await db.select({ tags: projectKanbanTasks.tags, status: projectKanbanTasks.status })
    .from(projectKanbanTasks).where(eq(projectKanbanTasks.projectId, projectId));
  const doneIds = new Set(
    tasks.filter((t) => t.status === "done").map((t) => backboneIdOf(t.tags)).filter(Boolean) as string[],
  );

  const main = mainLineMilestones(phases);
  const doneCount = main.filter((m) => doneIds.has(m.id)).length;

  // Current phase: the first main-line phase with something left to do.
  const current = phases.find((p) => !p.optional && p.milestones.some((m) => !doneIds.has(m.id)))
    ?? phases[phases.length - 1];
  const inPhaseDone = current.milestones.filter((m) => doneIds.has(m.id)).length;
  const next = current.milestones.find((m) => !doneIds.has(m.id)) ?? null;

  return {
    goal,
    subcategory: project.subcategory,
    promise: tree.promise,
    target: tree.target,
    tier: tree.defaultTier,
    phases: phases.map((p) => ({
      id: p.id, title: p.title, optional: !!p.optional, checkpoint: p.checkpoint ?? null,
      total: p.milestones.length,
      done: p.milestones.filter((m) => doneIds.has(m.id)).length,
      milestones: p.milestones.map((m) => ({ ...m, done: doneIds.has(m.id) })),
    })),
    current: { id: current.id, title: current.title, step: Math.min(inPhaseDone + 1, current.milestones.length), of: current.milestones.length },
    next: next ? { ...next, done: false } : null,
    mainLine: { done: doneCount, total: main.length },
  };
}
