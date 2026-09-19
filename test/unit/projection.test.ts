/**
 * What this year will do to the company, before anybody commits to it.
 *
 * The projection is the engine run on a copy of the year, so most of what is
 * worth pinning is that it stays the engine — and that the two things it
 * deliberately leaves out (rivals' plans, the year's news) stay out.
 */
import { describe, it, expect } from "vitest";
import { projectYear } from "@shared/simulation/projection";
import { resolveYear } from "@shared/simulation/resolve";
import { buildWorld, economyFor, decisionsForYear } from "@shared/simulation/season";
import { nicheById } from "@shared/simulation/niches";
import { ROLES, type Role } from "@shared/simulation/types";

const niche = nicheById("dating_apps")!;
const fresh = () => buildWorld({ seasonId: "proj", niche, teams: [
  { id: "t", name: "T", seats: [...ROLES] as Role[] },
  { id: "r", name: "Rival", seats: [...ROLES] as Role[] },
] });

const filed = {
  cmo: { price: 40, brandSpend: 300_000, performanceSpend: 200_000, celebritySpend: 0, targetCities: [] },
  cto: { featureSpend: 200_000, reliabilitySpend: 100_000, techDebtPaydown: 0 },
  coo: { capacityTarget: 90_000, supportSpend: 150_000, efficiencySpend: 0, headcount: 2 },
};

describe("the projection", () => {
  it("is the engine's own answer for the same decisions, without the year's news", () => {
    const world = fresh();
    const economy = economyFor("proj", 1);
    const pair = projectYear({ world, companyId: "t", economy, filed })!;

    const company = world.companies.find((c) => c.id === "t")!;
    const { decisions } = decisionsForYear({ company, niche, submitted: filed as any });
    const direct = resolveYear(world, [{ ...decisions, companyId: "t" }], economy, { withoutEvent: true });
    const report = direct.reports.find((r) => r.companyId === "t")!;

    expect(pair.filed.revenue).toBe(report.revenue);
    expect(pair.filed.profit).toBe(report.profit);
    expect(pair.filed.cashEnd).toBe(report.cash);
  });

  /*
   * The year's news is decided from the state of the market and is secret
   * until the tick. A projection that included it would tell a team tonight
   * what happens to them tomorrow.
   */
  it("never includes the year's news", () => {
    const world = fresh();
    const result = resolveYear(world, [{ companyId: "t" }], economyFor("proj", 1), { withoutEvent: true });
    expect(result.event).toBeNull();
  });

  it("shows nothing different when there is no draft", () => {
    const pair = projectYear({ world: fresh(), companyId: "t", economy: economyFor("proj", 1), filed })!;
    expect(pair.drafted).toEqual(pair.filed);
  });

  it("moves when the viewer changes their draft — the whole point of it", () => {
    const pair = projectYear({
      world: fresh(), companyId: "t", economy: economyFor("proj", 1), filed,
      draft: { role: "cmo", decision: { ...filed.cmo, brandSpend: 2_000_000 } },
    })!;
    expect(pair.drafted.cashEnd, "spending more leaves less in the bank").toBeLessThan(pair.filed.cashEnd);
  });

  it("serves this year with the capacity already built, and opens the rest next year", () => {
    const pair = projectYear({
      world: fresh(), companyId: "t", economy: economyFor("proj", 1),
      filed: { ...filed, coo: { ...filed.coo, capacityTarget: 5_000_000 } },
    })!;
    expect(pair.filed.capacityNow, "this year: what it had").toBeLessThan(5_000_000);
    expect(pair.filed.capacityNext, "next year: what it ordered").toBe(5_000_000);
  });

  it("forecasts next year's demand, which is what capacity should be sized to", () => {
    const pair = projectYear({ world: fresh(), companyId: "t", economy: economyFor("proj", 1), filed })!;
    expect(pair.filed.nextYearDemand?.likely).toBeGreaterThan(0);
  });

  it("shows what is still on its way — brand and quality arriving next year", () => {
    const pair = projectYear({ world: fresh(), companyId: "t", economy: economyFor("proj", 1), filed })!;
    expect(pair.filed.stats.brand.coming, "half the brand campaign lands next year").toBeGreaterThan(0);
    expect(pair.filed.stats.quality.coming, "this year's shipping lands next year").toBeGreaterThan(0);
  });

  it("names the seats that have not filed, which run on last year's plan", () => {
    const pair = projectYear({ world: fresh(), companyId: "t", economy: economyFor("proj", 1), filed })!;
    expect(pair.absent.sort()).toEqual(["ceo", "cfo"]);
  });

  it("reports the rating and whether the investors' target would be met", () => {
    const world = fresh();
    world.companies = world.companies.map((c) => c.id === "t"
      ? { ...c, investors: { since: 1, raised: 1_000_000, target: 999_999_999, targetYear: 1, strikes: 1, inCharge: false } }
      : c);
    const pair = projectYear({ world, companyId: "t", economy: economyFor("proj", 1), filed })!;
    expect(pair.filed.credit.grade).toBeTruthy();
    expect(pair.filed.target?.met).toBe(false);
    expect(pair.filed.target?.wouldRemove, "a second miss would cost the chief executive the chair").toBe(true);
  });
});
