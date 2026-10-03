/**
 * The phone's copy of the whole-business build's stages and status shape.
 *
 * Mirrors `shared/nova-build.ts`. Metro cannot resolve `@shared`, so this is a
 * hand copy and `test/unit/mobile-mirror.test.ts` compares the two. No imports
 * at all, which is what keeps that comparison possible.
 *
 * Why the phone needs this at all: it could *start* a build and then showed
 * nothing. The button fired, a toast said "Nova is building it", and after that
 * the app said nothing for the length of a forty-step job — no stage, no step
 * count, no completion, and no error if it died. A fourteen-dollar outcome where
 * the only feedback is one toast is indistinguishable, from the person's side,
 * from one that silently failed.
 */

export const BUILD_STAGES = ["starting", "reading", "building", "finishing"] as const;
export type BuildStage = (typeof BUILD_STAGES)[number];

export const BUILD_STAGE_COPY: Record<BuildStage, string> = {
  starting: "Getting your path ready",
  reading: "Reading what's already there",
  building: "Working through your path",
  finishing: "Tidying up",
};

/** How many steps one purchase covers. Said out loud so the wait is not open-ended. */
export const BUILD_STEP_CAP = 40;

/**
 * The label for a stage, tolerating one the server has added since this shipped.
 *
 * A build reporting an unknown stage must not blank the line that says what is
 * happening — on a wait this long the line is the only evidence anything is.
 */
export const buildStageLabel = (stage: string | null | undefined): string =>
  BUILD_STAGE_COPY[(stage ?? "") as BuildStage] ?? "Working through your path";

/** The stages as the progress bar wants them. */
export const BUILD_WORKING_STAGES = BUILD_STAGES.map((id) => ({ id, label: BUILD_STAGE_COPY[id] }));

/** `GET /api/projects/:id/nova-build`, as the server returns it. */
export interface BuildRunStatus {
  running: {
    id: string;
    stage: BuildStage;
    stageLabel: string;
    stepsDone: number;
    stepsTotal: number;
    stepsForYou: number;
    stepsFailed: number;
    currentTitle: string | null;
    startedAt: string;
    elapsedSeconds: number;
  } | null;
  last: {
    id: string;
    stepsDone: number;
    stepsTotal: number;
    stepsForYou: number;
    stepsFailed: number;
    finishedAt: string | null;
    error: string | null;
  } | null;
  waiting?: unknown;
  paid?: boolean;
}

/**
 * Steps gone through, which is not the same as steps Nova finished.
 *
 * `stepsForYou` counts steps Nova researched and deliberately left open — a
 * decision with three real options on it is work done, not work skipped — and
 * failures count too. Excluding either stalls the bar on a run that is still
 * working, which on the one screen where "is it stuck?" is the only question
 * reads as stuck.
 */
export function buildThrough(running: { stepsDone: number; stepsForYou: number; stepsFailed: number }): number {
  return (running.stepsDone ?? 0) + (running.stepsForYou ?? 0) + (running.stepsFailed ?? 0);
}

/**
 * How far through the run, 0–1, or null to let the bar breathe at its default.
 *
 * Only during `building`: the other three stages are a handful of seconds each
 * and nothing in them knows its own position, so a fraction there would be
 * invented. An unknown position drawn honestly beats a precise-looking guess.
 */
export function buildProgress(running: NonNullable<BuildRunStatus["running"]> | null): number | null {
  if (!running || running.stage !== "building" || !running.stepsTotal) return null;
  return Math.max(0, Math.min(1, buildThrough(running) / running.stepsTotal));
}

/** Which step it is on, counting from one — "step 19 of 28", clamped to the total. */
export function buildStepLine(running: NonNullable<BuildRunStatus["running"]> | null): string | null {
  if (!running || !running.stepsTotal) return null;
  return `step ${Math.min(buildThrough(running) + 1, running.stepsTotal)} of ${running.stepsTotal}`;
}

/**
 * The elapsed time to show, which keeps moving between polls.
 *
 * The server's `elapsedSeconds` is as of the last response. Taking the larger of
 * that and the clock means the number ticks instead of stepping, and never goes
 * backwards if the two disagree.
 */
export function buildElapsedSeconds(running: { elapsedSeconds: number; startedAt: string }, now: number): number {
  const fromClock = Math.round((now - Date.parse(running.startedAt)) / 1000);
  return Math.max(running.elapsedSeconds ?? 0, Number.isFinite(fromClock) ? fromClock : 0);
}
