/**
 * Every decision connected to the forecast, and Nova planning every decision.
 *
 * Two complaints, both reproduced here: a chief executive had Nova plan their
 * year and "it didn't change anything" — the plan had answers for sixteen
 * levers and filed defaults for the chief executive's — and once a desk was
 * saved the screen could no longer say what it had done.
 */
import { describe, it, expect } from "vitest";
import { withOptions } from "@shared/simulation/lever-options";
import { isUnlocked } from "@shared/simulation/responsibilities";
import { projectYear } from "@shared/simulation/projection";
import { buildWorld, economyFor } from "@shared/simulation/season";
import { nicheById, nicheById } from "@shared/simulation/niches";
import { ROLES, type Role } from "@shared/simulation/types";
import { optimise, candidatesFor, REST_BUDGET } from "@shared/simulation/optimiser";
import { LEVER_FIELDS, LEVER_FIELDS } from "@shared/simulation/levers";

const niche = nicheById("dating_apps")!;
const fresh = () => buildWorld({ seasonId: "conn", niche, teams: [{ id: "t", name: "T", seats: [...ROLES] as Role[] }] });
const economy = economyFor("conn", 1);

const filed = {
  cmo: { price: 40, brandSpend: 300_000, performanceSpend: 200_000, celebritySpend: 0, targetCities: [] },
  cto: { featureSpend: 200_000, reliabilitySpend: 100_000, techDebtPaydown: 0 },
  coo: { capacityTarget: 90_000, supportSpend: 150_000, efficiencySpend: 0, headcount: 2 },
};

describe("what each saved desk does to the forecast", () => {
  it("has a line for every desk that saved, and none for one that did not", () => {
    const pair = projectYear({ world: fresh(), companyId: "t", economy, filed })!;
    expect(pair.impact.map((i) => i.role).sort()).toEqual(["cmo", "coo", "cto"]);
  });

  it("says what marketing's plan is worth, against leaving it on last year's plan", () => {
    const pair = projectYear({ world: fresh(), companyId: "t", economy, filed })!;
    const cmo = pair.impact.find((i) => i.role === "cmo")!;
    expect(cmo.customers, "half a million on marketing wins somebody").not.toBe(0);
  });

  it("shows a decision that pays next year paying next year", () => {
    const world = fresh();
    const lean = projectYear({ world, companyId: "t", economy, filed })!;
    const efficient = projectYear({
      world, companyId: "t", economy,
      filed: { ...filed, coo: { ...filed.coo, efficiencySpend: 600_000 } },
    })!;
    expect(efficient.filed.nextYear, "the year after is played").not.toBeNull();
    expect(efficient.filed.nextYear!.unitCost, "efficiency lands as a cheaper unit next year")
      .toBeLessThan(lean.filed.nextYear!.unitCost);
  });

  it("charges the bonus pot and a replacement, which the engine settles after the year", () => {
    const world = fresh();
    const without = projectYear({ world, companyId: "t", economy, filed })!;
    const pot = projectYear({ world, companyId: "t", economy, filed: { ...filed, ceo: { focus: "growth", bonusPool: 200_000 } } })!;
    expect(pot.filed.cashEnd).toBeLessThan(without.filed.cashEnd);
    expect(pot.filed.lines.some((l) => /bonus pot/i.test(l.label))).toBe(true);
  });

  it("shows each colleague's loyalty, before and after", () => {
    const pair = projectYear({ world: fresh(), companyId: "t", economy, filed })!;
    expect(pair.filed.team.map((t) => t.role).sort()).toEqual(["cfo", "cmo", "coo", "cto"]);
  });
});

describe("Nova planning one chair at a table", () => {
  it("holds the colleagues' saved desks exactly as they filed them", () => {
    const world = fresh();
    const plan = optimise({ world, companyId: "t", year: 1, economy, desks: ["ceo"], fixed: filed })!;
    expect(plan.decisions.cmo).toEqual(filed.cmo);
    expect(plan.decisions.coo).toEqual(filed.coo);
  });

  it("decides the chief executive's choices, not only the money", () => {
    /*
     * Year two: positioning and seat targets are open. Each is a choice the
     * engine scores; "growth, and nothing else" is what the old plan filed
     * whatever the company looked like.
     */
    const world = { ...fresh(), year: 2 };
    const plan = optimise({ world, companyId: "t", year: 2, economy: economyFor("conn", 2), desks: ["ceo"], fixed: filed })!;
    const ceo = plan.decisions.ceo as Record<string, unknown>;
    const decided = Object.keys(ceo).filter((k) => !["focus", "shockAnswer", "founderHours"].includes(k));
    expect(decided.length + (ceo.focus !== "growth" ? 1 : 0), "something beyond the old default").toBeGreaterThan(0);
  });

  it("never answers a shock by blaming a colleague", () => {
    const world = fresh();
    const shocked = {
      ...world, year: 3,
      companies: world.companies.map((c) => c.id === "t"
        ? { ...c, shock: { kind: "outage" as const, year: 2, reputation: 15, headline: "Down for a weekend" } }
        : c),
    };
    const plan = optimise({ world: shocked, companyId: "t", year: 3, economy: economyFor("conn", 3) })!;
    expect(String((plan.decisions.ceo as any)?.shockAnswer ?? "")).not.toMatch(/^blame_/);
  });
});

/**
 * The budget for "everything else" has to reach every desk.
 *
 * `decideTheRest` tries each remaining lever's candidates against the score and
 * stops dead when it has spent `REST_BUDGET` runs of the engine. Walked in desk
 * order, that cut-off always fell in the same place: counted on dating apps in
 * year five the five desks want 37, 41, 47, 28 and 35 candidate runs — 188 —
 * against a budget of 180, so the operations seat's last levers (`sourcing`,
 * `recruitingSpend`, `trainingSpend`) were never tried in any season by any
 * company, and nothing anywhere said so.
 *
 * The fix is this: the budget covers the ordinary case. (Walking the desks
 * round-robin was tried too, so that running out would cost each desk its
 * least-reachable lever rather than one desk everything, and reverted — with a
 * big enough budget it changes only the order, and this pass is greedy enough
 * that the order moved a funded season by 7% and turned a balance guard red.)
 *
 * The point of the test is the next lever somebody adds. Four more levers on
 * one desk and this goes red, which is the moment to think about the budget
 * rather than three years later when a lever turns out never to have been
 * tried.
 */
describe("the budget for everything else", () => {
  const niche = nicheById("dating_apps")!;

  it("covers every candidate on every desk in a full year", () => {
    const world = buildWorld({ seasonId: "budget", niche, teams: [{ id: "us", name: "Us", seats: [...ROLES] }] });
    const company = world.companies.find((c) => c.id === "us")!;
    let needed = 0;
    for (const role of ROLES) {
      for (const raw of LEVER_FIELDS[role]) {
        if (!isUnlocked(role, raw.id, 5, 1)) continue;
        const field = withOptions(raw, {
          company, niche, seasonId: "budget", year: 5, solo: false,
          offers: [], openedNiches: world.openedNiches,
        });
        needed += candidatesFor(field, company, {}, 1).length;
      }
    }
    expect(needed, `the five desks want ${needed} runs and the budget is ${REST_BUDGET}`)
      .toBeLessThanOrEqual(REST_BUDGET);
  });
});

describe("every lever has something to try", () => {
  it("offers a value for each kind of lever", () => {
    const company = fresh().companies.find((c) => c.id === "t")!;
    const focus = LEVER_FIELDS.ceo.find((f) => f.id === "focus")!;
    expect(candidatesFor(focus, company, { focus: "growth" })).toEqual(["margin", "quality", "survival"]);
    const research = LEVER_FIELDS.cto.find((f) => f.id === "researchSpend")!;
    expect(candidatesFor(research, company, {}).length).toBeGreaterThan(0);
  });
});
