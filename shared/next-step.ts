/**
 * One answer to "what should I do next", in one place.
 *
 * The shape was declared three times — the server that computes it, the web
 * card that draws it, and the phone card that mirrors the web card — and the
 * three had already drifted: the phone's copy had lost `projectedAt`, and the
 * two cards disagreed about what to say when a path runs out ("Main line done
 * — pick what's next." against "The main line is done — pick what's next on
 * the project."). Three restatements of one contract is three chances to be
 * subtly wrong about the thing the product is for.
 *
 * So the type lives here and both clients import it, and the few words that
 * are the *same* words on every screen live here too. Not the step's own text:
 * that is either authored into the path tree or written by Nova from what the
 * builder saved, and the server sends it.
 */
import type { ProjectGoal } from "./goals";
import type { Actor } from "./phase-trees/types";

export interface WeeklyUpdate {
  due: boolean;
  steps: { taskId: string; title: string; completedAt: string }[];
}

/**
 * Why a project has no next step to show, and what would give it one.
 *
 * A project that predates paths, or one whose owner has not started a section,
 * used to be dropped from the list in silence: no step, no explanation, no way
 * in. The home card is where somebody looks to find out what to do, so "this
 * one needs a path, here is the button" belongs there rather than nowhere.
 */
export interface NeedsPath {
  /**
   * "start" — the section has never been started, so there is no tree at all.
   * "adopt" — work exists from before paths; adoption reads it and marks what
   *   is already done rather than pretending the project is on step one.
   */
  kind: "start" | "adopt";
  /** What is already there, for the "N of M already done" line adoption shows. */
  existingTasks: number;
  existingDone: number;
}

export interface NextStepItem {
  project: { id: string; title: string; logoUrl: string | null };
  /**
   * The section this step is on.
   *
   * One item per project, and this is the section it is furthest along — a
   * company running Ship, Systemize and Run at once is one row here, not three
   * of itself. The other sections are on the project's own page, which is
   * where somebody goes to change which one they are working.
   */
  track: { goal: ProjectGoal; label: string; short: string; primary: boolean };
  phase: string;
  progress: { done: number; total: number };
  next: { id: string; title: string; actor: string; estimateMinutes: number | null; step: string | null } | null;
  daysSinceActivity: number;
  projectedAt: string | null;
  /** The step finished most recently, if it can still be shared for feedback. */
  lastDone: { taskId: string; title: string; completedAt: string; sharedPostId: string | null } | null;
  /** This week's progress update: finished steps nobody has shared yet. Due when there's at least one. */
  weekly: WeeklyUpdate;
  /** Set instead of `next` when there is no path to take a step on. */
  needsPath?: NeedsPath;
}

/**
 * The actor labels, shortened for a card. The long forms are ACTOR_LABEL in
 * phase-trees/types.ts, and typing this as Record<Actor, string> is what makes
 * a new actor a compile error here rather than a raw "user-decides" appearing
 * on somebody's home screen — which is what the web card's own copy of this
 * map did, having been keyed on an actor that does not exist.
 */
export const ACTOR_SHORT: Record<Actor, string> = {
  "nova-builds": "Nova builds it",
  "nova-drafts": "Nova drafts it",
  "user-decides": "You choose",
  "user-does": "Only you",
};

/**
 * The lines both cards say. Written once because they are the same sentence on
 * every screen, and a sentence duplicated is a sentence that will be edited in
 * one place.
 */
export const NEXT_STEP_COPY = {
  mainLineDone: "Main line done — pick what's next.",
  nothingWaiting: "Nothing waiting on a path right now.",
  startTitle: "This project isn't on a path yet",
  startBody: "A path is the sequence Nova works out with you — one step at a time, each with something to show at the end.",
  startAction: "Choose a path",
  adoptTitle: "Put this project on its path",
  adoptAction: "Start the path",
  /** Adoption reads the work that is already there, so it says so before it runs. */
  adoptBody: (done: number, total: number) =>
    total > 0
      ? `${done}/${total} tasks already done — Nova reads them and marks what's finished.`
      : "Nova sets up the steps and marks anything already finished.",
  failed: "Couldn't set the path up. Try again in a moment.",
} as const;
