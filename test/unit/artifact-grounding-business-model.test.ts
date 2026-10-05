/**
 * What Nova is told about how the business charges.
 *
 * It used to be told nothing. `collectArtifacts` gathers what the builder has
 * answered — milestones, the capital profile, their posts, their decisions —
 * and never the project's own brief, so every artifact that needed a price
 * invented one on its own. The result was $9/$29/$79 in the MVP document, a
 * single $29 tier in the pricing review, and $29/$59/$99 in another section of
 * the same plan. None of them was wrong about anything it could see. There was
 * nothing to be right about.
 *
 * Worse for a product that had changed: SparkTower moved off subscriptions to
 * pay-per-outcome, and the plan went on recommending monthly tiers, because the
 * field recording that was empty and nothing read it anyway.
 *
 * This is a unit test of the text, not of the collector: what matters is that
 * the model is stated as settled rather than offered as one artifact among
 * twenty, which is the difference between grounding and a suggestion.
 */
import { describe, it, expect } from "vitest";

/** The shape `collectArtifacts` builds, kept here so the wording is asserted. */
function businessModelArtifact(brief: { businessModel?: string | null }, tiers: { name: string; price: number | null; billingPeriod: string | null }[]) {
  if (!brief.businessModel?.trim() && !tiers.length) return null;
  const lines = ["How this business charges — settled, not a suggestion. Use these and do not invent others:"];
  if (brief.businessModel?.trim()) lines.push(brief.businessModel.trim().slice(0, 1200));
  if (tiers.length) {
    lines.push(`Priced today: ${tiers.map((t) => `${t.name} $${t.price ?? 0}${t.billingPeriod ? ` per ${t.billingPeriod}` : ""}`).join(", ")}.`);
  }
  return lines.join("\n");
}

describe("telling Nova how the business charges", () => {
  it("says nothing when the project has not said", () => {
    expect(businessModelArtifact({ businessModel: null }, [])).toBeNull();
    expect(businessModelArtifact({ businessModel: "   " }, [])).toBeNull();
  });

  /*
   * "Settled, not a suggestion" is the load-bearing phrase. A model reading
   * "here is the business model" among twenty artifacts treats it as one more
   * opinion to synthesise.
   */
  it("states the model as settled rather than offering it", () => {
    const text = businessModelArtifact({ businessModel: "Pay per outcome from a prepaid balance." }, [])!;
    expect(text.startsWith("How this business charges — settled, not a suggestion.")).toBe(true);
    expect(text).toContain("do not invent others");
    expect(text).toContain("Pay per outcome");
  });

  it("lists the tiers a project has actually priced", () => {
    const text = businessModelArtifact({ businessModel: "Tiered." }, [
      { name: "Starter", price: 9, billingPeriod: "monthly" },
      { name: "Pro", price: 29, billingPeriod: "monthly" },
    ])!;
    expect(text).toContain("Starter $9 per monthly");
    expect(text).toContain("Pro $29 per monthly");
  });

  it("works from tiers alone when there is no prose", () => {
    const text = businessModelArtifact({ businessModel: null }, [{ name: "One price", price: 5, billingPeriod: null }])!;
    expect(text).toContain("One price $5");
    expect(text).not.toContain("per null");
  });

  /* A model long enough to drown the rest of the context is cut, not dropped. */
  it("caps a very long description rather than discarding it", () => {
    const text = businessModelArtifact({ businessModel: "x".repeat(5000) }, [])!;
    expect(text.length).toBeLessThan(1400);
    expect(text).toContain("xxx");
  });
});
