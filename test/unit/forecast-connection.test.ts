/**
 * Every decision connected to the forecast, and Nova planning every decision.
 *
 * Two complaints, both reproduced here: a chief executive had Nova plan their
 * year and "it didn't change anything" — the plan had answers for sixteen
 * levers and filed defaults for the chief executive's — and once a desk was
 * saved the screen could no longer say what it had done.
 */
import { describe, it, expect } from "vitest";
import { projectYear } from "@shared/simulation/projection";
import { buildWorld, economyFor } from "@shared/simulation/season";
import { nicheById } from "@shared/simulation/niches";
import { ROLES, type Role } from "@shared/simulation/types";
import { optimise, candidatesFor } from "@shared/simulation/optimiser";
import { LEVER_FIELDS } from "@shared/simulation/levers";

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
    const decided = Object.keys(ceo).filter((k) => !["focus", "shockAnswer", "founderActions"].includes(k));
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

describe("every lever has something to try", () => {
  it("offers a value for each kind of lever", () => {
    const company = fresh().companies.find((c) => c.id === "t")!;
    const focus = LEVER_FIELDS.ceo.find((f) => f.id === "focus")!;
    expect(candidatesFor(focus, company, { focus: "growth" })).toEqual(["margin", "quality", "survival"]);
    const research = LEVER_FIELDS.cto.find((f) => f.id === "researchSpend")!;
    expect(candidatesFor(research, company, {}).length).toBeGreaterThan(0);
  });
});
