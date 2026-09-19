/**
 * Capacity a company bought is capacity it has.
 *
 * The engine always served customers from built capacity plus what assets add
 * (`effectiveOf` in resolve.ts), but the "running at the limit" news and the
 * projection's room both read the built number alone. A dating app that won a
 * compute cluster and an app-store deal served 538,814 people, was shown
 * "of 210,000 room", and was told every year that it was at its limit — an
 * event that also took 5% off what it had built each time it fired.
 */
import { describe, it, expect } from "vitest";
import { eventFor } from "@shared/simulation/events";
import { servingCapacity } from "@shared/simulation/assets";
import { projectYear } from "@shared/simulation/projection";
import { buildWorld, economyFor } from "@shared/simulation/season";
import { nicheById } from "@shared/simulation/niches";
import { ROLES, type Company, type CompanyAsset, type Role, type World } from "@shared/simulation/types";

const niche = nicheById("dating_apps")!;

const cluster: CompanyAsset = {
  id: "a1", kind: "facility", name: "Own matching compute cluster", bookValue: 2_200_000,
  effect: { capacity: 300_000, unitCost: 0.88 }, expiresIn: 5,
};

function worldWith(over: Partial<Company>, seasonId = "cap"): World {
  const world = buildWorld({ seasonId, niche, teams: [{ id: "t", name: "Ardent", seats: [...ROLES] as Role[] }] });
  return {
    ...world,
    year: 3,
    companies: world.companies.map((c) => (c.id === "t" ? { ...c, ...over } : c)),
  };
}

const serving = { capacity: 210_000, customers: { swipers: 250_000, recently_single: 110_000, long_haulers: 40_000 } };

describe("capacity from assets", () => {
  it("counts toward the room a company serves from", () => {
    expect(servingCapacity({ capacity: 210_000, assets: [cluster] })).toBe(510_000);
    expect(servingCapacity({ capacity: 210_000, assets: [] })).toBe(210_000);
  });

  it("keeps a company with bought room from being told it is at its limit", () => {
    const limitNews = (world: World) => {
      let seen = 0;
      for (let i = 0; i < 150; i++) {
        const e = eventFor({ world: { ...world, seasonId: `cap-${i}` }, year: 3, economy: world.economy });
        if (e?.headline?.includes("running at the limit")) seen += 1;
      }
      return seen;
    };
    // Without the cluster, 400k customers on 210k of room really is the limit — so the check isn't vacuous.
    expect(limitNews(worldWith({ ...serving, assets: [] }))).toBeGreaterThan(0);
    expect(limitNews(worldWith({ ...serving, assets: [cluster] }))).toBe(0);
  });

  it("shows in the projection's room, this year and next", () => {
    const world = worldWith({ assets: [cluster] });
    const plain = worldWith({ assets: [] });
    const economy = economyFor("cap", 3);
    const coo = { coo: { capacityTarget: 90_000, supportSpend: 0, efficiencySpend: 0, headcount: 0 } };
    const withAsset = projectYear({ world, companyId: "t", economy, filed: coo })!.filed;
    const without = projectYear({ world: plain, companyId: "t", economy, filed: coo })!.filed;
    expect(withAsset.capacityNow - without.capacityNow).toBe(300_000);
    expect(withAsset.capacityNext - without.capacityNext).toBe(300_000);
  });
});
