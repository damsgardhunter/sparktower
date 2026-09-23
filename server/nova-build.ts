/**
 * Nova building the whole business — the work behind the $30.
 *
 * Read shared/nova-build.ts first: it says which steps Nova closes and which
 * it deliberately leaves open, and that decision is the reason this file
 * exists rather than a loop that answers everything.
 *
 * The work happens after the request that paid for it has already answered.
 * There is no queue in this server (the pattern is a timer or a fire-and-
 * forget promise), so a run is tracked by a row it keeps current, exactly as
 * code audits are, and the status route stamps a run the server restarted
 * through as over. A build takes minutes and the page must be able to show it
 * happening; a spinner that belongs to one browser tab would lose the whole
 * thing to a refresh.
 */
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "./db";
import { novaBuildRuns, projects, users } from "@shared/schema";
import {
  latestWork, listTracks, pathStatus, pathTaskContext, saveWork, chooseWork, startTrack, instantiatePathTree,
} from "./phase-trees";
import { produceWorkForTask, readSurroundings, withFreshLoops } from "./nova-work";
import { workKindFor } from "@shared/phase-trees/work";
import { getUserEntitlements } from "./entitlements";
import { hasBuildPass } from "./wallet";
import { notify } from "./notifications";
import { whileBuilding } from "./build-quiet";
import {
  BUILD_STAGE_COPY, BUILD_STALE_MS, BUILD_STEP_CAP, buildSummary,
  type BuildRunStatus, type BuildStage,
} from "@shared/nova-build";

const STALE_MESSAGE =
  "The build stopped before it finished — the server restarted or the connection dropped. " +
  "Start it again; what it already wrote is on your board, and it won't charge you twice.";

/**
 * A handle on the row, shaped like startAuditRun's: tracking is not the work,
 * so nothing here throws. A build that finishes while its progress row is
 * unwritable is still a build that finished.
 */
interface BuildRunHandle {
  id: string;
  stage(stage: BuildStage, currentTitle?: string | null): Promise<void>;
  progress(done: number, forYou: number, currentTitle: string | null, failed?: number): Promise<void>;
  total(total: number): Promise<void>;
  finish(result: { error?: string }): Promise<void>;
}

async function startBuildRun(projectId: string, userId: string): Promise<BuildRunHandle> {
  let id = "";
  try {
    const [row] = await db.insert(novaBuildRuns).values({ projectId, startedById: userId }).returning({ id: novaBuildRuns.id });
    id = row?.id ?? "";
  } catch (err) {
    console.error("[nova-build] couldn't record the run:", err);
  }
  let done = false;
  const set = async (values: Partial<typeof novaBuildRuns.$inferInsert>) => {
    if (!id || done) return;
    await db.update(novaBuildRuns).set(values).where(eq(novaBuildRuns.id, id)).catch(() => {});
  };
  return {
    id,
    stage: (stage, currentTitle) => set({ stage, ...(currentTitle !== undefined ? { currentTitle } : {}) }),
    progress: (stepsDone, stepsForYou, currentTitle, stepsFailed) =>
      set({ stepsDone, stepsForYou, currentTitle, ...(stepsFailed !== undefined ? { stepsFailed } : {}) }),
    total: (stepsTotal) => set({ stepsTotal }),
    finish: async (result) => {
      if (!id || done) return;
      const values = { finishedAt: new Date(), error: result.error ?? null };
      done = true;
      await db.update(novaBuildRuns).set(values).where(eq(novaBuildRuns.id, id)).catch(() => {});
    },
  };
}

/** True while a build for this project is running, so a second one is refused rather than raced. */
export async function buildInFlight(projectId: string): Promise<boolean> {
  const [row] = await db.select({ id: novaBuildRuns.id })
    .from(novaBuildRuns)
    .where(and(
      eq(novaBuildRuns.projectId, projectId),
      isNull(novaBuildRuns.finishedAt),
      // In SQL, like the audit's: a timestamp read back into JS is off by the server's zone.
      sql`extract(epoch from (now() - ${novaBuildRuns.startedAt})) * 1000 < ${BUILD_STALE_MS}`,
    ))
    .limit(1);
  return !!row;
}

export async function buildRunStatus(projectId: string, userId: string): Promise<BuildRunStatus> {
  const rows = await db.select({
    id: novaBuildRuns.id, stage: novaBuildRuns.stage,
    stepsDone: novaBuildRuns.stepsDone, stepsTotal: novaBuildRuns.stepsTotal, stepsForYou: novaBuildRuns.stepsForYou,
    stepsFailed: novaBuildRuns.stepsFailed,
    currentTitle: novaBuildRuns.currentTitle, startedAt: novaBuildRuns.startedAt,
    finishedAt: novaBuildRuns.finishedAt, error: novaBuildRuns.error,
    ageMs: sql<number>`(extract(epoch from (now() - ${novaBuildRuns.startedAt})) * 1000)::bigint`,
  }).from(novaBuildRuns)
    .where(eq(novaBuildRuns.projectId, projectId))
    .orderBy(desc(novaBuildRuns.startedAt))
    .limit(5);

  const running = rows.find((r) => !r.finishedAt && Number(r.ageMs) < BUILD_STALE_MS) ?? null;

  /*
   * A run nobody finished is stamped over here, on the read. The process that
   * was doing the work is gone — .unref()'d timers and fire-and-forget
   * promises die with it — so nothing else will ever close the row, and a
   * progress bar that turns forever is worse than an error that says what
   * happened.
   */
  for (const stale of rows) {
    if (stale.finishedAt || Number(stale.ageMs) < BUILD_STALE_MS) continue;
    await db.update(novaBuildRuns)
      .set({ finishedAt: new Date(), error: STALE_MESSAGE })
      .where(and(eq(novaBuildRuns.id, stale.id), isNull(novaBuildRuns.finishedAt)))
      .catch(() => {});
    // Written onto the row in hand as well, or this response would describe
    // the run as it was a moment ago and the reader would be told nothing.
    stale.finishedAt = new Date();
    stale.error = STALE_MESSAGE;
  }

  const last = rows.find((r) => r.finishedAt) ?? null;
  return {
    waiting: running ? null : await whatIsWaiting(projectId),
    running: running ? {
      id: running.id,
      stage: running.stage as BuildStage,
      stageLabel: BUILD_STAGE_COPY[running.stage as BuildStage],
      stepsDone: running.stepsDone, stepsTotal: running.stepsTotal, stepsForYou: running.stepsForYou,
      stepsFailed: running.stepsFailed,
      currentTitle: running.currentTitle,
      startedAt: running.startedAt.toISOString(),
      elapsedSeconds: Math.round(Number(running.ageMs) / 1000),
    } : null,
    last: last ? {
      id: last.id,
      stepsDone: last.stepsDone, stepsTotal: last.stepsTotal, stepsForYou: last.stepsForYou,
      stepsFailed: last.stepsFailed,
      finishedAt: last.finishedAt ? last.finishedAt.toISOString() : null,
      error: last.error,
    } : null,
    paid: await hasBuildPass(userId, projectId),
  };
}

/** Steps Nova finishes itself, against steps it prepares and leaves for the builder. */
const NOVA_CLOSES: ReadonlySet<string> = new Set(["nova-builds", "nova-drafts"]);

/**
 * What is actually still open, counted now rather than remembered from the run.
 *
 * The finished card used to describe the path from the run's own numbers, and
 * those numbers go stale in three ways that all showed up in one sitting:
 *
 *  - **The cap.** A build covers `BUILD_STEP_CAP` steps. On a 48-milestone
 *    Systemize path that left seven it never reached, and the card said "Nova
 *    built out your path" with no mention of them.
 *  - **Steps that appear later.** Choosing a capital route added seventeen new
 *    milestones *after* the build finished. The card kept reporting the run it
 *    had done, so work Nova could do for free sat there unoffered.
 *  - **What "left for you" means.** `stepsForYou` counts a decision with three
 *    researched options and a question only the builder can answer (their
 *    numbers, their call) as the same thing. The card told everyone "each has
 *    Nova's options on it already — open one and pick"; on that same path,
 *    eight of the fifteen had nothing on them, because nothing is what Nova is
 *    supposed to put there.
 *
 * Counted live, these are three numbers instead of a claim: what Nova can
 * still write, what is waiting with options, and what only the builder can
 * answer.
 */
async function whatIsWaiting(projectId: string): Promise<BuildRunStatus["waiting"]> {
  try {
    const sections = (await listTracks(projectId))?.tracks ?? [];
    let novaCanWrite = 0;
    let optionsReady = 0;
    let yoursAlone = 0;

    for (const section of sections.filter((t) => t.started)) {
      const status = await pathStatus(projectId, section.goal as any, { sync: false }).catch(() => null);
      if (!status?.adopted) continue;
      const open: { taskId: string }[] = [];
      for (const phase of status.phases) {
        for (const m of phase.milestones as any[]) if (!m.done && m.taskId) open.push({ taskId: m.taskId });
      }
      for (const loop of status.loopTree?.loops ?? []) {
        if (!loop.written && loop.status !== "done") open.push({ taskId: loop.taskId });
      }

      for (const step of open) {
        const ctx = await pathTaskContext(projectId, step.taskId).catch(() => null);
        if (!ctx) continue;
        const kind = workKindFor(ctx.actor, ctx.milestone?.work);
        // The two Nova deliberately never touches: a question only they can
        // answer, and a step finished by a surface doing its own job.
        if (kind === "intake" || ctx.milestone?.doneOn) { yoursAlone += 1; continue; }
        const work = await latestWork(step.taskId);
        if (NOVA_CLOSES.has(ctx.actor)) { if (!work) novaCanWrite += 1; }
        else if (work) optionsReady += 1;
        else novaCanWrite += 1;
      }
    }
    return { novaCanWrite, optionsReady, yoursAlone };
  } catch (err) {
    // A card that can't count is not a card that should fail the page.
    console.error(`[nova-build] couldn't count what's waiting on ${projectId}:`, err);
    return null;
  }
}

/**
 * Walk the path and leave something on every step.
 *
 * Milestones are taken from the tree rather than by following `next`, because
 * `next` is a cursor that stops on the first step Nova deliberately leaves
 * open — following it would make the build loop forever on the first decision
 * that belongs to the builder.
 */
export async function runBusinessBuild(projectId: string, userId: string): Promise<void> {
  const run = await startBuildRun(projectId, userId);
  let done = 0;
  let forYou = 0;
  let failed = 0;

  try {
    const ent = await getUserEntitlements(userId);
    const [project] = await db.select({ goal: projects.goal, subcategory: projects.subcategory, title: projects.title })
      .from(projects).where(eq(projects.id, projectId));
    if (!project) throw new Error("Project not found");

    /*
     * The path has to exist before it can be built. Someone who buys this on
     * a project that was never put on a path bought exactly the case where
     * there is most to do, so it starts the path rather than refusing.
     */
    await run.stage("starting", null);
    const tracks = await listTracks(projectId).catch(() => null);
    if (!tracks?.tracks.length) {
      await startTrack(projectId, project.goal as any, project.subcategory ?? "other");
    }
    const sections = (await listTracks(projectId))?.tracks ?? [];
    /*
     * The sections this build is for: the ones whose owner has actually
     * started them, and the primary one whether or not they have.
     *
     * `listTracks` returns all three paths — Ship, Systemize, Run — started or
     * not, because the section switcher needs to offer them. Laying out every
     * one of them put sixty-five milestones from two paths nobody had chosen
     * onto the board, where they sat untouched: not in the path panel, which
     * reads only started sections, but very much on the Kanban board, which
     * reads tasks. A project of twenty-eight steps became one of ninety-three,
     * and the build's own summary counted none of them.
     *
     * A project with no path at all is still the case with the most to do, so
     * the primary section is started here if it isn't already — that part was
     * right.
     */
    const ordered = [...sections]
      .filter((s) => s.started || s.primary)
      .sort((a, b) => Number(!!b.primary) - Number(!!a.primary));

    /*
     * A section can have a track row and still have no steps: the path is
     * instantiated when it is adopted, and a project made before paths existed
     * — or one whose owner never pressed "start the path" — has the track and
     * nothing under it. Skipping those was skipping the whole purchase, since
     * a project with no path is precisely the one with the most to build.
     */
    for (const section of ordered) {
      await instantiatePathTree(projectId, section.goal as any, section.subcategory ?? "other", { keepRoadmap: true })
        .catch((err) => console.error(`[nova-build] couldn't lay out ${section.goal} on ${projectId}:`, err));
    }

    await run.stage("reading", null);
    // Read once for the whole build: it is the same project at every step, and
    // rebuilding this per milestone would be forty reads of the same rows.
    const surroundings = await readSurroundings(projectId);

    // Every unfinished milestone across every section this project is on.
    const todo: { taskId: string; title: string; goal: string }[] = [];
    for (const section of ordered) {
      const status = await pathStatus(projectId, section.goal as any, { sync: false }).catch(() => null);
      if (!status?.adopted) continue;

      /*
       * The five loops come first, and they come instead of the milestone they
       * hang off.
       *
       * "The core loops" is the milestone the rest of the path orders off, and
       * it is not done until all five loops are written — `isDone` in
       * phase-trees.ts says so explicitly. The build used to write a paragraph
       * onto the milestone's own task and close that, which satisfied nothing:
       * the loop tree stayed empty, the milestone stayed open, and the buyer
       * came back to a screen reading "17/24 milestones" above "5 loops · 0
       * written" with the next step still asking for the loops. Writing the
       * children is what finishing this milestone means.
       */
      const loopSourceIds = new Set<string>();
      for (const loop of status.loopTree?.loops ?? []) {
        if (loop.written || loop.status === "done") continue;
        todo.push({ taskId: loop.taskId, title: `${loop.title || "Loop"} — the loop itself`, goal: section.goal });
      }
      if (status.loopTree && (status.loopTree.loops ?? []).some((l: any) => !l.written && l.status !== "done")) {
        loopSourceIds.add(status.loopTree.sourceId);
      }

      for (const phase of status.phases) {
        for (const m of phase.milestones as any[]) {
          if (m.done || !m.taskId) continue;
          // Its loops are already queued above, and they are what completes it.
          if (loopSourceIds.has(m.id)) continue;
          todo.push({ taskId: m.taskId, title: m.title, goal: section.goal });
        }
      }
    }

    const planned = todo.slice(0, BUILD_STEP_CAP);
    await run.total(planned.length);
    await run.stage("building", planned[0]?.title ?? null);

    for (const step of planned) {
      await run.progress(done, forYou, step.title);

      const ctx = await pathTaskContext(projectId, step.taskId).catch(() => null);
      if (!ctx) continue;
      const kind = workKindFor(ctx.actor, ctx.milestone?.work);

      /*
       * An intake step asks the builder something about their own business
       * that has one right answer and Nova does not know it — which route
       * they're taking, what they actually charge. Guessing it would be a lie
       * the rest of the path is then built on.
       */
      if (kind === "intake") { forYou += 1; continue; }

      /*
       * A step with a surface of its own is left alone for the same reason.
       * The whole-business build would otherwise have written a paragraph onto
       * "The jobs that come round" and closed it, and the buyer would have a
       * ticked step with no jobs on their board — the worst possible outcome
       * of the purchase, since the tick is what tells them it was handled.
       */
      if (ctx.milestone?.doneOn) { forYou += 1; continue; }

      try {
        /*
         * A packet that is already there is used rather than paid for again.
         * The same trick the editor bridge uses: a build re-run after an
         * interrupted one should cost model time only for what is still
         * missing.
         */
        const existing = await latestWork(step.taskId);
        const saved = existing ?? await (async () => {
          // The same ask the button on the step makes — see server/nova-work.ts.
          // A loop is written knowing the loops written already, which on a
          // build is the four this run wrote a minute ago.
          const context = ctx.task.tags?.includes("kind:loop")
            ? await withFreshLoops(projectId, surroundings)
            : surroundings;
          const payload = await produceWorkForTask(ent, ctx, context);
          return saveWork(projectId, step.taskId, payload);
        })();

        if (NOVA_CLOSES.has(ctx.actor)) {
          // Nova's own work: written onto the step and closed.
          await chooseWork(projectId, saved.id, { index: 0 });
          done += 1;
        } else {
          /*
           * The builder's call. The options are researched and waiting on the
           * step, and the step stays open — see shared/nova-build.ts for why
           * this is the point of the feature rather than a shortcoming of it.
           */
          forYou += 1;
        }
      } catch (err) {
        /*
         * One step failing is not the build failing; it stays open like any
         * step Nova couldn't finish. Counted as a failure rather than as one
         * of the builder's decisions, though — the two used to share
         * `forYou`, which made the summary describe six broken model calls as
         * "six decisions only you can make".
         */
        console.error(`[nova-build] step ${step.taskId} on ${projectId} failed:`, err);
        failed += 1;
      }
      await run.progress(done, forYou, step.title, failed);
    }

    await run.stage("finishing", null);
    await run.progress(done, forYou, null, failed);
    await run.finish({});
    await tell(userId, projectId, run.id, buildSummary(done, forYou, failed));

  } catch (err: any) {
    console.error(`[nova-build] build for ${projectId} failed:`, err);
    const message = err?.message ? String(err.message).slice(0, 300) : "The build stopped unexpectedly.";
    await run.finish({ error: message });
    /*
     * Told about the failure too, and for the stronger reason: they paid,
     * walked away, and would otherwise come back to a path that looks
     * untouched with nothing saying why.
     */
    await tell(userId, projectId, run.id, `It stopped early: ${message} Nothing was charged twice — open it and start it again.`);
  }
}

/**
 * Ring the bell for the person who paid.
 *
 * A build takes minutes and outlives the page, which is the whole reason this
 * exists: somebody who buys it and goes to make a coffee has no other way of
 * finding out it is done. `allowSelf` because they are both who started it and
 * who is being told, and the run id as the target so each build notifies once
 * and a second build still does.
 */
async function tell(userId: string, projectId: string, runId: string, excerpt: string) {
  if (!runId) return;
  await notify({
    recipients: [userId], actorId: userId, kind: "nova_build_done",
    targetId: runId, projectId, excerpt, allowSelf: true,
  }).catch((err) => console.error("[nova-build] couldn't notify:", err));
}

/**
 * Start a build without making the buyer's request wait minutes for it.
 *
 * Deliberately not awaited by the route: the purchase has already succeeded by
 * the time this is called, and a checkout that hangs for four minutes is a
 * checkout people abandon and then dispute. The run row is what they watch
 * instead.
 */
export function startBusinessBuild(projectId: string, userId: string): void {
  /*
   * No advisory lock around this. The lock helper holds a transaction for the
   * length of the body, and this body is forty model calls — minutes of a
   * database connection pinned open for work that touches the database in
   * short bursts. Two builds at once are kept apart by `buildInFlight`, which
   * the route checks before ever getting here, and by the fact that a step
   * already answered is skipped.
   */
  // Quiet while it works: see server/build-quiet.ts. Wrapped here rather than
  // inside the run so the flag is cleared even if the run throws its way out.
  void whileBuilding(projectId, () => runBusinessBuild(projectId, userId))
    .catch((err) => console.error(`[nova-build] couldn't start for ${projectId}:`, err));
}
