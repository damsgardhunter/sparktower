/**
 * "What would it take?" — the Run path's roadmap from the company as it is to
 * a company of a chosen size.
 *
 * Four targets, $1m to $50bn a year in revenue, and for each one the honest
 * arithmetic between here and there. The point of the feature is the honesty:
 * a corner shop does not become a $50bn company by working harder, and a
 * roadmap that implies it would is worse than no roadmap at all. So the gap,
 * the ladder of stages and the verdict are all computed here, from the
 * company's own check-in numbers, before Nova is asked anything. Nova writes
 * the words around numbers it is given and is told not to invent any; if it
 * flatters the person, the computed verdict underneath still says what the
 * multiple actually is.
 *
 * Everything in this file is pure — numbers in, numbers and sentences out — so
 * the server, the web client and the unit tests all agree on what "a hundred
 * times bigger" means without any of them asking the database. The routes
 * (server/what-would-it-take.ts) load rows and pass them through.
 *
 * All check-in figures are read as a week's worth, because that is what a
 * weekly check-in is, and annualised by 52. Nothing here touches the clock:
 * "when was this generated" is a timestamp the caller supplies.
 */
import { CUSTOM_PREFIX, asRunSubcategory, formatValue, metricFor, type CheckinLike, type RunSubcategory } from "./company-rhythm";

// ─── The four targets ────────────────────────────────────────────────────────

export const WWIT_TARGET_IDS = ["m1", "m100", "b1", "b50"] as const;
export type WwitTargetId = (typeof WWIT_TARGET_IDS)[number];

export interface WwitTarget {
  id: WwitTargetId;
  /** Revenue a year, in dollars. */
  revenue: number;
  /** "$1m a year". */
  label: string;
  /** "$1m", for a tab or a chip. */
  short: string;
  /** What a company that size actually is, in plain words. No flattery. */
  whatItIs: string;
  /** Roughly what it would sell for, and on what basis — because "worth" is not "revenue". */
  worth: { low: number; high: number; basis: string };
  /** How many companies in the world are this big, where the number is worth knowing. */
  howMany?: string;
}

/*
 * The valuation ranges are deliberately wide and stated as a basis rather than
 * a number. A business is not priced on revenue — it is priced on profit, or
 * on growth — and quoting "2× revenue" as if it were a fact is the kind of
 * thing that makes an owner turn down a real offer. So each target says what
 * it is really priced on and gives the revenue multiple only as the rough
 * consequence of that.
 */
export const WWIT_TARGETS: readonly WwitTarget[] = [
  {
    id: "m1",
    revenue: 1_000_000,
    label: "$1m a year",
    short: "$1m",
    whatItIs: "A good local business. One site, or a small team, taking about $19,000 a week. The owner usually still works in it, and the business mostly stops when they do.",
    worth: { low: 300_000, high: 800_000, basis: "Businesses this size sell on what the owner takes out — usually 2–4× owner earnings — not on turnover. At a $1m turnover that is commonly $300k–$800k, and it is lower if the business needs you in it." },
  },
  {
    id: "m100",
    revenue: 100_000_000,
    label: "$100m a year",
    short: "$100m",
    whatItIs: "A national business. A few hundred staff, or dozens of sites, or a software company with thousands of paying customers. It has a management layer, and it runs on days you are not there.",
    worth: { low: 100_000_000, high: 250_000_000, basis: "Priced on profit: 8–12× operating profit is normal for a business this size, which at a 10–15% margin comes out around 1–2× revenue. A software company at this size is priced higher, on growth." },
  },
  {
    id: "b1",
    revenue: 1_000_000_000,
    label: "$1bn a year",
    short: "$1bn",
    whatItIs: "One of the larger companies in its country, or a public one. Thousands of staff, several countries or several hundred sites, and a board that is not you.",
    worth: { low: 1_500_000_000, high: 5_000_000_000, basis: "12–18× operating profit, or 3–6× revenue for a software business that is still growing fast. Roughly $1.5bn–$5bn, and which end depends almost entirely on margin and growth rate." },
    howMany: "Somewhere around 3,000 companies in the world turn over $1bn a year or more.",
  },
  {
    id: "b50",
    revenue: 50_000_000_000,
    label: "$50bn a year",
    short: "$50bn",
    whatItIs: "Among the largest companies on earth. At this size it is not a bigger version of a small business: it either sells something ordinary to hundreds of millions of people, or something expensive to most of an industry. It takes decades, or an enormous amount of other people's money, and usually both.",
    worth: { low: 50_000_000_000, high: 250_000_000_000, basis: "$50bn–$250bn, depending entirely on margin. A supermarket group at $50bn of sales is worth a fraction of what a software company at $50bn of sales is worth, because one keeps 2c of every dollar and the other keeps 30c." },
    howMany: "About 120 companies in the world turn over $50bn a year. Most are older than anyone reading this.",
  },
];

export const wwitTarget = (id: unknown): WwitTarget | null =>
  WWIT_TARGETS.find((t) => t.id === id) ?? null;

export const isWwitTargetId = (v: unknown): v is WwitTargetId =>
  typeof v === "string" && (WWIT_TARGET_IDS as readonly string[]).includes(v);

// ─── Reading this company's revenue out of its check-ins ─────────────────────

/**
 * Where a week's revenue comes from for each kind of business.
 *
 * Some businesses record it directly (a shop's takings); a restaurant records
 * the two numbers it is the product of. Software is the awkward one: the five
 * numbers a software company watches are all about *change* — new revenue,
 * churn, active customers — and none of them is the total. Rather than guess
 * at a total from a change, that case is reported as "we can't read this yet"
 * with the number to start filing, which is the honest answer and the one
 * point 2 of this feature exists to give.
 */
interface RevenueRecipe {
  /** Metric ids that are a week's revenue on their own, best first. */
  direct: string[];
  /** Two metrics whose product is a week's revenue. */
  product?: { units: string; price: string };
}

const REVENUE_RECIPE: Record<RunSubcategory, RevenueRecipe> = {
  restaurant: { direct: [], product: { units: "covers", price: "avg_spend" } },
  service: { direct: ["invoiced", "collected"] },
  retail: { direct: ["sales"] },
  agency: { direct: ["fees_invoiced", "collected"] },
  software: { direct: [] },
  other: { direct: ["revenue"] },
};

/** What to start filing when a company's numbers don't add up to revenue yet. */
export const REVENUE_ADVICE: Record<RunSubcategory, string> = {
  restaurant: "Fill in covers and average spend on your weekly check-in — the two together are the week's takings.",
  service: "Fill in money invoiced on your weekly check-in.",
  retail: "Fill in sales on your weekly check-in.",
  agency: "Fill in fees invoiced on your weekly check-in.",
  software: "None of the five numbers a software company watches is total revenue — they all measure change. Add one of your own called \"Revenue\" to the weekly check-in with the money that came in that week, and this becomes worth running.",
  other: "Fill in money in on your weekly check-in.",
};

/**
 * A number the company added itself that is plainly revenue by another name.
 * Checked after the recipe, so a company that tracks both keeps its real one.
 *
 * Only ever a `custom:` metric, never one of the defaults. The first version
 * of this matched any money-shaped metric by its label, which picked up a
 * software company's "New monthly revenue" and its "Revenue lost to
 * cancellations" — both of which measure change, neither of which is what the
 * business turns over. That is not a small error: a company taking $2m a year
 * would have been read as taking $200k, and told the $1m target was five times
 * away when it had already passed it.
 */
const CUSTOM_REVENUE = /\b(revenue|sales|turnover|takings|income|money in|billings|gross|mrr|arr)\b/i;

export interface RevenueRead {
  /** An average week, in dollars. */
  weekly: number;
  /** That week × 52. Every target is a yearly figure, so everything compares here. */
  annual: number;
  /** How many filed check-ins the average is over. */
  weeksUsed: number;
  /** The most recent week it read. */
  latestWeek: string;
  /** Which metrics it came from, for showing the person what it was built on. */
  metricIds: string[];
  /** "Sales, averaged over the last 6 weeks you filed." */
  from: string;
}

const numbersOf = (c: CheckinLike): Record<string, number | null> =>
  c.numbers && typeof c.numbers === "object" && !Array.isArray(c.numbers) ? (c.numbers as Record<string, number | null>) : {};

const finite = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * A week's revenue, averaged over the most recent check-ins that have the
 * numbers for it.
 *
 * Averaged rather than taken from the latest week on purpose: one quiet week
 * would otherwise halve a company's apparent size and change the verdict.
 * Weeks that are missing the numbers are skipped rather than counted as zero
 * — a blank box means "not filled in", not "we took nothing".
 */
export function readWeeklyRevenue(
  subcategory: unknown,
  checkins: CheckinLike[],
  maxWeeks = 8,
): RevenueRead | null {
  const sub = asRunSubcategory(subcategory);
  const sorted = [...checkins].sort((a, b) => b.weekOf.localeCompare(a.weekOf));
  if (!sorted.length) return null;
  const recipe = REVENUE_RECIPE[sub];

  const attempts: { ids: string[]; value: (n: Record<string, number | null>) => number | null; label: string }[] = [];
  for (const id of recipe.direct) {
    attempts.push({ ids: [id], value: (n) => finite(n[id]), label: metricFor(id).label });
  }
  if (recipe.product) {
    const { units, price } = recipe.product;
    attempts.push({
      ids: [units, price],
      value: (n) => {
        const u = finite(n[units]); const p = finite(n[price]);
        return u == null || p == null ? null : u * p;
      },
      label: `${metricFor(units).label} × ${metricFor(price).label}`,
    });
  }
  // The company's own number for it, last, so a real one always wins.
  const customIds = [...new Set(sorted.flatMap((c) => Object.keys(numbersOf(c))))]
    .filter((id) => id.startsWith(CUSTOM_PREFIX) && CUSTOM_REVENUE.test(metricFor(id).label));
  for (const id of customIds) {
    attempts.push({ ids: [id], value: (n) => finite(n[id]), label: metricFor(id).label });
  }

  for (const attempt of attempts) {
    const values: number[] = [];
    let latestWeek = "";
    for (const c of sorted) {
      if (values.length >= maxWeeks) break;
      const v = attempt.value(numbersOf(c));
      if (v == null || v < 0) continue;
      if (!latestWeek) latestWeek = c.weekOf;
      values.push(v);
    }
    // One week is enough to say something; it is just said with the week count attached.
    if (!values.length) continue;
    const weekly = values.reduce((s, v) => s + v, 0) / values.length;
    if (weekly <= 0) continue;
    return {
      weekly,
      annual: weekly * 52,
      weeksUsed: values.length,
      latestWeek,
      metricIds: attempt.ids,
      from: values.length === 1
        ? `${attempt.label}, from the one week you have filed (${latestWeek})`
        : `${attempt.label}, averaged over the last ${values.length} weeks you filed (to ${latestWeek})`,
    };
  }
  return null;
}

// ─── Margin ──────────────────────────────────────────────────────────────────

/**
 * Gross or net, and never the two confused.
 *
 * A gross margin is what is left after the cost of the thing sold; a net
 * margin is what the business actually keeps. A restaurant running at 32%
 * gross is perfectly healthy and may still keep nothing, because rent, wages
 * outside the kitchen, rates and interest all come out after that. Calling one
 * the other would tell an owner they have money to fund growth with when they
 * have none, so every read carries which it is and every sentence written from
 * it says so out loud.
 */
export type MarginKind = "gross" | "net";

export interface MarginRead {
  /** 0.18 for 18%. */
  fraction: number;
  kind: MarginKind;
  /** "Food and labour cost (% of sales), averaged over 4 weeks — a gross margin…". */
  from: string;
  metricIds: string[];
}

/** A number the company added itself that means margin (a percentage) or profit (money). */
const CUSTOM_MARGIN = /\bmargin\b/i;
const CUSTOM_PROFIT = /\b(profit|earnings|takehome|take-home)\b/i;

/**
 * What the business keeps, where its own check-ins say.
 *
 * Three sources, in order of how directly they answer the question: a margin
 * the company records itself, a profit figure it records itself (divided by
 * the revenue of the same weeks), and — for a restaurant only — prime cost,
 * which is the one default metric anywhere in the Run path that implies a
 * margin at all. Nothing is inferred beyond that: a business with no profit
 * number gets null, and the roadmap says so rather than picking a plausible
 * figure, because the whole point of the margin work is that the difference
 * between 3% and 40% is the difference between two entirely different answers.
 */
export function readMargin(subcategory: unknown, checkins: CheckinLike[], maxWeeks = 8): MarginRead | null {
  const sub = asRunSubcategory(subcategory);
  const sorted = [...checkins].sort((a, b) => b.weekOf.localeCompare(a.weekOf));
  if (!sorted.length) return null;

  const avg = (id: string, take = maxWeeks): { value: number; weeks: number } | null => {
    const vs: number[] = [];
    for (const c of sorted) {
      if (vs.length >= take) break;
      const v = finite(numbersOf(c)[id]);
      if (v == null) continue;
      vs.push(v);
    }
    return vs.length ? { value: vs.reduce((s, v) => s + v, 0) / vs.length, weeks: vs.length } : null;
  };
  const weeks = (n: number) => (n === 1 ? "from one week" : `averaged over ${n} weeks`);
  const kindOf = (label: string): MarginKind => (/\bgross\b/i.test(label) ? "gross" : "net");

  const customIds = [...new Set(sorted.flatMap((c) => Object.keys(numbersOf(c))))].filter((id) => id.startsWith(CUSTOM_PREFIX));

  // 1. A margin the company records itself, as a percentage.
  for (const id of customIds.filter((i) => CUSTOM_MARGIN.test(metricFor(i).label))) {
    const read = avg(id);
    if (!read || read.value <= -100 || read.value > 100) continue;
    const kind = kindOf(metricFor(id).label);
    return {
      fraction: read.value / 100,
      kind,
      from: `${metricFor(id).label}, ${weeks(read.weeks)} — read as a ${kind} margin`,
      metricIds: [id],
    };
  }

  // 2. A profit figure it records itself, against the revenue of the same weeks.
  for (const id of customIds.filter((i) => CUSTOM_PROFIT.test(metricFor(i).label) && !CUSTOM_MARGIN.test(metricFor(i).label))) {
    const profit = avg(id);
    const revenue = readWeeklyRevenue(sub, checkins, maxWeeks);
    if (!profit || !revenue || revenue.weekly <= 0) continue;
    const kind = kindOf(metricFor(id).label);
    return {
      fraction: profit.value / revenue.weekly,
      kind,
      from: `${metricFor(id).label} against ${metricFor(revenue.metricIds[0]).label}, ${weeks(profit.weeks)} — read as a ${kind} margin`,
      metricIds: [id, ...revenue.metricIds],
    };
  }

  /*
   * 3. A restaurant's prime cost. Food and labour as a share of sales, so
   * what's left is gross — rent, rates, everything else and the owner's own
   * wage are all still to come out of it. Named as gross wherever it is used,
   * because a café reading "68% margin" and believing it keeps 68c in the
   * dollar is exactly the misreading this whole section exists to prevent.
   */
  if (sub === "restaurant") {
    const prime = avg("prime_cost_pct");
    if (prime && prime.value > 0 && prime.value < 100) {
      return {
        fraction: (100 - prime.value) / 100,
        kind: "gross",
        from: `${metricFor("prime_cost_pct").label}, ${weeks(prime.weeks)} — what's left after food and labour, before rent and everything else`,
        metricIds: ["prime_cost_pct"],
      };
    }
  }
  return null;
}

/** What to add to the weekly check-in so the next run doesn't have to guess. */
export const MARGIN_ADVICE =
  "Add a number of your own called \"Profit\" to the weekly check-in — what the business actually kept that week, after everything — and the next run of this can say what the target is worth to you rather than only what it turns over.";

/** The two ends this straddles when nobody has filed a margin: a supermarket and a software company. */
export const MARGIN_GUESS_LOW = 0.1;
export const MARGIN_GUESS_HIGH = 0.4;

// ─── What this business sells, one of ────────────────────────────────────────

export interface UnitRead {
  /** "covers", "jobs", "customers" — plural, as the person says it. */
  unit: string;
  /** How many in an average week. */
  perWeek: number;
  /** What one is worth. */
  price: number;
  /** "500 covers a week at $28 each". */
  how: string;
}

/**
 * The customers × price behind the revenue, where the company's own numbers
 * contain it. Not every business records one: an agency tracks fees and not
 * jobs, so it gets no unit line rather than an invented one.
 */
export function readUnits(subcategory: unknown, checkins: CheckinLike[], maxWeeks = 8): UnitRead | null {
  const sub = asRunSubcategory(subcategory);
  const sorted = [...checkins].sort((a, b) => b.weekOf.localeCompare(a.weekOf)).slice(0, maxWeeks);
  if (!sorted.length) return null;

  const avg = (id: string): number | null => {
    const vs = sorted.map((c) => finite(numbersOf(c)[id])).filter((v): v is number => v != null && v >= 0);
    return vs.length ? vs.reduce((s, v) => s + v, 0) / vs.length : null;
  };

  const say = (unit: string, perWeek: number, price: number): UnitRead => ({
    unit, perWeek, price,
    how: `${Math.round(perWeek).toLocaleString("en-GB")} ${unit} a week at ${formatValue(price, "money")} each`,
  });

  if (sub === "restaurant") {
    const covers = avg("covers"); const spend = avg("avg_spend");
    return covers && spend ? say("covers", covers, spend) : null;
  }
  if (sub === "retail") {
    const sales = avg("sales"); const basket = avg("avg_basket");
    return sales && basket ? say("sales", sales / basket, basket) : null;
  }
  if (sub === "service") {
    const jobs = avg("jobs_done"); const invoiced = avg("invoiced");
    return jobs && invoiced ? say("jobs", jobs, invoiced / jobs) : null;
  }
  if (sub === "software") {
    const customers = avg("active_customers");
    const revenue = readWeeklyRevenue(sub, checkins, maxWeeks);
    return customers && revenue ? say("customers", customers, revenue.weekly / customers) : null;
  }
  return null;
}

// ─── The gap ─────────────────────────────────────────────────────────────────

/** How many of what it has now the company would need. A restaurant scales in restaurants. */
const COPY_NOUN: Record<RunSubcategory, string> = {
  restaurant: "restaurants the size of yours",
  retail: "shops the size of yours",
  service: "teams the size of yours",
  agency: "agencies the size of yours",
  software: "times the revenue you have now",
  other: "businesses the size of yours",
};

export interface Gap {
  todayAnnual: number;
  targetAnnual: number;
  /** targetAnnual ÷ todayAnnual. The single number the whole verdict turns on. */
  multiple: number;
  extraAnnual: number;
  /** "About 1,900 restaurants the size of yours." */
  inCopies: string;
  /** "At $28 a head, 686,000 covers a week." Null when the business doesn't record units. */
  inUnits: string | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * A multiple as a person would say it: "1.92×" for the small ones, "96,154×"
 * for the ones that make the point. Past ten, the decimals are noise that
 * makes a serious number look like a spreadsheet cell.
 */
export const showMultiple = (m: number): string =>
  `${m >= 10 ? Math.round(m).toLocaleString("en-GB") : round2(m)}×`;

export function gapTo(target: WwitTarget, revenue: RevenueRead, units: UnitRead | null, subcategory: unknown): Gap {
  const sub = asRunSubcategory(subcategory);
  const multiple = target.revenue / revenue.annual;
  const copies = Math.max(1, Math.round(multiple));
  return {
    todayAnnual: Math.round(revenue.annual),
    targetAnnual: target.revenue,
    multiple: round2(multiple),
    extraAnnual: Math.round(target.revenue - revenue.annual),
    inCopies: sub === "software"
      ? `${copies.toLocaleString("en-GB")}× the revenue you have now`
      : `About ${copies.toLocaleString("en-GB")} ${COPY_NOUN[sub]}`,
    inUnits: units
      ? `At ${formatValue(units.price, "money")} each, ${Math.round(target.revenue / 52 / units.price).toLocaleString("en-GB")} ${units.unit} a week — you do about ${Math.round(units.perWeek).toLocaleString("en-GB")}.`
      : null,
  };
}

// ─── The ladder ──────────────────────────────────────────────────────────────

export interface Stage {
  /** 1-based. */
  number: number;
  /** Revenue a year this stage ends at. */
  endsAt: number;
  /** How many times bigger than the stage before, rounded to one place. */
  multiple: number;
  /** "About 3 years" — at a fast but real pace. */
  howLong: string;
  /** Years, for the running total. */
  years: number;
}

/**
 * Growth that a real business sustains for years, used to turn a multiple
 * into a length of time.
 *
 * 40% a year compounding is fast — it is roughly a doubling every two years —
 * and very few companies hold it for a decade. It is used here rather than
 * something faster because the number this produces is the one an owner will
 * quote at someone, and an optimistic pace makes "$1bn in six years" look
 * like a plan instead of a fantasy.
 */
const PACE_PER_YEAR = 1.4;

/** Ten years of a stage is not a stage, so the ladder aims for steps of about this size. */
const STEP_TARGET = 6;

/**
 * The stages between here and the target: a geometric ladder, because growth
 * is multiplicative. Each rung is the same multiple, chosen so the rungs come
 * out near 6× — big enough to be a real change in the business, small enough
 * that "what has to be true" is answerable for one rung at a time.
 */
export function stageLadder(fromAnnual: number, toAnnual: number, maxStages = 6): Stage[] {
  if (!(fromAnnual > 0) || !(toAnnual > fromAnnual)) return [];
  const total = toAnnual / fromAnnual;
  const count = Math.max(1, Math.min(maxStages, Math.round(Math.log(total) / Math.log(STEP_TARGET)) || 1));
  const step = Math.pow(total, 1 / count);
  const years = Math.log(step) / Math.log(PACE_PER_YEAR);
  const stages: Stage[] = [];
  for (let i = 1; i <= count; i += 1) {
    stages.push({
      number: i,
      // Built from the original, not by repeated multiplication, so the last rung lands exactly on the target.
      endsAt: Math.round(fromAnnual * Math.pow(step, i)),
      multiple: round2(step),
      years: round2(years),
      howLong: describeYears(years),
    });
  }
  return stages;
}

export function describeYears(years: number): string {
  if (years < 0.75) return "Under a year";
  if (years < 1.5) return "About a year";
  if (years < 10) return `About ${Math.round(years)} years`;
  if (years < 25) return `${Math.round(years / 5) * 5} years or so`;
  return "A generation";
}

// ─── The verdict ─────────────────────────────────────────────────────────────

export type WwitVerdict = "reachable" | "a stretch" | "a different business";

/**
 * Whether the target is reachable from here, decided by the multiple alone.
 *
 * The thresholds are blunt on purpose. Anything up to about 30× is a bigger
 * version of the business that exists — more sites, more staff, the same
 * thing. Past about 1,000× it is not the same business at all, however hard
 * anyone works, and saying so is the whole reason this feature exists. The
 * middle is a stretch: possible, but it needs something the company does not
 * have today, usually other people's money or a different way of selling.
 */
export function verdictFor(multiple: number): WwitVerdict {
  if (multiple <= 30) return "reachable";
  if (multiple <= 1000) return "a stretch";
  return "a different business";
}

const HARDER: Record<WwitVerdict, WwitVerdict> = {
  reachable: "a stretch",
  "a stretch": "a different business",
  "a different business": "a different business",
};

/** Below this, there is effectively nothing left over to pay for growth with. */
export const THIN_NET_MARGIN = 0.05;
/** Under about ten times, a build can be done out of trading; past it, it has to be funded. */
const FUNDED_BUILD_MULTIPLE = 10;

export interface VerdictCall {
  verdict: WwitVerdict;
  /** What the revenue multiple alone said, before the margin was considered. */
  onRevenueAlone: WwitVerdict;
  /** True when a thin net margin made it harder than the revenue gap alone. */
  tightenedByMargin: boolean;
  /** Always said, margin or no margin. This is the sentence that stops the two being confused. */
  note: string;
}

/**
 * The verdict once what the business keeps is taken into account.
 *
 * A business at $1m turnover keeping $300k and one keeping $20k are not the
 * same distance from anything, and for a while this said they were. Growth is
 * paid for out of profit or out of somebody else's money; a company with
 * almost no profit and a target that needs a real capital build is therefore
 * not in the same position as one that can fund it from trading, whatever
 * their revenue multiples have in common.
 *
 * Only a *net* margin tightens the verdict. A gross margin says nothing about
 * what is left to reinvest — a restaurant at 32% gross is ordinary and healthy
 * and may keep nothing at all — so treating one as the other would refuse
 * perfectly reachable targets to perfectly normal businesses. A gross read
 * gets said out loud and then set aside.
 *
 * And it only tightens past a build that trading could plausibly fund. Doubling
 * on a thin margin is hard; it is not "a different business", and saying so
 * would be its own kind of dishonesty.
 */
export function verdictWithMargin(multiple: number, margin: MarginRead | null): VerdictCall {
  const base = verdictFor(multiple);
  const pct = margin ? Math.round(margin.fraction * 100) : null;

  if (!margin) {
    return {
      verdict: base, onRevenueAlone: base, tightenedByMargin: false,
      note: `There is no profit number in your check-ins, so this is a verdict about revenue only. A business keeping 3c in the dollar and one keeping 40c are not the same distance from this target. ${MARGIN_ADVICE}`,
    };
  }
  if (margin.kind === "gross") {
    return {
      verdict: base, onRevenueAlone: base, tightenedByMargin: false,
      note: `Your margin reads about ${pct}%, but that is a gross margin — ${margin.from}. It is not what the business keeps, so the verdict here is still about revenue only. ${MARGIN_ADVICE}`,
    };
  }
  if (margin.fraction < THIN_NET_MARGIN && multiple > FUNDED_BUILD_MULTIPLE) {
    const harder = HARDER[base];
    return {
      verdict: harder, onRevenueAlone: base, tightenedByMargin: harder !== base,
      note: `You keep about ${pct}% of what comes in. A build ${showMultiple(multiple)} the size of the business cannot be paid for out of that, so it needs outside money or a different margin${harder !== base ? ` — which is why this reads as "${harder}" rather than "${base}" on the revenue gap alone` : ""}.`,
    };
  }
  return {
    verdict: base, onRevenueAlone: base, tightenedByMargin: false,
    note: `You keep about ${pct}% of what comes in (${margin.from}), so some of this can be funded out of the business itself.`,
  };
}

/**
 * The sentence that refuses to flatter: what a business would have to become
 * to be this size, said in terms of the company in front of us.
 */
export function whatItImplies(subcategory: unknown, target: WwitTarget, gap: Gap): string {
  const sub = asRunSubcategory(subcategory);
  const verdict = verdictFor(gap.multiple);
  if (verdict === "reachable") {
    return `This is the business you have now, ${gap.multiple < 2 ? "a little" : `about ${Math.round(gap.multiple)} times`} bigger. The shape does not have to change; the capacity does.`;
  }
  const shape: Record<RunSubcategory, string> = {
    restaurant: `${gap.inCopies.toLowerCase()} — which is a restaurant group with a property team, a central kitchen or supply deal, regional managers and, almost certainly, outside money. Nobody gets there by filling the room you have.`,
    retail: `${gap.inCopies.toLowerCase()}, or one shop that became a wholesaler or a brand sold in other people's shops. The second is the only one most retailers ever manage.`,
    service: `${gap.inCopies.toLowerCase()} — a firm that hires, trains and supervises at a scale where you never meet most customers, or a product that does the job without your people doing it each time.`,
    agency: `${gap.inCopies.toLowerCase()}. Agencies are priced and sized by people, so this is a headcount question first: the revenue follows roughly linearly, and so does the cost.`,
    software: `${gap.inCopies}. Software is the one kind of business where that can come from the same team selling the same thing to far more people — but only if the thing already sells itself to someone, repeatedly, today.`,
    other: `${gap.inCopies.toLowerCase()}, which is a different company with a different structure, not the same one working harder.`,
  };
  const head = verdict === "a different business"
    ? `Not from here, not as this business. ${target.label} is ${Math.round(gap.multiple).toLocaleString("en-GB")}× what you turn over now.`
    : `A stretch: ${target.label} is ${Math.round(gap.multiple).toLocaleString("en-GB")}× what you turn over now.`;
  return `${head} What that size implies is ${shape[sub]}`;
}

// ─── What gets stored ────────────────────────────────────────────────────────

/**
 * The figures a roadmap was built from, stored beside it.
 *
 * This is what makes the feature worth coming back to. Six months later the
 * company runs it again, and the two roadmaps can be compared because each one
 * carries the revenue, the week and the check-in count it was built on. A
 * roadmap without its grounding is just an opinion with a date on it.
 */
export interface WwitGrounding {
  subcategory: RunSubcategory;
  /** Null when the company hasn't filed the numbers revenue can be read from. */
  annualRevenue: number | null;
  weeklyRevenue: number | null;
  revenueFrom: string | null;
  weeksUsed: number;
  latestWeek: string | null;
  /** Every check-in on file, so "you had filed four weeks then and twenty now" is answerable. */
  checkinsOnFile: number;
  units: UnitRead | null;
  /** What the business keeps, where its check-ins say — gross or net, never confused. Null when nobody has filed one. */
  margin: MarginRead | null;
  /** The numbers the company watches and where they stood, for showing under the roadmap. */
  metrics: { id: string; label: string; unit: string; latest: number | null }[];
  quarterGoals: string[];
  recurringJobs: number;
  monthsWithReports: number;
}

export interface WwitStage extends Stage {
  /** Nova's name for the stage: "One kitchen, three shifts". */
  title: string;
  /** People, capacity, cash, margin — what has to be true by the end of it. */
  mustBeTrue: string[];
  /** The first thing that breaks at this size. */
  breaksFirst: string;
  /** What fixing it costs, in money or in hiring. */
  costToFix: string;
}

export interface WwitStep {
  title: string;
  /** Why this one, in a line. Shown under the step and copied onto the board task. */
  why: string;
}

export interface WwitRoadmapBody {
  /** One sentence a person would say out loud. */
  headline: string;
  /** The arithmetic of the gap, as lines. Computed, not written. */
  arithmetic: string[];
  stages: WwitStage[];
  /** The first ninety days, concrete. These are what the board hand-off creates. */
  first90: WwitStep[];
  /** The honest read. Ends with what would have to change if it isn't reachable. */
  verdict: WwitVerdict;
  /** What the revenue gap alone said, so a verdict the margin made harder can show its working. */
  verdictOnRevenueAlone: WwitVerdict;
  /** True when a thin net margin is the reason the verdict is what it is. */
  tightenedByMargin: boolean;
  /** What the margin does, or doesn't, tell us. Always present, margin or no margin. */
  marginNote: string;
  verdictText: string;
  /** What this size of company actually is, and what it would be worth — from the target. */
  whatItIs: string;
  worth: string;
}

/** Everything a stored roadmap holds. The row's jsonb is exactly this. */
export interface WwitRoadmap {
  target: WwitTargetId;
  gap: Gap | null;
  body: WwitRoadmapBody;
}

/** How the gap moved between two runs. Null where one of them couldn't read revenue. */
export interface WwitMovement {
  previousAnnual: number;
  currentAnnual: number;
  /** Positive means revenue grew. */
  changeFraction: number;
  previousMultiple: number;
  currentMultiple: number;
  /** "The gap closed from 48× to 31×." */
  text: string;
}

export function movementBetween(
  target: WwitTarget,
  previous: { annualRevenue: number | null },
  current: { annualRevenue: number | null },
): WwitMovement | null {
  const a = previous.annualRevenue; const b = current.annualRevenue;
  if (!a || !b || a <= 0 || b <= 0) return null;
  const prevMultiple = round2(target.revenue / a);
  const curMultiple = round2(target.revenue / b);
  const change = round2((b - a) / a);
  const dir = curMultiple < prevMultiple ? "closed" : curMultiple > prevMultiple ? "widened" : "did not move";
  return {
    previousAnnual: Math.round(a),
    currentAnnual: Math.round(b),
    changeFraction: change,
    previousMultiple: prevMultiple,
    currentMultiple: curMultiple,
    text: dir === "did not move"
      ? `The gap is still ${showMultiple(curMultiple)}.`
      : `The gap ${dir} from ${showMultiple(prevMultiple)} to ${showMultiple(curMultiple)}, on revenue ${change >= 0 ? "up" : "down"} ${Math.abs(Math.round(change * 100))}%.`,
  };
}

/**
 * The lines of arithmetic under the roadmap. Computed here rather than asked
 * of the model, because these are the numbers the person will repeat to their
 * accountant, and a model that rounds $1.9m to $2m has told them something
 * untrue about their own business.
 */
export function arithmeticLines(
  target: WwitTarget,
  revenue: RevenueRead,
  gap: Gap,
  units: UnitRead | null,
  margin: MarginRead | null = null,
): string[] {
  const lines = [
    `Today: about ${formatValue(revenue.annual, "money")} a year (${formatValue(revenue.weekly, "money")} a week). ${revenue.from}.`,
    `Target: ${formatValue(target.revenue, "money")} a year — ${showMultiple(gap.multiple)} where you are.`,
    `The gap: ${formatValue(gap.extraAnnual, "money")} a year more than you take now.`,
    gap.inCopies + ".",
  ];
  if (gap.inUnits) lines.push(gap.inUnits);
  if (units) lines.push(`What you sell now: ${units.how}.`);

  /*
   * Revenue is not money kept, and this is where that stops being an omission.
   * With a margin on file the line is specific; without one it shows both ends
   * of the plausible range, so the owner can see how much of the answer is
   * resting on a number nobody has filed — rather than the roadmap quietly
   * reasoning as though the question never came up.
   */
  if (margin) {
    const pct = Math.round(margin.fraction * 100);
    const what = margin.kind === "gross" ? "gross profit (before rent, wages outside the line and everything else)" : "profit";
    lines.push(
      `Margin: about ${pct}% ${margin.kind} — ${margin.from}. At that margin, ${formatValue(target.revenue, "money")} of revenue is about ${formatValue(target.revenue * margin.fraction, "money")} of ${what} a year, against roughly ${formatValue(revenue.annual * margin.fraction, "money")} today.`,
    );
  } else {
    lines.push(
      `Margin: not in your check-ins, so this is revenue, not money kept. At a ${Math.round(MARGIN_GUESS_LOW * 100)}% margin, ${formatValue(target.revenue, "money")} a year is about ${formatValue(target.revenue * MARGIN_GUESS_LOW, "money")} of profit; at ${Math.round(MARGIN_GUESS_HIGH * 100)}%, about ${formatValue(target.revenue * MARGIN_GUESS_HIGH, "money")}. ${MARGIN_ADVICE}`,
    );
  }
  return lines;
}

/** "Worth roughly $300k–$800k" plus the basis, as one sentence. */
export const worthLine = (t: WwitTarget): string =>
  `Worth roughly ${formatValue(t.worth.low, "money")}–${formatValue(t.worth.high, "money")}. ${t.worth.basis}`;
