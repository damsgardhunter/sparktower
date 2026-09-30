/**
 * Opening a season where a project actually is.
 *
 * `opening.ts` was written, finished, and connected to nothing: 169 lines that
 * no route, column or control referred to. This is the wiring, and these are
 * the things it has to keep true.
 *
 * The case it exists for is a founder rehearsing the business they are running
 * now. Every season until this one opened funded and level — money in the
 * bank, a credit line, nobody to serve — which is the right contest for tables
 * playing each other and the wrong one for somebody four milestones into their
 * own path. Its own comment puts it better: "a simulation that hands them six
 * million pounds is teaching them to run a company that is not theirs."
 */
import { describe, it, expect } from "vitest";
import { buildWorld } from "@shared/simulation/season";
import { atStanding, positionFor } from "@shared/simulation/opening";
import { nicheById } from "@shared/simulation/niches";
import { ROLES, type Role, type Company } from "@shared/simulation/types";

const niche = nicheById("dating_apps")!;
const held = (c: Company) => Object.values(c.customers ?? {}).reduce((sum, n) => sum + (Number(n) || 0), 0);

const season = (opening?: "competitive" | "actual", progress = 0.05) =>
  buildWorld({
    seasonId: "open", niche, cadence: "quarterly", opening,
    teams: [{ id: "me", name: "Mine", seats: [...ROLES] as Role[], officers: 1, standing: { progress, people: 1 } }],
  }).companies.find((c) => c.id === "me")!;

describe("where a season opens", () => {
  it("is funded and level unless the season asked otherwise", () => {
    /* The contest every season has been. Absent and "competitive" are the same thing. */
    const unset = season(undefined);
    const explicit = season("competitive");
    expect(unset.cash).toBe(explicit.cash);
    expect(unset.creditLimit).toBe(explicit.creditLimit);
    expect(unset.cash, "a funded season opened with nothing").toBeGreaterThan(0);
  });

  it("opens an idea with no money and no credit history", () => {
    const early = season("actual", 0.05);
    const funded = season("competitive");
    expect(early.cash, "an idea was handed the funded opening").toBe(0);
    expect(early.creditLimit).toBeLessThan(funded.creditLimit);
    expect(early.creditScore!, "a company with no trading history had a thick file").toBeLessThan(30);
    expect(held(early), "an idea opened with customers").toBe(0);
  });

  it("opens a trading business with a bank, a record and customers", () => {
    const trading = season("actual", 0.95);
    const early = season("actual", 0.05);
    expect(trading.cash).toBeGreaterThan(early.cash);
    expect(trading.creditLimit).toBeGreaterThan(early.creditLimit);
    expect(trading.creditScore!).toBeGreaterThan(early.creditScore!);
    expect(held(trading), "a trading business opened with nobody").toBeGreaterThan(0);
  });

  it("never hands a project more than the funded opening", () => {
    /*
     * "Where you actually are" is a different question, not a bonus. The
     * furthest-along project still opens behind the funded contest, because
     * the funded contest is a company that raised money and this one has not.
     */
    const funded = season("competitive");
    for (const progress of [0.05, 0.3, 0.6, 0.95, 1]) {
      const actual = season("actual", progress);
      expect(actual.cash, `progress ${progress} opened richer than funded`).toBeLessThanOrEqual(funded.cash);
      expect(actual.creditLimit, `progress ${progress} opened with more credit than funded`).toBeLessThanOrEqual(funded.creditLimit);
    }
  });

  it("gets steadily better the further along the work is", () => {
    /* Four coarse bands, and none of them goes backwards. */
    let last = { cash: -1, credit: -1, score: -1 };
    for (const progress of [0.05, 0.3, 0.6, 0.95]) {
      const c = season("actual", progress);
      expect(c.cash, `cash went backwards at ${progress}`).toBeGreaterThanOrEqual(last.cash);
      expect(c.creditLimit, `credit went backwards at ${progress}`).toBeGreaterThanOrEqual(last.credit);
      expect(c.creditScore!, `the rating went backwards at ${progress}`).toBeGreaterThanOrEqual(last.score);
      last = { cash: c.cash, credit: c.creditLimit, score: c.creditScore! };
    }
  });

  it("leaves a competitive season bit-for-bit what it always was", () => {
    /*
     * The reason `atStanding` is applied after `startingCompany` rather than
     * inside it: the funded opening stays the one definition of a company, and
     * a season that did not ask for this cannot be changed by it existing.
     */
    const withStanding = buildWorld({
      seasonId: "same", niche, cadence: "quarterly",
      teams: [{ id: "me", name: "Mine", seats: [...ROLES] as Role[], officers: 1, standing: { progress: 0.05, people: 1 } }],
    }).companies.find((c) => c.id === "me")!;
    const without = buildWorld({
      seasonId: "same", niche, cadence: "quarterly",
      teams: [{ id: "me", name: "Mine", seats: [...ROLES] as Role[], officers: 1 }],
    }).companies.find((c) => c.id === "me")!;
    expect(withStanding).toEqual(without);
  });

  it("puts the bands in an order a person would recognise", () => {
    const labels = [0.05, 0.3, 0.6, 0.95].map((progress) => positionFor({ progress, people: 1 }).label);
    expect(new Set(labels).size, "two stages of the work read the same").toBe(4);
    expect(labels[0]).toMatch(/idea/i);
  });

  it("does not need a world to be useful on its own", () => {
    /* `atStanding` is pure: a company goes in, a company comes out. */
    const funded = season("competitive");
    const moved = atStanding(funded, { progress: 0.3, people: 1 }, niche);
    expect(moved.cash).toBeLessThan(funded.cash);
    expect(funded.cash, "the funded company was mutated").toBeGreaterThan(0);
  });
});
