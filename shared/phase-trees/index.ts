import type { ProjectGoal } from "../goals";
import type { PathTree, BackboneMilestone, BackbonePhase, Actor, VerificationTier } from "./types";
import { SHIP_TREE } from "./ship";
import { SYSTEMIZE_TREE } from "./systemize";
import { FUND_TREE } from "./fund";

export * from "./types";
export { SHARED_MILESTONES } from "./shared";
export * from "./pace";
export * from "./inject";
export * from "./work";

export const PATH_TREES: Record<ProjectGoal, PathTree> = {
  ship_mvp: SHIP_TREE,
  systemize_business: SYSTEMIZE_TREE,
  raise_funding: FUND_TREE,
};

export const treeFor = (goal: ProjectGoal): PathTree => PATH_TREES[goal];

/** One milestone, with the variant for this project type applied. */
export interface ResolvedMilestone {
  id: string;
  phaseId: string;
  title: string;
  description: string;
  actor: Actor;
  estimateMinutes: number | null;
  tier: VerificationTier;
  sharedId?: string;
  expandsFrom?: string;
  /** True when the text came from a variant rather than the universal line. */
  variantApplied: boolean;
}

export interface ResolvedPhase extends Omit<BackbonePhase, "milestones"> {
  milestones: ResolvedMilestone[];
}

/**
 * Adaptation layers 1 and 2: the backbone with this type's variants applied
 * and its skipped milestones removed. Layer 3 — Nova's injected tasks — is
 * added at runtime against real artifacts, never here.
 */
export function resolveTree(goal: ProjectGoal, subcategory: string): ResolvedPhase[] {
  const tree = treeFor(goal);
  return tree.phases.map((phase) => ({
    ...phase,
    milestones: phase.milestones
      .filter((m) => !m.skipFor?.includes(subcategory))
      .map((m) => resolveMilestone(m, phase.id, subcategory)),
  }));
}

function resolveMilestone(m: BackboneMilestone, phaseId: string, subcategory: string): ResolvedMilestone {
  const v = m.variants?.[subcategory];
  return {
    id: m.id,
    phaseId,
    title: v?.title ?? m.title,
    description: v?.description ?? m.description,
    actor: m.actor,
    estimateMinutes: v?.estimateMinutes ?? m.estimateMinutes,
    tier: m.tier,
    sharedId: m.sharedId,
    expandsFrom: m.expandsFrom,
    variantApplied: !!v,
  };
}

/** Milestones on the main line only — the optional branch is offered, not counted. */
export const mainLineMilestones = (phases: ResolvedPhase[]) =>
  phases.filter((p) => !p.optional).flatMap((p) => p.milestones);
