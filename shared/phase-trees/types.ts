/**
 * The shape of a phase tree.
 *
 * Authored, never generated: the backbone for a path is the same for every
 * project on it, variants swap milestone content by project type, and Nova's
 * injected tasks sit on top — capped, and each one grounded in an artifact
 * Nova can name. See server/phase-trees.md for the design this encodes.
 */
import type { ProjectGoal } from "../goals";

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
}

export interface BackbonePhase {
  /** "week-1", "branch-build", … */
  id: string;
  title: string;
  /** The checkpoint line at the end of the phase, if the doc has one. */
  checkpoint?: string;
  /** Not on the main line: offered, never imposed. */
  optional?: boolean;
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
