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
  notes: string[];
  bankrupt: boolean;
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
 * The part of `fixed` the phone can't derive, backed out of the server's own number.
 *
 * `fixedCosts()` is `headcount × 85,000 × costIndex + seats.length × 140,000`,
 * and the desk response does not send `seats.length` — the engine's seat list
 * isn't the same thing as the `table` array, because a dissolved seat leaves
 * the table but stops costing a salary. Rather than guess with `table.length`
 * and be quietly wrong for any company that has dissolved a seat, the
 * executive half is recovered by subtracting the headcount half — computed
 * from the headcount the server itself was looking at — from the `fixed` it
 * returned. Anything the phone then changes about headcount moves the total
 * correctly, and the constant half comes from the engine rather than from a
 * hopeful assumption.
 *
 * Clamped at zero: a negative base could only come from a response and a
 * mirror that disagree, and a total that is too *low* is the dangerous
 * direction.
 */
export function executiveSalariesFrom(serverFixed: number, filedHeadcount: number, costIndex: number): number {
  if (!Number.isFinite(serverFixed)) return 0;
  const salaries = num(filedHeadcount) * SALARY_PER_HEAD * (Number.isFinite(costIndex) ? costIndex : 1);
  return Math.max(0, serverFixed - salaries);
}

/** Mirrors fixedCosts() in shared/simulation/decisions.ts, with the seat count supplied. */
export function fixedCosts(headcount: number, costIndex: number, executiveSalaries: number): number {
  return num(headcount) * SALARY_PER_HEAD * (Number.isFinite(costIndex) ? costIndex : 1) + Math.max(0, executiveSalaries);
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
  company: Pick<DeskCompany, "cash" | "debt" | "creditLimit">;
  decisions: FiledDecisions;
  costIndex: number;
  /** From executiveSalariesFrom(), so the constant half of `fixed` is the engine's. */
  executiveSalaries: number;
}): Commitment {
  const { company, decisions, costIndex, executiveSalaries } = input;
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
  const fixed = fixedCosts(num(coo.headcount), costIndex, executiveSalaries);
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
 * "17h 40m", "42m", "0:41".
 *
 * A year is a day away, so minutes and seconds ticking is noise for most of
 * it; under a minute it becomes a deadline and the seconds matter again.
 */
export function formatUntil(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds)) return "—";
  const whole = Math.max(0, Math.floor(seconds));
  if (whole >= 3600) {
    const h = Math.floor(whole / 3600);
    const m = Math.floor((whole % 3600) / 60);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  if (whole >= 60) return `${Math.floor(whole / 60)}m`;
  return `0:${String(whole).padStart(2, "0")}`;
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
