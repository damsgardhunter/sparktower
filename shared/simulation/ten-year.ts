/**
 * What a business is worth in ten years, computed.
 *
 * The decision simulator's whole architecture is that the arithmetic decides
 * and Nova narrates: the verdict is worked out from the cash curve and handed
 * to the model as a fact it may not contradict, because a model asked for a
 * number will produce a confident one and nobody can check it.
 *
 * The ten-year outlook sat on the same page and did the opposite. It asked the
 * model for `tenYear`, `peak` and `peakYear` outright — three invented figures
 * rendered beside a curve that had been computed to the pound, borrowing its
 * credibility. That is the single most misleading thing on the screen, and it
 * is misleading in the flattering direction, because a model asked what a
 * business might be worth in a decade has no reason to say "very little".
 *
 * So the number is computed here, from figures the owner has already given,
 * and the model is left the job it is good at: saying what it means.
 *
 * ## How it is worked out
 *
 * Nothing clever, on purpose — an owner has to be able to argue with it.
 *
 *  1. Revenue is carried forward ten years at a growth rate that decays. A
 *     business growing 3% a month does not do that for a decade; it slows as
 *     it fills its market, and `DECAY` halves the rate every couple of years.
 *  2. Profit is revenue at the gross margin, less the overheads, less tax.
 *  3. The value is that profit multiplied. The multiple is where the judgement
 *     is, and it is a small number for a small business: an owner-operated
 *     business with no recurring revenue changes hands at two to three times
 *     what it earns its owner, and most of them at the bottom of that.
 *
 * The multiple is where the year's spending shows up, which is the point of
 * asking the question at all. Money put into the things that make a business
 * sellable — someone who can run it, systems that work without the owner,
 * customers who come back — raises it. Money put into capacity does not.
 *
 * It is a range, and it is presented as one. A single figure for a decade out
 * is a fiction whatever produces it; what is defensible is an order of
 * magnitude and the reasons it might land at either end.
 */
import type { Baseline } from "./decision-sim";
import type { BudgetSummary } from "../sprints/budget";

/** Ten years, in months, for carrying the revenue forward. */
const HORIZON_YEARS = 10;

/**
 * How fast growth fades.
 *
 * A business does not hold its current growth rate for a decade. This halves
 * it roughly every two years, which turns a spectacular first year into a
 * respectable decade rather than a fantasy — 3% a month sustained for ten
 * years is thirty-fold, and almost nothing does that.
 */
const DECAY = 0.7;

/**
 * The lines that make a business worth a multiple rather than a wage.
 *
 * A buyer is not buying this year's profit, they are buying next year's
 * without the current owner in it. These are the ids on both decks that buy
 * that; funding them moves the multiple, and the ids are shared deliberately
 * (see shared/simulation/operating-deck.ts).
 */
const SELLABILITY = new Set(["manager", "systems", "come-back", "someone-selling", "back-office", "support"]);

export interface TenYearValue {
  /** Monthly revenue in year ten, on the decayed growth. */
  revenueThen: number;
  /** Annual profit in year ten, after overheads and tax. */
  profitThen: number;
  /** The low and high of the range, and the middle. */
  low: number;
  mid: number;
  high: number;
  /** The multiple band applied to year-ten profit. */
  multipleLow: number;
  multipleHigh: number;
  /** The year the business is worth most, 1–10. */
  peakYear: number;
  /** What it is worth at that peak. */
  peak: number;
  /** Plain sentences naming every judgement above, for the model and the owner. */
  workings: string[];
}

/**
 * The valuation, from the owner's own figures and their answer about the year.
 *
 * `monthlyGrowth` is taken from the baseline rather than from the simulator's
 * runs, because this question is about the business as it stands plus one
 * year's spending, not about any particular decision in the decision lab.
 */
/**
 * Monthly profit at some future revenue, from today's profit.
 *
 * Today's profit is a fact — revenue less costs — and everything above it is
 * new revenue at the margin, less the overheads that grow with it. Written
 * once because the ten-year figure and the peak search both need it and had
 * drifted apart.
 */
function profitAt(baseline: Baseline, revenueThen: number, profitNow: number): number {
  const grown = baseline.monthlyRevenue > 0 ? revenueThen / baseline.monthlyRevenue : 1;
  const extra = revenueThen - baseline.monthlyRevenue;
  const overheadCreep = baseline.monthlyCosts * (Math.pow(grown, 0.6) - 1);
  return profitNow + extra * baseline.grossMargin - overheadCreep;
}

export function valueTenYears(baseline: Baseline, budget: BudgetSummary, opts?: { recurring?: boolean }): TenYearValue {
  const recurring = opts?.recurring ?? false;

  /* 1 — revenue, carried forward on a growth rate that fades. */
  let monthly = Math.max(0, baseline.monthlyRevenue);
  let rate = baseline.growth;
  const yearly: number[] = [];
  for (let year = 1; year <= HORIZON_YEARS; year += 1) {
    for (let m = 0; m < 12; m += 1) monthly *= 1 + rate;
    rate *= DECAY;
    yearly.push(monthly);
  }
  const revenueThen = monthly;

  /*
   * 2 — profit, on the same rule the month-by-month engine uses.
   *
   * Only *new* revenue is margined. `monthlyCosts` already contains the cost
   * of delivering what the business sells today, so margining all of it and
   * then subtracting the costs charges the company twice for the same stock
   * and shifts — which valued a shop turning over £480,000 a year at nothing
   * at all until a test caught it. Overheads creep as the business grows, but
   * sub-linearly: that gap is most of what operating leverage means.
   */
  const profitNow = baseline.monthlyRevenue - baseline.monthlyCosts;
  const monthlyProfit = profitAt(baseline, revenueThen, profitNow);
  const profitThen = Math.max(0, monthlyProfit * 12 * (1 - baseline.taxRate));

  /*
   * 3 — the multiple. Two to three times owner earnings is where an ordinary
   * small business trades; recurring revenue and a business that runs without
   * its owner is what moves it up.
   */
  let low = 2;
  let high = 3;
  if (recurring) { low += 1; high += 2; }
  const deployed = budget.deployed || 1;
  const onSellability = budget.funded
    .filter((l) => SELLABILITY.has(l.option.id) && !l.underfunded)
    .reduce((n, l) => n + l.amount, 0);
  const sellShare = onSellability / deployed;
  low += sellShare * 1.5;
  high += sellShare * 2;
  /* An owner who is the business, still, ten years on: the discount is real. */
  if (baseline.staff <= 1 && sellShare < 0.2) { low *= 0.6; high *= 0.7; }

  const mid = profitThen * ((low + high) / 2);

  /*
   * The peak. A business whose growth has faded to nothing and whose overheads
   * keep climbing is worth most before the end of the ten years, and saying so
   * is more use than a line that only ever goes up.
   */
  let peak = 0;
  let peakYear = HORIZON_YEARS;
  for (let year = 1; year <= HORIZON_YEARS; year += 1) {
    const p = Math.max(0, profitAt(baseline, yearly[year - 1], profitNow) * 12 * (1 - baseline.taxRate));
    const v = p * ((low + high) / 2);
    if (v > peak) { peak = v; peakYear = year; }
  }

  const workings = [
    `Revenue is carried forward at ${(baseline.growth * 100).toFixed(1)}% a month, fading by ${Math.round((1 - DECAY) * 100)}% a year — ${Math.round(baseline.monthlyRevenue).toLocaleString("en-GB")} a month now to about ${Math.round(revenueThen).toLocaleString("en-GB")} in year ten.`,
    `Profit starts from what it makes now — ${Math.round(profitNow).toLocaleString("en-GB")} a month — with everything above today's revenue counted at a ${Math.round(baseline.grossMargin * 100)}% margin, less overheads that grow at about two-thirds the rate of revenue${baseline.taxRate > 0 ? `, less ${Math.round(baseline.taxRate * 100)}% tax` : ""}.`,
    `The multiple is ${low.toFixed(1)}–${high.toFixed(1)} times that${
      [
        recurring ? "revenue that recurs" : null,
        sellShare > 0.2 ? `${Math.round(sellShare * 100)}% of the year's spending going on the things that let it run without you` : null,
      ].filter(Boolean).length
        ? `, helped by ${[
            recurring ? "revenue that recurs" : null,
            sellShare > 0.2 ? `${Math.round(sellShare * 100)}% of the year's spending going on the things that let it run without you` : null,
          ].filter(Boolean).join(" and ")}`
        : ""
    }${baseline.staff <= 1 && sellShare < 0.2 ? " — and discounted hard, because on these numbers you are still the business in ten years' time" : ""}.`,
  ];

  return {
    revenueThen, profitThen,
    low: profitThen * low, mid, high: profitThen * high,
    multipleLow: low, multipleHigh: high,
    peakYear, peak, workings,
  };
}
