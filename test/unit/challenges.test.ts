/**
 * One person's year.
 *
 * The claims worth pinning here are about what a challenge is *for*: that the
 * quiet seat has something of its own to win, that a team drowning is not
 * handed a growth target, that a miss explains itself, and that winning yours
 * is good for the four people sitting next to you rather than at their
 * expense.
 */
import { describe, it, expect } from "vitest";
import { challengeFor, checkChallenge, applyReward, readMetric } from "@shared/simulation/challenges";
import { startingCompany, buildWorld } from "@shared/simulation/season";
import { nicheById } from "@shared/simulation/niches";
import { ROLES, type Company, type Role, type World } from "@shared/simulation/types";
import type { CompanyReport } from "@shared/simulation/resolve";

const niche = nicheById("fitness_app")!;
const company = (over: Partial<Company> = {}): Company => ({
  ...startingCompany({ id: "v1", name: "Northbound", niche, seats: [...ROLES] }),
  ...over,
});
const world = (c: Company): World => ({
  ...buildWorld({ seasonId: "s", niche, teams: [{ id: "v1", name: "Northbound", seats: [...ROLES] }] }),
  companies: [c],
});

const report = (over: Partial<CompanyReport> = {}): CompanyReport => ({
  companyId: "v1", name: "Northbound", year: 1,
  customers: 100_000, marketShare: 0.05, shareChange: 0.01, turnedAway: 0,
  revenue: 2_000_000, costs: 1_500_000, profit: 500_000, cash: 5_000_000, debt: 0,
  reputation: 55, reputationChange: 2, quality: 45, brand: 20, service: 45,
  rank: 3, notes: [], bankrupt: false,
  ...over,
});

describe("getting one", () => {
  it("gives every seat something of its own", () => {
    /*
     * The failure this exists to prevent: four people have a good fortnight
     * while the fifth, dealt the quiet seat, has nothing that is theirs to win
     * and stops opening it on day six.
     */
    const c = company();
    for (const role of ROLES) {
      const ch = challengeFor({ company: c, world: world(c), role, year: 1, ventureId: "v1" });
      expect(ch.role).toBe(role);
      expect(ch.targets.length, `${role} got no targets`).toBeGreaterThan(0);
      expect(ch.brief.length, `${role}'s brief says nothing`).toBeGreaterThan(40);
    }
  });

  it("is the same challenge however many times it is asked for", () => {
    // The tick can be re-run, and two teammates look at the same screen.
    const c = company();
    const once = challengeFor({ company: c, world: world(c), role: "cmo", year: 3, ventureId: "v1" });
    const again = challengeFor({ company: c, world: world(c), role: "cmo", year: 3, ventureId: "v1" });
    expect(once).toEqual(again);
  });

  it("is not the same thing every year, or for everyone", () => {
    const c = company();
    const years = [1, 2, 3, 4, 5, 6].map((y) => challengeFor({ company: c, world: world(c), role: "cmo", year: y, ventureId: "v1" }).title);
    expect(new Set(years).size, "every year set the same challenge").toBeGreaterThan(1);

    const mine = challengeFor({ company: c, world: world(c), role: "cfo", year: 2, ventureId: "v1" }).id;
    const theirs = challengeFor({ company: c, world: world(c), role: "cfo", year: 2, ventureId: "v2" }).id;
    expect(mine).not.toBe(theirs);
  });

  it("asks for more than one thing at once", () => {
    /*
     * A single number is a dial to turn. A target with a constraint on it is a
     * year of work that collides with what the other four want, which is the
     * point of the whole exercise.
     */
    const c = company();
    for (const role of ROLES) {
      const ch = challengeFor({ company: c, world: world(c), role, year: 2, ventureId: "v1" });
      expect(ch.targets.length, `${role}'s challenge is a single dial`).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("a company in trouble", () => {
  const sinking = company({ cash: 100_000, creditLimit: 100_000, debt: 2_000_000 });

  it("is set the work of getting out of trouble, not of growing", () => {
    /*
     * Handing a team on the edge of insolvency a growth target is the game
     * admitting it has stopped looking at them — at exactly the moment they
     * are deciding whether to keep playing.
     */
    for (const role of ROLES) {
      const ch = challengeFor({ company: sinking, world: world(sinking), role, year: 6, ventureId: "v1" });
      expect(ch.title, `${role} got a growth challenge while insolvent`).toMatch(/keep the doors open|stop the bleeding/i);
    }
  });

  it("is asked for something it could actually do", () => {
    // Targets are relative to where the company is, not to where a healthy one
    // would be. A target nobody could hit reads as the game giving up on you.
    const ch = challengeFor({ company: sinking, world: world(sinking), role: "cfo", year: 6, ventureId: "v1" });
    const cash = ch.targets.find((t) => t.metric === "cash")!;
    expect(cash.goal).toBeLessThanOrEqual(sinking.cash);
  });

  it("pays out in the thing a struggling company actually needs", () => {
    const ch = challengeFor({ company: sinking, world: world(sinking), role: "coo", year: 6, ventureId: "v1" });
    expect(["credit", "cash"]).toContain(ch.reward.kind);
  });
});

describe("marking it", () => {
  const c = company();
  const ch = challengeFor({ company: c, world: world(c), role: "cfo", year: 1, ventureId: "v1" });

  it("counts a year that did everything asked", () => {
    const generous = report({ cash: 99_000_000, debt: 0, profit: 9_000_000, reputation: 90 });
    const result = checkChallenge({ challenge: ch, report: generous, company: c });
    expect(result.outcome).toBe("met");
    expect(result.reward).toEqual(ch.reward);
  });

  it("gives half a loaf for half the work", () => {
    /*
     * A near miss is still a year of work. Paying nothing for it teaches
     * people that trying was the mistake.
     *
     * Built from the challenge that was actually drawn rather than from a
     * guess at which one it would be — two seats share a pool, and a test that
     * assumes the draw is a test of the draw.
     */
    const [first, second] = ch.targets;
    const satisfy = (t: typeof first) => (t.compare === "at_least" ? t.goal + 1 : t.goal - 1);
    const violate = (t: typeof first) => (t.compare === "at_least" ? t.goal - 1 : t.goal + 1);
    const mixed = report({
      [first.metric]: satisfy(first),
      [second.metric]: violate(second),
    } as any);

    const result = checkChallenge({ challenge: ch, report: mixed, company: c });
    expect(result.outcome, JSON.stringify(result.targets)).toBe("partial");
    expect(result.reward).toEqual(ch.partialReward);
  });

  it("pays nothing for a year that did none of it", () => {
    const bad = report({ cash: -5_000_000, debt: 50_000_000, profit: -9_000_000, reputation: 1 });
    const result = checkChallenge({ challenge: ch, report: bad, company: c });
    expect(result.outcome).toBe("missed");
    expect(result.reward).toBeNull();
  });

  it("says what fell short rather than that you failed", () => {
    /*
     * "You failed" tells a player nothing they did not already know. What
     * happened and by how much is the only useful thing a result can say on
     * day four of fourteen.
     */
    const bad = report({ cash: -5_000_000, debt: 50_000_000, profit: -9_000_000, reputation: 1 });
    const result = checkChallenge({ challenge: ch, report: bad, company: c });
    expect(result.note).toMatch(/got /);
    for (const target of result.targets) {
      expect(typeof target.actual).toBe("number");
    }
  });
});

describe("what winning yours is worth", () => {
  it("lands on the company, so your teammates want you to win it", () => {
    /*
     * A reward that paid out personally would give five people reasons to
     * optimise past each other — a CMO cutting price to hit their own number
     * while the CFO watches the margin go. Every reward here is a company
     * thing; the credit is what belongs to the person.
     */
    const c = company();
    for (const role of ROLES) {
      const ch = challengeFor({ company: c, world: world(c), role, year: 2, ventureId: "v1" });
      expect(["reputation", "cash", "capacity", "credit"]).toContain(ch.reward.kind);
    }
  });

  it("actually changes the company", () => {
    const c = company();
    expect(applyReward(c, { kind: "cash", amount: 1_000_000, label: "" }).cash).toBe(c.cash + 1_000_000);
    expect(applyReward(c, { kind: "credit", amount: 500_000, label: "" }).creditLimit).toBe(c.creditLimit + 500_000);
    expect(applyReward(c, { kind: "capacity", amount: 0.1, label: "" }).capacity).toBe(Math.round(c.capacity * 1.1));
    expect(applyReward(c, { kind: "reputation", amount: 5, label: "" }).reputation).toBe(c.reputation + 5);
  });

  it("cannot push a bounded number past its bounds", () => {
    const c = company({ reputation: 98 });
    expect(applyReward(c, { kind: "reputation", amount: 10, label: "" }).reputation).toBe(100);
  });

  it("changes nothing when nothing was won", () => {
    const c = company();
    expect(applyReward(c, null)).toEqual(c);
  });
});

describe("reading the year", () => {
  it("takes each number from where that number actually lives", () => {
    const c = company({ price: 19, unitCost: 3.5, capacity: 400_000 });
    const r = report({ customers: 250_000, marketShare: 0.12, turnedAway: 900 });
    expect(readMetric("customers", { report: r, company: c })).toBe(250_000);
    // Share is read as a percentage, because that is how the target is written.
    expect(readMetric("market_share", { report: r, company: c })).toBeCloseTo(12);
    expect(readMetric("price", { report: r, company: c })).toBe(19);
    expect(readMetric("unit_cost", { report: r, company: c })).toBe(3.5);
    expect(readMetric("turned_away", { report: r, company: c })).toBe(900);
  });

  it("adds up spending across every seat that spends", () => {
    const spend = readMetric("spend", {
      report: report(), company: company(),
      decisions: {
        companyId: "v1",
        cmo: { price: 20, brandSpend: 100_000, performanceSpend: 50_000, celebritySpend: 25_000, targetCities: [] },
        cto: { featureSpend: 200_000, reliabilitySpend: 100_000, techDebtPaydown: 0 },
        coo: { capacityTarget: 1, supportSpend: 75_000, efficiencySpend: 50_000, headcount: 0 },
      },
    });
    expect(spend).toBe(600_000);
  });
});
