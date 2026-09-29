/**
 * Four ways the engine used to answer a question nobody asked, and say it
 * with a straight face.
 *
 * These are not edge cases. Each was found by putting the most ordinary
 * question a founder has into the tool and reading what came back: "if I hire
 * a salesperson who signs three customers a month, does it pay for itself?"
 * The answer was no, in confident detail, with a Monte Carlo behind it — and
 * the salesperson had sold nothing at all, because the model had no way for a
 * person on the payroll to win anybody.
 *
 * The other three are the same shape. A growth rate that compounded for three
 * years made doing nothing unbeatable, so every plan lost to standing still.
 * A verdict that read "it runs you out of money" sat above a median ending
 * balance of two hundred thousand. And a subscription scheme priced per month
 * was scored as a one-off campaign because nobody had typed in a number that
 * could be worked out from the two beside it.
 *
 * What they have in common is the failure mode worth pinning: not a number
 * slightly out, but an answer to a different question, delivered with the
 * confidence of the right one. A wrong number invites argument. This does not.
 */
import { describe, it, expect } from "vitest";
import {
  answer, cleanLever, growthAt, growthMultiplier, runMonths, ruinRisk,
  emptyBaseline, GROWTH_HALF_LIFE_MONTHS,
  type Baseline, type SubscriptionLever, type HireLever,
} from "../../shared/simulation/decision-sim";
import { isRecurring } from "../../shared/simulation/marketing";

/** The business the bug was found on: four customers, a wage, and savings. */
const larder: Baseline = {
  ...emptyBaseline(),
  monthlyRevenue: 1_200, monthlyCosts: 3_800, grossMargin: 0.85,
  cash: 42_000, staff: 1, growth: 0.12, ownerHours: 55,
  daysToGetPaid: 14, taxRate: 0.19, seasonalSwing: 0.15, bestMonth: 12,
};

/** A salesperson on £4k, and the customers they sign — the two-lever shape Nova writes. */
const salesperson = (): HireLever => ({
  kind: "hire", label: "Hire 1 salesperson", startMonth: 3, ownerHoursAMonth: 0,
  people: 1, monthlyCostEach: 4_000, rampMonths: 1,
  monthlyRevenueEach: 0, ownerHoursFreedEach: 0,
});
const theyBringIn = (over: Partial<SubscriptionLever> = {}) => cleanLever({
  kind: "subscription", label: "Restaurants the salesperson signs", startMonth: 3,
  ownerHoursAMonth: 0, monthlyAmount: 0, months: 0,
  newCustomersAtFull: 3, halfSpend: 1.5, pricePerMonth: 299,
  monthlyChurn: 0.03, earlyChurn: 0.075, earlyMonths: 3, lagMonths: 1,
  marketSize: 100_000, rivalShare: 0, priceErosion: 0,
  newCustomersFromHours: 0, wordOfMouth: 0, reinvestShare: 0,
  ...over,
}) as SubscriptionLever;

describe("a salesperson who actually sells", () => {
  /*
   * The whole bug in one assertion. `newCustomersAtFull` is a ceiling on the
   * *spend* curve, and the spend is in the hire lever next door, so the plain
   * reading of this lever was "three a month at a budget of nothing" — which
   * is nought.
   */
  it("reads a rate with no budget behind it as the rate the author meant", () => {
    const lever = theyBringIn();
    expect(lever.newCustomersFromStaff, "three a month, driven by the person hired to do it").toBe(3);
  });

  it("leaves a lever that does have a driver exactly as it was", () => {
    const paidFor = theyBringIn({ monthlyAmount: 2_000, newCustomersAtFull: 8 });
    expect(paidFor.newCustomersFromStaff, "the spend is the driver here; nothing to repair").toBe(0);
    const byHand = theyBringIn({ newCustomersFromHours: 4, newCustomersAtFull: 4 });
    expect(byHand.newCustomersFromStaff, "the owner's own week is already accounted for").toBe(0);
  });

  it("wins customers, earns revenue, and beats doing nothing", () => {
    const a = answer({ baseline: larder, levers: [salesperson(), theyBringIn()], months: 36, currency: "USD" });
    const last = a.with.bold.months[35];

    expect(last.customers ?? 0, "the salesperson signed somebody").toBeGreaterThan(40);
    expect(a.revenueDifference, "and it shows up as money").toBeGreaterThan(5_000);
    /*
     * The answer that matters to the person asking. Before this it was
     * −$119,496 — the wage, and nothing at all on the other side of it.
     */
    expect(a.cashDifference, "a salesperson who signs three a month pays for themselves").toBeGreaterThan(0);
  });

  it("still says no to a hire who brings in nothing, which is the honest half", () => {
    const a = answer({ baseline: larder, levers: [salesperson()], months: 36, currency: "USD" });
    expect(a.revenueDifference, "no lever said they would sell anything").toBe(0);
    expect(a.cashDifference, "so it is a wage and nothing else").toBeLessThan(0);
  });
});

describe("a growth rate is re-won, not owned", () => {
  it("keeps the rate that was typed in the months the owner can vouch for", () => {
    expect(growthAt(0.12, 1), "this month is the month they described").toBeCloseTo(0.12, 6);
    expect(growthAt(0.12, 1 + GROWTH_HALF_LIFE_MONTHS), "and half of it a half-life later").toBeCloseTo(0.06, 6);
  });

  it("does not turn a small business into a rocket by leaving it alone", () => {
    /*
     * 12% a month compounded flat is 53× over three years. A business taking
     * £1,200 a month "did nothing" its way to £63,000 a month, and every plan
     * that cost money to start lost to standing still — which made the one
     * comparison this tool is built on worthless.
     */
    const flat = Math.pow(1.12, 35);
    const decayed = growthMultiplier(0.12, 36);
    expect(flat, "what it used to do").toBeGreaterThan(50);
    expect(decayed, "a strong three years, not a fantasy").toBeGreaterThan(4);
    expect(decayed, "and nothing like fifty").toBeLessThan(12);
  });

  it("finds a floor for a business going the other way", () => {
    // A shop losing 8% a month does not shrink to a rounding error either.
    expect(growthMultiplier(-0.08, 36)).toBeGreaterThan(0.15);
  });

  it("is the first month itself, never a month of growth", () => {
    expect(growthMultiplier(0.12, 1)).toBe(1);
  });
});

describe("a gap and a grave are not the same thing", () => {
  /*
   * A plan that dips in month nine, comes back, and ends well. The verdict
   * still warns — a business that cannot make March payroll does not get to
   * see month twenty-eight — but the facts have to say which of the two it is,
   * because "runs out of money" beside "the middle outcome ends at $211,000"
   * reads as a broken tool rather than a nuanced one.
   */
  const levers = [salesperson(), theyBringIn()];

  it("says when the balance comes back, and what it takes to bridge it", () => {
    const run = runMonths({ baseline: larder, levers, months: 36, confidence: "cautious", startingMonth: 1 });
    expect(run.runsOutIn, "it does go under").not.toBeNull();
    expect(run.recoversBy, "and it does come back").not.toBeNull();
    expect(run.recoversBy!).toBeGreaterThan(run.runsOutIn!);
    expect(run.fundingGap, "the hole has a size, and it is what somebody would borrow").toBeGreaterThan(0);
  });

  it("never says it recovered while it is still under water at the end", () => {
    const doomed = runMonths({
      baseline: { ...larder, cash: 2_000, monthlyCosts: 20_000 },
      levers: [], months: 24, confidence: "cautious", startingMonth: 1,
    });
    expect(doomed.runsOutIn).not.toBeNull();
    expect(doomed.recoversBy, "nothing here brings it back").toBeNull();
  });

  it("counts how many failures are permanent, not just how many there are", () => {
    const ruin = ruinRisk({ baseline: larder, levers, months: 36 });
    expect(ruin.ruined, "going under is still the risk, and still counted").toBeGreaterThan(0);
    expect(ruin.neverRecovered, "but most of these are overdrafts, not endings").toBeLessThan(ruin.ruined);
  });

  it("does not report a ruin rate that the ending balance contradicts", () => {
    const a = answer({ baseline: larder, levers, months: 36, currency: "USD" });
    const said = a.facts.join(" ");
    if (a.ruin.medianEnd > 0 && a.ruin.ruined > 0) {
      expect(said, "if the middle outcome ends up, the facts have to say the dips came back")
        .toMatch(/never come back|comes back/i);
    }
  });
});

describe("a subscription is scored as a subscription", () => {
  /*
   * The marketing scorer needs three numbers to treat a scheme as recurring,
   * and the form only ever asked for two of them — so "$299 a month, 3% churn"
   * was judged as a one-off campaign, with no lifetime value, no cost per
   * customer and no payback month. The third was derivable from the money all
   * along.
   */
  it("works the customer count back from the money when nobody typed it", () => {
    const perMonth = 299;
    const expectedMonthlyReturn = 2_700;
    const derived = Math.round(expectedMonthlyReturn / perMonth);
    expect(derived, "nine restaurants at $299").toBe(9);
    expect(isRecurring({
      monthlyBudget: 3_000, months: 12, expectedMonthlyReturn,
      pricePerMonth: perMonth, monthlyChurn: 0.03, newCustomersAtFull: derived, marketSize: 0,
    }), "a price and a churn rate and a rate of arrivals is a subscription").toBe(true);
  });

  it("still calls a campaign with no price a campaign", () => {
    expect(isRecurring({
      monthlyBudget: 3_000, months: 12, expectedMonthlyReturn: 2_700,
      pricePerMonth: 0, monthlyChurn: 0, newCustomersAtFull: 0, marketSize: 0,
    })).toBe(false);
  });
});
