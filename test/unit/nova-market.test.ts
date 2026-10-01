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
