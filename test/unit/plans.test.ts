/**
 * Tier normalisation, entitlements, and what an AI action costs.
 *
 * Every answer here is a permission decision. Wrong one way it gives paid
 * features away; wrong the other it blocks someone who has paid, which they
 * report as "the site is broken" rather than as a billing problem.
 *
 * The legacy aliases are the sharp edge: accounts in the database still carry
 * tier strings that no longer exist, and the mapping from those to a current
 * tier is the only thing standing between a paying customer and the free plan.
 */
import { describe, it, expect } from "vitest";
import {
  normalizeTier, tierRank, isAtLeast, getEntitlements, hasFeature, minimumTierFor,
  documentFillCost, roadmapRebuildCost,
  TIER_IDS, LEGACY_TIER_ALIASES, ENTITLEMENTS, CREDIT_COSTS,
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

  it("resolves a feature through the same normalisation as everything else", () => {
    expect(hasFeature("spark_unlimited", "priorityAi")).toBe(ENTITLEMENTS.pro.priorityAi);
    expect(hasFeature("free", "priorityAi")).toBe(false);
    expect(hasFeature(null, "aiRoadmap")).toBe(false);
    expect(getEntitlements("nonsense")).toEqual(ENTITLEMENTS.free);
  });

  it("names the cheapest tier that grants a feature, for the upsell", () => {
    // Pointing someone at Pro for something Builder already includes costs a
    // sale; pointing them at Builder for something Pro-only costs their trust.
    expect(minimumTierFor("aiRoadmap")).toBe("builder");
    expect(minimumTierFor("priorityAi")).toBe("pro");
    expect(minimumTierFor("createSprints")).toBe("starter");
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
