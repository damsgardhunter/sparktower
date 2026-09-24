/**
 * Nova's work on one step of a path, asked for in exactly one way.
 *
 * Two callers want this: the route behind the button on the step
 * (`POST /api/projects/:id/path/work`) and the whole-business build, which
 * does the same thing forty times without anybody watching. They had two
 * copies, and the copies had drifted: the route passed Nova the project's
 * loops and the ones its owner had already rejected, and the build passed
 * neither — so the thing somebody paid for was reasoning about their
 * business without knowing what its core loops were, while the free button
 * next to it knew. That is the failure this module exists to prevent, and the
 * reason the context is assembled here rather than at either call site.
 *
 * It is deliberately ignorant of money and of HTTP: the route charges before
 * calling, the build has a pass, and neither concern belongs in the thing that
 * writes the answer.
 */
import { storage } from "./storage";
import { buildOperableProjectState } from "./project-operations";
import { collectArtifacts, type pathTaskContext } from "./phase-trees";
import { produceWork } from "./phase-trees-nova";
import { workKindFor, loopTypeOf, LOOP_TYPE_INFO, type WorkPayload } from "@shared/phase-trees";
import type { UserEntitlements } from "./entitlements";

type TaskContext = NonNullable<Awaited<ReturnType<typeof pathTaskContext>>>;

/** The project's loops and standing refusals, read once and reusable across a build's many steps. */
export interface WorkSurroundings {
  state: string;
  artifacts: Awaited<ReturnType<typeof collectArtifacts>>;
  loops: { title: string; description: string; status: string; type: ReturnType<typeof loopTypeOf> }[];
  rejectedLoops: string[];
}

/**
 * Everything Nova needs to know about the project, independent of which step
 * is being worked.
 *
 * The build reads this once for the whole run — it is the same project at
 * every step, and forty reads of the same rows is forty reads of the same
 * rows. The route reads it per request, which is the same cost it always had.
 */
export async function readSurroundings(projectId: string): Promise<WorkSurroundings> {
  const [state, artifacts, all, project] = await Promise.all([
    buildOperableProjectState(projectId, { includeIds: false, includeAudit: true }),
    collectArtifacts(projectId),
    storage.getProjectKanbanTasks(projectId),
    storage.getProject(projectId),
  ]);
  const loops = all
    .filter((t) => t.tags?.includes("kind:loop") && !t.tags.some((x) => x.startsWith("archived:")))
    .map((t) => ({ title: t.title, description: t.description ?? "", status: t.status, type: loopTypeOf(t.tags) }));
  return { state, artifacts, loops, rejectedLoops: project?.rejectedLoops ?? [] };
}

/**
 * The loops again, because a build writes them.
 *
 * `readSurroundings` is read once for a whole build — the same project at
 * every step — but the five core loops are the one part of it the build
 * changes as it goes. Written from a snapshot taken before any of them
 * existed, the growth loop would be composed without sight of the product
 * loop it is supposed to feed, which is the one relationship the five are for.
 * Cheap: one query, and only before a step that is itself a loop.
 */
export async function withFreshLoops(projectId: string, surroundings: WorkSurroundings): Promise<WorkSurroundings> {
  const all = await storage.getProjectKanbanTasks(projectId);
  return {
    ...surroundings,
    loops: all
      .filter((t) => t.tags?.includes("kind:loop") && !t.tags.some((x) => x.startsWith("archived:")))
      .map((t) => ({ title: t.title, description: t.description ?? "", status: t.status, type: loopTypeOf(t.tags) })),
  };
}

/**
 * Nova doing this one step.
 *
 * A loop's task carries its name and possibly its steps, so what that kind of
 * loop is for rides along in the ask — otherwise Nova writes a generic
 * sequence and calls it a growth loop.
 */
export async function produceWorkForTask(
  ent: UserEntitlements,
  ctx: TaskContext,
  surroundings: WorkSurroundings,
): Promise<WorkPayload> {
  const kind = workKindFor(ctx.actor, ctx.milestone?.work);
  const loopKind = ctx.task.tags?.includes("kind:loop") ? LOOP_TYPE_INFO[loopTypeOf(ctx.task.tags)] : null;
  return produceWork(
    ent,
    kind,
    loopKind
      ? {
          title: `${loopKind.label}: ${ctx.task.title}`,
          description:
            `Write this ${loopKind.label.toLowerCase()} as 3–5 steps in the product's own words. ${loopKind.asks} ` +
            `It closes when: ${loopKind.closes} For example: ${loopKind.example} Give each option a 2–5 word name as its title.` +
            (ctx.task.description?.trim() ? `\n\nWhat's written so far: ${ctx.task.description.trim()}` : ""),
          tier: ctx.tier,
        }
      : { title: ctx.task.title, description: ctx.task.description ?? ctx.milestone?.description ?? "", tier: ctx.tier },
    {
      goal: ctx.project.goal,
      subcategory: ctx.project.subcategory,
      state: surroundings.state,
      artifacts: surroundings.artifacts,
      loops: surroundings.loops,
      rejectedLoops: surroundings.rejectedLoops,
    },
  );
}
