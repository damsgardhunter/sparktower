/**
 * The people a business employs.
 *
 * The thing being guarded is that a market's workforce is the *market's* —
 * a kitchen's people cost what a kitchen's people cost and do what they do,
 * and a studio's are a different proposition entirely. If those two ever
 * collapse into one number again, the operations seat's hiring decision is
 * the same decision in every market, which is where it started.
 */
import { describe, it, expect } from "vitest";
import { NICHES, nicheById } from "@shared/simulation/niches";
import { workforceFor, salaryIn, effortIn, GENERIC_WORKFORCE } from "@shared/simulation/workforce";
import { SALARY } from "@shared/simulation/decisions";

describe("who works here", () => {
  it("gives every written market a workforce of its own", () => {
    for (const niche of NICHES) {
      const mix = workforceFor(niche);
      expect(mix.length, `${niche.id} has no people`).toBeGreaterThanOrEqual(2);
      for (const kind of mix) {
        expect(kind.name, `${niche.id} has an unnamed kind`).toBeTruthy();
        // "staff" is what this replaced. A trade calls its people something.
        expect(kind.name.toLowerCase(), `${niche.id} still says staff`).not.toBe("staff");
      }
    }
  });

  it("prices a kitchen and a studio differently", () => {
    /*
     * The whole point. A chef and a senior engineer are not the same hire,
     * and "should we take somebody on" has to be a different question in a
     * restaurant from what it is in software or the two markets only differ
     * in what they are called.
     */
    const kitchen = salaryIn(nicheById("restaurant_chain")!);
    const studio = salaryIn(nicheById("project_saas")!);
    expect(kitchen).toBeLessThan(studio * 0.7);
    // And both are somewhere a payroll could actually be.
    for (const niche of NICHES) {
      expect(salaryIn(niche)).toBeGreaterThan(SALARY * 0.5);
      expect(salaryIn(niche)).toBeLessThan(SALARY * 2);
    }
  });

  it("has a restaurant's people making room and a studio's making product", () => {
    const kitchen = effortIn(nicheById("restaurant_chain")!);
    const studio = effortIn(nicheById("project_saas")!);
    expect(kitchen.room).toBeGreaterThan(kitchen.product);
    expect(studio.product).toBeGreaterThan(studio.room);
  });

  it("spends every head's effort on something, and never on brand", () => {
    for (const niche of NICHES) {
      const effort = effortIn(niche);
      const total = effort.room + effort.product + effort.service;
      expect(total, `${niche.id} loses effort`).toBeCloseTo(1, 5);
    }
  });

  it("falls back to a generic mix rather than refusing a market", () => {
    /*
     * A market Nova wrote can arrive without a workforce, or with one that
     * is nonsense. A season that will not start is a worse outcome than one
     * whose people are called operators.
     */
    expect(workforceFor({ workforce: undefined })).toEqual(GENERIC_WORKFORCE);
    expect(workforceFor({ workforce: [] })).toEqual(GENERIC_WORKFORCE);
    expect(workforceFor({ workforce: [{ id: "x", name: "x", one: "x", does: "room", pay: 1, share: 0 }] }))
      .toEqual(GENERIC_WORKFORCE);
  });

  it("normalises shares it is handed rather than trusting them", () => {
    // A model asked for shares that sum to one will sometimes send 1.4.
    const mix = workforceFor({
      workforce: [
        { id: "a", name: "a", one: "a", does: "room", pay: 1, share: 0.7 },
        { id: "b", name: "b", one: "b", does: "product", pay: 1, share: 0.7 },
      ],
    });
    expect(mix.reduce((sum, k) => sum + k.share, 0)).toBeCloseTo(1, 5);
  });
});
