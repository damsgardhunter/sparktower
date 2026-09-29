/**
 * The shape of a phase tree.
 *
 * Authored, never generated: the backbone for a path is the same for every
 * project on it, variants swap milestone content by project type, and Nova's
 * injected tasks sit on top — capped, and each one grounded in an artifact
 * Nova can name. See server/phase-trees.md for the design this encodes.
 */
import type { ProjectGoal } from "../goals";
import type { WorkKind } from "./work";

/** Who acts. The most important rule in the system. */
export type Actor = "nova-builds" | "nova-drafts" | "user-decides" | "user-does";

/**
 * What counts as done, and therefore how confidently a date can be projected.
 * Verified gets a hard date, Evidence a range, Claimed no projection.
 */
export type VerificationTier = "verified" | "artifact" | "evidence" | "claimed";

export interface Variant {
  /** Replaces the milestone title for this project type, if set. */
  title?: string;
  /** Replaces or extends the description for this project type. */
  description: string;
  /** Overrides the estimate for this type. */
  estimateMinutes?: number;
}

/**
 * A question answered by picking, not typing. Money questions especially:
 * "how much could you put in?" is easier to answer with a range to tap than a
 * box to fill, and "$0" has to be one of the choices, said without judgement.
 */
export interface IntakeQuestion {
  id: string;
  prompt: string;
  /** One line under the prompt, when the question needs it. */
  help?: string;
  /** "text" is a short line in their own words — used sparingly, and always optional. */
  kind?: "choice" | "text";
  options: { id: string; label: string }[];
  /** Several may be picked. Single choice otherwise. */
  multi?: boolean;
  /** Skippable — the answer reads as "not sure" and Nova works it out. */
  optional?: boolean;
  /** Asked only when an earlier question in the same step has one of these answers. */
  showIf?: { question: string; in: string[] };
  /** For text questions. */
  placeholder?: string;
}

/**
 * A screen that finishes a step by being used. Each is somewhere on the
 * project's own dashboard.
 *
 * A list rather than a bare union so it can be read at runtime: the phone
 * restates these names (Metro can't resolve @shared) and the mirror test
 * compares the two, which it can only do against something that exists after
 * compilation.
 */
export const PATH_SURFACES = ["wwit", "recurring-jobs", "quarter-goals"] as const;
export type PathSurface = (typeof PATH_SURFACES)[number];

export interface BackboneMilestone {
  /** Stable id, e.g. "SHIP.M1.2". Referenced by injected tasks and switching. */
  id: string;
  title: string;
  description: string;
  actor: Actor;
  /** For a range like "1–3h", the upper bound. Null where it's genuinely open. */
  estimateMinutes: number | null;
  tier: VerificationTier;
  /** Content by project type. Anything unlisted gets the universal text. */
  variants?: Record<string, Variant>;
  /** Project types this milestone is skipped for entirely. */
  skipFor?: string[];
  /** A shared milestone id (SH-0x), so work carries across paths. */
  sharedId?: string;
  /**
   * Some milestones fan out at runtime — "one per step of the core loop" —
   * and the count isn't known until an earlier milestone is answered. Nova's
   * injected layer expands these; the backbone carries one placeholder.
   */
  expandsFrom?: string;
  /**
   * Answered by tapping choices. The milestone is done when they're saved, no
   * Nova call and no credit — Nova reads the answers on every later step.
   */
  intake?: IntakeQuestion[];
  /** Where answers can be suggested from before the builder confirms them. */
  prefill?: "resume";
  /** The answer to this question (in `intake`) chooses the route: which route phases the path shows. */
  routeQuestion?: string;
  /** Done means outcomes now depend on other people: the dashboard switches to pipeline mode. */
  inMarket?: boolean;
  /**
   * What Nova produces here, when the actor's default isn't it. A financial
   * plan is "built" by Nova but is a document, not code: `plan`.
   */
  work?: WorkKind;
  /**
   * This step is finished by using a surface of its own, and not by Nova
   * writing an answer onto the step.
   *
   * Several Run milestones are closed by the thing they describe actually
   * happening — the weekly roadmap gets built, the recurring jobs get set up,
   * the quarter's goals get filed — by routes that call completeRunMilestone.
   * Without saying so here, those steps still offered the generic "Nova builds
   * it" button, which ran the ordinary work generator and closed the step with
   * a plausible paragraph. The builder ended up with the step ticked, no jobs
   * on the board, and nothing to tell them the difference.
   *
   * So the step points at where its work really happens, and the generic
   * generator is refused for it — on the server too, not only in the button,
   * because the button is not the only way to reach it.
   */
  doneOn?: { surface: PathSurface; label: string };
  /**
   * Authored text this milestone (or a variant) used to have. Tasks are
   * written at creation and keep their text, and "the description differs
   * from the authored one" is how an answer is recognised — so a project made
   * before a rewrite would read its old placeholder as an answer without this.
   */
  supersedes?: string[];
}

export interface BackbonePhase {
  /** "week-1", "branch-build", … */
  id: string;
  title: string;
  /** The checkpoint line at the end of the phase, if the doc has one. */
  checkpoint?: string;
  /** Not on the main line: offered, never imposed. */
  optional?: boolean;
  /** Shown only once the project has chosen this route (see BackboneMilestone.routeQuestion). */
  route?: string;
  milestones: BackboneMilestone[];
}

export interface PathTree {
  goal: ProjectGoal;
  /** The promise, in the user's terms. */
  promise: string;
  /** "4 weeks", "4 weeks to in-market". */
  target: string;
  /** Default tier for the path; a milestone may override. */
  defaultTier: VerificationTier;
  phases: BackbonePhase[];
}

export const ACTOR_LABEL: Record<Actor, string> = {
  "nova-builds": "Nova builds it — you run or review",
  "nova-drafts": "Nova drafts it — you edit or approve",
  "user-decides": "Nova lays out options — you choose",
  "user-does": "Only you can do this",
};
