/**
 * A market Nova wrote has to be playable, whatever Nova said.
 *
 * The seven hand-made markets are balanced against each other and against
 * years of play. A written one is a model's best guess, and the failure that
 * matters is not "unfair" — a hard market is fine — but "the engine divides
 * by zero" or "the incumbents own 140% of it and nothing a team does can
 * matter". Both read to a player as the game being broken.
 *
 * So the contract is narrow: `buildCustomMarket` either returns something the
 * engine can run or returns null, and never anything in between.
 */
import { describe, it, expect } from "vitest";
import {
  buildCustomMarket, marketProblems, MIN_SEGMENT_SIZE, MAX_SEGMENT_SIZE, INCUMBENT_SHARE_TOTAL,
} from "@shared/simulation/custom-market";
import { resolveYear } from "@shared/simulation/resolve";
import { startingCompany } from "@shared/simulation/season";
import { seedIncumbents } from "@shared/simulation/incumbents";
import { ROLES, type World } from "@shared/simulation/types";

const sane = {
  name: "Veterinary practice software",
  premise: "Software for small animal clinics.",
  segments: [
    { id: "single_site", name: "Single-site clinics", description: "One vet, one nurse.", size: 40_000, growth: 0.04, priceSensitivity: 0.7, qualityFocus: 0.5, brandFocus: 0.2, serviceFocus: 0.8, loyalty: 0.5, referencePrice: 120 },
    { id: "groups", name: "Clinic groups", description: "Five to fifty sites.", size: 9_000, growth: 0.09, priceSensitivity: 0.3, qualityFocus: 0.8, brandFocus: 0.5, serviceFocus: 0.7, loyalty: 0.7, referencePrice: 900 },
  ],
  regions: [
    { id: "north", name: "The North", weight: 0.3, entryCost: 120_000, note: "Price-led." },
    { id: "midlands", name: "The Midlands", weight: 0.3, entryCost: 140_000, note: "Mixed." },
    { id: "south", name: "The South", weight: 0.4, entryCost: 260_000, note: "The groups are here." },
  ],
  incumbents: [
    { id: "oldco", name: "Oldco", posture: "coaster", startingShare: 0.5, quality: 50, brand: 70, service: 40, priceIndex: 1.1 },
    { id: "newco", name: "Newco", posture: "innovator", startingShare: 0.3, quality: 75, brand: 35, service: 60, priceIndex: 0.9 },
  ],
  baseUnitCost: 30,
  innovationPace: 1.1,
  voice: { customer: "clinic", customers: "clinics", unit: "licence", capacity: "seats" },
};

describe("a market Nova wrote", () => {
  it("comes back playable when the answer is sane", () => {
    const m = buildCustomMarket(sane, "fallback")!;
    expect(m).toBeTruthy();
    expect(marketProblems(m)).toEqual([]);
    expect(m.name).toBe("Veterinary practice software");
    expect(m.voice.customers).toBe("clinics");
  });

  it("actually runs a year in the engine", () => {
    /*
     * The claim that matters. Everything else here is about not producing
     * nonsense; this is about the nonsense-free thing being a game.
     */
    const niche = buildCustomMarket(sane, "fallback")!;
    const company = startingCompany({ id: "t", name: "T", niche, seats: [...ROLES] });
    const world: World = {
      seasonId: "custom", niche, year: 1,
      economy: { demand: 1, interestRate: 0.06, costIndex: 1, outlook: "steady" },
      companies: [...seedIncumbents(niche), company],
    };
    const out = resolveYear(world, [{
      companyId: "t",
      cmo: { price: 130, brandSpend: 200_000, performanceSpend: 100_000, celebritySpend: 0, targetCities: ["north"] },
      cto: { featureSpend: 150_000, reliabilitySpend: 80_000, techDebtPaydown: 0 },
      coo: { capacityTarget: company.capacity, supportSpend: 90_000, efficiencySpend: 0, headcount: 4 },
      cfo: { borrow: 0, repay: 0, cashBuffer: 0 },
      ceo: { focus: "growth" },
    } as any]);
    const report = out.reports.find((r) => r.companyId === "t")!;
    expect(report.revenue).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(report.profit)).toBe(true);
    expect(Number.isFinite(report.marketShare)).toBe(true);
  });

  it("normalises region weights and incumbent share rather than refusing them", () => {
    const m = buildCustomMarket({
      ...sane,
      regions: sane.regions.map((r) => ({ ...r, weight: 7 })),        // all wrong, all equal
      incumbents: sane.incumbents.map((i) => ({ ...i, startingShare: 0.9 })), // 180% of the market
    }, "fallback")!;
    expect(m.cities.reduce((s, c) => s + c.weight, 0)).toBeCloseTo(1, 6);
    expect(m.incumbents.reduce((s, i) => s + i.startingShare, 0)).toBeCloseTo(INCUMBENT_SHARE_TOTAL, 6);
    expect(marketProblems(m)).toEqual([]);
  });

  it("keeps a market it can run out of a market that is far too big or far too small", () => {
    const tiny = buildCustomMarket({ ...sane, segments: sane.segments.map((s) => ({ ...s, size: 3 })) }, "f")!;
    expect(tiny.segments.every((s) => s.size >= MIN_SEGMENT_SIZE)).toBe(true);

    const huge = buildCustomMarket({ ...sane, segments: sane.segments.map((s) => ({ ...s, size: 9e9 })) }, "f")!;
    expect(huge.segments.every((s) => s.size <= MAX_SEGMENT_SIZE)).toBe(true);
  });

  it("never lets a segment price at nothing", () => {
    const m = buildCustomMarket({ ...sane, segments: sane.segments.map((s) => ({ ...s, referencePrice: 0 })) }, "f")!;
    expect(m.segments.every((s) => s.referencePrice >= 1)).toBe(true);
    expect(marketProblems(m)).toEqual([]);
  });

  it("gives two things that would share an id different ones", () => {
    const m = buildCustomMarket({
      ...sane,
      segments: [{ ...sane.segments[0], id: "same" }, { ...sane.segments[1], id: "same" }],
      regions: sane.regions.map((r) => ({ ...r, id: "one" })),
    }, "f")!;
    expect(new Set(m.segments.map((s) => s.id)).size).toBe(2);
    expect(new Set(m.cities.map((c) => c.id)).size).toBe(3);
    expect(marketProblems(m)).toEqual([]);
  });

  it("drops a region's mix for segments that do not exist", () => {
    const m = buildCustomMarket({
      ...sane,
      regions: [{ ...sane.regions[0], segmentMix: { single_site: 1.4, invented: 9 } }, ...sane.regions.slice(1)],
    }, "f")!;
    const mix = (m.cities[0] as any).segmentMix ?? {};
    expect(Object.keys(mix)).toEqual(["single_site"]);
  });

  it("returns null rather than a broken market when there is not one in the answer", () => {
    for (const bad of [
      null, undefined, "a market", 42, {},
      { ...sane, segments: [sane.segments[0]] },              // one segment is not a market
      { ...sane, regions: sane.regions.slice(0, 1) },          // nowhere to expand to
      { ...sane, incumbents: [sane.incumbents[0]] },           // nobody to take share from
      { ...sane, segments: "not a list" },
    ]) {
      expect(buildCustomMarket(bad, "f"), JSON.stringify(bad)?.slice(0, 40)).toBeNull();
    }
  });

  it("fills in everything a hurried answer left out", () => {
    const bare = {
      segments: [{ name: "A" }, { name: "B" }],
      regions: [{ name: "One" }, { name: "Two" }, { name: "Three" }],
      incumbents: [{ name: "X" }, { name: "Y" }],
    };
    const m = buildCustomMarket(bare, "fallback-id")!;
    expect(m).toBeTruthy();
    expect(marketProblems(m)).toEqual([]);
    expect(m.id).toBe("fallback-id");
    expect(m.voice.customers).toBe("customers");
    expect(m.incumbents[0].persona.tagline.length).toBeGreaterThan(0);
  });
});
