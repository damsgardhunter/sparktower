/**
 * Nova designing a season from a real business.
 *
 * Two things are being held. The prompt has to carry what the company is and
 * where it has got to — a business that has shipped nothing is not the same
 * business as one with paying customers, and a simulation that cannot tell
 * them apart is a generic one with their name on it. And the answer has to be
 * made safe: a model that invents a market, a continent or a forty-year season
 * should produce a season, not an error thrown at somebody who pressed a
 * button.
 */
import { describe, it, expect } from "vitest";
import { buildSimulationPrompt, parseSimulationBrief } from "../../server/nova-simulation";
import { NICHES } from "@shared/simulation/niches";

const company = { name: "Northwind Trading", industry: "Logistics", size: "11-50", description: "Same-day delivery for pharmacies." };

describe("what Nova is told", () => {
  it("offers every market and every scope, so it never has to guess an id", () => {
    const { system } = buildSimulationPrompt({ company, people: 5 });
    for (const niche of NICHES) expect(system, niche.id).toContain(niche.id);
    expect(system).toContain("home");
    expect(system).toContain("world");
    expect(system).toContain("north_america");
  });

  it("carries the business, the project and how far it has got", () => {
    const { user } = buildSimulationPrompt({
      company,
      project: { title: "Courier network", description: "Rider network across three cities", goal: "ship_mvp" },
      progress: "Path: ship_mvp — 7 of 24 milestones done.",
      people: 12,
    });
    expect(user).toContain("Northwind Trading");
    expect(user).toContain("Courier network");
    expect(user).toContain("7 of 24");
    expect(user).toContain("12");
  });

  it("asks for a shape, not a subject", () => {
    // The instruction that stops it putting a hardware company in "podcasts"
    // because they both involve audio.
    const { system } = buildSimulationPrompt({ company, people: 5 });
    expect(system).toMatch(/SHAPE/);
  });

  it("says nothing about a project that isn't there", () => {
    const { user } = buildSimulationPrompt({ company, people: 3 });
    expect(user).not.toContain("WHAT THEY ARE BUILDING");
    expect(user).not.toContain("undefined");
    expect(user).not.toContain("null");
  });
});

describe("what comes back", () => {
  const good = JSON.stringify({
    nicheId: "drone_delivery", scope: "north_america", botTeams: 4, totalYears: 8,
    name: "Northwind — the delivery years", why: "Your costs are a fleet and your customers choose on speed.",
    mapping: [{ inTheGame: "Capacity", inYourBusiness: "Riders on shift" }],
  });

  it("takes a sound answer as it is", () => {
    const brief = parseSimulationBrief(good, "fallback")!;
    expect(brief.nicheId).toBe("drone_delivery");
    expect(brief.scope).toBe("north_america");
    expect(brief.botTeams).toBe(4);
    expect(brief.totalYears).toBe(8);
    expect(brief.mapping[0].inYourBusiness).toBe("Riders on shift");
  });

  it("refuses a market that does not exist, rather than inventing one", () => {
    expect(parseSimulationBrief(JSON.stringify({ nicheId: "crypto", scope: "world" }), "x")).toBeNull();
    expect(parseSimulationBrief("not json at all", "x")).toBeNull();
  });

  it("brings a wild answer back inside what a season can be", () => {
    const wild = JSON.stringify({
      nicheId: "podcasts", scope: "atlantis", botTeams: 9_000, totalYears: 400, name: "", why: "",
      mapping: [{ inTheGame: "", inYourBusiness: "nothing" }],
    });
    const brief = parseSimulationBrief(wild, "Fallback name")!;
    expect(brief.scope, "an invented continent becomes the safe default").toBe("home");
    expect(brief.botTeams).toBeLessThanOrEqual(50);
    expect(brief.totalYears).toBeLessThanOrEqual(14);
    expect(brief.totalYears).toBeGreaterThanOrEqual(4);
    expect(brief.name, "an empty name falls back rather than shipping blank").toBe("Fallback name");
    expect(brief.mapping, "half a mapping line is no mapping line").toEqual([]);
  });

  it("keeps the mapping short enough to read", () => {
    const many = JSON.stringify({
      nicheId: "mmos", scope: "world", botTeams: 3, totalYears: 6, name: "n", why: "w",
      mapping: Array.from({ length: 20 }, (_, i) => ({ inTheGame: `g${i}`, inYourBusiness: `b${i}` })),
    });
    expect(parseSimulationBrief(many, "x")!.mapping.length).toBeLessThanOrEqual(6);
  });
});
