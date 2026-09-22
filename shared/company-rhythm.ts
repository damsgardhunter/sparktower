/**
 * The rhythm a running company keeps once the Run path's setup is done: the
 * weekly check-in, the recurring jobs, and the monthly report.
 *
 * Everything here is pure — dates in, words and numbers out — so the server,
 * the web client and the tests all agree on what "this week", "overdue" and
 * "down 12% on last week" mean without any of them asking the database or the
 * clock. The routes (server/company-rhythm-routes.ts) only load rows and pass
 * them through.
 *
 * Dates are YYYY-MM-DD text computed in UTC throughout. A week is keyed by its
 * Monday so two people in different timezones filing on a Sunday night land
 * on the same week, and a month-end due date is clamped rather than rolled
 * forward, so a job due on 31 January is next due on 28 (or 29) February and
 * not quietly skipped into March — and back on 31 March after that, because a
 * monthly job remembers the day it belongs on.
 *
 * The reply to a check-in is written from the numbers alone and always exists.
 * Nova can rewrite it in better prose when AI is available, but a company that
 * files its numbers on a day the model is down still hears what changed.
 */

// ─── Dates ───────────────────────────────────────────────────────────────────

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const YM = /^\d{4}-\d{2}$/;

export const ymdOf = (d: Date): string => d.toISOString().slice(0, 10);
export const todayYmd = (now: Date = new Date()): string => ymdOf(now);

const parse = (ymd: string): Date => new Date(`${ymd}T00:00:00Z`);

/** A real calendar date in YYYY-MM-DD form — "2026-02-30" is not one. */
export function isYmd(v: unknown): v is string {
  if (typeof v !== "string" || !YMD.test(v)) return false;
  const d = parse(v);
  return !Number.isNaN(d.getTime()) && ymdOf(d) === v;
}

export function isMonth(v: unknown): v is string {
  if (typeof v !== "string" || !YM.test(v)) return false;
  const m = Number(v.slice(5, 7));
  return m >= 1 && m <= 12;
}

export function addDays(ymd: string, n: number): string {
  const d = parse(ymd);
  d.setUTCDate(d.getUTCDate() + n);
  return ymdOf(d);
}

const daysInMonth = (year: number, month0: number) => new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();

/** The same day `n` months on, clamped to the last day of a shorter month. */
export function addMonthsClamped(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const total = (m - 1) + n;
  const year = y + Math.floor(total / 12);
  const month0 = ((total % 12) + 12) % 12;
  const day = Math.min(d, daysInMonth(year, month0));
  return ymdOf(new Date(Date.UTC(year, month0, day)));
}

/** The Monday of the week a date falls in, which is the week's key. */
export function weekOf(date: Date | string = new Date()): string {
  const d = typeof date === "string" ? parse(date) : new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const sinceMonday = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - sinceMonday);
  return ymdOf(d);
}

export const isMonday = (ymd: string): boolean => isYmd(ymd) && weekOf(ymd) === ymd;

export const monthOf = (ymd: string): string => ymd.slice(0, 7);

/** The weeks that belong to a month: those whose Monday falls in it. A check-in counts toward its Monday's month. */
export function weeksInMonth(month: string): string[] {
  const first = `${month}-01`;
  let monday = weekOf(first);
  if (monday < first) monday = addDays(monday, 7);
  const out: string[] = [];
  while (monthOf(monday) === month) { out.push(monday); monday = addDays(monday, 7); }
  return out;
}

export function lastDayOfMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${month}-${String(daysInMonth(y, m - 1)).padStart(2, "0")}`;
}

export function addMonthsToMonth(month: string, n: number): string {
  return addMonthsClamped(`${month}-01`, n).slice(0, 7);
}

// ─── Recurring jobs ──────────────────────────────────────────────────────────

export const JOB_INTERVALS = ["week", "fortnight", "month"] as const;
export type JobInterval = (typeof JOB_INTERVALS)[number];
export const JOB_INTERVAL_LABEL: Record<JobInterval, string> = { week: "Every week", fortnight: "Every fortnight", month: "Every month" };

export const isJobInterval = (v: unknown): v is JobInterval => typeof v === "string" && (JOB_INTERVALS as readonly string[]).includes(v);

/**
 * The same day `n` months on, using the job's anchor day rather than the day
 * it last landed on: anchored to the 31st, January 31 goes to February 28 (or
 * 29) and then back to March 31, where clamping from the last due date would
 * have left it on the 28th for good.
 */
export function addMonthsAnchored(ymd: string, n: number, anchorDay: number): string {
  const [y, m] = ymd.split("-").map(Number);
  const total = (m - 1) + n;
  const year = y + Math.floor(total / 12);
  const month0 = ((total % 12) + 12) % 12;
  const day = Math.min(Math.max(1, Math.floor(anchorDay)), daysInMonth(year, month0));
  return ymdOf(new Date(Date.UTC(year, month0, day)));
}

/** The day of the month a monthly job belongs on, taken from a due date. */
export const anchorDayOf = (ymd: string): number => Number(ymd.slice(8, 10));

/**
 * What a job's anchor day should be stored as: the day of its due date for a
 * monthly job, nothing for the others (a week has no day of the month).
 */
export const anchorFor = (every: JobInterval, nextDue: string): number | null => (every === "month" ? anchorDayOf(nextDue) : null);

/**
 * When a job is next due after the occurrence due on `ymd`. A monthly job
 * lands on its anchor day, or the month's last day when the month is shorter.
 * A job saved before anchors existed has none, so its current due date stands
 * in — the best evidence of the day it was meant for.
 */
export function advanceDue(ymd: string, every: JobInterval, anchorDay?: number | null): string {
  if (every === "week") return addDays(ymd, 7);
  if (every === "fortnight") return addDays(ymd, 14);
  return addMonthsAnchored(ymd, 1, anchorDay ?? anchorDayOf(ymd));
}

/** What marking a job done records, and where its due date moves to. */
export function completeJob(job: { nextDue: string; every: JobInterval; anchorDay?: number | null }, doneOn: string) {
  return { dueOn: job.nextDue, doneOn, onTime: doneOn <= job.nextDue, nextDue: advanceDue(job.nextDue, job.every, job.anchorDay) };
}

export const isOverdue = (job: { nextDue: string; active?: boolean }, today: string): boolean =>
  job.active !== false && job.nextDue < today;

export function daysOverdue(nextDue: string, today: string): number {
  return Math.max(0, Math.round((parse(today).getTime() - parse(nextDue).getTime()) / 86_400_000));
}

// ─── Metrics ─────────────────────────────────────────────────────────────────

export type MetricUnit = "money" | "count" | "percent" | "weeks";

export interface RhythmMetric {
  id: string;
  label: string;
  unit: MetricUnit;
  /** Which way is good. Food cost going up is a worse week, covers going up a better one. */
  better: "up" | "down";
  /** What to do when this number is the one that slipped. One sentence, starting with a verb. */
  advice?: string;
}

export const RUN_SUBCATEGORIES = ["restaurant", "service", "retail", "agency", "software", "other"] as const;
export type RunSubcategory = (typeof RUN_SUBCATEGORIES)[number];

const cash: RhythmMetric = { id: "cash", label: "Cash in the bank", unit: "money", better: "up", advice: "Look at what's owed to you and chase the biggest invoice this week; then check which payment out could wait." };

/**
 * The five (or so) numbers a business like this watches, matching the
 * RUN.S1.2 variants in shared/phase-trees/run.ts. They are a starting point:
 * the project's own list is whatever its latest check-in tracked.
 */
export const DEFAULT_METRICS: Record<RunSubcategory, RhythmMetric[]> = {
  restaurant: [
    { id: "covers", label: "Covers", unit: "count", better: "up", advice: "Check which sittings were quiet and put one offer or booking push behind the quietest." },
    { id: "avg_spend", label: "Average spend", unit: "money", better: "up", advice: "Brief the team on one add-on to suggest at every table — a starter, a side or a drink." },
    { id: "prime_cost_pct", label: "Food and labour cost (% of sales)", unit: "percent", better: "down", advice: "Compare the rota against covers day by day, and check waste and portion sizes on your three best sellers." },
    cash,
    { id: "repeat_guests", label: "Repeat guests", unit: "count", better: "up", advice: "Ask three regulars what would bring them back more often, and do the easiest one." },
  ],
  service: [
    { id: "jobs_done", label: "Jobs done", unit: "count", better: "up", advice: "Find what stopped jobs being finished this week — waiting on parts, people or approvals — and clear the biggest blocker." },
    { id: "invoiced", label: "Money invoiced", unit: "money", better: "up", advice: "Check every finished job has been invoiced; unbilled work is the cheapest money you'll find." },
    { id: "collected", label: "Money collected", unit: "money", better: "up", advice: "Chase the three oldest unpaid invoices by phone, not email." },
    { id: "pipeline", label: "Pipeline for next month", unit: "money", better: "up", advice: "Call past clients who haven't booked in three months and ask what's coming up." },
    cash,
    { id: "repeat_clients", label: "Repeat clients", unit: "count", better: "up", advice: "Ask the last client who didn't rebook why, and fix what they say." },
  ],
  retail: [
    { id: "sales", label: "Sales", unit: "money", better: "up", advice: "Look at which days and products fell furthest and put your best-selling line where people see it first." },
    { id: "avg_basket", label: "Average basket", unit: "money", better: "up", advice: "Put one natural add-on next to your best seller and at the till." },
    { id: "stock_turn", label: "Stock turn (weeks of stock)", unit: "weeks", better: "down", advice: "Mark down the slowest ten lines and hold the next order on anything with more than eight weeks on the shelf." },
    cash,
    { id: "returning_customers", label: "Returning customers", unit: "count", better: "up", advice: "Send last month's customers one reason to come back this week." },
  ],
  agency: [
    { id: "fees_invoiced", label: "Fees invoiced", unit: "money", better: "up", advice: "Check every milestone that's been delivered has been billed." },
    { id: "collected", label: "Money collected", unit: "money", better: "up", advice: "Chase the three oldest unpaid invoices by phone, not email." },
    { id: "utilisation", label: "Billable time (%)", unit: "percent", better: "up", advice: "Find the internal work that ate the week and decide what can stop or be charged for." },
    { id: "pipeline", label: "Pipeline for next month", unit: "money", better: "up", advice: "Call two past clients and one warm lead and ask what's coming up." },
    cash,
  ],
  software: [
    { id: "new_revenue", label: "New monthly revenue", unit: "money", better: "up", advice: "Look at where last month's paying customers came from and double down on that one channel." },
    { id: "churn", label: "Revenue lost to cancellations", unit: "money", better: "down", advice: "Email everyone who cancelled this week and ask one question: what nearly kept you?" },
    { id: "active_customers", label: "Active customers", unit: "count", better: "up", advice: "Find the accounts that stopped logging in and reach out before they cancel." },
    { id: "runway_weeks", label: "Cash runway (weeks)", unit: "weeks", better: "up", advice: "List every cost over $500 a month and cut or pause one this week." },
    { id: "support_tickets", label: "Support tickets", unit: "count", better: "down", advice: "Group this week's tickets by cause and fix the cause behind the biggest group." },
  ],
  other: [
    { id: "revenue", label: "Money in", unit: "money", better: "up", advice: "Look at which customers or products fell furthest and call the biggest one that went quiet." },
    cash,
    { id: "new_customers", label: "New customers", unit: "count", better: "up", advice: "Ask your last three new customers how they found you, and do more of that." },
    { id: "repeat_customers", label: "Customers who came back", unit: "count", better: "up", advice: "Ask one customer who didn't come back why, and fix what they say." },
    { id: "biggest_cost", label: "Your biggest running cost", unit: "money", better: "down", advice: "Get one competing quote for it this week, or find the part of it that isn't needed." },
  ],
};

export const asRunSubcategory = (v: unknown): RunSubcategory =>
  typeof v === "string" && (RUN_SUBCATEGORIES as readonly string[]).includes(v) ? (v as RunSubcategory) : "other";

export const defaultMetricsFor = (sub: unknown): RhythmMetric[] => DEFAULT_METRICS[asRunSubcategory(sub)];

/**
 * A metric the company added itself is stored under `custom:<its name>`, so
 * the name travels with the numbers and nothing else needs a column.
 */
export const CUSTOM_PREFIX = "custom:";
export const customMetricId = (label: string) => `${CUSTOM_PREFIX}${label.trim().replace(/\s+/g, " ").slice(0, 50)}`;

const ALL_KNOWN = new Map<string, RhythmMetric>(Object.values(DEFAULT_METRICS).flat().map((m) => [m.id, m]));

/** What an id means: a known metric, a custom one named in its id, or — failing both — the bare id. */
export function metricFor(id: string): RhythmMetric {
  const known = ALL_KNOWN.get(id);
  if (known) return known;
  if (id.startsWith(CUSTOM_PREFIX)) return { id, label: id.slice(CUSTOM_PREFIX.length) || "Custom number", unit: "count", better: "up" };
  return { id, label: id.replace(/_/g, " "), unit: "count", better: "up" };
}

export type CheckinNumbers = Record<string, number | null>;

/**
 * The list a project watches: the metric ids its latest check-in tracked (a
 * blank this week is kept as null, so leaving a box empty doesn't drop the
 * number from the list), or the defaults for its kind of business before it
 * has filed anything.
 */
export function metricsForProject(sub: unknown, latest: { numbers: unknown } | null | undefined): RhythmMetric[] {
  const keys = latest && latest.numbers && typeof latest.numbers === "object" ? Object.keys(latest.numbers as object) : [];
  if (!keys.length) return defaultMetricsFor(sub);
  // Postgres jsonb doesn't keep key order, so the order is set here: the
  // defaults in their usual order, then the company's own in name order.
  const defaults = defaultMetricsFor(sub).map((m) => m.id);
  const rank = (id: string) => { const i = defaults.indexOf(id); return i < 0 ? defaults.length : i; };
  return [...keys].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b)).map(metricFor);
}

/**
 * Cleans what a client sent as numbers: finite numbers or null, at most
 * twenty, ids of a sensible length. Returns an error sentence instead when the
 * input can't be read.
 */
export function cleanNumbers(raw: unknown): { ok: true; numbers: CheckinNumbers } | { ok: false; message: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, message: "Send the numbers as a list of name and value." };
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length === 0) return { ok: false, message: "Track at least one number." };
  if (entries.length > 20) return { ok: false, message: "Twenty numbers is the most a check-in can track." };
  /*
   * Null-prototype, because every key here came from a client and each one is
   * written straight onto this object. `__proto__` as a metric name would set
   * this object's prototype instead of a number on it, and `constructor` would
   * shadow one; the row then goes to jsonb and comes back out through
   * Object.keys into the rhythm screen. Nothing here needs to inherit
   * anything, so it inherits nothing.
   */
  const out: CheckinNumbers = Object.create(null) as CheckinNumbers;
  for (const [k, v] of entries) {
    const id = k.trim();
    if (!id || id.length > 60) return { ok: false, message: "Each number needs a short name." };
    // Said plainly rather than silently dropped: a name that means something to
    // JavaScript and nothing to a business is a mistake worth showing.
    if (id === "__proto__" || id === "constructor" || id === "prototype") {
      return { ok: false, message: `"${id}" can't be the name of a number.` };
    }
    if (v === null || v === "" || v === undefined) { out[id] = null; continue; }
    const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/,/g, "")) : NaN;
    if (!Number.isFinite(n)) return { ok: false, message: `"${metricFor(id).label}" isn't a number.` };
    out[id] = n;
  }
  return { ok: true, numbers: out };
}

// ─── Words ───────────────────────────────────────────────────────────────────

const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
export const inWords = (n: number) => WORDS[n] ?? String(n);

export function formatValue(v: number | null | undefined, unit: MetricUnit): string {
  if (v == null) return "—";
  if (unit === "percent") return `${Number(v.toFixed(1))}%`;
  if (unit === "money") {
    const a = Math.abs(v);
    const body = a >= 1_000_000 ? `${(a / 1_000_000).toFixed(2)}m` : a >= 10_000 ? `${(a / 1000).toFixed(1).replace(/\.0$/, "")}k` : Math.round(a).toLocaleString("en-GB");
    return `${v < 0 ? "−" : ""}$${body}`;
  }
  if (unit === "weeks") return `${Number(v.toFixed(1))} wk`;
  return Math.round(v) === v ? v.toLocaleString("en-GB") : String(Number(v.toFixed(2)));
}

const sentenceCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const snippet = (s: string, n = 90) => { const t = s.trim().replace(/\s+/g, " "); return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t; };

// ─── The weekly reply ────────────────────────────────────────────────────────

export interface CheckinLike {
  weekOf: string;
  numbers: unknown;
  wentRight?: string | null;
  wentWrong?: string | null;
}

const valueIn = (c: CheckinLike, id: string): number | null => {
  const n = (c.numbers as Record<string, unknown> | null)?.[id];
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};

export interface MetricChange {
  id: string;
  label: string;
  unit: MetricUnit;
  value: number;
  previous: number | null;
  previousWeek: string | null;
  /** Fractional change on the previous value; null when there is none, or it was zero. */
  pct: number | null;
  direction: "up" | "down" | "flat" | "new";
  /** Positive is better for the business, whichever way the number moved. */
  goodness: number;
  /** "lowest"/"highest" when this week is the extreme of the last `window` weeks with a value. */
  extreme: "lowest" | "highest" | null;
  window: number;
  /** How many check-ins in a row this number has moved the wrong way, this one included. */
  worseStreak: number;
}

/** Changes under this share are "flat": nobody should be told a 0.4% wobble is news. */
const FLAT = 0.01;

function changeFor(metric: RhythmMetric, current: CheckinLike, history: CheckinLike[]): MetricChange | null {
  const value = valueIn(current, metric.id);
  if (value == null) return null;
  // Prior weeks with a value for this number, newest first.
  const prior = history.filter((c) => c.weekOf < current.weekOf && valueIn(c, metric.id) != null).sort((a, b) => (a.weekOf < b.weekOf ? 1 : -1));
  const prev = prior[0];
  const previous = prev ? valueIn(prev, metric.id) : null;
  const sign = metric.better === "up" ? 1 : -1;
  let pct: number | null = null;
  let direction: MetricChange["direction"] = "new";
  let goodness = 0;
  if (previous != null) {
    const diff = value - previous;
    pct = previous !== 0 ? diff / Math.abs(previous) : null;
    const rel = pct ?? (diff === 0 ? 0 : Math.sign(diff));
    direction = Math.abs(rel) < FLAT ? "flat" : diff > 0 ? "up" : "down";
    goodness = direction === "flat" ? 0 : sign * rel;
  }
  // The window: this week and up to four before it, so "the lowest in five weeks" means what it says.
  const windowValues = [value, ...prior.slice(0, 4).map((c) => valueIn(c, metric.id) as number)];
  const window = windowValues.length;
  let extreme: MetricChange["extreme"] = null;
  if (window >= 3 && direction !== "flat") {
    const others = windowValues.slice(1);
    if (value < Math.min(...others)) extreme = "lowest";
    else if (value > Math.max(...others)) extreme = "highest";
  }
  // The wrong-way streak, walking back through the prior weeks.
  let worseStreak = 0;
  if (goodness < 0) {
    worseStreak = 1;
    const seq = [value, ...prior.map((c) => valueIn(c, metric.id) as number)];
    for (let i = 1; i + 1 < seq.length; i++) {
      const d = seq[i] - seq[i + 1];
      const r = seq[i + 1] !== 0 ? d / Math.abs(seq[i + 1]) : Math.sign(d);
      if (Math.abs(r) >= FLAT && sign * r < 0) worseStreak++; else break;
    }
  }
  return { id: metric.id, label: metric.label, unit: metric.unit, value, previous, previousWeek: prev?.weekOf ?? null, pct, direction, goodness, extreme, window, worseStreak };
}

/** One line about one number: "Covers down 12% on last week, the lowest in five weeks." */
export function describeChange(c: MetricChange, currentWeek: string): string {
  if (c.direction === "new") return `${c.label}: ${formatValue(c.value, c.unit)} — the first week you've tracked it.`;
  const onWhat = c.previousWeek === addDays(currentWeek, -7) ? "on last week" : "on your last check-in";
  if (c.direction === "flat") return `${c.label} flat ${onWhat} at ${formatValue(c.value, c.unit)}.`;
  const size = c.pct != null
    ? `${Math.round(Math.abs(c.pct) * 100)}%`
    : `${formatValue(Math.abs(c.value - (c.previous ?? 0)), c.unit)}`;
  let line = `${c.label} ${c.direction} ${size} ${onWhat}`;
  if (c.extreme) line += `, the ${c.extreme} in ${inWords(c.window)} weeks`;
  if (c.worseStreak >= 3) line += ` (${inWords(c.worseStreak)} weeks running the wrong way)`;
  return `${line}.`;
}

export interface CheckinReply {
  changes: MetricChange[];
  lines: string[];
  /** The one thing worth doing about it. */
  focus: string;
  focusMetric: string | null;
  text: string;
}

/**
 * What changed and the one thing worth doing, from the numbers alone.
 *
 * The focus is the number that moved furthest the wrong way, if any moved
 * more than a few per cent — a business only fixes one thing a week, so the
 * reply names one. When nothing slipped it turns to what the owner said went
 * wrong, and failing that to what went right.
 */
export function buildCheckinReply(input: { metrics: RhythmMetric[]; current: CheckinLike; history: CheckinLike[] }): CheckinReply {
  const { metrics, current, history } = input;
  const changes = metrics.map((m) => changeFor(m, current, history)).filter((c): c is MetricChange => !!c);
  const hadHistory = history.some((c) => c.weekOf < current.weekOf);
  const lines: string[] = [];

  if (!hadHistory) {
    lines.push("This is your first check-in, so there's nothing to compare yet — next week's reply will say what moved.");
  } else {
    // Biggest moves first, whichever way; flat and new numbers last.
    const ordered = [...changes].sort((a, b) => Math.abs(b.goodness) - Math.abs(a.goodness));
    for (const c of ordered) lines.push(describeChange(c, current.weekOf));
    if (changes.length === 0) lines.push("No numbers this week, so there's nothing to compare.");
  }

  const worst = [...changes].filter((c) => c.goodness <= -0.05).sort((a, b) => a.goodness - b.goodness)[0];
  let focus: string;
  let focusMetric: string | null = null;
  if (worst) {
    focusMetric = worst.id;
    const advice = metrics.find((m) => m.id === worst.id)?.advice ?? `Find the one cause behind ${worst.label.toLowerCase()} slipping and fix that before anything else.`;
    focus = `The one thing: ${worst.label.toLowerCase()}. ${advice}`;
  } else if (current.wentWrong?.trim()) {
    focus = `The numbers held, so take what went wrong — "${snippet(current.wentWrong)}" — and make sure it can't happen the same way next week.`;
  } else if (current.wentRight?.trim()) {
    focus = `Nothing slipped. Keep doing what worked: "${snippet(current.wentRight)}".`;
  } else {
    focus = hadHistory ? "Nothing slipped this week. Keep the rhythm going." : "Next week, file again on the same day so the comparison is fair.";
  }

  const text = [...lines, focus].join("\n");
  return { changes, lines, focus, focusMetric, text };
}

// ─── Went-wrong themes ───────────────────────────────────────────────────────

/**
 * Plain keyword groups for what went wrong. Deliberately crude: the point is
 * to notice that "staff" has come up three weeks out of four, not to
 * understand the sentence.
 */
export const WRONG_THEMES: { id: string; label: string; words: string[] }[] = [
  { id: "cash", label: "Cash and getting paid", words: ["cash", "money", "paid", "pay", "invoice", "overdue", "bank", "debt", "tax", "vat", "payroll"] },
  { id: "staff", label: "Staff and cover", words: ["staff", "sick", "team", "hire", "hiring", "rota", "shift", "absent", "quit", "resigned", "short-staffed", "cover", "holiday"] },
  { id: "customers", label: "Customers and complaints", words: ["customer", "customers", "complaint", "complaints", "review", "reviews", "refund", "refunds", "angry", "unhappy", "cancel", "cancelled", "churn"] },
  { id: "supply", label: "Stock and suppliers", words: ["stock", "supplier", "suppliers", "delivery", "deliveries", "shortage", "ran out", "order", "orders", "inventory"] },
  { id: "systems", label: "Systems and equipment", words: ["system", "software", "broke", "broken", "outage", "till", "website", "app", "bug", "equipment", "machine", "crashed"] },
  { id: "time", label: "Admin and time", words: ["admin", "paperwork", "busy", "overwhelmed", "no time", "late", "behind", "deadline", "missed"] },
  { id: "sales", label: "Sales and demand", words: ["quiet", "slow", "sales", "footfall", "leads", "bookings", "demand", "traffic"] },
];

export function themesIn(text: string | null | undefined): string[] {
  if (!text) return [];
  const t = ` ${text.toLowerCase().replace(/[^a-z0-9\s-]/g, " ")} `;
  return WRONG_THEMES.filter((th) => th.words.some((w) => t.includes(` ${w} `) || (w.includes(" ") && t.includes(w)))).map((th) => th.id);
}

// ─── The monthly report ──────────────────────────────────────────────────────

export interface ReportJob { id: string; title: string; every: JobInterval; nextDue: string; active: boolean; ownerId?: string | null; anchorDay?: number | null }
export interface ReportRun { jobId: string; dueOn: string; doneOn: string; onTime: boolean }

export interface MetricMonth {
  id: string; label: string; unit: MetricUnit; better: "up" | "down";
  first: number | null; firstWeek: string | null;
  last: number | null; lastWeek: string | null;
  change: number | null; pct: number | null;
  verdict: "improved" | "worse" | "flat" | "not enough data";
}

export interface JobMonth { jobId: string; title: string; onTime: number; late: number; missed: number }

export interface MonthlyReport {
  month: string;
  weeks: string[];
  filed: number;
  /** Weeks of the month that have started by `today`; a report on the current month isn't blamed for next week. */
  weeksSoFar: number;
  missingWeeks: string[];
  metrics: MetricMonth[];
  bestWeek: { weekOf: string; improved: number; worsened: number } | null;
  worstWeek: { weekOf: string; improved: number; worsened: number } | null;
  jobs: { onTime: number; late: number; missed: number; byJob: JobMonth[] };
  themes: { id: string; label: string; weeks: string[] }[];
  fixNext: { kind: "metric" | "job" | "theme"; id: string; text: string } | null;
}

/**
 * The occurrences a job has let pass without being done: from its current
 * due date forward, every due date before today. Marking a job done moves its
 * due date one interval on, so each of these is an occurrence nobody did.
 */
export function missedDueDates(job: ReportJob, today: string, until: string): string[] {
  if (!job.active) return [];
  const out: string[] = [];
  let due = job.nextDue;
  for (let i = 0; due < today && due <= until && i < 400; i++) {
    out.push(due);
    due = advanceDue(due, job.every, job.anchorDay);
  }
  return out;
}

export function buildMonthlyReport(input: {
  month: string;
  metrics: RhythmMetric[];
  checkins: CheckinLike[];
  jobs: ReportJob[];
  runs: ReportRun[];
  today: string;
}): MonthlyReport {
  const { month, metrics, jobs, runs, today } = input;
  const all = [...input.checkins].sort((a, b) => (a.weekOf < b.weekOf ? -1 : 1));
  const inMonth = all.filter((c) => monthOf(c.weekOf) === month);
  const weeks = weeksInMonth(month);
  const started = weeks.filter((w) => w <= today);
  const filedSet = new Set(inMonth.map((c) => c.weekOf));

  const metricRows: MetricMonth[] = metrics.map((m) => {
    const withValue = inMonth.filter((c) => valueIn(c, m.id) != null);
    const f = withValue[0];
    const l = withValue[withValue.length - 1];
    const first = f ? valueIn(f, m.id) : null;
    const last = l ? valueIn(l, m.id) : null;
    let change: number | null = null, pct: number | null = null;
    let verdict: MetricMonth["verdict"] = "not enough data";
    if (first != null && last != null && withValue.length >= 2) {
      change = last - first;
      pct = first !== 0 ? change / Math.abs(first) : null;
      const rel = pct ?? Math.sign(change);
      verdict = Math.abs(rel) < FLAT ? "flat" : (m.better === "up" ? rel > 0 : rel < 0) ? "improved" : "worse";
    }
    return { id: m.id, label: m.label, unit: m.unit, better: m.better, first, firstWeek: f?.weekOf ?? null, last, lastWeek: l?.weekOf ?? null, change, pct, verdict };
  });

  // Best and worst week: most numbers better (or worse) than the check-in before, which may be last month's.
  const scored = inMonth.map((c) => {
    const history = all.filter((h) => h.weekOf < c.weekOf);
    const cs = metrics.map((m) => changeFor(m, c, history)).filter((x): x is MetricChange => !!x && x.direction !== "new");
    return { weekOf: c.weekOf, improved: cs.filter((x) => x.goodness > 0).length, worsened: cs.filter((x) => x.goodness < 0).length, compared: cs.length };
  }).filter((s) => s.compared > 0);
  const net = (s: { improved: number; worsened: number }) => s.improved - s.worsened;
  const bestWeek = scored.length >= 2 ? scored.reduce((b, s) => (net(s) > net(b) ? s : b)) : null;
  const worstWeek = scored.length >= 2 ? scored.reduce((w, s) => (net(s) < net(w) ? s : w)) : null;
  const strip = (s: typeof scored[number] | null) => s && { weekOf: s.weekOf, improved: s.improved, worsened: s.worsened };

  // Jobs: runs whose due date fell in the month, and the occurrences nobody did.
  const monthEnd = lastDayOfMonth(month);
  const monthRuns = runs.filter((r) => monthOf(r.dueOn) === month);
  const byJob: JobMonth[] = jobs.map((j) => {
    const mine = monthRuns.filter((r) => r.jobId === j.id);
    const missed = missedDueDates(j, today, monthEnd).filter((d) => monthOf(d) === month).length;
    return { jobId: j.id, title: j.title, onTime: mine.filter((r) => r.onTime).length, late: mine.filter((r) => !r.onTime).length, missed };
  }).filter((j) => j.onTime + j.late + j.missed > 0);
  const sum = (k: "onTime" | "late" | "missed") => byJob.reduce((n, j) => n + j[k], 0);

  // What keeps going wrong: a theme counts when it comes up in two or more weeks.
  const themeWeeks = new Map<string, string[]>();
  for (const c of inMonth) for (const t of themesIn(c.wentWrong)) themeWeeks.set(t, [...(themeWeeks.get(t) ?? []), c.weekOf]);
  const themes = WRONG_THEMES.map((t) => ({ id: t.id, label: t.label, weeks: themeWeeks.get(t.id) ?? [] }))
    .filter((t) => t.weeks.length >= 2)
    .sort((a, b) => b.weeks.length - a.weeks.length);

  // What to fix next: the number that got worst, else the job most often late or missed, else the theme.
  let fixNext: MonthlyReport["fixNext"] = null;
  const worse = metricRows.filter((m) => m.verdict === "worse")
    .map((m) => ({ m, badness: Math.abs(m.pct ?? Math.sign(m.change ?? 0)) }))
    .sort((a, b) => b.badness - a.badness)[0];
  const slipping = [...byJob].filter((j) => j.late + j.missed > 0).sort((a, b) => (b.late + b.missed) - (a.late + a.missed))[0];
  if (worse) {
    const m = worse.m;
    const how = m.pct != null ? `${Math.round(Math.abs(m.pct) * 100)}%` : formatValue(Math.abs(m.change ?? 0), m.unit);
    const advice = metrics.find((x) => x.id === m.id)?.advice;
    fixNext = { kind: "metric", id: m.id, text: `${sentenceCase(m.label.toLowerCase())} got ${how} worse over the month (${formatValue(m.first, m.unit)} → ${formatValue(m.last, m.unit)}).${advice ? ` ${advice}` : ""}` };
  } else if (slipping) {
    const bits = [slipping.late && `late ${inWords(slipping.late)} time${slipping.late === 1 ? "" : "s"}`, slipping.missed && `missed ${inWords(slipping.missed)} time${slipping.missed === 1 ? "" : "s"}`].filter(Boolean).join(" and ");
    fixNext = { kind: "job", id: slipping.jobId, text: `"${slipping.title}" was ${bits}. Check its owner has the time for it, or hand it to the backup and write down the steps.` };
  } else if (themes[0]) {
    fixNext = { kind: "theme", id: themes[0].id, text: `${themes[0].label} came up in ${inWords(themes[0].weeks.length)} check-ins. Pick the cause that keeps repeating and fix it once.` };
  }

  return {
    month,
    weeks,
    filed: inMonth.length,
    weeksSoFar: started.length,
    missingWeeks: started.filter((w) => !filedSet.has(w)),
    metrics: metricRows,
    bestWeek: strip(bestWeek),
    worstWeek: bestWeek && worstWeek && worstWeek.weekOf !== bestWeek.weekOf ? strip(worstWeek) : null,
    jobs: { onTime: sum("onTime"), late: sum("late"), missed: sum("missed"), byJob },
    themes,
    fixNext,
  };
}

// ─── The rhythm's settings ───────────────────────────────────────────────────

/** Monday first, matching `rhythm_settings.checkin_day` (0 = Monday … 6 = Sunday). */
export const CHECKIN_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

export const isCheckinDay = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 6;

/** Which check-in day a date is, Monday = 0, read in UTC like every other date here. */
export function checkinDayOf(date: Date | string): number {
  const d = typeof date === "string" ? parse(date) : date;
  return (d.getUTCDay() + 6) % 7;
}

/** The date of a week's check-in day: the week's Monday plus the chosen day. */
export const checkinDateFor = (week: string, checkinDay: number): string => addDays(week, checkinDay);

// ─── The quarter's goals ─────────────────────────────────────────────────────

const QUARTER = /^(\d{4})-Q([1-4])$/;

export const isQuarter = (v: unknown): v is string => typeof v === "string" && QUARTER.test(v);

/** "2026-Q3" for any date from 1 July to 30 September 2026. */
export function quarterOf(date: Date | string = new Date()): string {
  const ymd = typeof date === "string" ? date : ymdOf(date);
  return `${ymd.slice(0, 4)}-Q${Math.floor((Number(ymd.slice(5, 7)) - 1) / 3) + 1}`;
}

/** The first and last day of a quarter. */
export function quarterRange(quarter: string): { start: string; end: string } {
  const [, y, q] = QUARTER.exec(quarter) ?? [];
  const firstMonth = (Number(q) - 1) * 3 + 1;
  const start = `${y}-${String(firstMonth).padStart(2, "0")}-01`;
  return { start, end: lastDayOfMonth(addMonthsToMonth(start.slice(0, 7), 2)) };
}

export function addQuarters(quarter: string, n: number): string {
  return quarterOf(addMonthsClamped(quarterRange(quarter).start, n * 3));
}

/** Whether a check-in counts toward a quarter: its Monday falls inside it, the same rule a month uses. */
export const inQuarter = (week: string, quarter: string): boolean => {
  const { start, end } = quarterRange(quarter);
  return week >= start && week <= end;
};

export interface GoalLike { metricId: string | null; target: number | null; direction: "up" | "down" | null; status?: string }

export interface GoalProgress {
  /** The first and latest values the quarter's check-ins recorded for the goal's number. */
  first: number | null; firstWeek: string | null;
  latest: number | null; latestWeek: string | null;
  /** How far from the first value to the target the latest has come, 0 to 1. */
  fraction: number | null;
  /** How much of the quarter has gone by `today`, 0 to 1. */
  elapsed: number;
  reached: boolean;
  state: "reached" | "on track" | "behind" | "no numbers yet" | "not measured";
}

/*
 * About two weeks of a thirteen-week quarter's slack before calling a goal
 * behind. Weekly numbers are noisy, and a goal marked "behind" in its second
 * week because the number wobbled teaches people to ignore the badge.
 */
const ON_TRACK_SLACK = 0.15;

/**
 * Where a measured goal stands, from the quarter's check-ins alone.
 *
 * Progress runs from the quarter's first recorded value (where the company
 * started) to the target, so a café aiming for 600 covers from 500 is halfway
 * at 550 — not 92% of the way because 550 is 92% of 600. It is on track while
 * it has come at least as far as the quarter has gone, give or take the
 * slack above; a number already past its target is reached, whenever that was.
 */
export function goalProgress(goal: GoalLike, checkins: CheckinLike[], quarter: string, today: string): GoalProgress {
  const { start, end } = quarterRange(quarter);
  const span = daysOverdue(start, end) + 1;
  const elapsed = today < start ? 0 : today > end ? 1 : (daysOverdue(start, today) + 1) / span;
  const base = { first: null, firstWeek: null, latest: null, latestWeek: null, fraction: null, elapsed, reached: false };
  if (!goal.metricId || goal.target == null) return { ...base, state: "not measured" };
  const direction = goal.direction ?? metricFor(goal.metricId).better;
  const withValue = checkins
    .filter((c) => inQuarter(c.weekOf, quarter) && valueIn(c, goal.metricId!) != null)
    .sort((a, b) => (a.weekOf < b.weekOf ? -1 : 1));
  if (!withValue.length) return { ...base, state: "no numbers yet" };
  const f = withValue[0];
  const l = withValue[withValue.length - 1];
  const first = valueIn(f, goal.metricId)!;
  const latest = valueIn(l, goal.metricId)!;
  const reached = direction === "up" ? latest >= goal.target : latest <= goal.target;
  const distance = goal.target - first;
  let fraction: number;
  if (reached) fraction = 1;
  else if (distance === 0) fraction = 0; // Started on the target and has since fallen off it.
  else fraction = Math.min(1, Math.max(0, (latest - first) / distance));
  const state: GoalProgress["state"] = reached ? "reached" : fraction + ON_TRACK_SLACK >= elapsed ? "on track" : "behind";
  return { first, firstWeek: f.weekOf, latest, latestWeek: l.weekOf, fraction, elapsed, reached, state };
}
