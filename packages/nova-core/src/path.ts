/**
 * The shapes the bridge answers with.
 *
 * Hand-written rather than imported from the app's `shared/`, because these
 * packages ship on their own — an extension installed from the marketplace has
 * no access to the repository that built it. The server is the authority on
 * these; anything here that goes stale shows up as a missing field rather than
 * a wrong one, which is the failure mode worth having.
 */

/** Who acts on a step. The load-bearing field: it says whether a tool may act at all. */
export type Actor = "nova-builds" | "nova-drafts" | "user-decides" | "user-does";
export type VerificationTier = "verified" | "artifact" | "evidence" | "claimed";
export type WorkKind = "options" | "build" | "template";

export const ACTOR_LABEL: Record<Actor, string> = {
  "nova-builds": "Nova builds it — you run or review",
  "nova-drafts": "Nova drafts it — you edit or approve",
  "user-decides": "Nova lays out options — you choose",
  "user-does": "Only you can do this",
};

export interface WorkOption { title: string; body: string; why?: string }
export interface WorkFile { path: string; language: string; content: string; purpose?: string }

export interface OptionsPayload { kind: "options"; existing?: string; intro: string; options: WorkOption[] }
/** Where a block of run steps happens. */
export type RunPlace = "terminal" | "new-terminal" | "browser-console" | "browser" | "manual";

/**
 * Run steps as a block to copy. Computed by the server — including `copy`,
 * the exact clipboard text — so every client shows the same thing.
 */
export interface RunGroup {
  where: RunPlace;
  cwd?: string;
  label: string;
  commands: string[];
  note?: string;
  longRunning?: boolean;
  before?: string;
  copy: string;
}

export interface BuildPayload {
  kind: "build"; existing?: string; summary: string; files: WorkFile[];
  runSteps: string[]; verify: string; assumptions: string[];
  /** Which model wrote the files, when the server says. */
  model?: string;
  /** The run steps as blocks, from a server new enough to send them. */
  runGroups?: RunGroup[];
}
export interface TemplatePayload { kind: "template"; intro: string; template: string; whatNovaDid: string; whatIsLeft: string }
export type WorkPayload = OptionsPayload | BuildPayload | TemplatePayload;

export interface Work { id: string; kind: WorkKind; payload: WorkPayload; chosenIndex?: number | null; createdAt?: string }

export interface NovaProject {
  id: string; title: string; goal: string; subcategory: string;
  oneLiner: string | null; liveUrl: string | null; createdAt: string;
}

export interface PhaseSummary { id: string; title: string; done: number; total: number; optional: boolean }

export interface LoopStep { taskId: string; title: string; description: string; status: string; actor: Actor }

/** How far a loop has got. `unwritten` is a name and nothing else; `built` is every step done. */
export type LoopState = "unwritten" | "written" | "planned" | "building" | "built";

export interface Loop {
  taskId: string;
  title: string;
  description: string;
  status: string;
  state?: LoopState;
  /** On the next step's copy: whether it already has steps. */
  expanded?: boolean;
  written?: boolean;
  steps?: LoopStep[];
  done?: number;
  total?: number;
}

/**
 * How each state reads to a person — one set of words wherever loops are drawn.
 *
 * Lived privately in the webview until the path tree needed the same labels,
 * and a loop that says "Steps ready" in one panel and "written" in the one
 * beside it is two products, not one.
 */
export const LOOP_STATE_LABEL: Record<LoopState, string> = {
  unwritten: "Needs its steps written",
  written: "Steps ready",
  planned: "Broken into steps",
  building: "Building",
  built: "Built",
};

/** A loop's state, derived the same way everywhere when the server didn't send one. */
export const loopStateOf = (loop: Loop): LoopState =>
  loop.state ?? (loop.expanded ? "planned" : loop.description?.trim() ? "written" : "unwritten");

export interface LoopsResult {
  adopted: boolean;
  supported: boolean;
  message?: string;
  sourceId?: string;
  sourceTitle?: string;
  fanOutId?: string;
  fanOutTitle?: string;
  loops: Loop[];
  /** Titles the builder has already said aren't loops. */
  rejected?: string[];
  remaining?: number;
}

export interface NextStep {
  backboneId: string;
  title: string;
  description: string;
  actor: Actor;
  tier: VerificationTier;
  estimateMinutes: number | null;
  /** The task Nova would work. Null when the milestone has no task of its own. */
  workTaskId: string | null;
  step: { taskId: string; title: string; description: string } | null;
  /** The loops behind this milestone, when it has any. On the core loop, these are the work. */
  loops?: Loop[];
  work: Work | null;
}

export interface PathStatus {
  adopted: boolean;
  /** Present when `adopted` is false: the project predates paths and someone has to adopt one. */
  message?: string;
  goal: string;
  subcategory?: string;
  promise: string;
  target?: string;
  phase?: { id: string; title: string; step: number; of: number; optional: boolean };
  phases?: PhaseSummary[];
  progress?: { done: number; total: number };
  pace?: {
    mode: string; state: string; note: string;
    projectedAt: string | null; projectedLow: string | null; projectedHigh: string | null;
  } | null;
  plan?: unknown;
  next?: NextStep | null;
  complete?: boolean;
}

export interface VerifyCheck { backboneId: string; proven: boolean; evidence: string | null; markedNow: boolean }
export interface VerifyResult {
  scanned: { files: number; read: number; truncated: boolean };
  verified: string[];
  marked: string[];
  checks: VerifyCheck[];
  capabilitiesFrom: { auditId: string; at: string } | null;
  note: string;
}

export interface AuditResult {
  audit: {
    id: string; stage: string; completionPercent: number; summary: string;
    findings: {
      stackSummary?: string;
      capabilities?: { area: string; status: string; summary: string; missing?: string }[];
      risks?: { area: string; severity: string; finding: string; recommendation: string }[];
      missing?: { item: string; matters: string }[];
      nextThreeThings?: string[];
    };
  };
  creditsCharged: number;
  verifiedMilestones: { verified: string[]; marked: string[] };
}
