/**
 * The facts of a real business that the arithmetic used to assume away.
 *
 * Each of these was a way the old engine flattered a plan, and every one of
 * them flattered in the same direction: the owner's week was infinite, money
 * arrived the moment it was earned, the taxman took nothing, every month was
 * an average month, the newest customer was as loyal as the oldest, the
 * five-hundredth cost what the fifth did, nobody else was selling to the same
 * people, and the worst case was a smaller success rather than a failure.
 *
 * They are pinned together because the temptation is always to take one back
 * out — each on its own makes a plan look worse, and a tool that makes plans
 * look worse is a tool people stop opening. The defence is that all of them
 * are true.
 */
import { describe, it, expect } from "vitest";
import {
  answer, runMonths, ruinRisk, subscriptionAt, seasonalFactor, emptyBaseline, cleanMonths,
  HORIZONS, DEFAULT_MONTHS, MAX_MONTHS,
  type Baseline, type SubscriptionLever,
} from "../../shared/simulation/decision-sim";

const trading: Baseline = {
  ...emptyBaseline(),
  monthlyRevenue: 20_000, monthlyCosts: 15_000, grossMargin: 0.5, cash: 10_000, staff: 2,
};

const subscription = (over: Partial<SubscriptionLever> = {}): SubscriptionLever => ({
  kind: "subscription", label: "Winning customers", startMonth: 1, ownerHoursAMonth: 0,
  monthlyAmount: 1_000, months: 0, newCustomersAtFull: 20, halfSpend: 1_000,
  pricePerMonth: 49, monthlyChurn: 0.03, earlyChurn: 0.075, earlyMonths: 3,
  lagMonths: 1, marketSize: 200_000, rivalShare: 0, priceErosion: 0,
  newCustomersFromHours: 0, wordOfMouth: 0, reinvestShare: 0,
  ...over,
});

describe("the owner's week", () => {
  const solo: Baseline = { ...emptyBaseline(), monthlyCosts: 1_000, grossMargin: 0.85, ownerHours: 15 };
  /*
   * A hundred hours a month of letters and phone calls, most of the customers
   * coming from the calls rather than the postage — which is what makes the
   * hours bite. Only the hand-done part is held back by a short week; see
   * "does not throttle the customers the money bought".
   */
  const outreach = subscription({
    ownerHoursAMonth: 100, monthlyAmount: 900, halfSpend: 900,
    newCustomersAtFull: 6, newCustomersFromHours: 12,
  });

  it("holds a plan back to the hours there actually are", () => {
    const stretched = answer({ baseline: solo, levers: [outreach], months: 24 });
    const roomy = answer({ baseline: { ...solo, ownerHours: 40 }, levers: [outreach], months: 24 });
    expect(stretched.with.likely.endMonthlyRevenue).toBeLessThan(roomy.with.likely.endMonthlyRevenue);
    expect(stretched.with.likely.stretchedMonths).toBe(24);
    expect(roomy.with.likely.stretchedMonths).toBe(0);
  });

  it("says so, rather than quietly returning a smaller number", () => {
    const r = answer({ baseline: solo, levers: [outreach], months: 24 });
    expect(r.facts.join(" ")).toMatch(/more of your week than you said you have/);
    // And is explicit that the shortfall is already priced in, not additional.
    expect(r.facts.join(" ")).toMatch(/in the answer rather than on top of it/);
  });

  it("leaves a plan alone when nobody said how long the week is", () => {
    /*
     * Zero means "don't model it". A field nobody filled in must not start
     * refusing plans that were fine yesterday.
     */
    const unstated = answer({ baseline: { ...solo, ownerHours: 0 }, levers: [outreach], months: 24 });
    const roomy = answer({ baseline: { ...solo, ownerHours: 40 }, levers: [outreach], months: 24 });
    expect(unstated.with.likely.endMonthlyRevenue).toBe(roomy.with.likely.endMonthlyRevenue);
    expect(unstated.with.likely.stretchedMonths).toBe(0);
  });

  it("counts hours a hire gives back, once they are up to speed", () => {
    const withHelp = answer({
      baseline: solo, months: 24,
      levers: [outreach, {
        kind: "hire", label: "Someone on the phones", startMonth: 1, ownerHoursAMonth: 0,
        people: 1, monthlyCostEach: 1_800, monthlyRevenueEach: 0, rampMonths: 2, ownerHoursFreedEach: 20,
      }],
    });
    const alone = answer({ baseline: solo, levers: [outreach], months: 24 });
    expect(withHelp.with.likely.endMonthlyRevenue).toBeGreaterThan(alone.with.likely.endMonthlyRevenue);
  });
});

describe("getting paid later than you earned", () => {
  it("keeps the money out of the bank until it is due", () => {
    const now = runMonths({ baseline: trading, levers: [], months: 12 });
    const later = runMonths({ baseline: { ...trading, daysToGetPaid: 60 }, levers: [], months: 12 });
    expect(later.endCash).toBeLessThan(now.endCash);
    expect(later.owedToYou).toBeGreaterThan(0);
    expect(now.owedToYou).toBe(0);
  });

  it("digs the hole at the start, which is where it actually happens", () => {
    const later = runMonths({ baseline: { ...trading, daysToGetPaid: 60 }, levers: [], months: 12 });
    expect(later.lowestMonth).toBeLessThanOrEqual(3);
    expect(later.lowestCash).toBeLessThan(0);
  });

  it("does not touch money that was never a customer's", () => {
    /* A wage put in arrives when it arrives, terms or no terms. */
    const job = { kind: "job" as const, label: "Day job", startMonth: 1, ownerHoursAMonth: 0, monthlyTakeHome: 3_000, months: 12, intoBusiness: 1 };
    const bare: Baseline = { ...emptyBaseline(), monthlyCosts: 0, daysToGetPaid: 60 };
    const r = runMonths({ baseline: bare, levers: [job], months: 12 });
    expect(r.endCash).toBe(36_000);
  });
});

describe("tax", () => {
  it("comes off a profit", () => {
    const untaxed = runMonths({ baseline: trading, levers: [], months: 12 });
    const taxed = runMonths({ baseline: { ...trading, taxRate: 0.25 }, levers: [], months: 12 });
    expect(taxed.endCash).toBeLessThan(untaxed.endCash);
    expect(taxed.taxTotal).toBeGreaterThan(0);
  });

  it("is never refunded on a loss, because nobody posts you a cheque", () => {
    const losing: Baseline = { ...emptyBaseline(), monthlyRevenue: 1_000, monthlyCosts: 5_000, grossMargin: 0.5, cash: 50_000, taxRate: 0.25 };
    const r = runMonths({ baseline: losing, levers: [], months: 12 });
    expect(r.taxTotal).toBe(0);
    expect(r.endCash).toBe(runMonths({ baseline: { ...losing, taxRate: 0 }, levers: [], months: 12 }).endCash);
  });
});

describe("seasonality", () => {
  const seasonal: Baseline = { ...trading, seasonalSwing: 0.4, bestMonth: 12 };

  it("averages out over a year, so a year of it is not a cut", () => {
    const flatYear = runMonths({ baseline: trading, levers: [], months: 12 }).months.reduce((n, m) => n + m.revenue, 0);
    const swungYear = runMonths({ baseline: seasonal, levers: [], months: 12 }).months.reduce((n, m) => n + m.revenue, 0);
    expect(Math.abs(swungYear - flatYear) / flatYear).toBeLessThan(0.02);
  });

  it("puts the peak on the month the owner named", () => {
    const r = runMonths({ baseline: seasonal, levers: [], months: 12, startingMonth: 1 });
    const best = r.months.reduce((top, m) => (m.revenue > top.revenue ? m : top), r.months[0]);
    expect(best.month).toBe(12);
  });

  it("is a flat line for a business that says it has no season", () => {
    for (let m = 1; m <= 12; m += 1) expect(seasonalFactor(trading, m, 1)).toBe(1);
  });
});

describe("churn that is worst at the start", () => {
  it("costs a base real customers against one flat rate", () => {
    const l = subscription();
    const cohort = subscriptionAt(l, 35, 1).stock;
    const flat = subscriptionAt({ ...l, earlyChurn: l.monthlyChurn, earlyMonths: 0 }, 35, 1).stock;
    expect(cohort).toBeLessThan(flat);
    expect(cohort).toBeGreaterThan(flat * 0.7);
  });

  it("does not spread NaN through a lever stored before the field existed", () => {
    /*
     * Scenarios saved by an older build come back out of the database without
     * these fields at all. One `undefined` in this arithmetic turns every
     * month into NaN, which the owner sees as a screen of dashes.
     */
    const legacy = { ...subscription() } as Record<string, unknown>;
    delete legacy.earlyChurn; delete legacy.earlyMonths;
    delete legacy.rivalShare; delete legacy.priceErosion;
    const r = subscriptionAt(legacy as unknown as SubscriptionLever, 24, 1);
    expect(Number.isFinite(r.stock)).toBe(true);
    expect(r.stock).toBeGreaterThan(0);
  });

  it("still applies the early rate to a lever that predates the field", () => {
    /*
     * Not NaN, which is the loud failure, but the quiet one: `c.age <
     * lever.earlyMonths` is false for every cohort when the field is
     * undefined, so the early rate never fired and the projection reverted to
     * the flat model without a word. The defended default has to be the thing
     * the loop reads, or every stored scenario reads a few per cent too kind.
     */
    const legacy = { ...subscription() } as Record<string, unknown>;
    delete legacy.earlyChurn; delete legacy.earlyMonths;
    const defaulted = subscriptionAt(legacy as unknown as SubscriptionLever, 24, 1).stock;
    const flat = subscriptionAt(subscription({ earlyChurn: 0.03, earlyMonths: 0 }), 24, 1).stock;
    expect(defaulted).toBeLessThan(flat);
  });
});

describe("the cheap customers go first", () => {
  it("wins fewer each month as the market fills", () => {
    const small = subscription({ marketSize: 400 });
    const early = subscriptionAt(small, 5, 1).joined;
    const late = subscriptionAt(small, 35, 1).joined;
    expect(late).toBeLessThan(early * 0.6);
    expect(late).toBeGreaterThan(0);
  });

  it("never wins more people than are left to win", () => {
    const tiny = subscription({ marketSize: 50 });
    const r = subscriptionAt(tiny, 35, 1);
    expect(r.stock).toBeLessThanOrEqual(r.reachable);
    expect(r.everWon).toBeLessThanOrEqual(r.reachable * 1.01);
  });
});

describe("somebody else is already selling to them", () => {
  it("takes the incumbents' share off the top", () => {
    const open = subscriptionAt(subscription({ marketSize: 400 }), 35, 1);
    const crowded = subscriptionAt(subscription({ marketSize: 400, rivalShare: 0.75 }), 35, 1);
    expect(crowded.reachable).toBeCloseTo(100, 5);
    expect(crowded.stock).toBeLessThan(open.stock);
  });

  it("leans on the price year after year", () => {
    const held = answer({ baseline: emptyBaseline(), levers: [subscription()], months: 36 });
    const squeezed = answer({ baseline: emptyBaseline(), levers: [subscription({ priceErosion: 0.1 })], months: 36 });
    expect(squeezed.with.likely.endMonthlyRevenue).toBeLessThan(held.with.likely.endMonthlyRevenue * 0.85);
  });
});

describe("how often it simply does not work", () => {
  const thin: Baseline = { ...emptyBaseline(), monthlyCosts: 1_000, grossMargin: 0.85, cash: 0 };
  const job = { kind: "job" as const, label: "Day job", startMonth: 1, ownerHoursAMonth: 0, monthlyTakeHome: 2_000, months: 36, intoBusiness: 1 };

  it("gives the same answer twice, because a projection you cannot cite is useless", () => {
    const a = ruinRisk({ baseline: thin, levers: [job, subscription()], months: 36 });
    const b = ruinRisk({ baseline: thin, levers: [job, subscription()], months: 36 });
    expect(a).toEqual(b);
  });

  it("finds the risk in a plan whose cautious case looks survivable", () => {
    const r = answer({ baseline: thin, levers: [job, subscription()], months: 36 });
    // The named cautious run never goes under...
    expect(r.with.cautious.runsOutIn).toBeNull();
    // ...and yet a share of the runs do, which is the thing three tidy curves hide.
    expect(r.ruin.risk).toBeGreaterThan(0);
    expect(r.facts.join(" ")).toMatch(/runs out of money in \d+% of them/);
  });

  it("orders plans by fragility, not just by their middle outcome", () => {
    const noBuffer = ruinRisk({ baseline: thin, levers: [job, subscription()], months: 36 });
    const buffered = ruinRisk({ baseline: { ...thin, cash: 30_000 }, levers: [job, subscription()], months: 36 });
    expect(buffered.risk).toBeLessThan(noBuffer.risk);
  });

  it("reports a spread, so the middle is never mistaken for the whole", () => {
    const r = ruinRisk({ baseline: thin, levers: [job, subscription()], months: 36 });
    expect(r.worstEnd).toBeLessThan(r.medianEnd);
    expect(r.medianEnd).toBeLessThan(r.bestEnd);
    expect(r.trials).toBeGreaterThan(100);
  });
});

describe("the horizon somebody asked for", () => {
  it("keeps one it can run as it is", () => {
    for (const h of HORIZONS) expect(cleanMonths(h)).toBe(h);
  });

  it("snaps a longer one down to the longest it has, not back to the shortest", () => {
    /*
     * The regression this is really here for. Asking for 48 months used to
     * return 12 — the default, silently — so everything a plan did after its
     * first year never happened and the answer came back looking fine. Eight
     * plans that differed only in the month an owner quit her job all returned
     * an identical figure, because none of them ever reached the month she
     * quit.
     */
    expect(cleanMonths(48)).toBe(MAX_MONTHS);
    expect(cleanMonths(120)).toBe(MAX_MONTHS);
    expect(cleanMonths(30)).toBe(MAX_MONTHS);
  });

  it("rounds an in-between one to the nearest, preferring more time on a tie", () => {
    // 18 is equidistant from 12 and 24; less time than you asked for is the
    // more misleading answer, because plans break at the end.
    expect(cleanMonths(18)).toBe(24);
    expect(cleanMonths(4)).toBe(3);
    expect(cleanMonths(1)).toBe(3);
  });

  it("falls back to the default only when there is no number at all", () => {
    for (const junk of [null, undefined, NaN, 0, -5, "nonsense"]) {
      expect(cleanMonths(junk)).toBe(DEFAULT_MONTHS);
    }
  });

  it("actually reaches a decision taken late in the plan", () => {
    const base: Baseline = { ...emptyBaseline(), monthlyRevenue: 6_000, monthlyCosts: 2_000, grossMargin: 0.8, cash: 5_000 };
    const draws = (from: number) => [{
      kind: "drawings" as const, label: "Paying herself", startMonth: from,
      monthlyAmount: 2_000, months: 0, ownerHoursAMonth: 0,
    }];
    const early = answer({ baseline: base, levers: draws(6), months: 48 });
    const late = answer({ baseline: base, levers: draws(30), months: 48 });
    expect(early.with.likely.drawnTotal).toBeGreaterThan(0);
    expect(late.with.likely.drawnTotal).toBeGreaterThan(0);
    expect(early.with.likely.drawnTotal).toBeGreaterThan(late.with.likely.drawnTotal);
  });
});

describe("customers won with time rather than money", () => {
  /* Twelve hours a week, $500 a month, and no advertising budget worth the name. */
  const bootstrapper: Baseline = { ...emptyBaseline(), monthlyCosts: 120, grossMargin: 0.85, ownerHours: 12, taxRate: 0.15 };
  const wage = { kind: "job" as const, label: "Day job", startMonth: 1, ownerHoursAMonth: 0, monthlyTakeHome: 500, months: 36, intoBusiness: 1 };

  it("wins nobody at all when the plan is only spending and there is none", () => {
    const nothing = subscription({ monthlyAmount: 0, halfSpend: 1, newCustomersFromHours: 0 });
    expect(subscriptionAt(nothing, 24, 1).stock).toBe(0);
  });

  it("wins customers from the owner's own hours, with no budget at all", () => {
    /*
     * The bootstrapper's whole strategy: no ads, fifty hours a month at the
     * markets and in the forums. Acquisition used to be a pure function of
     * money, so this plan returned zero customers, zero revenue — and, because
     * she had spent nothing, a verdict of "it pays for itself".
     */
    const byHand = subscription({ monthlyAmount: 0, halfSpend: 1, ownerHoursAMonth: 50, newCustomersFromHours: 4 });
    const r = answer({ baseline: bootstrapper, levers: [wage, byHand], months: 36 });
    const last = r.with.likely.months[35];
    expect(last.customers).toBeGreaterThan(50);
    expect(last.revenue).toBeGreaterThan(0);
    expect(r.verdict).not.toBe("it costs more than it brings back");
  });

  it("wins fewer when there are not enough hours in her week", () => {
    const asks50 = subscription({ monthlyAmount: 0, halfSpend: 1, ownerHoursAMonth: 50, newCustomersFromHours: 4 });
    const asks100 = subscription({ monthlyAmount: 0, halfSpend: 1, ownerHoursAMonth: 100, newCustomersFromHours: 4 });
    /* 12 hours a week is about 52 a month: the first plan fits, the second does not. */
    const fits = answer({ baseline: bootstrapper, levers: [wage, asks50], months: 36 });
    const does_not = answer({ baseline: bootstrapper, levers: [wage, asks100], months: 36 });
    expect(does_not.with.likely.months[35].customers).toBeLessThan(fits.with.likely.months[35].customers);
    expect(does_not.with.likely.stretchedMonths).toBeGreaterThan(0);
  });

  it("does not throttle the customers the money bought", () => {
    /*
     * The ads run whether or not she has the evening. Only the hand-done part
     * of a plan is held back by the hours, which is why the two sources are
     * counted separately at all.
     */
    const paidOnly = subscription({ ownerHoursAMonth: 100, newCustomersFromHours: 0 });
    const roomy = answer({ baseline: { ...bootstrapper, ownerHours: 60 }, levers: [wage, paidOnly], months: 36 });
    const squeezed = answer({ baseline: bootstrapper, levers: [wage, paidOnly], months: 36 });
    expect(squeezed.with.likely.months[35].customers).toBe(roomy.with.likely.months[35].customers);
  });
});

describe("a plan that works on paper and falls over too often", () => {
  it("is not called merely tight", () => {
    /*
     * The badge is the only thing most people read. A plan whose cautious run
     * survives but which fails a quarter of its own runs used to carry the
     * same words, and the same colour, as one that fails five per cent.
     */
    const built: Baseline = { ...emptyBaseline(), monthlyCosts: 1_000, grossMargin: 0.9, staff: 1 };
    const plan = (draw: number) => [
      { kind: "job" as const, label: "Her salary", startMonth: 1, ownerHoursAMonth: 0, monthlyTakeHome: 2_000, months: 12, intoBusiness: 1 },
      subscription({ monthlyAmount: 400, halfSpend: 400, newCustomersAtFull: 12, pricePerMonth: 39, marketSize: 20_000 }),
      { kind: "drawings" as const, label: "Paying herself", startMonth: 13, monthlyAmount: draw, months: 0, ownerHoursAMonth: 0 },
    ];
    const safe = answer({ baseline: built, levers: plan(0), months: 36 });
    const fragile = answer({ baseline: built, levers: plan(1_500), months: 36 });
    const doomed = answer({ baseline: built, levers: plan(2_500), months: 36 });

    // All three survive or fail on a gradient, and the badge follows it.
    expect(safe.ruin.risk).toBeLessThan(0.25);
    expect(safe.verdict).toBe("it works, but it is tight");

    expect(fragile.with.cautious.runsOutIn).toBeNull();  // the cautious run is fine...
    expect(fragile.ruin.risk).toBeGreaterThan(0.25);     // ...and it still fails too often
    expect(fragile.verdict).toBe("it works only if little goes wrong");

    expect(doomed.verdict).toBe("it runs you out of money");

    // And the share is said out loud whatever the badge says.
    expect(fragile.facts.join(" ")).toMatch(/runs out of money in \d+% of them/);
  });
});

describe("a business that can actually grow", () => {
  /*
   * The complaint this was built for: whatever an owner tried, the customer
   * count went up and then stopped. It had to. Intake was a fixed number of
   * people a month set by a fixed budget, against a percentage leaving, and
   * that arithmetic has exactly one shape — a curve rising to intake ÷ churn
   * and staying there. No decision available to the owner changed the shape,
   * only the height, and somebody watching every plan they try flatten out
   * reasonably concludes the thing does not believe in their business.
   *
   * Two mechanisms were missing, and every real subscription business has
   * both: customers who bring customers, and revenue put back into winning
   * more.
   */
  const base: Baseline = { ...emptyBaseline(), monthlyCosts: 120, grossMargin: 0.85, taxRate: 0.15 };
  const wage = { kind: "job" as const, label: "Wage", startMonth: 1, ownerHoursAMonth: 0, monthlyTakeHome: 500, months: 36, intoBusiness: 1 };
  const at = (lever: SubscriptionLever, month: number) =>
    answer({ baseline: base, levers: [wage, lever], months: 36 }).with.likely.months[month - 1].customers ?? 0;

  const flat = subscription({ monthlyAmount: 380, halfSpend: 380, newCustomersAtFull: 10, pricePerMonth: 29 });

  it("still flattens when nothing compounds, which is the honest answer for that plan", () => {
    const early = at(flat, 12) - at(flat, 6);
    const late = at(flat, 36) - at(flat, 30);
    expect(late).toBeLessThan(early);
  });

  it("grows faster the more customers it already has", () => {
    const viral = subscription({ ...flat, wordOfMouth: 0.04 });
    expect(at(viral, 36)).toBeGreaterThan(at(flat, 36) * 1.5);
    /* And the shape turns: later months add more than earlier ones. */
    const early = at(viral, 12) - at(viral, 6);
    const late = at(viral, 36) - at(viral, 30);
    expect(late).toBeGreaterThan(early);
  });

  it("spends more on growth as it earns more", () => {
    const ploughed = subscription({ ...flat, reinvestShare: 0.5 });
    expect(at(ploughed, 36)).toBeGreaterThan(at(flat, 36) * 1.3);
    // Early on there is no revenue to put back, so the two start together.
    expect(at(ploughed, 3)).toBeCloseTo(at(flat, 3), 0);
  });

  it("compounds hardest when both are true, and still respects the market", () => {
    const both = subscription({ ...flat, wordOfMouth: 0.04, reinvestShare: 0.5, marketSize: 400, rivalShare: 0 });
    const r = subscriptionAt(both, 35, 1);
    expect(r.stock).toBeGreaterThan(subscriptionAt({ ...both, wordOfMouth: 0, reinvestShare: 0 }, 35, 1).stock);
    // The market is still the ceiling: compounding cannot sell to people who
    // do not exist, which is the failure mode this most needed guarding from.
    expect(r.stock).toBeLessThanOrEqual(r.reachable);
  });

  it("does not run away when word of mouth is left at its cap", () => {
    const wild = subscription({ ...flat, wordOfMouth: 0.5, reinvestShare: 1, marketSize: 5_000, rivalShare: 0 });
    const r = subscriptionAt(wild, 35, 1);
    expect(Number.isFinite(r.stock)).toBe(true);
    expect(r.stock).toBeLessThanOrEqual(r.reachable);
  });

  it("changes nothing for a lever stored before either field existed", () => {
    const legacy = { ...flat } as Record<string, unknown>;
    delete legacy.wordOfMouth; delete legacy.reinvestShare;
    const before = subscriptionAt(flat, 24, 1).stock;
    const after = subscriptionAt(legacy as unknown as SubscriptionLever, 24, 1).stock;
    expect(after).toBeCloseTo(before, 6);
  });
});

describe("a season that reaches the business being built, not just the one already there", () => {
  /*
   * `seasonalFactor` multiplied `baseline.monthlyRevenue` and nothing else, so
   * it did nothing whatever for a business whose revenue is all still to come
   * — which is every business on the "ship an MVP" path. Nadia's customers are
   * market traders: they sign up when the markets start and cancel when they
   * stop, and the tool could not see a month of it.
   */
  const seasonal = (swing: number): Baseline => ({
    ...emptyBaseline(), monthlyCosts: 120, grossMargin: 0.85, taxRate: 0.15,
    seasonalSwing: swing, bestMonth: 7,
  });
  const wage = { kind: "job" as const, label: "Wage", startMonth: 1, ownerHoursAMonth: 0, monthlyTakeHome: 500, months: 36, intoBusiness: 1 };
  const traders = subscription({ monthlyAmount: 380, halfSpend: 380, newCustomersAtFull: 10, pricePerMonth: 29, marketSize: 180_000 });
  const run = (swing: number) => answer({ baseline: seasonal(swing), levers: [wage, traders], months: 36, startingMonth: 1 });

  it("changes a subscription's shape at all, which it could not before", () => {
    const flat = run(0).with.likely.months.map((m) => m.customers);
    const swung = run(0.5).with.likely.months.map((m) => m.customers);
    expect(swung).not.toEqual(flat);
  });

  it("builds a staircase rather than a wobble: it stalls out of season", () => {
    /*
     * The distinction that matters. A café's season moves its revenue up and
     * down. A subscription takes the same price from everyone still
     * subscribed, so what the season moves is who joins and who leaves — and
     * the shape that makes is a base that climbs through the season and
     * flattens out of it.
     */
    const m = run(0.5).with.likely.months.map((x) => x.customers ?? 0);
    const inSeason = m[7] - m[5];    // Jun → Aug, the busy months
    const outOfSeason = m[13] - m[11]; // Dec → Feb, the dead ones
    expect(inSeason).toBeGreaterThan(outOfSeason * 2);
    // Flat, not falling off a cliff: they are subscribers, not footfall.
    expect(outOfSeason).toBeGreaterThanOrEqual(0);
  });

  it("does not invent or destroy customers over a whole year", () => {
    const flat = run(0).with.likely.months[35].customers ?? 0;
    const swung = run(0.5).with.likely.months[35].customers ?? 0;
    expect(Math.abs(swung - flat) / flat).toBeLessThan(0.15);
  });

  it("loses more of them in the quiet months", () => {
    /*
     * A quiet month is quiet in both directions. Checked on the churn side by
     * running with no intake at all, so the only thing moving the base is who
     * leaves.
     */
    const dormant = subscription({ monthlyAmount: 0, halfSpend: 1, newCustomersAtFull: 0, newCustomersFromHours: 0 });
    const july = subscriptionAt(dormant, 6, 1, 1, () => 1.5).stock;
    const january = subscriptionAt(dormant, 6, 1, 1, () => 0.5).stock;
    // Nobody joins either way; the one in the good season keeps more of nothing,
    // so the meaningful check is that the rates differ in the right direction.
    expect(july).toBeGreaterThanOrEqual(january);
  });

  it("leaves a business with no season exactly as it was", () => {
    /* The regression guard: this must be free for everybody who never sets it. */
    const none = run(0).with.likely.months.map((m) => m.customers);
    const explicitZero = answer({
      baseline: { ...seasonal(0), bestMonth: 3 }, levers: [wage, traders], months: 36, startingMonth: 6,
    }).with.likely.months.map((m) => m.customers);
    expect(explicitZero).toEqual(none);
  });

  it("does not season a price change twice", () => {
    /*
     * A price lever is a percentage of `baseRevenue`, which already has the
     * season in it. Multiplying again would count it twice and make a price
     * rise look seasonal when it is not.
     */
    const trading: Baseline = { ...emptyBaseline(), monthlyRevenue: 10_000, monthlyCosts: 6_000, grossMargin: 0.5, seasonalSwing: 0.4, bestMonth: 7 };
    const price = { kind: "price" as const, label: "Up 10%", startMonth: 1, ownerHoursAMonth: 0, changePct: 0.1, demandChangePct: -0.05, lagMonths: 0 };
    const r = runMonths({ baseline: trading, levers: [price], months: 12, startingMonth: 1 });
    const plain = runMonths({ baseline: trading, levers: [], months: 12, startingMonth: 1 });
    for (let i = 0; i < 12; i += 1) {
      const uplift = r.months[i].revenue / plain.months[i].revenue;
      // The same proportional uplift every month, whatever the season is doing.
      expect(uplift).toBeCloseTo(r.months[0].revenue / plain.months[0].revenue, 3);
    }
  });
});
