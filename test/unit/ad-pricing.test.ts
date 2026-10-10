/**
 * The price list and the per-second rate, held to each other.
 *
 * `OUTCOME_PRICE_CENTS` has to carry literal numbers — `server/entitlements.ts`
 * charges `OUTCOME_PRICE_CENTS[outcome]` for whatever outcome it is handed, so
 * the list is what actually takes the money. `AD_PRICE.centsPerSecond` is the
 * rule a person is quoted. Nothing in the type system makes the two agree, so
 * this does: change the rate and these fail until the list is changed with it.
 */
import { describe, it, expect } from "vitest";
import { AD_DURATIONS, AD_PRICE, AD_COST, adOutcome, adPriceCents, plateCostCents, expectedCostCents, beatPlan } from "@shared/ads";
import { planShots, planPlates } from "@shared/ad-shots";
import { OUTCOME_PRICE_CENTS, OUTCOME_COPY } from "@shared/plans";
import { AD_STYLES } from "@shared/ad-styles";

describe("what an advert costs the person who asks for it", () => {
  it("charges the per-second rate at every length, off the price list", () => {
    for (const duration of AD_DURATIONS) {
      const outcome = adOutcome(duration);
      expect(OUTCOME_PRICE_CENTS[outcome], `${duration}s`).toBe(duration * AD_PRICE.centsPerSecond);
      /* And the quote a person is shown is the same number that will be taken. */
      expect(adPriceCents(duration), `${duration}s quote`).toBe(OUTCOME_PRICE_CENTS[outcome]);
    }
  });

  it("has a price and copy for every length, so none can be ordered and not charged", () => {
    for (const duration of AD_DURATIONS) {
      const outcome = adOutcome(duration);
      expect(OUTCOME_PRICE_CENTS[outcome], `${outcome} is not on the price list`).toBeGreaterThan(0);
      expect(OUTCOME_COPY[outcome]?.name, `${outcome} has no name`).toBeTruthy();
    }
  });
});

describe("whether the price covers the cost", () => {
  /**
   * The whole reason the rate holds. Each plate is generated once; at
   * AD_COST.attemptsPerFinished every length loses money, which is the
   * condition this asserts rather than assumes.
   */
  it("is above the cost of generating each plate once, at every length and in every style", () => {
    /*
     * Every style, because a style's beatWeights change the shot list and so
     * the number of clips generated — which is the entire cost. They used to
     * be computed and thrown away, so this only ever exercised one shape; now
     * that they reach the plan, a style that happened to generate more seconds
     * than it sells is a real way to go underwater, and it would be invisible
     * until the ledger said so.
     */
    for (const style of AD_STYLES) {
      for (const duration of AD_DURATIONS) {
        const plates = planPlates(planShots(beatPlan(duration, style.beatWeights)));
        const cost = plateCostCents(plates.map((p) => p.seconds));
        expect(adPriceCents(duration), `${style.id} at ${duration}s: ${cost}c to make, ${adPriceCents(duration)}c charged`)
          .toBeGreaterThan(cost);
      }
    }
  });

  it("is below the cost of generating each plate three times, which is why a re-roll is a new render", () => {
    for (const duration of AD_DURATIONS) {
      expect(expectedCostCents(duration), `${duration}s`).toBeGreaterThan(adPriceCents(duration));
    }
  });

  it("gets better per second as the advert gets longer, because clips have a floor", () => {
    const perSecondMargin = AD_DURATIONS.map((duration) => {
      const plates = planPlates(planShots(beatPlan(duration)));
      return (adPriceCents(duration) - plateCostCents(plates.map((p) => p.seconds))) / duration;
    });
    /*
     * Six seconds of advert still needs three plates — fifteen seconds
     * generated — so the short cut is the thin one. Worth asserting because
     * it is the opposite of what a per-second price looks like it means, and
     * the pricing copy says so to the person reading it.
     */
    for (let i = 1; i < perSecondMargin.length; i++) {
      expect(perSecondMargin[i], `${AD_DURATIONS[i]}s vs ${AD_DURATIONS[i - 1]}s`).toBeGreaterThan(perSecondMargin[i - 1]);
    }
  });

  it("counts the seconds actually generated, not the seconds sold", () => {
    const plates = planPlates(planShots(beatPlan(6)));
    const generated = plates.reduce((n, p) => n + p.seconds, 0);
    expect(generated, "a six-second advert generates more than six seconds").toBeGreaterThan(6);
    expect(plateCostCents(plates.map((p) => p.seconds)))
      .toBe(generated * AD_COST.centsPerSecond + AD_COST.renderOverheadCents);
  });
});
