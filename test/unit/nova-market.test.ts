/**
 * What the market prompt asks Nova for.
 *
 * `nova-market.ts` writes the whole world a real project competes in —
 * segments, regions, rivals — rather than choosing from the catalogue. These
 * assert the shape of the ask, because the shape of the ask is what came back
 * wrong: a range invites the floor.
 */
import { describe, it, expect } from "vitest";
import { buildMarketPrompt, parseMarket } from "../../server/nova-market";
import { MAX_INCUMBENTS, MAX_REGIONS, MIN_SEGMENT_SIZE } from "@shared/simulation/custom-market";

/**
 * A market with two segments and three regions is the same market every time.
 *
 * The prompt asked for "two to five" segments and "3 to 10" regions, and a
 * model asked for a range takes the floor: three markets written from three
 * real projects came back with exactly two and exactly three, every time. Two
 * segments is two positioning choices, two price tiers and two kinds of buyer
 * to be for — the whole middle of the game, gone, whatever the business is.
 *
 * The incumbents block has always said "exactly four — not three, not five"
 * and named the four archetypes, and it gets four every time. Segments and
 * regions are written the same way now. Asking again after the change: four
 * segments and five or six regions in every market, and the one that had been
 * unplayable came back with twenty thousand customers instead of five.
 */
describe("what the market prompt asks for", () => {
  const prompt = buildMarketPrompt({
    project: { title: "A thing", description: "Something somebody is building.", goal: "ship_mvp", category: "saas" },
    startup: true,
  });

  it("asks for four segments, in the words that worked for the rivals", () => {
    expect(prompt.system, "a range invites the floor").not.toMatch(/two to five groups/i);
    expect(prompt.system).toMatch(/exactly four groups/i);
    expect(prompt.system, "and says what the four usually are").toMatch(/procurement/i);
  });

  it("asks for more than the minimum number of regions", () => {
    expect(prompt.system).toMatch(/five or six places/i);
    expect(prompt.system, "and says why, so it is not read as arbitrary").toMatch(/where to go next is a decision/i);
  });

  it("still asks for exactly four rivals", () => {
    // The instruction this one was modelled on, which has always been obeyed.
    expect(prompt.system).toMatch(/not three, not five/i);
  });
});

describe("reading back what Nova sends", () => {
  it("refuses an answer that is not a market", () => {
    expect(parseMarket("I'd be happy to help you design a market!", "x")).toBeNull();
    expect(parseMarket("", "x")).toBeNull();
    expect(parseMarket("{ not json", "x")).toBeNull();
  });
});

/*
 * The winnability guard, on the path a player's market actually takes.
 *
 * `parseMarket` now refuses a market a business cannot be built in, and the route
 * treats that as a market that did not come back: it falls back to the nearest of
 * the seven and says the market is not theirs. That is the right outcome for an
 * unplayable market and a terrible one for a playable market wrongly judged — the
 * fallback is silent by design, so a guard that was too strict would quietly take
 * every bespoke market away and the only trace would be a line in a log.
 *
 * Every test above this asserts a refusal. This asserts the other direction, which
 * is the one that would not have been noticed.
 */
describe("the winnability guard on a written market", () => {
  /*
   * The same shape `every-market-winnable.test.ts` sweeps as a generated market and
   * finds playable, written as the JSON a model would answer with so it goes
   * through the real path: `parseModelJson`, then the cleaner, then the guard.
   */
  const PLAYABLE = JSON.stringify({
    name: "Scrap yards",
    premise: "Routing and weighbridge software for independent yards.",
    baseUnitCost: 60,
    segments: [
      { id: "single", name: "Single-site yards", size: 4000, referencePrice: 600, growth: 0.03, priceSensitivity: 0.6, qualityFocus: 0.5, brandFocus: 0.2, serviceFocus: 0.6, loyalty: 0.6 },
      { id: "multi", name: "Multi-site", size: 2500, referencePrice: 1000, growth: 0.05, priceSensitivity: 0.4, qualityFocus: 0.6, brandFocus: 0.3, serviceFocus: 0.7, loyalty: 0.7 },
      { id: "groups", name: "Groups", size: 2000, referencePrice: 1200, growth: 0.06, priceSensitivity: 0.3, qualityFocus: 0.7, brandFocus: 0.4, serviceFocus: 0.7, loyalty: 0.8 },
    ],
    regions: [1, 2, 3, 4, 5].map((i) => ({ id: `r${i}`, name: `R${i}`, weight: i === 1 ? 0.32 : 0.17, entryCost: 20_000, note: "" })),
    incumbents: [0.32, 0.2, 0.15].map((startingShare, i) => ({ id: `riv${i}`, name: `Rival ${i}`, posture: "coaster", startingShare, quality: 55, brand: 50, service: 50, priceIndex: 1 })),
  });

  it("lets a market somebody could play through", () => {
    const niche = parseMarket(PLAYABLE, "scrap-yards");
    expect(niche, "the guard threw away a market the balance sweep finds playable").toBeTruthy();
    expect(niche!.segments.length).toBe(3);
  }, 30_000);

  /*
   * A market that is entirely legal and cannot be played.
   *
   * This is the shape the guard exists for, and finding it took some looking —
   * which is worth recording, because the first three fixtures tried all came back
   * playable and each one taught something about where the real defences are:
   *
   *   - rivals given `startingShare: 1` across every segment are **normalised**
   *     back down by the cleaner, so the unowned pool is never emptied that way;
   *   - a `baseUnitCost` above the price of everything is **clamped** (2,000
   *     became 420 against a cheapest price of 600), so a hopeless margin cannot
   *     be written directly either.
   *
   * So `buildCustomMarket` already repairs every one of those faults taken on its
   * own. What it cannot see is a *combination* of individually reasonable numbers:
   * the smallest segments allowed, no growth, customers almost perfectly loyal,
   * and the most incumbents allowed, all excellent and all undercutting. Every
   * field is inside its range; a competent founder still wins nobody in sixteen
   * quarters. Only playing it finds that.
   */
  const UNPLAYABLE = JSON.stringify({
    name: "Hostile", premise: "A market written badly.", baseUnitCost: 60,
    segments: ["a", "b"].map((id) => ({
      id, name: id.toUpperCase(), size: MIN_SEGMENT_SIZE, referencePrice: 20, growth: 0,
      priceSensitivity: 0.95, qualityFocus: 0.9, brandFocus: 0.9, serviceFocus: 0.9, loyalty: 0.95,
    })),
    regions: Array.from({ length: MAX_REGIONS }, (_, i) => ({ id: `r${i}`, name: `R${i}`, weight: 1 / MAX_REGIONS, entryCost: 20_000, note: "" })),
    incumbents: Array.from({ length: MAX_INCUMBENTS }, (_, i) => ({
      id: `riv${i}`, name: `Rival ${i}`, posture: "defender", startingShare: 0.9 / MAX_INCUMBENTS,
      quality: 98, brand: 98, service: 98, priceIndex: 0.5,
    })),
  });

  it("refuses one that is legal and still cannot be won", () => {
    expect(parseMarket(UNPLAYABLE, "hostile"), "an unwinnable market was handed to a player").toBeNull();
  }, 30_000);

  it("leaves a market already in play alone", () => {
    /*
     * Replay passes `check: false`, and must: a stored market that failed the guard
     * would come back as "nothing to replay", which takes away a season somebody
     * has already played in order to tell them it was unfair.
     */
    expect(parseMarket(UNPLAYABLE, "hostile", { check: false })).toBeTruthy();
  });
});
