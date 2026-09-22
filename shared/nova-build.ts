/**
 * "Nova builds the whole business" — the $30 outcome, described in one place.
 *
 * The promise is that every step of the path is laid out: read, thought about,
 * and left with something on it. What it is *not* is Nova deciding the
 * business. That distinction is the whole design of this file, so it is worth
 * stating plainly before any code depends on it.
 *
 * A path step has an actor (shared/phase-trees/types.ts):
 *
 *   nova-builds / nova-drafts  — Nova's work. It is done, written and closed.
 *   user-decides               — the builder's call. Nova researches it and
 *                                leaves three real options on the step, and
 *                                the step stays open.
 *   user-does                  — something only they can do (make the call,
 *                                sign the thing). Nova leaves the template and
 *                                the step stays open.
 *   intake                     — a question about their business that has a
 *                                right answer only they know. Untouched.
 *
 * Auto-answering the middle two would be the easy version and the wrong one.
 * Someone who pays $30 and comes back to a finished plan they never made a
 * single decision in has not had their business built; they have had it
 * replaced, and they will not be able to defend a word of it to an investor,
 * a landlord or a co-founder. Leaving those steps open with the work already
 * done underneath them is the difference between a business someone owns and
 * a document someone bought.
 */

export const BUILD_STAGES = ["starting", "reading", "building", "finishing"] as const;
export type BuildStage = (typeof BUILD_STAGES)[number];

export const BUILD_STAGE_COPY: Record<BuildStage, string> = {
  starting: "Getting your path ready",
  reading: "Reading what's already there",
  building: "Working through your path",
  finishing: "Tidying up",
};

/**
 * How many steps one purchase covers.
 *
 * A path is thirty to sixty milestones and each one is a model call, some of
 * them large. The cap is here rather than left implicit so that the number is
 * something decided rather than something discovered from a bill, and so the
 * build says it stopped at the cap instead of quietly appearing finished.
 */
export const BUILD_STEP_CAP = 40;

/**
 * A build the server restarted through is over, not running. Longer than the
 * audit's fifteen minutes because this is genuinely a long job — forty model
 * calls, some of them writing code.
 */
export const BUILD_STALE_MS = 45 * 60_000;

export interface BuildRunStatus {
  running: {
    id: string;
    stage: BuildStage;
    stageLabel: string;
    stepsDone: number;
    stepsTotal: number;
    stepsForYou: number;
    currentTitle: string | null;
    startedAt: string;
    elapsedSeconds: number;
  } | null;
  last: {
    id: string;
    stepsDone: number;
    stepsTotal: number;
    stepsForYou: number;
    finishedAt: string | null;
    error: string | null;
  } | null;
  /** Whether this project has been paid for, which is what shows the button at all. */
  paid: boolean;
}

/** What the builder is told when a build ends, in the words of what they got. */
export function buildSummary(done: number, forYou: number): string {
  if (done === 0 && forYou === 0) return "There was nothing left to build — your path is already answered.";
  const built = done === 1 ? "1 step" : `${done} steps`;
  if (forYou === 0) return `Nova wrote ${built}. Every one of them is yours to change.`;
  const yours = forYou === 1 ? "1 step" : `${forYou} steps`;
  return `Nova wrote ${built}, and left ${yours} for you — those are the decisions only you can make, with the options already researched.`;
}
