/**
 * A small market gets a small company.
 *
 * Everything absolute in the engine — six million in the bank, £140,000
 * executives, £220,000 for sixteen points of brand — is tuned to the seven
 * markets written by hand, which are all worth about £400m a year. Those
 * numbers are not what the engine needs; they are what those seven need.
 *
 * Asked for scheduling software for small veterinary practices, Nova wrote a
 * market of fourteen thousand clinics worth £1.65m a year, which is a correct
 * description of that business. The company then opened in it with six
 * million pounds — three and a half times the entire market — and a salary
 * bill it could never earn back. It lost money in all fourteen years and
 * finished £5.7m down. The market was right and the company was absurd.
 *
 * Two claims here, and the second matters as much as the first: a written
 * market must be playable, and the seven must not move by a penny.
 */
import { describe, it, expect } from "vitest";
import { marketScale, marketPotential, REFERENCE_POTENTIAL, MARKET_SCALE_MIN } from "@shared/simulation/world";
import { atScale } from "@shared/simulation/market";
import { startingCompany, STARTING_CASH } from "@shared/simulation/season";
import { fixedCosts } from "@shared/simulation/decisions";
import { NICHES, nicheById } from "@shared/simulation/niches";
import { buildCustomMarket } from "@shared/simulation/custom-market";
import { ROLES, type Niche } from "@shared/simulation/types";

const ECONOMY = { demand: 1, interestRate: 0.06, costIndex: 1, outlook: "steady" as const };
const open = (niche: Niche) => startingCompany({ id: "t", name: "T", niche, seats: [...ROLES] });

/** A market the size Nova writes when asked about a real small business. */
const small = buildCustomMarket({
  name: "Vet clinic scheduling",
  segments: [
    { id: "micros", name: "Paper-diary micros", description: "One or two vets.", size: 5200, growth: 0.04, priceSensitivity: 0.7, qualityFocus: 0.5, brandFocus: 0.3, serviceFocus: 0.6, loyalty: 0.3, referencePrice: 79 },
    { id: "legacy", name: "Legacy desktop holdouts", description: "On an old system.", size: 3400, growth: 0.02, priceSensitivity: 0.6, qualityFocus: 0.6, brandFocus: 0.3, serviceFocus: 0.8, loyalty: 0.7, referencePrice: 119 },
  ],
  regions: [
    { id: "north", name: "North", weight: 0.4, entryCost: 14_000, note: "Cost-conscious." },
    { id: "mids", name: "Midlands", weight: 0.3, entryCost: 13_000, note: "Mixed." },
    { id: "south", name: "South", weight: 0.3, entryCost: 18_000, note: "Dense." },
  ],
  incumbents: [
    { id: "oak", name: "Oak", posture: "fortress", startingShare: 0.5, quality: 63, brand: 78, service: 64, priceIndex: 1.25 },
    { id: "desk", name: "Desk", posture: "coaster", startingShare: 0.3, quality: 55, brand: 62, service: 50, priceIndex: 0.95 },
  ],
  baseUnitCost: 14,
  innovationPace: 0.6,
}, "vets")!;

describe("the seven markets written by hand", () => {
  it("are all at full scale, so nothing about them changes", () => {
    for (const niche of NICHES) {
      expect(marketScale(niche), `${niche.name} should be scale 1`).toBe(1);
    }
  });

  it("open with the cash and the salaries they always did", () => {
    for (const niche of NICHES) {
      const c = open(niche);
      expect(c.cash, `${niche.name}'s bank`).toBe(STARTING_CASH);
      expect(c.scale).toBe(1);
      // And a threshold in their money is the threshold it always was.
      expect(atScale(220_000, c.scale)).toBe(220_000);
    }
  });
});

describe("a market written for one business", () => {
  it("is a fraction of the reference, and gets a company to match", () => {
    expect(marketPotential(small)).toBeLessThan(REFERENCE_POTENTIAL / 100);
    const c = open(small);
    expect(c.scale).toBeLessThan(0.05);
    expect(c.cash, "six million would be several times the whole market").toBeLessThan(STARTING_CASH / 10);
  });

  it("pays salaries it could plausibly earn, not London executive ones", () => {
    const big = fixedCosts(open(nicheById("dating_apps")!), 0, ECONOMY, 1);
    const tiny = fixedCosts(open(small), 0, ECONOMY, 1);
    expect(tiny).toBeLessThan(big);
    // A year of existing must not cost more than the market is worth in a year.
    expect(tiny).toBeLessThan(marketPotential(small));
  });

  it("moves its levers for money it could actually have", () => {
    /*
     * The failure this catches. £220,000 buys sixteen points of brand, which
     * is right in a £400m market and is thirteen per cent of a £1.65m one —
     * so every lever cost more than the company could earn and none of them
     * did anything at any price it could afford.
     */
    const c = open(small);
    const threshold = atScale(220_000, c.scale);
    expect(threshold).toBeLessThan(marketPotential(small) * 0.05);
    expect(threshold).toBeGreaterThan(0);
  });

  it("never scales so far down that the numbers stop being money", () => {
    const absurd = buildCustomMarket({
      ...JSON.parse(JSON.stringify({ ...small, segments: small.segments, regions: small.cities, incumbents: small.incumbents })),
      segments: small.segments.map((s) => ({ ...s, size: 2_000, referencePrice: 1 })),
      regions: small.cities, incumbents: small.incumbents,
    }, "absurd")!;
    expect(marketScale(absurd)).toBe(MARKET_SCALE_MIN);
    expect(open(absurd).cash).toBeGreaterThan(0);
  });
});

describe("atScale", () => {
  it("is the identity at full scale, and proportional below it", () => {
    expect(atScale(220_000, 1)).toBe(220_000);
    expect(atScale(220_000, 0.5)).toBe(110_000);
    expect(atScale(220_000, undefined)).toBe(220_000);
  });

  it("never returns nothing, however small the market", () => {
    expect(atScale(220_000, 0)).toBeGreaterThan(0);
    expect(atScale(220_000, -5)).toBeGreaterThan(0);
  });
});
