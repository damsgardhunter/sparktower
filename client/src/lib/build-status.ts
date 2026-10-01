/**
 * Whether Nova is building out this project's path right now, and how the last
 * build ended.
 *
 * The twin of lib/audit-status, deliberately: the two are the same kind of
 * thing — long server-side work that outlives the page that started it — and a
 * builder should not have to learn two different ways of being told something
 * is happening. Same poll cadence, same "finished → re-read everything once"
 * rule, same one shared cache entry however many copies are mounted.
 *
 * What it adds is the step count and the step's name, because a build has
 * somewhere to be in a way a code read does not: forty steps, each with a
 * title, and "which one is it on" is the question people actually have while
 * they wait.
 */
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { toast } from "@/hooks/use-toast";
import { BUILD_STAGES, BUILD_STAGE_COPY, buildSummary, type BuildRunStatus, type BuildStage } from "@shared/nova-build";

export const STAGE_ORDER: readonly BuildStage[] = BUILD_STAGES;

/** Faster than the audit's while running: this reports a step at a time, and a bar that never moves reads as stuck. */
export const RUNNING_POLL_MS = 3_000;
export const IDLE_POLL_MS = 30_000;

export const buildStatusKey = (projectId: string | undefined) => ["/api/projects", projectId, "nova-build"];

/*
 * Checked against the list rather than indexed straight into the map. An
 * object literal answers `["__proto__"]` with Object.prototype, not undefined,
 * so the `??` fallback never fires and React is handed an object to render.
 * The stage is ours and not a client's, so this is not an attack — it is the
 * lookup being wrong about its own fallback, which is worse, because it only
 * shows up the day the column holds something unexpected.
 */
export const buildStageLabel = (stage: string | null | undefined) =>
  (STAGE_ORDER as readonly string[]).includes(stage ?? "")
    ? BUILD_STAGE_COPY[stage as BuildStage]
    : "Working through your path";

/** What each project's build last looked like, so a finish is acted on once however many copies are mounted. */
/**
 * Steps gone through, which is not the same as steps Nova finished.
 *
 * `stepsForYou` counts steps Nova researched and deliberately left open — a
 * decision with three real options on it is work done, not work skipped — and
 * failures count too. Excluding either stalls the bar on a run that is still
 * working, which on the one screen where "is it stuck?" is the only question
 * reads as stuck.
 */
export function buildThrough(running: Pick<NonNullable<BuildRunStatus["running"]>, "stepsDone" | "stepsForYou" | "stepsFailed">): number {
  return (running.stepsDone ?? 0) + (running.stepsForYou ?? 0) + (running.stepsFailed ?? 0);
}

/**
 * How far through the run, 0–1, or null to let the bar breathe at its default.
 *
 * Only during `building`, and that is deliberate: the other three stages are a
 * handful of seconds each and nothing in them knows its own position, so a
 * fraction there would be invented. `Working` draws an unknown position honestly;
 * a made-up one that looks precise is the worse of the two.
 */
export function buildProgress(running: NonNullable<BuildRunStatus["running"]> | null): number | null {
  if (!running || running.stage !== "building" || !running.stepsTotal) return null;
  return Math.max(0, Math.min(1, buildThrough(running) / running.stepsTotal));
}

/**
 * Which step it is on, counting from one — "step 19 of 28".
 *
 * Clamped to the total so the last step does not announce itself as one past the
 * end, which it would on a run where every step has been gone through and the
 * row has not been closed yet.
 */
export function buildStepLine(running: NonNullable<BuildRunStatus["running"]> | null): string | null {
  if (!running || !running.stepsTotal) return null;
  return `step ${Math.min(buildThrough(running) + 1, running.stepsTotal)} of ${running.stepsTotal}`;
}

/**
 * The elapsed time to show, which keeps moving between polls.
 *
 * The server's `elapsedSeconds` is as of the last response, three seconds ago at
 * best. Taking the larger of that and the clock means the number ticks instead of
 * stepping, and never goes backwards if the two disagree.
 */
export function buildElapsedSeconds(running: Pick<NonNullable<BuildRunStatus["running"]>, "elapsedSeconds" | "startedAt">, now: number): number {
  const fromClock = Math.round((now - Date.parse(running.startedAt)) / 1000);
  return Math.max(running.elapsedSeconds ?? 0, Number.isFinite(fromClock) ? fromClock : 0);
}

export interface BuildMark {
  runningId: string | null;
  lastId: string | null;
  finishedAt: string | null;
  /** Everything the build has got through, however each one ended. */
  through: number;
}

/** Where a status reading stands against the one before it. */
export interface BuildChange {
  /** The run is no longer running. */
  stopped: boolean;
  /** A run finished — a different run, or the same one gaining an end. */
  finished: boolean;
  /** Still running, and another step went by since the last look. */
  advanced: boolean;
}

export const markOf = (data: BuildRunStatus): BuildMark => ({
  runningId: data.running?.id ?? null,
  lastId: data.last?.id ?? null,
  finishedAt: data.last?.finishedAt ?? null,
  through: data.running ? data.running.stepsDone + data.running.stepsForYou + data.running.stepsFailed : 0,
});

/**
 * What changed between two readings, and so what has to be re-read.
 *
 * Its own function because the answer decides whether a fourteen-minute build
 * looks like it is working: `advanced` is the one that was missing, and
 * nothing about a React effect makes that rule easier to check.
 */
export function buildChange(prev: BuildMark, next: BuildMark): BuildChange {
  const stopped = !!prev.runningId && !next.runningId;
  const finished = next.finishedAt !== prev.finishedAt || next.lastId !== prev.lastId;
  return { stopped, finished, advanced: !stopped && !finished && !!next.runningId && next.through > prev.through };
}

const seen = new Map<string, BuildMark>();

/*
 * What the path screen reads, re-read each time the build gets through
 * another step.
 *
 * Shorter than the list used when a run ends, on purpose: this fires once per
 * step for the length of the build, and the documents and the activity log are
 * neither on the screen somebody is watching nor cheap to fetch. They are
 * caught by the full sweep at the finish.
 */
const LIVE_KEYS = ["path", "tracks", "milestones", "kanban"];
/** Until when a build's outcome is left to the screen that started it. */
const quietUntil = new Map<string, number>();

/** The panel calls this around its own POST, so a failure isn't toasted twice. */
export function quietBuildErrors(projectId: string, ms: number) {
  quietUntil.set(projectId, Date.now() + ms);
}

export function useBuildStatus(projectId: string | undefined, opts: { expectRunning?: boolean } = {}) {
  const query = useQuery<BuildRunStatus>({
    queryKey: buildStatusKey(projectId),
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/nova-build`, { credentials: "include" });
      if (!res.ok) throw new Error(`${res.status}: ${(await res.text()) || res.statusText}`);
      return res.json();
    },
    enabled: !!projectId,
    refetchInterval: (q) => (opts.expectRunning || q.state.data?.running ? RUNNING_POLL_MS : IDLE_POLL_MS),
    refetchOnWindowFocus: true,
    staleTime: 1_500,
  });

  const data = query.data;
  useEffect(() => {
    if (!projectId || !data) return;
    const next = markOf(data);
    const prev = seen.get(projectId);
    seen.set(projectId, next);
    if (!prev) return;  // first look: nothing has changed yet
    const { stopped, finished, advanced } = buildChange(prev, next);

    /*
     * A step went by while the build is still going: re-read the path.
     *
     * Everything here used to wait for the run to stop, so for the fourteen
     * minutes of a twenty-seven step build the screen showed the path exactly
     * as it was when the button was pressed — Nova answering and closing a
     * step every forty-five seconds, and the card above the progress bar
     * sitting on the same step throughout. It didn't look like it was working,
     * it looked broken.
     *
     * Keyed on the count rather than the poll, so this is about one re-read
     * per step and not one every three seconds.
     */
    if (!stopped && !finished) {
      if (advanced) {
        for (const key of LIVE_KEYS) queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, key] });
      }
      return;
    }

    /*
     * A build rewrites the path, the board and the milestones — nineteen steps
     * answered and closed. Everything that reads any of that is stale the
     * moment it ends, so it is all re-read once, here, rather than in each of
     * the screens that happen to be open.
     */
    for (const key of ["path", "tracks", "kanban", "milestones", "roadmap", "activity", "documents"]) {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, key] });
    }
    queryClient.invalidateQueries({ queryKey: ["/api/nova/wallet"] });
    queryClient.invalidateQueries({ queryKey: ["/api/me/next-steps"] });

    if (!finished || (quietUntil.get(projectId) ?? 0) >= Date.now()) return;
    if (data.last?.error) {
      toast({ title: "The build didn't finish", description: data.last.error, variant: "destructive" });
    } else if (data.last) {
      toast({ title: "Nova finished building your path", description: buildSummary(data.last.stepsDone, data.last.stepsForYou, data.last.stepsFailed) });
    }
  }, [projectId, data]);

  return { ...query, running: data?.running ?? null, last: data?.last ?? null, waiting: data?.waiting ?? null, paid: data?.paid ?? false };
}
