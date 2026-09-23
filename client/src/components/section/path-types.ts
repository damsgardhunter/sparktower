/**
 * The shape of GET /api/projects/:id/path?goal=… as the section screens read
 * it, and the small formatters every one of them shares.
 */
import type { IntakeQuestion, WorkKind, LoopType, Actor, VerificationTier, PaceState, ProjectionMode, PathSurface } from "@shared/phase-trees";
import type { ProjectGoal } from "@shared/goals";
import type { CapitalProfile } from "@shared/capital";
import type { WorkRow } from "@/components/path-work";
import type { LoopTreeData } from "@/components/loop-tree";

export interface PathMilestone {
  id: string; title: string; description: string; actor: Actor; estimateMinutes: number | null;
  tier: VerificationTier; done: boolean; taskId: string | null; taskStatus: string | null;
  expandsFrom?: string; steps: { done: number; total: number } | null;
  intake?: IntakeQuestion[];
  prefill?: "resume";
  routeQuestion?: string;
  /** See BackboneMilestone.doneOn: finished by using a surface of its own. */
  doneOn?: { surface: PathSurface; label: string };
}
export interface PathLoop { taskId: string; title: string; description: string; status: string; expanded: boolean; type: LoopType }
export interface NextAction extends PathMilestone {
  step: { taskId: string; title: string; description: string; actor: Actor; isLoop: boolean; loop: { taskId: string; title: string } | null } | null;
  loops: PathLoop[];
  missingLoopTypes?: LoopType[];
  workTaskId: string | null;
  workKind?: WorkKind | null;
  work: WorkRow | null;
}
export interface PathPhase {
  id: string; title: string; optional: boolean; checkpoint: string | null; total: number; done: number;
  milestones: PathMilestone[];
  injected: { id: string; title: string; status: string; artifact: string | null }[];
  injectRoom: number;
}
export interface PathPace { state: PaceState; multiplier: number | null; mode: ProjectionMode; projectedAt: string | null; projectedLow: string | null; projectedHigh: string | null; note: string; daysSinceActivity: number }
export interface AuditUpdate { auditId: string; at: string; applied: string[]; appliedCount: number; pendingCount: number; pendingLoops: string[] }
export interface PathEvent { id: string; title: string; estimateMinutes: number | null; actualMinutes: number | null; projectedBefore: string | null; projectedAfter: string | null; createdAt: string }

/** A section that isn't started (`started: false`), or started on a project made before paths (`started: true`). */
export interface NoPath { adopted: false; started?: boolean; goal: ProjectGoal; subcategory: string | null; promise: string; existingTasks: number; existingDone: number }
export interface PathStatus {
  adopted: true;
  started?: true;
  primary?: boolean;
  goal: ProjectGoal; subcategory: string; promise: string; target: string;
  phases: PathPhase[];
  current: { id: string; title: string; optional: boolean; step: number; of: number };
  branch: { phaseId: string; title: string; open: boolean; round: number } | null;
  offer: { phaseId: string; title: string; milestones: string[] } | null;
  next: NextAction | null;
  mainLine: { done: number; total: number };
  plan: { loops: number; authoredDays: number; totalMinutes: number; doneMinutes: number } | null;
  loopTree: LoopTreeData | null;
  novaNotes: string;
  rejectedLoops: string[];
  /** What the latest codebase audit changed on its own, and what it left waiting. */
  auditUpdate?: AuditUpdate | null;
  /** The step finished most recently, and the post that shared it, if one did. */
  lastDone?: { taskId: string; title: string; completedAt: string; sharedPostId: string | null } | null;
  weekly?: { due: boolean; steps: { taskId: string; title: string; completedAt: string }[] };
  pace: PathPace | null;
  events: PathEvent[];
  proposal: { goal: ProjectGoal; why: string }[] | null;
  capital?: (CapitalProfile & { route: string | null }) | null;
}
export type PathResponse = PathStatus | NoPath;

export const ACTOR_SHORT: Record<Actor, string> = {
  "nova-builds": "Nova builds it",
  "nova-drafts": "Nova drafts it",
  "user-decides": "You choose",
  "user-does": "Only you",
};

export const TIER_SHORT: Record<VerificationTier, string> = {
  verified: "Nova verifies",
  artifact: "Done when it exists",
  evidence: "Show proof",
  claimed: "Your word",
};

export function estimate(minutes: number | null) {
  if (minutes == null) return "Open-ended";
  if (minutes === 0) return "Automatic";
  if (minutes < 60) return `${minutes} min`;
  const h = Math.round(minutes / 60);
  return h >= 8 ? `${Math.round(h / 8)}d` : `${h}h`;
}

export const day = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "");

/** "just now", "4m ago", "3h ago", "2d ago". */
export function ago(iso: string | number | Date | null | undefined, now = Date.now()) {
  if (iso == null) return "";
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86_400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86_400)}d ago`;
}

export function projection(p: PathPace) {
  if (p.mode === "pipeline") return "Pipeline";
  if (p.mode === "none" || !p.projectedAt) return "No date yet";
  if (p.mode === "range" && p.projectedLow && p.projectedHigh) return `${day(p.projectedLow)} – ${day(p.projectedHigh)}`;
  return day(p.projectedAt);
}

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Nova's gradient, for Nova moments and the "next" highlight. */
export const NOVA_GRADIENT = "bg-gradient-to-r from-green-400 via-emerald-500 to-purple-500";
