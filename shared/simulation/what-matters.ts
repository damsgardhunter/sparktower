/**
 * Which number in this plan actually decides it.
 *
 * The simulator could already answer "what happens if I do this?" precisely.
 * It could not answer the question people ask immediately afterwards, which is
 * **"which part of this should I worry about?"** — and without that, a plan
 * with nine numbers in it is nine things to fret over equally, when in practice
 * one or two of them carry the whole answer and the rest are noise.
 *
 * So: take the plan that was run, nudge each number in it on its own, and see
 * how far the answer moves. Everything is ranked by how much it moved, in
 * money, and said in a sentence an owner can act on. It is the difference
 * between "here is your projection" and "your churn rate is the thing; the ad
 * budget barely matters".
 *
 * ## Why a nudge rather than a derivative
 *
 * The honest reason is that a percentage is something an owner can picture and
 * a gradient is not. "A fifth more churn costs you £14,000" is a sentence
 * somebody can check against their own experience; ∂cash/∂churn is not. The
 * nudge is also robust to the kinks in this engine — the drawings cap, the
 * market ceiling, the month a wage stops — where a derivative taken at a point
 * would happily report a slope that does not exist a step either side.
 *
 * ## Why both directions
 *
 * Because they are not symmetric and the asymmetry is the useful part. Halving
 * the marketing budget usually costs less than doubling it gains, and a plan
 * that survives being 20% wrong in one direction and dies 20% wrong in the
 * other is a plan whose owner should know which way round that is.
 */
import {
  answer, runMonths, type Answer, type Baseline, type Lever, type SubscriptionLever,
} from "./decision-sim";

/** How hard to push each number. A fifth is big enough to move the answer and small enough to still be the same plan. */
const NUDGE = 0.2;

export interface Sensitivity {
  /**
   * Whether this is part of the decision being asked about, or part of the
   * business underneath it.
   *
   * They have to be kept apart, and a test caught why. Rank them together and
   * the business always wins: a fifth of a £15,000 monthly cost base is
   * £108,000 over three years, and no single hire can move the answer that
   * far. So the reply to "should I take this person on?" came back "your
   * running costs are the thing", which is true, unhelpful, and not what was
   * asked. Both are worth knowing; they are two different questions.
   */
  scope: "decision" | "business";
  /** Which lever it belongs to, by index, or -1 for one of the baseline's own figures. */
  leverIndex: number;
  /** The field's key, so a client can highlight the box it lives in. */
  field: string;
  /** What the field is called in the owner's words. */
  label: string;
  /** The value the plan actually used. */
  value: number;
  /** End cash if this were a fifth better, and a fifth worse. */
  better: number;
  worse: number;
  /** The spread between them — how much this one number is worth. */
  swing: number;
  /** A sentence for the owner. */
  line: string;
}

/**
 * The fields worth nudging, and which direction counts as "better".
 *
 * A closed list rather than every number on the lever, because some of them
 * are not things anybody can decide — `startMonth` moves the answer a long way
 * and "start it sooner" is not a lever, it is a wish — and a ranking cluttered
 * with those buries the ones that are.
 */
const WORTH_NUDGING: Record<string, { label: string; betterIsUp: boolean }> = {
  monthlyChurn: { label: "how many leave each month", betterIsUp: false },
  earlyChurn: { label: "how many leave in their first months", betterIsUp: false },
  pricePerMonth: { label: "what you charge", betterIsUp: true },
  newCustomersAtFull: { label: "how many the spending wins", betterIsUp: true },
  newCustomersFromHours: { label: "how many your own hours win", betterIsUp: true },
  wordOfMouth: { label: "how much customers bring you", betterIsUp: true },
  reinvestShare: { label: "how much you put back in", betterIsUp: true },
  monthlyAmount: { label: "what you spend a month", betterIsUp: true },
  rivalShare: { label: "how much of the market is taken", betterIsUp: false },
  priceErosion: { label: "how fast the price falls", betterIsUp: false },
  monthlyCostEach: { label: "what each one costs", betterIsUp: false },
  monthlyRevenueEach: { label: "what each one brings in", betterIsUp: true },
  monthlyTakeHome: { label: "what the wage pays", betterIsUp: true },
  marketSize: { label: "how many customers exist", betterIsUp: true },
};

/** The baseline's own figures, which are as much a decision as any lever. */
const BASELINE_NUDGES: { field: keyof Baseline; label: string; betterIsUp: boolean }[] = [
  { field: "monthlyCosts", label: "what it costs you to run", betterIsUp: false },
  { field: "grossMargin", label: "what you keep per pound", betterIsUp: true },
  { field: "ownerHours", label: "the hours you can give it", betterIsUp: true },
  { field: "daysToGetPaid", label: "how long customers take to pay", betterIsUp: false },
];

const money = (n: number) => Math.round(n);

/**
 * Rank everything in this plan by how much it is worth.
 *
 * Runs the engine twice per number, which for a plan with a dozen nudgeable
 * figures is a couple of dozen projections — cheap, because the engine is
 * arithmetic and the whole point of it being arithmetic is that this is
 * affordable.
 */
export function whatMatters(input: {
  baseline: Baseline;
  levers: Lever[];
  months: number;
  /** How many to return. The tail is noise by construction. */
  top?: number;
}): Sensitivity[] {
  /*
   * `runMonths`, not `answer`.
   *
   * `answer` does three confidence runs, a do-nothing run, the verdict, the
   * facts — and, since it learned to, `ruinRisk`, which is two hundred and
   * forty more projections. This function calls it twice per field, so a plan
   * with thirteen nudgeable numbers was asking for something like six thousand
   * full thirty-six-month simulations to draw one small panel, and the
   * simulations page timed out on any project with a couple of scenarios on
   * it. What a nudge needs is one number off one run, which is what this is.
   */
  const at = (baseline: Baseline, levers: Lever[]): number =>
    runMonths({ baseline, levers, months: input.months, confidence: "likely" }).endCash;

  const found: Sensitivity[] = [];

  const record = (
    scope: "decision" | "business",
    leverIndex: number, field: string, label: string, value: number,
    up: number, down: number, betterIsUp: boolean,
  ) => {
    const better = betterIsUp ? up : down;
    const worse = betterIsUp ? down : up;
    const swing = Math.abs(better - worse);
    if (!Number.isFinite(swing) || swing < 1) return;
    found.push({ scope, leverIndex, field, label, value, better: money(better), worse: money(worse), swing: money(swing), line: "" });
  };

  for (let i = 0; i < input.levers.length; i += 1) {
    const lever = input.levers[i] as unknown as Record<string, unknown>;
    for (const [field, meta] of Object.entries(WORTH_NUDGING)) {
      const value = lever[field];
      if (typeof value !== "number" || !Number.isFinite(value) || value === 0) continue;
      const swap = (v: number) => {
        const copy = input.levers.slice();
        copy[i] = { ...(input.levers[i] as SubscriptionLever), [field]: v } as Lever;
        return at(input.baseline, copy);
      };
      record("decision", i, field, meta.label, value, swap(value * (1 + NUDGE)), swap(value * (1 - NUDGE)), meta.betterIsUp);
    }
  }

  for (const { field, label, betterIsUp } of BASELINE_NUDGES) {
    const value = input.baseline[field];
    if (typeof value !== "number" || !Number.isFinite(value) || value === 0) continue;
    const swap = (v: number) => at({ ...input.baseline, [field]: v }, input.levers);
    record("business", -1, field, label, value, swap(value * (1 + NUDGE)), swap(value * (1 - NUDGE)), betterIsUp);
  }

  /*
   * Sorted within each scope and returned decision-first, so the answer to
   * "should I do this?" leads with the parts of *this*, and the business's own
   * figures follow as context rather than crowding it out.
   */
  const top = input.top ?? 5;
  const bySwing = (a: Sensitivity, b: Sensitivity) => b.swing - a.swing;
  const decision = found.filter((r) => r.scope === "decision").sort(bySwing).slice(0, top);
  const business = found.filter((r) => r.scope === "business").sort(bySwing).slice(0, Math.max(2, Math.ceil(top / 2)));
  return [...decision, ...business];
}

/**
 * The same, written out, in the business's own money.
 *
 * Separate from the ranking so the numbers can be tested without testing the
 * prose, and so a client that wants to draw bars rather than read sentences
 * has the figures on their own.
 */
export function explainWhatMatters(rows: Sensitivity[], money: (n: number) => string): Sensitivity[] {
  const pct = Math.round(NUDGE * 100);
  /*
   * Only the plan that really has one gets told it has one.
   *
   * When the top two are within a quarter of each other there is no single
   * number deciding anything, and writing "X is the one that matters" would be
   * the confident noise this engine exists to avoid. The ranking is still
   * worth showing — knowing that price and volume both swamp churn is useful —
   * so the list stays and only the claim goes.
   */
  const hasOne = worthSaying(rows);
  const first = rows.findIndex((r) => r.scope === "decision");
  return rows.map((r, i) => ({
    ...r,
    line: i === first && hasOne
      ? `${capitalise(r.label)} is the number that decides this: ${pct}% either way is a ${money(r.swing)} swing in what you end up with.`
      : `${capitalise(r.label)}: ${pct}% either way moves it by ${money(r.swing)}.`,
  }));
}

/**
 * One line over the whole ranking, or null when there is nothing honest to say.
 *
 * The heading somebody reads before the list, and the place the "no single
 * driver" case is handled out loud rather than by omission — a panel that
 * silently shows five equal bars teaches less than a sentence saying they are
 * equal, and why that is itself the finding.
 */
export function headlineWhatMatters(rows: Sensitivity[], money: (n: number) => string): string | null {
  const own = rows.filter((r) => r.scope === "decision");
  if (own.length < 2) return null;
  if (worthSaying(rows)) {
    return `One number carries this decision: ${own[0].label}. Everything else in it moves the answer by less.`;
  }
  const [a, b] = own;
  const tail = own[own.length - 1];
  /* Two that matter about equally, and a tail that does not: the useful shape. */
  if (tail && a.swing > tail.swing * 2) {
    return `Two things carry this plan about equally — ${a.label} and ${b.label} — and they are worth several times anything else on the list.`;
  }
  return `Nothing here decides this on its own: every number below moves the answer by a similar amount, so it is the combination that matters rather than any one of them.`;
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Whether the ranking is worth showing at all.
 *
 * A plan where everything moves the answer about equally has no story to tell,
 * and inventing one — "your margin is the key driver!" — would be exactly the
 * confident noise this whole engine exists to avoid. The top item has to be
 * meaningfully bigger than the second, or nothing is said.
 */
export const worthSaying = (rows: Sensitivity[]): boolean => {
  /* Only the decision's own numbers can crown the decision. */
  const own = rows.filter((r) => r.scope === "decision");
  return own.length >= 2 && own[0].swing > own[1].swing * 1.25;
};

/** Convenience for a caller that has an `Answer` already and wants the ranking beside it. */
export const whatMattersFor = (
  a: Answer, baseline: Baseline, levers: Lever[], money: (n: number) => string,
): Sensitivity[] => explainWhatMatters(whatMatters({ baseline, levers, months: a.months }), money);
