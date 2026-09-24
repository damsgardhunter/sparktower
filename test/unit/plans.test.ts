/**
 * The price list, and what survives of tiers.
 *
 * Two jobs, and the second one is the sharp edge. The first is that the prices
 * are what the product owner set and that nothing that is meant to be free has
 * quietly grown a price. The second is that the tier machinery still normalises
 * the strings sitting in real rows: entitlements are the same for everyone now,
 * so a broken mapping can't take a feature away, but the strings are still read
 * while old subscriptions wind down and they have to keep resolving.
 */
import { describe, it, expect } from "vitest";
import {
  normalizeTier, tierRank, isAtLeast, getEntitlements, hasFeature, minimumTierFor,
  documentFillCost, roadmapRebuildCost, priceOf, formatMoney, topUpFor,
  TIER_IDS, LEGACY_TIER_ALIASES, ENTITLEMENTS, CREDIT_COSTS,
  CHARGE_FOR, OUTCOME_PRICE_CENTS, MONTHLY_SMALL_ACTIONS, TOP_UP_CENTS,
  FREE_FOR_EVERYONE, PRICE_LIST, type NovaActionId,
} from "@shared/plans";

describe("normalizing a stored tier", () => {
  it("passes through the current ids", () => {
    for (const tier of TIER_IDS) expect(normalizeTier(tier)).toBe(tier);
  });

  it("maps every legacy alias to a real tier", () => {
    /*
     * These strings are still in the users table. If one stopped mapping, the
     * account silently drops to free — they keep paying and lose the features,
     * which is the worst version of this bug.
     */
    for (const [legacy, expected] of Object.entries(LEGACY_TIER_ALIASES)) {
      expect(normalizeTier(legacy)).toBe(expected);
      expect(TIER_IDS).toContain(normalizeTier(legacy));
    }
    expect(normalizeTier("spark_pro")).toBe("starter");
    expect(normalizeTier("spark_unlimited")).toBe("pro");
  });

  it("falls back to free for anything unrecognised", () => {
    // Failing closed is right here: an unknown string must not grant anything.
    expect(normalizeTier(null)).toBe("free");
    expect(normalizeTier(undefined)).toBe("free");
    expect(normalizeTier("")).toBe("free");
    expect(normalizeTier("enterprise_plus")).toBe("free");
  });
});

describe("comparing tiers", () => {
  it("ranks them cheapest to most capable", () => {
    expect(tierRank("free")).toBeLessThan(tierRank("starter"));
    expect(tierRank("starter")).toBeLessThan(tierRank("builder"));
    expect(tierRank("builder")).toBeLessThan(tierRank("pro"));
  });

  it("ranks a legacy alias as the tier it maps to", () => {
    expect(tierRank("spark_business")).toBe(tierRank("builder"));
  });

  it("treats a tier as clearing itself", () => {
    for (const tier of TIER_IDS) expect(isAtLeast(tier, tier)).toBe(true);
    expect(isAtLeast("pro", "free")).toBe(true);
    expect(isAtLeast("free", "builder")).toBe(false);
    expect(isAtLeast(null, "starter")).toBe(false);
  });
});

describe("entitlements", () => {
  it("gives every tier a complete set", () => {
    const keys = Object.keys(ENTITLEMENTS.free).sort();
    for (const tier of TIER_IDS) {
      // A key missing from one tier reads as undefined, and `undefined === true`
      // is false — so the feature silently switches off for that tier only.
      expect(Object.keys(ENTITLEMENTS[tier]).sort()).toEqual(keys);
    }
  });

  it("never takes a boolean feature away as you pay more", () => {
    /*
     * Monotonicity. Nothing enforces it in the type, so a hand-edited table can
     * end up granting something on Builder and not on Pro — and the person who
     * finds that has just upgraded.
     */
    const booleanKeys = Object.keys(ENTITLEMENTS.free).filter(
      (k) => typeof (ENTITLEMENTS.free as any)[k] === "boolean",
    );
    for (const key of booleanKeys) {
      let seenTrue = false;
      for (const tier of TIER_IDS) {
        const value = (ENTITLEMENTS[tier] as any)[key];
        if (value === true) seenTrue = true;
        else if (seenTrue) {
          throw new Error(`${key} is granted below ${tier} but not at ${tier}`);
        }
      }
    }
  });

  it("never reduces the credit allowance as you pay more", () => {
    for (let i = 1; i < TIER_IDS.length; i++) {
      expect(ENTITLEMENTS[TIER_IDS[i]].credits)
        .toBeGreaterThanOrEqual(ENTITLEMENTS[TIER_IDS[i - 1]].credits);
    }
  });

  it("gives everybody the same entitlements, whatever string their row carries", () => {
    /*
     * The decision, as a test: nothing is sold, so no tier — current, legacy or
     * nonsense — resolves to anything different. If this ever fails, a gate has
     * grown back and somebody is being told to pay for a feature.
     */
    for (const tier of [...TIER_IDS, "spark_unlimited", "nonsense", null, undefined]) {
      expect(getEntitlements(tier as any)).toEqual(FREE_FOR_EVERYONE);
    }
    expect(hasFeature("free", "aiRoadmap")).toBe(true);
    expect(hasFeature(null, "projectHealthChecks")).toBe(true);
    expect(hasFeature("free", "createSprints")).toBe(true);
    expect(hasFeature("free", "premiumVisibility")).toBe(true);
    // Private projects were a tier gate; deciding who sees your own work is not
    // Nova doing work for you, so it is free and unlimited.
    expect(FREE_FOR_EVERYONE.privateProjects).toBe(Infinity);
    // The stronger model is a cost decision, not something anybody is sold.
    expect(FREE_FOR_EVERYONE.priorityAi).toBe(false);
  });

  it("names free as the tier that grants everything, because it does", () => {
    expect(minimumTierFor("aiRoadmap")).toBe("free");
    expect(minimumTierFor("createSprints")).toBe("free");
    expect(minimumTierFor("earlyAccess")).toBe("free");
    // priorityAi is off everywhere, so there is no tier to name.
    expect(minimumTierFor("priorityAi")).toBe(null);
  });

  it("returns the tier the feature is actually on, whatever it is", () => {
    const booleanKeys = Object.keys(ENTITLEMENTS.free).filter(
      (k) => typeof (ENTITLEMENTS.free as any)[k] === "boolean",
    ) as any[];
    for (const key of booleanKeys) {
      const min = minimumTierFor(key);
      if (min === null) {
        // Granted nowhere — then no tier may have it.
        for (const tier of TIER_IDS) expect((ENTITLEMENTS[tier] as any)[key]).toBe(false);
      } else {
        expect((ENTITLEMENTS[min] as any)[key]).toBe(true);
      }
    }
  });
});

describe("quoting the cost of an AI action", () => {
  it("keeps a document fill between its floor and ceiling", () => {
    const { documentFillMin, documentFillMax } = CREDIT_COSTS;
    expect(documentFillCost(0)).toBe(documentFillMin);
    expect(documentFillCost(10_000)).toBe(documentFillMax);
    for (const n of [1, 3, 12, 40, 500]) {
      expect(documentFillCost(n)).toBeGreaterThanOrEqual(documentFillMin);
      expect(documentFillCost(n)).toBeLessThanOrEqual(documentFillMax);
    }
  });

  it("never quotes a negative or fractional charge", () => {
    // The count comes from the client, so it can be anything.
    expect(documentFillCost(-5)).toBe(CREDIT_COSTS.documentFillMin);
    expect(Number.isInteger(documentFillCost(7.4))).toBe(true);
  });

  it("charges more for a bigger document, never less", () => {
    let previous = 0;
    for (const n of [0, 1, 2, 5, 10, 25, 100]) {
      const cost = documentFillCost(n);
      expect(cost).toBeGreaterThanOrEqual(previous);
      previous = cost;
    }
  });

  it("scales a roadmap rebuild with the material, and saturates", () => {
    const { roadmapRebuildMin: min, roadmapRebuildMax: max } = CREDIT_COSTS;
    const empty = roadmapRebuildCost({ phases: 0, milestones: 0, tasks: 0 });
    const small = roadmapRebuildCost({ phases: 2, milestones: 3, tasks: 8 });
    const huge = roadmapRebuildCost({ phases: 50, milestones: 200, tasks: 900 });

    expect(empty).toBe(min);
    expect(small).toBeGreaterThan(min);
    expect(small).toBeLessThan(max);
    // The ceiling is the promise: a big project can't produce a surprise bill.
    expect(huge).toBe(max);
  });

  it("quotes a whole number of credits for a rebuild", () => {
    for (const counts of [{ phases: 1, milestones: 1, tasks: 1 }, { phases: 3, milestones: 7, tasks: 13 }]) {
      expect(Number.isInteger(roadmapRebuildCost(counts))).toBe(true);
    }
  });
});

describe("the price list", () => {
  it("prices exactly the outcomes the product owner named, in whole dollars", () => {
    expect(OUTCOME_PRICE_CENTS).toEqual({
      dayPass: 100,
      roadmap: 300,
      document: 300,
      codeAudit: 500,
      business: 1499,
      seasonSeat: 300,
      // "What would it take?", priced with the roadmap and the document
      // because it is the same kind of thing: one commissioned piece of work
      // with an answer at the end.
      wwit: 300,
      // Simulating this company's own decisions, and where it lands in ten
      // years. One price for the project rather than one per question: the
      // second scenario is where the learning is, and charging for it would be
      // charging somebody to compare.
      simulations: 300,
      // Writing a marketing scheme for a product that already exists and
      // having Nova score it. The dearest of the small commissions because it
      // is the only one that reads a plan and argues with it on the owner's
      // own figures. One price for the project, like the simulator: a second
      // scheme is where the comparison is.
      // Posting a company challenge, at $4.99. Deliberately not a whole dollar
      // and deliberately not revenue — the note in shared/plans.ts says why:
      // it is priced to make posting a challenge a decision rather than a
      // reflex, on a surface where a careless one costs whoever enters it a
      // fortnight.
      challenge: 499,
      marketing: 600,
      // A day of pictures. Its own price rather than a small action, because
      // an image is the most expensive thing here per press.
      imagePass: 500,
    });
    /*
     * Whole dollars, on purpose — with two exceptions, on purpose.
     *
     * The point of leaving credits behind was that nobody should have to
     * convert a number into money in their head, and $3 does that better than
     * $2.99. Two prices earn the exception and both argue for it where they
     * are set: `business` because it is the only one big enough for the
     * threshold to be the thing somebody actually decides on, and `challenge`
     * because it is a deterrent rather than revenue. Everything else stays
     * whole. Pinned as a named set rather than loosened to "anything goes",
     * so the next price added has to argue for itself the way these two did.
     */
    const NOT_WHOLE = new Set<PricedOutcomeId>(["business", "challenge"]);
    for (const [id, cents] of Object.entries(OUTCOME_PRICE_CENTS)) {
      if (NOT_WHOLE.has(id as PricedOutcomeId)) continue;
      expect(cents % 100, `${id} should be a whole number of dollars`).toBe(0);
    }
    expect(OUTCOME_PRICE_CENTS.business).toBe(1499);
    expect(MONTHLY_SMALL_ACTIONS).toBe(25);
  });

  it("gives every Nova action a charge, and never invents a seventh price", () => {
    const allowed = new Set<string>(["free", "small", ...Object.keys(OUTCOME_PRICE_CENTS)]);
    for (const [action, kind] of Object.entries(CHARGE_FOR)) {
      expect(allowed.has(kind), `${action} is priced as "${kind}", which nothing sells`).toBe(true);
    }
  });

  it("keeps the things that are meant to be free, free", () => {
    // The rebuild costs the platform nothing — it is recomputed for everybody.
    expect(CHARGE_FOR.reputationEvaluation).toBe("free");
    // One price for the whole document: taken at the plan, nothing after it.
    expect(CHARGE_FOR.documentPlan).toBe("document");
    for (const inside of ["documentFill", "documentReplan", "documentTighten"] as NovaActionId[]) {
      expect(priceOf(inside).cents, `${inside} is inside a document already paid for`).toBe(null);
      expect(CHARGE_FOR[inside]).toBe("free");
    }
    // Keeping a bought roadmap current is not a second purchase.
    expect(CHARGE_FOR.roadmapGeneration).toBe("roadmap");
    expect(CHARGE_FOR.roadmapRebuild).toBe("roadmap");
    expect(CHARGE_FOR.roadmapUpdate).toBe("small");
    // A chat turn never has a price attached to it.
    expect(priceOf("novaChat")).toMatchObject({ kind: "small", cents: null });
  });

  it("formats money the way a person reads it", () => {
    expect(formatMoney(100)).toBe("$1");
    expect(formatMoney(3000)).toBe("$30");
    expect(formatMoney(250)).toBe("$2.50");
  });

  it("suggests the smallest top-up that clears a shortfall", () => {
    expect(topUpFor(1)).toBe(500);
    expect(topUpFor(500)).toBe(500);
    expect(topUpFor(2500)).toBe(3000);
    // Nothing on the list covers it: offer the biggest rather than nothing.
    expect(topUpFor(999_999)).toBe(TOP_UP_CENTS[TOP_UP_CENTS.length - 1]);
    // Every offered amount is a round number of dollars, ascending.
    for (const c of TOP_UP_CENTS) expect(c % 100).toBe(0);
    expect([...TOP_UP_CENTS]).toEqual([...TOP_UP_CENTS].sort((a, b) => a - b));
    // And the biggest one covers the dearest thing sold, so "$30 build" is one trip.
    expect(TOP_UP_CENTS[TOP_UP_CENTS.length - 1]).toBeGreaterThanOrEqual(OUTCOME_PRICE_CENTS.business);
  });

  it("serves a price list a dialog can render without knowing the prices", () => {
    expect(PRICE_LIST.outcomes.map((o) => o.id).sort()).toEqual(Object.keys(OUTCOME_PRICE_CENTS).sort());
    for (const o of PRICE_LIST.outcomes) {
      expect(o.display).toBe(formatMoney(o.cents));
      expect(o.name.length).toBeGreaterThan(0);
      expect(o.blurb.length).toBeGreaterThan(0);
    }
  });
});
