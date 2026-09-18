/**
 * The decision desk's arithmetic: the shapes GET /api/sim/ventures/:id/desk
 * sends, and the one sum that has to be right.
 *
 * Metro can't resolve the web app's `@shared` alias, so everything the server
 * sends is restated here rather than imported — the same arrangement as
 * lobby.ts, which says more about why. Where a constant is copied rather than
 * sent, the file it mirrors is named on the line above it, because a number
 * that drifts out of step with the engine is a number that lies to five people
 * at once.
 *
 * ## Why the phone does the sum at all
 *
 * The server already returns `preview.commitment`, and it is authoritative.
 * But it is a *poll* behind: a CMO who types two million into brand marketing
 * would see the table's total change two and a half seconds later, or — since
 * they haven't filed yet — not until they do. That is exactly backwards. The
 * whole point of showing the total is to change someone's mind *while their
 * thumb is still on the number*, so the phone recomputes it as they type and
 * the server's answer replaces it on the next poll.
 *
 * Which means this file has to match `commitment()` in
 * shared/simulation/levers.ts exactly. Not approximately: a local total that
 * reads 0.94 while the server resolves 1.07 is worse than no local total,
 * because it is the same failure the feature exists to prevent, wearing the
 * badge of the thing that was meant to prevent it. Hence desk.test.ts.
 */

// --- What the desk sends -------------------------------------------------
// Mirrors the response of GET /api/sim/ventures/:id/desk in
// server/simulation-desk-routes.ts.

/** Mirrors Role in shared/simulation/types.ts. */
export type DeskRole = "ceo" | "cmo" | "cfo" | "cto" | "coo";

/** The order seats are listed in, everywhere. Mirrors filedRoles() in shared/simulation/levers.ts. */
export const ROLE_ORDER: DeskRole[] = ["ceo", "cmo", "cfo", "cto", "coo"];

/** Mirrors LeverField in shared/simulation/levers.ts. */
export interface LeverField {
  id: string;
  label: string;
  help: string;
  kind: "money" | "price" | "count" | "choice";
  min?: number;
  max?: number;
  step?: number;
  options?: { value: string; label: string; help: string }[];
}

/** Mirrors Commitment in shared/simulation/levers.ts. */
export interface Commitment {
  spend: number;
  fixed: number;
  available: number;
  ratio: number;
  bySeat: { role: DeskRole; spend: number }[];
}

/** Mirrors DraftPreview in shared/simulation/levers.ts. */
export interface DraftPreview {
  commitment: Commitment;
  notes: string[];
  warnings: string[];
}

/** The subset of Company the desk sends. Mirrors Company in shared/simulation/types.ts. */
export interface DeskCompany {
  cash: number;
  debt: number;
  creditLimit: number;
  reputation: number;
  quality: number;
  brand: number;
  service: number;
  capacity: number;
  unitCost: number;
  price: number;
  customers: number;
  bankruptSince: number | null;
  /** The seats the engine still charges an executive salary for. Mirrors Company in shared/simulation/types.ts. */
  seats: DeskRole[];
}

/** Mirrors Economy in shared/simulation/types.ts, plus the sentence the route adds. */
export interface DeskEconomy {
  demand: number;
  interestRate: number;
  costIndex: number;
  outlook: "expansion" | "steady" | "tightening";
  outlookMeans: string;
}

export interface DeskSegment {
  id: string;
  name: string;
  description: string;
  referencePrice: number;
  loyalty: number;
  /** Customers of this segment you currently hold. */
  yours: number;
}

export interface DeskTableSeat {
  userId: string;
  name: string;
  role: DeskRole | null;
  title: string | null;
  filed: boolean;
  isYou: boolean;
}

export interface DeskRival {
  id: string;
  name: string;
  kind: "player" | "incumbent";
  price: number;
  customers: number;
  posture: string | null;
  posturedAs: string | null;
}

/** Mirrors CompanyReport in shared/simulation/types.ts. */
export interface CompanyReport {
  companyId: string;
  name: string;
  year: number;
  customers: number;
  marketShare: number;
  shareChange: number;
  turnedAway: number;
  revenue: number;
  costs: number;
  profit: number;
  cash: number;
  debt: number;
  reputation: number;
  reputationChange: number;
  quality: number;
  brand: number;
  service: number;
  rank: number;
  /** The year's prose. Market outcomes are not in here — they have their own field. */
  notes: string[];
  /**
   * What the year's sealed bids did, typed rather than described.
   *
   * Filled in by the tick rather than the engine (settlement happens after a
   * year resolves), and typed so a won bid can be shown differently from a
   * lost one without any client pattern-matching the sentence. Absent on a
   * year with no bids, and on any report written before the field existed.
   */
  market?: ReportMarketNote[];
  bankrupt: boolean;
}

/**
 * One settled bid, as the report carries it.
 *
 * Mirrors CompanyReport["market"] in shared/simulation/resolve.ts. `lost`
 * covers both being outbid and nothing clearing the reserve: the company's
 * position is identical either way — no asset, money untouched — and the
 * sentence in `text` still says which of the two happened.
 */
export interface ReportMarketNote {
  kind: "won" | "lost" | "sold" | "unsold";
  text: string;
}

/** One year's decisions from every seat. Mirrors TeamDecisions in shared/simulation/decisions.ts. */
export type FiledDecisions = { companyId?: string } & Partial<Record<DeskRole, Record<string, any>>>;

export interface DeskView {
  phase: "not_started" | "running" | "finished";
  ventureId: string;
  name: string | null;
  product?: string | null;
  niche?: { id: string; name: string; premise: string };
  year?: number;
  totalYears?: number;
  /** ISO timestamp this year resolves at, or null once the season has finished. */
  resolvesAt?: string | null;
  yourRole: DeskRole | null;
  yourTitle?: string | null;
  yourLevers?: string[];
  fields?: LeverField[];
  draft?: Record<string, any> | null;
  submitted?: boolean;
  company?: DeskCompany;
  segments?: DeskSegment[];
  economy?: DeskEconomy;
  table?: DeskTableSeat[];
  filed?: FiledDecisions;
  preview?: DraftPreview;
  lastYear?: CompanyReport | null;
  rivals?: DeskRival[];
  /** This seat's own objective for the year, or null before one is set. */
  challenge?: Challenge | null;
  /** How last year's went. Null in year one. */
  lastChallenge?: ChallengeResult | null;
  /** How much trouble the company is in, and what can be done about it. */
  distress?: DeskDistress;
}

/** What POST /api/sim/ventures/:id/decisions answers with. */
export interface FileDecisionResult {
  ok: boolean;
  year: number;
  draft: Record<string, any>;
  preview: DraftPreview;
}

// --- The sum -------------------------------------------------------------

/** Mirrors fixedCosts() in shared/simulation/decisions.ts. */
export const SALARY_PER_HEAD = 85_000;
/** Mirrors fixedCosts() in shared/simulation/decisions.ts: one salary per filled seat. */
export const EXECUTIVE_SALARY = 140_000;

/**
 * Mirrors fixedCosts() in shared/simulation/decisions.ts.
 *
 * Both halves are now computable on the phone: the desk sends `company.seats`,
 * which is the engine's own seat list and not the same thing as the `table`
 * array — a dissolved seat leaves the table but stops costing a salary, so the
 * two can diverge and only one of them is the bill.
 */
export function fixedCosts(headcount: number, costIndex: number, seatCount: number): number {
  const salaries = num(headcount) * SALARY_PER_HEAD * (Number.isFinite(costIndex) ? costIndex : 1);
  return salaries + Math.max(0, num(seatCount)) * EXECUTIVE_SALARY;
}

/** A value that may have arrived as a string from a text input, as a number. */
function num(value: any): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * What the table has committed, and what it has.
 *
 * Mirrors commitment() in shared/simulation/levers.ts, term for term —
 * including the details that look like accidents and aren't: the CEO
 * contributes nothing, the CFO's contribution is the *repayment* (money that
 * leaves) and never the drawdown (money that arrives, which is why `borrow`
 * shows up in `available` instead), the COO's headcount is a fixed cost rather
 * than discretionary spend, and `available` counts the unused credit line as
 * money the company has — because it is, and a team that only sees cash
 * over-reads its own danger and under-spends the whole season.
 */
export function commitment(input: {
  company: Pick<DeskCompany, "cash" | "debt" | "creditLimit" | "seats">;
  decisions: FiledDecisions;
  costIndex: number;
}): Commitment {
  const { company, decisions, costIndex } = input;
  const cmo = decisions.cmo ?? {};
  const cto = decisions.cto ?? {};
  const coo = decisions.coo ?? {};
  const cfo = decisions.cfo ?? {};

  const bySeat: { role: DeskRole; spend: number }[] = [
    { role: "cmo", spend: num(cmo.brandSpend) + num(cmo.performanceSpend) + num(cmo.celebritySpend) },
    { role: "cto", spend: num(cto.featureSpend) + num(cto.reliabilitySpend) + num(cto.techDebtPaydown) },
    { role: "coo", spend: num(coo.supportSpend) + num(coo.efficiencySpend) },
    { role: "cfo", spend: Math.max(0, num(cfo.repay)) },
    { role: "ceo", spend: 0 },
  ];

  const spend = bySeat.reduce((sum, s) => sum + s.spend, 0);
  const fixed = fixedCosts(num(coo.headcount), costIndex, company.seats?.length ?? 0);
  const borrowable = Math.max(0, company.creditLimit - company.debt);
  const available = Math.max(0, company.cash + num(cfo.borrow) + borrowable - num(cfo.cashBuffer));

  return { spend, fixed, available, ratio: available > 0 ? (spend + fixed) / available : Infinity, bySeat };
}

/**
 * Everyone's filed decisions, with your unsaved edits standing in for yours.
 *
 * The point of the live total: what you are *about* to commit counts against
 * the table immediately, not when you press the button. A seat with no role
 * changes nothing.
 */
export function withYourDraft(filed: FiledDecisions | undefined, role: DeskRole | null, draft: Record<string, any> | null): FiledDecisions {
  const base: FiledDecisions = { ...(filed ?? {}) };
  if (!role || !draft) return base;
  return { ...base, [role]: draft };
}

/** How over-committed the table is, and how loudly to say so. */
export type CommitmentLevel = "clear" | "tight" | "over";

/**
 * Thresholds mirror the warnings draftPreview() raises in
 * shared/simulation/levers.ts — 0.9 is "almost everything", above 1 the year
 * runs on credit — so the colour on the phone and the sentence from the server
 * can never contradict each other.
 */
export function commitmentLevel(ratio: number): CommitmentLevel {
  if (!Number.isFinite(ratio) || ratio > 1) return "over";
  if (ratio > 0.9) return "tight";
  return "clear";
}

/** How short the table is, or how much is left. Positive means short. */
export const shortfall = (c: Commitment): number => c.spend + c.fixed - c.available;

/**
 * The part of the spend the engine calls "discretionary".
 *
 * The three seats that buy things, and not the finance seat's repayment.
 * Mirrors both the `spend` metric in shared/simulation/challenges.ts and the
 * sum the tick reviews a covenant against (server/simulation-tick.ts), which
 * are deliberately the same number — a spending cap and a "without spending
 * your way there" target have to mean the same thing or one of them is lying.
 */
export const discretionarySpend = (c: Commitment): number =>
  c.bySeat.filter((s) => s.role === "cmo" || s.role === "cto" || s.role === "coo")
    .reduce((sum, s) => sum + s.spend, 0);

// --- The clock -----------------------------------------------------------

/**
 * Seconds until the year resolves, from an ISO timestamp.
 *
 * Unlike the lobby's `secondsLeft`, the desk sends an absolute time, so the
 * phone's clock is the one doing the arithmetic. That is fine at this scale —
 * being ninety seconds out on a deadline twenty hours away changes nothing,
 * where in a two-minute claiming phase it would change everything — but it is
 * the reason this is a different function rather than the lobby's reused.
 */
export function secondsUntil(iso: string | null | undefined, nowMs: number): number | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return null;
  return Math.max(0, (at - nowMs) / 1000);
}

/**
 * "1d 23h", "3h 25m", "12:04", "9s".
 *
 * Mirrors longCountdown() in shared/simulation/lobby-copy.ts, thresholds
 * included. The lobby's mm:ss is right for a phase that lasts minutes and
 * wrong for a year that lasts a day — it rendered a deadline as "2878:46" on
 * web, which is technically minutes and seconds and means nothing to anyone.
 * Past an hour the units get spelled out; inside one, seconds still matter
 * because that is when people are actually watching the number.
 */
export function formatUntil(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds)) return "—";
  const safe = Math.max(0, Math.floor(seconds));
  if (safe < 60) return `${safe}s`;

  const minutes = Math.floor(safe / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (hours < 1) return `${minutes}:${String(safe % 60).padStart(2, "0")}`;
  if (days < 1) return `${hours}h ${minutes % 60}m`;
  return `${days}d ${hours % 24}h`;
}

/** Inside the last half hour, filing stops being a plan and starts being a deadline. */
export const resolveIsImminent = (seconds: number | null): boolean =>
  seconds != null && Number.isFinite(seconds) && seconds <= 30 * 60;

// --- The form ------------------------------------------------------------

/** What a stepper moves by when the field doesn't say. */
export function stepFor(field: LeverField): number {
  if (field.step && field.step > 0) return field.step;
  return field.kind === "money" ? 50_000 : 1;
}

/**
 * One tap of + or −, clamped to the field's own bounds.
 *
 * Typing 1500000 on a phone keyboard is how a CMO commits ten times what they
 * meant to, so the steppers are the primary control and the keyboard is the
 * fallback. Stepping lands on multiples of the step from zero rather than from
 * wherever the value happened to be, so a draft carried over from last year
 * tidies itself up instead of staying at 1,237,000 forever.
 */
export function bump(field: LeverField, value: any, direction: 1 | -1): number {
  const step = stepFor(field);
  const current = num(value);
  const snapped = direction > 0
    ? Math.floor(current / step + 1e-9) * step + step
    : Math.ceil(current / step - 1e-9) * step - step;
  return clampToField(field, snapped);
}

/** Inside min/max, and never a fractional count of people. */
export function clampToField(field: LeverField, value: number): number {
  let n = Number.isFinite(value) ? value : 0;
  if (field.kind === "count") n = Math.round(n);
  if (field.min !== undefined) n = Math.max(field.min, n);
  if (field.max !== undefined) n = Math.min(field.max, n);
  return n;
}

/**
 * Whether this draft is submittable, and why not.
 *
 * Mirrors validateDecision() in shared/simulation/levers.ts — deliberately
 * including what it *doesn't* check. An expensive year is not an invalid one:
 * spending more than the company has is a decision the table is allowed to
 * make, and saying what it costs is the commitment meter's job. A form that
 * refuses the risky answer is a form that plays the game for you.
 *
 * The server validates again and wins; this only exists so the errors appear
 * under the right control before a round trip, and so the button can be honest
 * about being disabled.
 */
export function validateDraft(
  fields: LeverField[],
  draft: Record<string, any>,
  company: Pick<DeskCompany, "debt">,
  role: DeskRole | null,
): { ok: boolean; errors: Record<string, string> } {
  const errors: Record<string, string> = {};

  for (const field of fields) {
    const value = draft?.[field.id];

    if (field.kind === "choice") {
      if (!field.options?.some((o) => o.value === value)) errors[field.id] = "Pick one.";
      continue;
    }

    if (value === undefined || value === null || value === "") { errors[field.id] = "Needs a number."; continue; }
    const n = Number(value);
    if (!Number.isFinite(n)) { errors[field.id] = "Needs a number."; continue; }
    if (field.min !== undefined && n < field.min) errors[field.id] = `Can't go below ${field.min}.`;
    if (field.max !== undefined && n > field.max) errors[field.id] = `Can't go above ${field.max}.`;
  }

  // The one hard stop the server keeps: you cannot repay money you do not owe.
  if (role === "cfo" && Number(draft?.repay) > company.debt) {
    errors.repay = `You only owe ${Math.round(company.debt).toLocaleString()}.`;
  }

  return { ok: Object.keys(errors).length === 0, errors };
}

/** True when nothing has been touched since the last file, so the button can say "Filed". */
export function draftMatches(a: Record<string, any> | null | undefined, b: Record<string, any> | null | undefined): boolean {
  if (!a || !b) return false;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    const l = a[key];
    const r = b[key];
    // No lever sends a list today; kept because the comparison is cheap and a
    // silent false-equal on one would show "nothing to change" over a real edit.
    if (Array.isArray(l) || Array.isArray(r)) {
      if (JSON.stringify(l ?? []) !== JSON.stringify(r ?? [])) return false;
      continue;
    }
    if (typeof l === "number" || typeof r === "number") {
      if (num(l) !== num(r)) return false;
      continue;
    }
    if ((l ?? null) !== (r ?? null)) return false;
  }
  return true;
}

// --- Reading the numbers -------------------------------------------------

/**
 * "6.2m", "850k", "−1.4m".
 *
 * No currency symbol, because the engine's own warnings don't use one and a
 * screen that says "£6,200,000" beside a server sentence that says "6,200,000"
 * reads as two different numbers.
 */
export function money(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const sign = n < 0 ? "−" : "";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) {
    const m = abs / 1_000_000;
    return `${sign}${m >= 10 ? Math.round(m) : trim(m.toFixed(1))}m`;
  }
  if (abs >= 1_000) {
    const k = abs / 1_000;
    return `${sign}${k >= 10 ? Math.round(k) : trim(k.toFixed(1))}k`;
  }
  return `${sign}${Math.round(abs)}`;
}

const trim = (s: string) => (s.endsWith(".0") ? s.slice(0, -2) : s);

/** The exact figure, for the places where rounding to "6.2m" would hide the point. */
export const exact = (n: number): string => (Number.isFinite(n) ? Math.round(n).toLocaleString() : "—");

/** A signed number, for changes that read better with the direction in front. */
export const signed = (n: number, digits = 0): string =>
  !Number.isFinite(n) ? "—" : `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(digits)}`;

/** "12.4%" from a 0–1 share. */
export const percent = (fraction: number, digits = 1): string =>
  Number.isFinite(fraction) ? `${(fraction * 100).toFixed(digits)}%` : "—";

/**
 * What the coming weather means, in a word, when the server's sentence is too
 * long for a pill. Mirrors the outlooks in shared/simulation/types.ts.
 */
export const OUTLOOK_LABEL: Record<DeskEconomy["outlook"], string> = {
  expansion: "Busier next year",
  steady: "Steady next year",
  tightening: "Thinner next year",
};

/** Who the table is still waiting on, in seat order. */
export function waitingOn(table: DeskTableSeat[] | undefined): DeskTableSeat[] {
  const seats = table ?? [];
  const rank = (r: DeskRole | null) => (r ? ROLE_ORDER.indexOf(r) : ROLE_ORDER.length);
  return seats.filter((s) => !s.filed).sort((a, b) => rank(a.role) - rank(b.role));
}

/**
 * The one line about where the table is.
 *
 * Said in terms of people rather than counts — "waiting on Priya and Sam" is
 * something you can act on in the group chat; "3/5 filed" is a progress bar.
 */
export function tableStatus(table: DeskTableSeat[] | undefined): string {
  const seats = table ?? [];
  if (seats.length === 0) return "Nobody at the table yet.";

  const pending = waitingOn(seats);
  if (pending.length === 0) return "Everyone has filed. The year resolves on the tick.";

  const others = pending.filter((s) => !s.isYou).map((s) => s.name);
  if (others.length === 0) return "You're the only one who hasn't filed.";

  const list = others.length === 1
    ? others[0]
    : `${others.slice(0, -1).join(", ")} and ${others[others.length - 1]}`;

  return pending.some((s) => s.isYou) ? `Waiting on ${list} — and on you.` : `Waiting on ${list}.`;
}

// --- Your own year, inside five people's company -------------------------
// Mirrors shared/simulation/challenges.ts. The challenge is the one thing on
// this screen that is *yours*: the company's result is four other people too,
// and a seat that was dealt at random needs its own answer to "did I play this
// well". Which is also why none of it is paraphrased here — the server writes
// the brief against the company's actual position, and a screen that
// summarises it away turns a sentence written for you into a status line.

/** Mirrors MetricId in shared/simulation/challenges.ts. */
export type MetricId =
  | "customers" | "market_share" | "revenue" | "profit" | "reputation" | "quality"
  | "brand" | "service" | "price" | "unit_cost" | "cash" | "debt" | "turned_away"
  | "capacity" | "spend";

/** Mirrors Target in shared/simulation/challenges.ts. */
export interface Target {
  id: string;
  label: string;
  goal: number;
  compare: "at_least" | "at_most";
  metric: MetricId;
}

/** Mirrors Reward in shared/simulation/challenges.ts. */
export interface Reward {
  kind: "reputation" | "cash" | "capacity" | "credit";
  amount: number;
  label: string;
}

/** Mirrors Challenge in shared/simulation/challenges.ts. */
export interface Challenge {
  id: string;
  role: DeskRole;
  year: number;
  title: string;
  brief: string;
  targets: Target[];
  reward: Reward;
  partialReward: Reward;
}

/** Mirrors TargetResult in shared/simulation/challenges.ts. */
export interface TargetResult extends Target {
  actual: number;
  met: boolean;
}

/** Mirrors ChallengeResult in shared/simulation/challenges.ts. */
export interface ChallengeResult {
  challengeId: string;
  role: DeskRole;
  year: number;
  outcome: "met" | "partial" | "missed";
  targets: TargetResult[];
  note: string;
  reward: Reward | null;
}

/**
 * Where a target's number can be read from today.
 *
 * `now` is the company as it stands — a live figure the player can act on.
 * `committed` is this year's draft spending, which is a real number about the
 * year in progress rather than a guess at its outcome. `unknown` is the honest
 * answer for everything the year has to actually *run* to produce.
 */
export type ProgressSource = "now" | "committed" | "unknown";

export interface TargetProgress {
  target: Target;
  /** Null when the number can't be known before the tick. */
  actual: number | null;
  source: ProgressSource;
  /** Whether it would pass if the year ended on today's figure. Null when unknown. */
  met: boolean | null;
  /** 0–1 for a bar. Null when unknown. */
  fraction: number | null;
}

/** The metrics the desk payload already carries a live value for. */
const LIVE_METRICS: Partial<Record<MetricId, (c: DeskCompany) => number>> = {
  customers: (c) => c.customers,
  reputation: (c) => c.reputation,
  quality: (c) => c.quality,
  brand: (c) => c.brand,
  service: (c) => c.service,
  price: (c) => c.price,
  unit_cost: (c) => c.unitCost,
  cash: (c) => c.cash,
  debt: (c) => c.debt,
  capacity: (c) => c.capacity,
};

/**
 * Why a target has no number yet, said as a fact rather than an apology.
 *
 * These four are outcomes of the year rather than states of the company:
 * nothing the phone holds could produce them, and inventing a stand-in — last
 * year's profit shown under this year's target — would be a screen quietly
 * telling somebody they were 40% of the way to something they hadn't started.
 */
export const METRIC_PENDING: Partial<Record<MetricId, string>> = {
  market_share: "Known when the year resolves",
  revenue: "Known when the year resolves",
  profit: "Known when the year resolves",
  turned_away: "Known when the year resolves",
};

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/**
 * How far along one target is, from what the desk already knows.
 *
 * `spend` is the interesting case: it is not a state of the company, but it
 * *is* this year's committed discretionary spending, which the phone computes
 * anyway for the commitment meter. So a "without spending your way there"
 * target can be answered live, from the same sum — the CMO who is about to
 * break their own ceiling finds out while their thumb is on the number.
 */
export function targetProgress(target: Target, from: {
  company?: Pick<DeskCompany, "customers" | "reputation" | "quality" | "brand" | "service" | "price" | "unitCost" | "cash" | "debt" | "capacity"> | null;
  /** This year's discretionary spend, as the commitment meter computes it. */
  committedSpend?: number | null;
}): TargetProgress {
  const read = LIVE_METRICS[target.metric];
  let actual: number | null = null;
  let source: ProgressSource = "unknown";

  if (target.metric === "spend" && from.committedSpend != null && Number.isFinite(from.committedSpend)) {
    actual = from.committedSpend;
    source = "committed";
  } else if (read && from.company) {
    const value = read(from.company as DeskCompany);
    if (Number.isFinite(value)) { actual = value; source = "now"; }
  }

  if (actual == null) return { target, actual: null, source: "unknown", met: null, fraction: null };

  const met = target.compare === "at_least" ? actual >= target.goal : actual <= target.goal;
  return { target, actual, source, met, fraction: fractionOf(target, actual) };
}

/**
 * The bar, for targets that have one.
 *
 * An "at most" target is drawn as room left rather than distance travelled —
 * full while you are inside it, and shrinking as you approach the ceiling —
 * because "don't go above 24" is a budget, and a budget bar that fills up as
 * you spend is the one everybody already knows how to read.
 */
function fractionOf(target: Target, actual: number): number {
  if (target.compare === "at_least") {
    if (target.goal <= 0) return actual >= target.goal ? 1 : 0;
    return clamp01(actual / target.goal);
  }
  if (actual <= target.goal) return 1;
  if (target.goal <= 0 || actual <= 0) return 0;
  return clamp01(target.goal / actual);
}

/** Every target, in the order the challenge lists them. */
export const challengeProgress = (
  challenge: Challenge,
  from: Parameters<typeof targetProgress>[1],
): TargetProgress[] => challenge.targets.map((t) => targetProgress(t, from));

/**
 * Where the challenge stands, counted rather than judged.
 *
 * `pending` matters as much as `met`: "one of two, one still to settle" is a
 * true sentence, where "one of two" alone reads as a half-failure to somebody
 * whose other target simply cannot be known until the tick.
 */
export function challengeStanding(progress: TargetProgress[]): {
  met: number; missing: number; pending: number; of: number; line: string;
} {
  const met = progress.filter((p) => p.met === true).length;
  const missing = progress.filter((p) => p.met === false).length;
  const pending = progress.filter((p) => p.met == null).length;
  const of = progress.length;

  const line = of === 0 ? "Nothing set this year."
    : pending === of ? "Both settle when the year runs."
      : missing === 0 && pending === 0 ? "On both, as things stand."
        : met === 0 && pending === 0 ? "Neither, on today's numbers."
          : `${met} of ${of} on today's numbers${pending > 0 ? `, ${pending} still to settle` : ""}.`;

  return { met, missing, pending, of, line };
}

/**
 * A metric's value, in the units that metric is actually read in.
 *
 * Mirrors fmt() in shared/simulation/challenges.ts closely enough that the
 * server's own note ("got 23.40") and the number above it agree. A unit cost
 * of 23.4 shown as "23" beside a goal of 23.15 would be a screen telling
 * somebody they had hit a target they had missed.
 */
/** "23.40" → "23.4", "24.00" → "24". The pennies only when there are any. */
const trimZeros = (s: string): string => (s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s);

export function metricRead(metric: MetricId, value: number): string {
  if (!Number.isFinite(value)) return "—";
  switch (metric) {
    case "market_share": return `${value.toFixed(1)}%`;
    case "price":
    case "unit_cost": return Math.abs(value) >= 1_000 ? exact(value) : trimZeros(value.toFixed(2));
    case "reputation":
    case "quality":
    case "brand":
    case "service": return String(Math.round(value));
    default: return money(value);
  }
}

/** "at least 45,000" / "at most 24.20", as the target would be said aloud. */
export const targetGoalRead = (target: Target): string =>
  `${target.compare === "at_least" ? "at least" : "at most"} ${metricRead(target.metric, target.goal)}`;

/**
 * The prize, in four words.
 *
 * The reward's own `label` is the sentence and stays the sentence; this is the
 * badge that goes beside the title, because "+750k credit" is what a player
 * compares against the risk of missing.
 */
export function rewardRead(reward: Reward): string {
  switch (reward.kind) {
    case "reputation": return `+${Math.round(reward.amount)} reputation`;
    case "capacity": return `+${Math.round(reward.amount * 100)}% capacity`;
    case "cash": return `+${money(reward.amount)} cash`;
    case "credit": return `+${money(reward.amount)} credit`;
  }
}

/** How a finished challenge is coloured and named. Mirrors the outcomes in checkChallenge(). */
export const OUTCOME_LABEL: Record<ChallengeResult["outcome"], string> = {
  met: "Done",
  partial: "Half of it",
  missed: "Missed",
};

// --- Trouble, and the way out of it --------------------------------------
// Mirrors shared/simulation/recovery.ts. The copy there is written to be read
// before choosing — every option states what it costs in the same breath as
// what it raises — so this file carries the shapes and the arithmetic and
// leaves every sentence to the server.

/** Mirrors Distress in shared/simulation/recovery.ts. */
export type Distress = "healthy" | "strained" | "distressed" | "insolvent";

/** Mirrors RecoveryKind in shared/simulation/recovery.ts. */
export type RecoveryKind = "restructure" | "fire_sale" | "dissolve_seat" | "rescue_raise";

/** Mirrors RecoveryOption in shared/simulation/recovery.ts. */
export interface RecoveryOption {
  kind: RecoveryKind;
  title: string;
  body: string;
  /** What it costs, said out loud before they choose it. Never summarised away. */
  cost: string;
  raises: number;
  from: Distress[];
}

/** Mirrors Covenant in shared/simulation/recovery.ts. */
export interface Covenant {
  since: number;
  spendCap: number;
  /** Consecutive years met so far. */
  met: number;
  rateRelief: number;
}

/** What GET /api/sim/ventures/:id/desk sends under `distress`. */
export interface DeskDistress {
  level: Distress;
  title: string;
  body: string;
  options: RecoveryOption[];
  covenant: Covenant | null;
  filed: { kind: RecoveryKind; seat: string | null } | null;
}

/** Mirrors COVENANT_YEARS in shared/simulation/recovery.ts. */
export const COVENANT_YEARS = 2;

/** Worst first, so a comparison between two states is an ordering and not a lookup. */
export const DISTRESS_RANK: Record<Distress, number> = { healthy: 0, strained: 1, distressed: 2, insolvent: 3 };

/** True when the state is worth putting at the top of the desk. */
export const inTrouble = (level: Distress | undefined): boolean => !!level && level !== "healthy";

/** Only the chief executive files one — see the 403 in server/simulation-market-routes.ts. */
export const canFileRecovery = (role: DeskRole | null | undefined): boolean => role === "ceo";

/** The one move that needs an answer before it can be filed. */
export const recoveryNeedsSeat = (kind: RecoveryKind): boolean => kind === "dissolve_seat";

/**
 * The seats that can be dissolved: every filled one except the chair.
 *
 * The server refuses `ceo` with a 400, and a picker that offers a choice the
 * server will refuse is a picker that teaches people to distrust it.
 */
export const dissolvableSeats = (seats: DeskRole[] | undefined): DeskRole[] =>
  (seats ?? []).filter((s) => s !== "ceo").sort((a, b) => ROLE_ORDER.indexOf(a) - ROLE_ORDER.indexOf(b));

/**
 * Whether this move can be filed, and what to say instead.
 *
 * Mirrors the checks in POST /api/sim/ventures/:id/recovery, in the order the
 * server applies them, so the reason shown before the request is the reason
 * that would come back from it.
 */
export function validateRecovery(input: {
  kind: RecoveryKind | null;
  seat: DeskRole | null;
  options: RecoveryOption[];
  seats: DeskRole[] | undefined;
  role: DeskRole | null;
}): { ok: boolean; error: string | null } {
  const { kind, seat, options, seats, role } = input;
  if (!canFileRecovery(role)) {
    return { ok: false, error: "These change what the company is. They're the chief executive's call." };
  }
  if (!kind) return { ok: false, error: null };
  if (!options.some((o) => o.kind === kind)) {
    return { ok: false, error: "That move isn't available in this position." };
  }
  if (recoveryNeedsSeat(kind)) {
    if (!seat) return { ok: false, error: "Pick the seat to dissolve." };
    if (seat === "ceo") return { ok: false, error: "You can't dissolve your own chair." };
    if (!(seats ?? []).includes(seat)) return { ok: false, error: "That seat isn't filled." };
  }
  return { ok: true, error: null };
}

/**
 * How far through the covenant the company is, and what is left of it.
 *
 * This is the visible way out, and it is the thing that makes distress an arc
 * rather than a hole: two years inside the cap and the creditor lets go. So it
 * is drawn as progress — met/2 — rather than reported as a restriction.
 */
export function covenantProgress(covenant: Covenant): {
  met: number; of: number; remaining: number; fraction: number; line: string;
} {
  const met = Math.max(0, Math.min(COVENANT_YEARS, Math.round(covenant.met)));
  const remaining = Math.max(0, COVENANT_YEARS - met);
  return {
    met,
    of: COVENANT_YEARS,
    remaining,
    fraction: met / COVENANT_YEARS,
    line: remaining === 0
      ? "The terms are met. The cap lifts."
      : met === 0
        ? `${COVENANT_YEARS} clear years inside the cap and it lifts.`
        : `One more year inside the cap and it lifts.`,
  };
}

/**
 * How much of the spending cap this year's draft has used.
 *
 * The cap is on discretionary spend — what the four spending seats commit —
 * and the covenant is reviewed against what was actually spent, so the number
 * that matters is the same one the commitment meter is already showing.
 */
export function capUse(spend: number, covenant: Covenant | null | undefined): {
  over: boolean; fraction: number; left: number;
} | null {
  if (!covenant) return null;
  const cap = Math.max(0, covenant.spendCap);
  const used = Math.max(0, Number.isFinite(spend) ? spend : 0);
  return {
    over: used > cap,
    fraction: cap > 0 ? used / cap : used > 0 ? Infinity : 0,
    left: cap - used,
  };
}
