import { normaliseGoal, type ProjectGoal } from "../goals";
import type { PathTree, BackboneMilestone, BackbonePhase, Actor, VerificationTier, IntakeQuestion } from "./types";
import type { WorkKind } from "./work";
import { SHIP_TREE } from "./ship";
import { SYSTEMIZE_TREE } from "./systemize";
import { RUN_TREE } from "./run";

export * from "./types";
export { SHARED_MILESTONES } from "./shared";
export * from "./pace";
export * from "./inject";
export * from "./work";
export * from "./run-steps";
export * from "./loops";
export * from "./intake";
export { COMPANY_BASICS_QUESTIONS } from "./run";

export const PATH_TREES: Record<ProjectGoal, PathTree> = {
  ship_mvp: SHIP_TREE,
  systemize_business: SYSTEMIZE_TREE,
  run_company: RUN_TREE,
};

/*
 * The goal is normalised on the way in, because this is where a *stored* goal
 * arrives. `raise_funding` folded into Systemize, and the alias in
 * shared/goals.ts exists so that rows written before the fold, and links still
 * carrying the old id, keep resolving. Read straight out of the table, an old
 * id returned `undefined` and the caller died on `tree.phases` — a crash on
 * data we deliberately promised to keep understanding.
 */
export const treeFor = (goal: ProjectGoal): PathTree => PATH_TREES[normaliseGoal(goal) ?? goal];

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
  /** Former authored text; see BackboneMilestone.supersedes. */
  supersedes?: string[];
  intake?: IntakeQuestion[];
  work?: WorkKind;
  prefill?: "resume";
  routeQuestion?: string;
  inMarket?: boolean;
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
 *
 * `route` is the route the project has chosen, on a path that has routes (the
 * funding routes' debt, seller, investor, hybrid, self-funded, now inside Systemize): a route's phases
 * appear once it's chosen, and only that route's.
 */
export function resolveTree(goal: ProjectGoal, subcategory: string, route?: string | null): ResolvedPhase[] {
  const tree = treeFor(goal);
  return tree.phases.filter((phase) => !phase.route || phase.route === route).map((phase) => ({
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
    supersedes: m.supersedes,
    intake: m.intake,
    work: m.work,
    prefill: m.prefill,
    routeQuestion: m.routeQuestion,
    inMarket: m.inMarket,
    variantApplied: !!v,
  };
}

/**
 * The authored text a task's description should be compared with: the
 * superseded text it still carries, if it carries one, else today's. Anything
 * different from what this returns is the builder's (or Nova's) answer.
 */
export function authoredTextFor(m: { description: string; supersedes?: string[] } | null | undefined, written: string | null | undefined): string {
  if (!m) return "";
  const w = (written ?? "").trim();
  return m.supersedes?.find((x) => w === x.trim() || w.startsWith(`${x.trim()}\n\n`))?.trim() ?? m.description.trim();
}

/** Every milestone id a path has ever authored for any route or type — what counts as still on the tree. */
export const allMilestoneIds = (goal: ProjectGoal): Set<string> =>
  new Set(treeFor(goal).phases.flatMap((p) => p.milestones.map((m) => m.id)));

/** Milestones on the main line only — the optional branch is offered, not counted. */
export const mainLineMilestones = (phases: ResolvedPhase[]) =>
  phases.filter((p) => !p.optional).flatMap((p) => p.milestones);
