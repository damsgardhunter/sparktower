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
    /** Steps that threw. Not the same thing as a step handed back on purpose. */
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
  /**
   * What is open on the path right now, counted at read time rather than
   * remembered from the run — see `whatIsWaiting` in server/nova-build.ts for
   * the three ways a finished run's own numbers go stale. Null while a build
   * is running (it is changing under us) and when the count failed.
   */
  waiting: {
    /** Steps Nova could write and hasn't — the cap, an interrupted run, or steps that appeared since. */
    novaCanWrite: number;
    /** Decisions with Nova's options already on them: open one and pick. */
    optionsReady: number;
    /** Questions only the builder can answer, and steps another surface finishes. Nova leaves these alone. */
    yoursAlone: number;
  } | null;
  /** Whether this project has been paid for, which is what shows the button at all. */
  paid: boolean;
}

/**
 * What the builder is told when a build ends, in the words of what they got.
 *
 * `failed` is kept apart from `forYou` on purpose. They were one number, so a
 * run where six model calls threw reported that it had "left 6 steps for you —
 * the decisions only you can make", which is a sentence about a failure
 * written as though it were the feature working. A step that broke is said to
 * have broken, and the sentence points at the re-run, which is free.
 */
export function buildSummary(done: number, forYou: number, failed = 0): string {
  const broke = failed === 0 ? ""
    : ` ${failed === 1 ? "1 step" : `${failed} steps`} hit an error and stayed open — running the build again picks those up, and it won't charge you twice.`;
  if (done === 0 && forYou === 0 && failed === 0) return "There was nothing left to build — your path is already answered.";
  if (done === 0 && forYou === 0) return `Nothing was written.${broke}`;
  const built = done === 1 ? "1 step" : `${done} steps`;
  if (forYou === 0) return `Nova wrote ${built}. Every one of them is yours to change.${broke}`;
  const yours = forYou === 1 ? "1 step" : `${forYou} steps`;
  /*
   * What it left is named, not characterised. This sentence used to end "those
   * are the decisions only you can make, with the options already researched",
   * which is true of some of them and flatly untrue of the rest: a question
   * about the builder's own numbers has no options on it, and is not supposed
   * to. The card under this line counts the two apart from a live read of the
   * path (`waiting` in BuildRunStatus), which is the honest place for the
   * claim — a run's own tally cannot know which is which.
   */
  return `Nova wrote ${built}, and left ${yours} for you.${broke}`;
}
