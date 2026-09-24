/**
 * The simulator, for somebody who has nothing yet.
 *
 * Two things were shut to them. The readiness guard read the numbers alone, so
 * it could not tell "nobody filled this in" from "nothing, and I filled it in"
 * — and a founder with no savings, no revenue and no costs, who answered
 * honestly, was told to fill one in with no way past it. And every figure was
 * written in dollars whatever the business counted in.
 */
import { describe, it, expect } from "vitest";
import { answer, missingFrom, subscriptionAt, MAX_MONTHS, type Baseline } from "../../shared/simulation/decision-sim";
import { budgetFor } from "../../shared/simulation/operating-deck";

const nothing: Baseline = {
  monthlyRevenue: 0, monthlyCosts: 0, cash: 0, debt: 0,
  interestRate: 0, debtRepayment: 0, growth: 0, grossMargin: 0.8, staff: 1,
};

describe("starting from nothing", () => {
  it("refuses a baseline nobody has filled in, and says what to do", () => {
    const stopped = missingFrom(nothing);
    expect(stopped).toBeTruthy();
    expect(stopped).toMatch(/zero is a real answer/);
  });

  it("runs once the zeros are the owner's own answer", () => {
    const answered = ["monthlyRevenue", "monthlyCosts", "cash"];
    expect(missingFrom(nothing, answered), "an answered zero is an answer").toBeNull();
  });

  it("still asks for the numbers that were never given", () => {
    // Revenue answered, costs never touched: the costs question stands.
    expect(missingFrom(nothing, ["monthlyRevenue"])).toMatch(/pays out in an ordinary month/);
  });

  it("answers a real decision from nothing, which is the point", () => {
    const result = answer({
      baseline: nothing,
      months: 12,
      levers: [
        { kind: "spend", label: "Flyers", startMonth: 1, monthlyAmount: 150, months: 0, monthlyReturnAtFull: 600, halfSpend: 150, lagMonths: 2 },
      ],
    });
    expect(result.verdict).toBeTruthy();
    // Money going out before any comes in: the cash line has to go under.
    expect(result.with.cautious.lowestCash).toBeLessThan(0);
    expect(result.facts.length).toBeGreaterThan(2);
  });

  it("writes the answer in the business's own money", () => {
    const euros = answer({ baseline: { ...nothing, cash: 5000, monthlyCosts: 100 }, months: 6, levers: [], currency: "EUR" });
    expect(euros.facts.join(" ")).toContain("€");
    expect(euros.facts.join(" "), "and never in somebody else's").not.toContain("$");

    const dollars = answer({ baseline: { ...nothing, cash: 5000, monthlyCosts: 100 }, months: 6, levers: [] });
    expect(dollars.facts.join(" "), "dollars remain the default").toContain("$");
  });

  it("asks a business with nothing about a sum it could plausibly raise", () => {
    expect(budgetFor(0), "not the imaginary million").toBe(50_000);
    expect(budgetFor(35_800), "and a real business gets its own year").toBe(430_000);
  });
});

/**
 * A hire whose point is the owner's time.
 *
 * The verdict is worked out from the cash curve and handed to Nova as a fact
 * it writes to, so it decides what the answer sounds like. In cash alone,
 * hiring a manager so the owner can step back is always a loss — which made
 * the engine answer "it costs more than it brings back" to the single move
 * that systemising a business is about.
 */
describe("a decision that buys back the owner's week", () => {
  const shop: Baseline = {
    monthlyRevenue: 35_800, monthlyCosts: 33_000, cash: 22_000, debt: 0,
    interestRate: 0, debtRepayment: 0, growth: 0.005, grossMargin: 0.62, staff: 9,
  };
  const manager = (hours: number) => [{
    kind: "hire" as const, label: "A manager", startMonth: 1,
    people: 1, monthlyCostEach: 2_900, monthlyRevenueEach: 900, rampMonths: 4,
    ownerHoursFreedEach: hours,
  }];

  it("says it costs more than it brings back when it buys nothing but revenue", () => {
    expect(answer({ baseline: shop, levers: manager(0), months: 24 }).verdict)
      .toBe("it costs more than it brings back");
  });

  it("names the trade when the same money buys the owner's time", () => {
    const result = answer({ baseline: shop, levers: manager(20), months: 24 });
    expect(result.verdict).toBe("it costs money and buys back your time");
    expect(result.facts.join(" ")).toMatch(/20 hours a week off you/);
    // And is honest that it cannot price it.
    expect(result.facts.join(" ")).toMatch(/cannot price your week/);
  });

  it("still puts survival first — running out of money outranks any hours", () => {
    const broke = { ...shop, cash: 1_000, monthlyCosts: 35_500 };
    expect(answer({ baseline: broke, levers: manager(20), months: 24 }).verdict)
      .toBe("it runs you out of money");
  });
});

/**
 * A wage, put to work.
 *
 * The engine could only answer questions that started with money. Tomas — a
 * shift job, no savings, an idea — could model spending and borrowing but not
 * the thing he was actually going to do first, which is work for a year and
 * put some of it aside. That was the gap: the only advice available to him was
 * about decisions he could not make.
 */
describe("earning the money first", () => {
  const nothingAtAll: Baseline = {
    monthlyRevenue: 0, monthlyCosts: 0, cash: 0, debt: 0,
    interestRate: 0, debtRepayment: 0, growth: 0, grossMargin: 0.85, staff: 1,
  };
  const job = (intoBusiness: number, months = 12) => ({
    kind: "job" as const, label: "Warehouse shifts", startMonth: 1,
    monthlyTakeHome: 1800, months, intoBusiness,
  });

  it("puts the share that reaches the business into the bank, and not into revenue", () => {
    const r = answer({ baseline: nothingAtAll, levers: [job(0.3)], months: 12 });
    const end = r.with.likely.months[11];
    expect(end.cash, "twelve months at €540 put in").toBeCloseTo(1800 * 0.3 * 12, 0);
    expect(end.revenue, "a wage is not the business selling anything").toBe(0);
  });

  it("stops when the job stops", () => {
    const r = answer({ baseline: nothingAtAll, levers: [job(1, 6)], months: 12 });
    const atSix = r.with.likely.months[5].cash;
    const atTwelve = r.with.likely.months[11].cash;
    expect(atSix).toBeCloseTo(1800 * 6, 0);
    expect(atTwelve, "nothing more arrives after month six").toBeCloseTo(atSix, 0);
  });

  it("is a wage in all three runs — it does not get better if you are optimistic", () => {
    const r = answer({ baseline: nothingAtAll, levers: [job(1)], months: 12 });
    expect(r.with.cautious.endCash).toBeCloseTo(r.with.bold.endCash, 0);
  });

  it("makes Tomas's plan the better one, which is the whole point", () => {
    const start = [
      { kind: "oneOff" as const, label: "Trailer and crates", startMonth: 1, amount: 2500 },
      { kind: "spend" as const, label: "Flyers", startMonth: 1, monthlyAmount: 150, months: 0, monthlyReturnAtFull: 900, halfSpend: 150, lagMonths: 2 },
    ];
    const borrowNow = answer({
      baseline: nothingAtAll, months: 24,
      levers: [{ kind: "loan", label: "A small loan", startMonth: 1, amount: 10000, apr: 0.11, termMonths: 36 }, ...start],
    });
    const earnFirst = answer({
      baseline: nothingAtAll, months: 24,
      levers: [job(0.3), ...start.map((l) => ({ ...l, startMonth: 13 }))],
    });
    expect(borrowNow.verdict).toBe("it runs you out of money");
    expect(earnFirst.verdict).toBe("it pays for itself");
  });

  it("says plainly that borrowing against nothing is not a given", () => {
    const r = answer({
      baseline: nothingAtAll, months: 24, currency: "EUR",
      levers: [{ kind: "loan", label: "A small loan", startMonth: 1, amount: 10000, apr: 0.11, termMonths: 36 }],
    });
    expect(r.facts.join(" ")).toMatch(/most lenders will want to see one of the two first/);
  });
});

/**
 * A product that already exists, sold to customers who stay.
 *
 * `spend` models a level of trade held up by a level of advertising — right
 * for a café, wrong for anything with a subscription. Brought a finished
 * product with twenty thousand possible customers and 90% margins, the engine
 * showed it flat at whatever the marketing budget held up, and there was no
 * way for its owner to be right. Customers accumulate; that is the difference.
 */
describe("customers who stay", () => {
  const built: Baseline = {
    monthlyRevenue: 0, monthlyCosts: 1000, cash: 0, debt: 0,
    interestRate: 0, debtRepayment: 0, growth: 0, grossMargin: 0.9, staff: 1,
  };
  const selling = (over: Record<string, unknown> = {}) => ({
    kind: "subscription" as const, label: "Signing them up", startMonth: 1,
    monthlyAmount: 400, months: 0, newCustomersAtFull: 12, halfSpend: 400,
    pricePerMonth: 39, monthlyChurn: 0.03, lagMonths: 1, marketSize: 20_000, ...over,
  });

  it("compounds, instead of flattening at what the budget holds up", () => {
    const r = answer({ baseline: built, levers: [selling()], months: 24 });
    const m = r.with.likely.months;
    expect(m[11].revenue, "a year in").toBeGreaterThan(m[5].revenue);
    expect(m[23].revenue, "and still climbing at two years").toBeGreaterThan(m[11].revenue);
  });

  it("keeps the customers when the spending stops, less those who leave", () => {
    const r = answer({ baseline: built, levers: [selling({ months: 12 })], months: 24 });
    const m = r.with.likely.months;
    const atStop = m[11].revenue;
    expect(m[17].revenue, "still earning from the ones already won").toBeGreaterThan(atStop * 0.5);
    expect(m[23].revenue, "and decaying at churn, not collapsing").toBeLessThan(atStop);
  });

  it("never sells to more customers than exist", () => {
    const tiny = answer({ baseline: built, levers: [selling({ marketSize: 20, newCustomersAtFull: 200 })], months: 36 });
    const m = tiny.with.likely.months;
    expect(m[m.length - 1].revenue).toBeLessThanOrEqual(20 * 39 + 1);
  });

  it("climbs towards where churn caps it, rather than past it", () => {
    /*
     * n·(1−(1−c)^k)/c tends to n/c, so six a month against 3% churn settles
     * near two hundred — and the longest horizon this offers is three years,
     * which is not long enough to arrive. What the test can hold is that it is
     * still climbing at the end and has not overshot the ceiling churn sets.
     */
    const r = answer({ baseline: built, levers: [selling({ monthlyChurn: 0.03 })], months: MAX_MONTHS });
    const m = r.with.likely.months;
    const customers = (i: number) => m[i].revenue / 39;
    expect(customers(MAX_MONTHS - 1)).toBeGreaterThan(customers(MAX_MONTHS - 13));
    expect(customers(MAX_MONTHS - 1), "never past what churn allows").toBeLessThan(6 / 0.03);
  });
});

/**
 * Taking money out — the other half of putting it in, and the thing the whole
 * exercise is for.
 */
describe("pulling money out", () => {
  const built: Baseline = {
    monthlyRevenue: 0, monthlyCosts: 1000, cash: 0, debt: 0,
    interestRate: 0, debtRepayment: 0, growth: 0, grossMargin: 0.9, staff: 1,
  };
  const plan = (draw: number) => [
    { kind: "job" as const, label: "Her salary", startMonth: 1, monthlyTakeHome: 2000, months: 12, intoBusiness: 1 },
    { kind: "subscription" as const, label: "Signing them up", startMonth: 1, monthlyAmount: 400, months: 0,
      newCustomersAtFull: 12, halfSpend: 400, pricePerMonth: 39, monthlyChurn: 0.03, lagMonths: 1, marketSize: 20_000 },
    { kind: "drawings" as const, label: "Paying herself", startMonth: 13, monthlyAmount: draw, months: 0 },
  ];

  it("takes money out of the bank without pretending it was a cost", () => {
    const r = answer({ baseline: built, levers: plan(1500), months: 36 });
    expect(r.with.likely.drawnTotal).toBeGreaterThan(0);
    // The profit line is about the business; what the owner takes is a share of it.
    const noDraw = answer({ baseline: built, levers: plan(0), months: 36 });
    expect(r.with.likely.cumulativeProfit).toBe(noDraw.with.likely.cumulativeProfit);
    expect(r.with.likely.endCash).toBeLessThan(noDraw.with.likely.endCash);
  });

  it("takes only what is there, however much was asked for", () => {
    /*
     * A business that always trades at a profit, so the only thing that could
     * push the balance under is the drawing itself. Ask for fifty thousand a
     * month out of a business making four: it pays what it has and stops.
     */
    const profitable: Baseline = { ...built, monthlyRevenue: 5_000, monthlyCosts: 1_000, cash: 10_000 };
    const greedy = answer({
      baseline: profitable, months: 36,
      levers: [{ kind: "drawings", label: "Everything", startMonth: 1, monthlyAmount: 50_000, months: 0 }],
    });
    for (const m of greedy.with.cautious.months) {
      expect(m.cash, "never drawn into an overdraft nobody agreed to").toBeGreaterThanOrEqual(0);
    }
    expect(greedy.with.cautious.drawnShortfall, "and it says what it could not pay").toBeGreaterThan(0);
    expect(greedy.with.likely.drawnTotal, "while paying what it could").toBeGreaterThan(0);
  });

  it("shows the cost of leaving no buffer, because that is real", () => {
    /*
     * Stripping the account every month is not free even when every pound of
     * it was affordable that month: the business meets the next bad month with
     * nothing behind it. An engine that hid that would be flattering the one
     * habit that closes small companies.
     */
    const stripped = answer({ baseline: built, levers: plan(9_000), months: 36 });
    const kept = answer({ baseline: built, levers: plan(0), months: 36 });
    expect(stripped.with.cautious.lowestCash).toBeLessThan(kept.with.cautious.lowestCash);
  });

  it("lets a working business pay its owner, and says what the slow case costs", () => {
    /*
     * The verdict here was "it works, but it is tight" until the engine
     * learned how often a plan fails outright. Drawing £1,500 out of this
     * business survives the named cautious run and still falls over in about
     * two runs in five, so it is now called what it is. The facts below are
     * the point of the test and are unchanged.
     */
    const r = answer({ baseline: built, levers: plan(1500), months: 36, currency: "GBP" });
    expect(r.verdict).toBe("it works only if little goes wrong");
    expect(r.facts.join(" ")).toMatch(/You take £36k out of it/);
    expect(r.facts.join(" ")).toMatch(/would not have been there/);
  });

  it("still refuses a drawing the business cannot carry", () => {
    /*
     * A gradient rather than a cliff: £500 is tight, £1,500 survives the
     * cautious run and fails too often to plan on, £1,800 puts it under in the
     * cautious case outright — and survivability outranks everything.
     *
     * These were £2,500 and £4,000 until churn stopped being one flat rate.
     * The plan contains a subscription lever, and cohort churn — the newest
     * customers being the likeliest to leave — costs this base about a sixth
     * of itself over three years, so the wage it can carry falls with it. The
     * numbers moved because the business is genuinely weaker than the old
     * arithmetic said, which is the whole reason the arithmetic changed.
     */
    expect(answer({ baseline: built, levers: plan(500), months: 36 }).verdict).toBe("it works, but it is tight");
    /*
     * The middle of the gradient, which did not exist before: this survives
     * the cautious run and fails about 40% of the time, and saying "tight"
     * about that was the thing worth fixing.
     */
    expect(answer({ baseline: built, levers: plan(1_500), months: 36 }).verdict).toBe("it works only if little goes wrong");
    expect(answer({ baseline: built, levers: plan(1_800), months: 36 }).verdict).toBe("it runs you out of money");
  });
});

/**
 * How a subscription business compounds, and where it stops.
 *
 * Worth pinning because it is the question somebody asks when they see the
 * curve: 40 joining a month against 4% leaving is not exponential growth, it
 * is a saturating climb. As the base grows, churn eats more of each month's
 * intake, and the net addition shrinks towards zero.
 *
 * It no longer climbs towards 40/0.04, and the reason is the correction this
 * file exists to protect. Churn is not one rate: a customer's first months are
 * far and away their likeliest to be their last, so each month's intake is its
 * own cohort decaying on its own age. Even the earliest months therefore lose
 * a real share of what they win — under the old flat rate they lost almost
 * nothing — and the ceiling lands well below the naive intake/churn figure.
 */
describe("why it compounds, and where it stops", () => {
  const built: Baseline = {
    monthlyRevenue: 0, monthlyCosts: 1000, cash: 0, debt: 0,
    interestRate: 0, debtRepayment: 0, growth: 0, grossMargin: 0.85, staff: 1,
  };
  const joining = 40;
  const churn = 0.04;
  const price = 19;
  const run = answer({
    baseline: built, months: MAX_MONTHS,
    levers: [{
      kind: "subscription", label: "Signing up", startMonth: 1,
      monthlyAmount: 1000, months: 0, newCustomersAtFull: joining * 2, halfSpend: 1000,
      pricePerMonth: price, monthlyChurn: churn, lagMonths: 1, marketSize: 640_000,
    }],
  });
  const customers = (month: number) => run.with.likely.months[month - 1].revenue / price;

  it("keeps most of an early month's signups, and never all of them", () => {
    /*
     * Was "adds nearly every signup early, when there is barely anybody to
     * lose", at 70% of the intake. Front-loaded churn is exactly the claim
     * that the early months are *not* cheap — the people most likely to leave
     * are the ones who only just arrived — so the early net addition is lower
     * now, and saying so is the point.
     */
    const net = customers(6) - customers(5);
    expect(net).toBeGreaterThan(joining * 0.6);
    expect(net).toBeLessThanOrEqual(joining * 0.7);
  });

  it("settles well below intake ÷ churn, because the newest leave fastest", () => {
    /*
     * The regression this is really here for. A flat rate applied from day one
     * treats a customer of two years and a customer of two days as equally
     * likely to leave, and compounds that error through every later month.
     * Against the same intake and the same steady rate, the cohort model
     * settles materially lower — and it is the honest number.
     */
    const lever = {
      kind: "subscription" as const, label: "Signing up", startMonth: 1, ownerHoursAMonth: 0,
      monthlyAmount: 1000, months: 0, newCustomersAtFull: joining * 2, halfSpend: 1000,
      pricePerMonth: price, monthlyChurn: churn, earlyChurn: churn * 2.5, earlyMonths: 3,
      lagMonths: 1, marketSize: 640_000, rivalShare: 0, priceErosion: 0,
    };
    const cohort = subscriptionAt(lever, 35, 1).stock;
    const flat = subscriptionAt({ ...lever, earlyChurn: churn, earlyMonths: 0 }, 35, 1).stock;
    expect(cohort).toBeLessThan(flat * 0.9);
    expect(cohort).toBeGreaterThan(flat * 0.7);
    // And neither ever reaches the naive ceiling, which is what people quote.
    expect(flat).toBeLessThan(joining / churn);
  });

  it("adds less and less as churn gets something to eat", () => {
    const early = customers(6) - customers(5);
    const later = customers(36) - customers(35);
    expect(later).toBeLessThan(early);
    expect(later).toBeGreaterThan(0);
  });

  it("climbs towards what churn allows and never past it", () => {
    const ceiling = joining / churn;
    expect(customers(36)).toBeGreaterThan(customers(12));
    expect(customers(36)).toBeLessThan(ceiling);
    // Three years in, about three quarters of the way there.
    expect(customers(36) / ceiling).toBeGreaterThan(0.6);
  });

  it("shrinks instead, once the spending stops", () => {
    const stopped = answer({
      baseline: built, months: MAX_MONTHS,
      levers: [{
        kind: "subscription", label: "Signing up", startMonth: 1,
        monthlyAmount: 1000, months: 12, newCustomersAtFull: joining * 2, halfSpend: 1000,
        pricePerMonth: price, monthlyChurn: churn, lagMonths: 1, marketSize: 640_000,
      }],
    });
    const at = (month: number) => stopped.with.likely.months[month - 1].revenue;
    expect(at(18)).toBeLessThan(at(12));
    expect(at(18), "and it decays at churn rather than collapsing").toBeGreaterThan(at(12) * 0.5);
  });
});
