/**
 * The project manager's data shapes and constants.
 *
 * The app doesn't import the repo's `shared/` folder, so the parts of
 * shared/phase-trees, shared/capital, shared/investment and shared/check-in
 * the manager needs are restated here. When those change, change these.
 */
import { useQueryClient } from "@tanstack/react-query";
import { API_URL } from "../../api/client";

// --- Phase trees (shared/phase-trees/types.ts, work.ts, loops.ts) ---------

export type Actor = "nova-builds" | "nova-drafts" | "user-decides" | "user-does";
export type VerificationTier = "verified" | "artifact" | "evidence" | "claimed";
export type WorkKind = "options" | "build" | "template" | "plan" | "intake";
export type LoopType = "product" | "growth" | "retention" | "revenue" | "referral";
export type ProjectGoal = "ship_mvp" | "systemize_business" | "raise_funding";

export interface IntakeQuestion {
  id: string;
  prompt: string;
  help?: string;
  kind?: "choice" | "text";
  options: { id: string; label: string }[];
  multi?: boolean;
  optional?: boolean;
  showIf?: { question: string; in: string[] };
  placeholder?: string;
}

export interface RunGroup { where: string; cwd?: string; label: string; commands: string[]; note?: string; before?: string; copy: string }
export interface PlanPayload {
  kind: "plan";
  summary: string;
  figures: { label: string; value: string; note?: string }[];
  tables: { title: string; columns: string[]; rows: string[][] }[];
  sections: { heading: string; body: string }[];
  assumptions: string[];
  gaps: string[];
  actions: { title: string; detail: string; when?: string; moves?: string }[];
  verifyWith?: string;
}
export type WorkPayload =
  | { kind: "options"; existing?: string; intro: string; options: { title: string; body: string; why?: string }[] }
  | { kind: "build"; existing?: string; summary: string; files: { path: string; language: string; content: string; purpose?: string }[]; runSteps: string[]; verify: string; assumptions: string[]; runGroups?: RunGroup[] }
  | { kind: "template"; intro: string; template: string; whatNovaDid: string; whatIsLeft: string }
  | PlanPayload
  | { kind: "intake"; answers: Record<string, string[]>; summary: string };

export interface WorkRow { id: string; kind: WorkPayload["kind"]; payload: WorkPayload; chosenIndex: number | null; createdAt: string }

export const ACTOR_LABEL: Record<Actor, string> = {
  "nova-builds": "Nova builds it — you run or review",
  "nova-drafts": "Nova drafts it — you edit or approve",
  "user-decides": "Nova lays out options — you choose",
  "user-does": "Only you can do this",
};
export const ACTOR_SHORT: Record<Actor, string> = {
  "nova-builds": "Nova builds", "nova-drafts": "Nova drafts", "user-decides": "You choose", "user-does": "You",
};
export const TIER_LABEL: Record<VerificationTier, string> = {
  verified: "Nova checks this itself",
  artifact: "Done when the artifact exists",
  evidence: "Done when you show it",
  claimed: "Your word counts",
};
const WORK_ACTION_LABEL: Record<Actor, string> = {
  "nova-builds": "Have Nova build this",
  "nova-drafts": "Have Nova draft options",
  "user-decides": "Have Nova lay out the options",
  "user-does": "Get Nova's template for this",
};
export const workActionLabel = (actor: Actor, kind?: WorkKind | null) =>
  kind === "plan" ? "Have Nova build this plan" : WORK_ACTION_LABEL[actor] ?? "Have Nova work on this";

export const LOOP_TYPES: LoopType[] = ["product", "growth", "retention", "revenue", "referral"];
export const LOOP_TYPE_INFO: Record<LoopType, { label: string; asks: string; example: string }> = {
  product: { label: "Product loop", asks: "The core thing one kind of user does over and over and gets value from each time.", example: "Open the path → do the next step → see the date move → come back for the next step." },
  growth: { label: "Growth loop", asks: "How new people find the product without you finding each of them.", example: "Builder publishes a check-in → it's indexed and shared → a stranger lands on it → signs up → publishes their own." },
  retention: { label: "Retention loop", asks: "Why someone who used it once comes back next week.", example: "Post an update → get a comment → notified → come back to reply → post the next update." },
  revenue: { label: "Revenue loop", asks: "How using the product turns into money, and money into more use.", example: "Hit the free limit → upgrade → get more done → need more capacity → stay subscribed or upgrade." },
  referral: { label: "Referral loop", asks: "How a user deliberately brings another user in.", example: "Invite a teammate → they join and get value → they get their own invite link and credit → invite theirs." },
};
export const LOOP_TYPE_COLOR: Record<LoopType, string> = {
  product: "#9745B5", growth: "#0284C7", retention: "#7C3AED", revenue: "#059669", referral: "#EA580C",
};
const MAX_PRODUCT_LOOPS = 4;
const LOOP_CAP = LOOP_TYPES.length - 1 + MAX_PRODUCT_LOOPS;
export function addableLoopTypes(loops: { type: LoopType }[]): LoopType[] {
  if (loops.length >= LOOP_CAP) return [];
  return LOOP_TYPES.filter((t) => t === "product" ? loops.filter((l) => l.type === "product").length < MAX_PRODUCT_LOOPS : !loops.some((l) => l.type === t));
}

export const PROJECT_GOALS: { id: ProjectGoal; label: string; subs: { id: string; label: string }[] }[] = [
  { id: "ship_mvp", label: "Ship an MVP", subs: [{ id: "app", label: "App" }, { id: "saas", label: "SaaS" }, { id: "game", label: "Game" }, { id: "website", label: "Website" }, { id: "other", label: "Other" }] },
  { id: "systemize_business", label: "Systemize a business", subs: [{ id: "restaurant", label: "Restaurant" }, { id: "service", label: "Service business" }, { id: "retail", label: "Retail" }, { id: "other", label: "Other" }] },
  { id: "raise_funding", label: "Raise funding", subs: [{ id: "startup_equity", label: "Startup equity" }, { id: "local_community", label: "Local community" }, { id: "loan_grant", label: "Loan or grant" }, { id: "other", label: "Other" }] },
];
export const goalLabel = (g: string) => PROJECT_GOALS.find((x) => x.id === g)?.label ?? g;

// --- The path (GET /api/projects/:id/path) --------------------------------

export interface PathMilestone {
  id: string; title: string; description: string; actor: Actor; estimateMinutes: number | null;
  tier: VerificationTier; done: boolean; taskId: string | null; taskStatus: string | null;
  expandsFrom?: string; steps: { done: number; total: number } | null;
  intake?: IntakeQuestion[]; prefill?: "resume"; routeQuestion?: string;
}
export interface NextAction extends PathMilestone {
  step: { taskId: string; title: string; description: string; actor: Actor; isLoop: boolean; loop: { taskId: string; title: string } | null } | null;
  loops: { taskId: string; title: string; description: string; status: string; expanded: boolean; type: LoopType }[];
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
export interface LoopStep { taskId: string; title: string; description: string; status: string; actor: Actor; estimateHours: number | null }
export interface LoopNode {
  taskId: string; title: string; description: string; written: boolean; status: string; actor: Actor; type: LoopType;
  state: "unwritten" | "written" | "planned" | "building" | "built";
  steps: LoopStep[]; done: number; total: number;
  closure: { closure: "closed" | "open" | "unbuilt"; breaksAt?: string | null; fix?: string | null; note?: string | null } | null;
}
export interface LoopTreeData {
  sourceId: string; sourceTitle: string; fanOutId: string; fanOutTitle: string; loops: LoopNode[];
  unassigned: { taskId: string; title: string; status: string }[];
  coverage?: { missing: LoopType[]; unwritten: LoopType[]; productLoops: number; complete: boolean };
  competition?: { id: string; createdAt: string; stale: boolean; audit: { overallScore: number; summary: string; caveat: string; loops: { loopTaskId: string; title: string; type: LoopType; score: number; verdict: string; recommendation?: string; gap?: string }[] } } | null;
}
export interface CapitalProfile {
  score: number;
  band: { id: "not_yet" | "early" | "with_work" | "strong" | "very_strong"; label: string };
  parts: { key: string; label: string; score: number; max: number; why: string; raise?: string | null }[];
  routeFit: { route: string; label: string; score: number; why: string }[];
  answered: number;
  route: string | null;
}
export type PaceState = "active" | "nudge" | "decaying" | "dormant";
export interface PathStatus {
  adopted: true;
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
  auditUpdate?: { auditId: string; at: string; applied: string[]; appliedCount: number; pendingCount: number; pendingLoops: string[] } | null;
  lastDone?: { taskId: string; title: string; completedAt: string; sharedPostId: string | null } | null;
  pace: { state: PaceState; multiplier: number | null; mode: "date" | "range" | "none" | "pipeline"; projectedAt: string | null; projectedLow: string | null; projectedHigh: string | null; note: string; daysSinceActivity: number } | null;
  proposal: { goal: ProjectGoal; why: string }[] | null;
  capital?: CapitalProfile | null;
}
export interface NoPath { adopted: false; goal: ProjectGoal; subcategory: string; promise: string; existingTasks: number; existingDone: number }

export function estimate(minutes: number | null) {
  if (minutes == null) return "open-ended";
  if (minutes === 0) return "automatic";
  if (minutes < 60) return `${minutes} min`;
  return `${Math.round(minutes / 60)}h`;
}
export const shortDay = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";

/** Whether an intake question is asked, given the answers before it. */
export const isAsked = (q: IntakeQuestion, answers: Record<string, string[]>) =>
  !q.showIf || (answers[q.showIf.question] ?? []).some((a) => q.showIf!.in.includes(a));

// --- Investment (shared/investment.ts) -------------------------------------

export const INVESTMENT_AMOUNTS = [
  { id: "lt10k", label: "Under $10k" }, { id: "10k_25k", label: "$10k–$25k" }, { id: "25k_100k", label: "$25k–$100k" },
  { id: "100k_250k", label: "$100k–$250k" }, { id: "250k_1m", label: "$250k–$1M" }, { id: "1m_plus", label: "$1M+" },
];
export const INVESTMENT_INSTRUMENTS = [
  { id: "equity", label: "Equity" }, { id: "convertible", label: "SAFE or convertible note" }, { id: "profit_share", label: "Profit share" },
  { id: "revenue_share", label: "Revenue share" }, { id: "loan", label: "A loan" }, { id: "open", label: "Open to discuss" },
];
export const INVESTOR_TYPES = [
  { id: "individual", label: "Individual" }, { id: "angel", label: "Angel investor" }, { id: "network", label: "Angel group or network" },
  { id: "fund", label: "Venture or investment fund" }, { id: "family_office", label: "Family office" },
  { id: "strategic", label: "Business in the industry" }, { id: "lender", label: "Lender or CDFI" },
];
export const ACCREDITED_ANSWERS = [{ id: "yes", label: "Yes" }, { id: "no", label: "No" }, { id: "unsure", label: "Not sure" }];
export type InvestmentStatus = "new" | "reviewing" | "accepted" | "declined" | "withdrawn";
export const INVESTMENT_STATUS_LABEL: Record<InvestmentStatus, string> = {
  new: "New", reviewing: "Reviewing", accepted: "Want to talk", declined: "Declined", withdrawn: "Withdrawn",
};
export const INVESTMENT_DISCLAIMER =
  "This is an application to talk about investing, not an investment. No money moves through SparkTower, and nothing here is an offer or sale of securities. Any investment happens directly between you and the founder, on terms you agree with your own advisers.";
export const labelOf = (list: { id: string; label: string }[], id: string | null | undefined) =>
  list.find((x) => x.id === id)?.label ?? id ?? "";
export interface InvestmentAsk { headline: string; amount: string | null; minimum: string | null; instruments: string[]; useOfFunds: string }

// --- Check-ins (shared/check-in.ts) ----------------------------------------

export const CHECK_IN_LIMITS = {
  goal: { min: 5, max: 120 }, proof: { min: 10, max: 400 }, blocker: { min: 0, max: 300 }, nextStep: { min: 5, max: 140 },
} as const;
const PROOF_KEYWORDS = ["shipped", "launched", "released", "deployed", "merged", "published", "fixed", "built", "added", "wrote", "recorded", "demo", "live", "signed", "sold", "interviewed", "tested", "migrated", "opened"];
const NON_VERB_OPENERS = ["the", "a", "an", "my", "our", "their", "his", "her", "its", "this", "that", "these", "those", "i", "we", "it", "there", "in", "on", "for", "to", "at", "by", "with", "about", "maybe", "hopefully", "probably", "still", "just", "more", "some"];
export type CheckInDraft = { goal: string; proof: string; blocker: string; nextStep: string };
export function validateCheckIn(d: CheckInDraft): Partial<Record<keyof CheckInDraft, string>> {
  const e: Partial<Record<keyof CheckInDraft, string>> = {};
  const len = (v: string) => (v ?? "").trim().length;
  const L = CHECK_IN_LIMITS;
  const gl = len(d.goal);
  if (gl < L.goal.min) e.goal = `Say what you were aiming for this week — at least ${L.goal.min} characters.`;
  else if (gl > L.goal.max) e.goal = `Keep the goal to one sentence (${gl}/${L.goal.max}).`;
  else if ((d.goal.match(/[.!?](\s|$)/g) || []).length > 1) e.goal = "One sentence. Put the detail in Proof.";
  const pl = len(d.proof);
  const url = /https?:\/\/\S+\.\S+|\b\S+\.(com|org|net|io|dev|app|co|ai|xyz|sh|me)\b/i.test(d.proof);
  if (pl < L.proof.min) e.proof = `Name something that exists now — at least ${L.proof.min} characters.`;
  else if (pl > L.proof.max) e.proof = `Trim the proof (${pl}/${L.proof.max}).`;
  else if (!url && !PROOF_KEYWORDS.some((k) => new RegExp(`\\b${k}`, "i").test(d.proof))) e.proof = "Link it, or say what shipped — \"launched\", \"merged\", \"wrote\", and so on.";
  if (len(d.blocker) > L.blocker.max) e.blocker = `Keep the blocker short (${len(d.blocker)}/${L.blocker.max}).`;
  const nl = len(d.nextStep);
  const first = d.nextStep.trim().toLowerCase().split(/[\s,]+/)[0]?.replace(/[^a-z']/g, "");
  if (nl < L.nextStep.min) e.nextStep = `One concrete thing you'll do next — at least ${L.nextStep.min} characters.`;
  else if (nl > L.nextStep.max) e.nextStep = `One step, not a plan (${nl}/${L.nextStep.max}).`;
  else if (!first || NON_VERB_OPENERS.includes(first)) e.nextStep = "Start with a verb — \"Ship…\", \"Interview…\", \"Write…\".";
  return e;
}
export const weekLabel = (weekStart: string | null | undefined) => {
  if (!weekStart) return "";
  const d = new Date(weekStart);
  if (Number.isNaN(d.getTime())) return "";
  return `Week of ${d.toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" })}`;
};

// --- Misc -------------------------------------------------------------------

/** The website serves from the API host; big web-only tools link there. */
export const webUrl = (path: string) => `${API_URL}${path}`;

/** Every path-related query on the manager, so a change anywhere shows everywhere. */
export function useRefreshPath(projectId: string) {
  const qc = useQueryClient();
  return () => {
    for (const key of ["path", "kanban", "briefing", "milestones", "project"]) {
      qc.invalidateQueries({ queryKey: ["manage", projectId, key] });
    }
    qc.invalidateQueries({ queryKey: ["subscription"] });
  };
}

export const mkey = (projectId: string, ...rest: (string | undefined)[]) => ["manage", projectId, ...rest.filter(Boolean)] as string[];
