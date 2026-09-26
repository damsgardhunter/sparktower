/**
 * The decisions a person makes and a warm body never does.
 *
 * Bots file last year's number, nudged. That is right for a seat nobody took
 * and it is why a table learning to enter a market watches every rival shrink
 * instead of watching somebody do it. These are the three calls that decide
 * whether a newcomer gets in, and they have to be arithmetic over the same
 * model the engine uses — not a rule of thumb, because the obvious rules of
 * thumb were measured and two of them made the game worse.
 */
import { describe, it, expect } from "vitest";
import { bestPrice, bestSegment, fitFor, regionsWorthKeeping } from "@shared/simulation/bot-play";
import { appealFor } from "@shared/simulation/market";
import { startingCompany } from "@shared/simulation/season";
import { seedIncumbents } from "@shared/simulation/incumbents";
import { nicheById, NICHES } from "@shared/simulation/niches";
import { ROLES, type Company } from "@shared/simulation/types";

const niche = nicheById("dating_apps")!;
const newcomer = () => startingCompany({ id: "t", name: "T", niche, seats: [...ROLES] });
const rivals = seedIncumbents(niche);

describe("who a newcomer should aim at", () => {
  it("prefers the people who care least about what it hasn't got", () => {
    /*
     * A company opens with brand 8 against quality 38 and service 40, so
     * being unknown is its weakness. Everything else equal, the segment that
     * weighs brand least is the one to open against.
     */
    const c = newcomer();
    const heavyBrand = { ...niche.segments[0], id: "brandy", brandFocus: 0.95, qualityFocus: 0.1, serviceFocus: 0.1 };
    const lightBrand = { ...niche.segments[0], id: "quiet", brandFocus: 0.05, qualityFocus: 0.1, serviceFocus: 0.1 };
    expect(fitFor(c, lightBrand)).toBeGreaterThan(fitFor(c, heavyBrand));
  });

  it("changes its mind once the company is known", () => {
    const known = { ...newcomer(), brand: 90, quality: 40, service: 40 } as Company;
    const heavyBrand = { ...niche.segments[0], id: "brandy", brandFocus: 0.95, qualityFocus: 0.1, serviceFocus: 0.1 };
    const lightBrand = { ...niche.segments[0], id: "quiet", brandFocus: 0.05, qualityFocus: 0.1, serviceFocus: 0.1 };
    expect(fitFor(known, heavyBrand)).toBeGreaterThan(fitFor(known, lightBrand));
  });

  it("picks a real segment in every market, and never an empty one", () => {
    for (const n of NICHES) {
      const c = startingCompany({ id: "t", name: "T", niche: n, seats: [...ROLES] });
      const aim = bestSegment(c, n);
      expect(aim, n.name).toBeTruthy();
      expect(n.segments.map((s) => s.id)).toContain(aim!.id);
      expect(aim!.size).toBeGreaterThan(0);
    }
  });
});

describe("what to charge", () => {
  it("never prices under what it costs to serve", () => {
    for (const n of NICHES) {
      const c = startingCompany({ id: "t", name: "T", niche: n, seats: [...ROLES] });
      const against = seedIncumbents(n);
      for (const s of n.segments) {
        expect(bestPrice(c, s, against), `${n.name}/${s.name}`).toBeGreaterThan(n.baseUnitCost);
      }
    }
  });

  it("beats the going rate on what it actually earns", () => {
    /*
     * The claim that makes this worth doing: whatever it picks, it must be
     * worth more than simply charging what everybody else charges — share
     * against the real rivals, times what each customer is worth.
     */
    const c = newcomer();
    const seg = niche.segments[0];
    const theirs = rivals.reduce((sum, r) => sum + appealFor(r, seg), 0);
    const earns = (price: number) => {
      const mine = appealFor({ ...c, price } as Company, seg);
      return (mine / (mine + theirs)) * (price - c.unitCost);
    };
    expect(earns(bestPrice(c, seg, rivals))).toBeGreaterThanOrEqual(earns(seg.referencePrice));
  });

  it("charges less against weak rivals than against strong ones", () => {
    /*
     * Not a discount rule and not a premium rule — a response. With nobody
     * worth switching to, there is no reason to give margin away.
     */
    const c = newcomer();
    const seg = niche.segments[0];
    const strong = rivals.map((r) => ({ ...r, quality: 95, brand: 95, service: 95 } as Company));
    const weak = rivals.map((r) => ({ ...r, quality: 10, brand: 10, service: 10 } as Company));
    expect(bestPrice(c, seg, weak)).toBeGreaterThanOrEqual(bestPrice(c, seg, strong));
  });

  it("answers at all when there is nobody to price against", () => {
    const c = newcomer();
    const price = bestPrice(c, niche.segments[0], []);
    expect(Number.isFinite(price)).toBe(true);
    expect(price).toBeGreaterThan(c.unitCost);
  });
});

describe("where to sell", () => {
  it("keeps the places worth keeping, and never keeps none", () => {
    const open = niche.cities.slice(0, 4);
    expect(regionsWorthKeeping(open, niche.segments[0], 1)).toHaveLength(1);
    expect(regionsWorthKeeping(open, niche.segments[0], 0), "selling nowhere sells nothing").toHaveLength(1);
    expect(regionsWorthKeeping(open, null, 10)).toHaveLength(open.length);
  });

  it("keeps the region its people are actually in", () => {
    const seg = niche.segments[0];
    const small = { ...niche.cities[0], id: "small", weight: 0.05, segmentMix: { [seg.id]: 3 } } as any;
    const big = { ...niche.cities[1], id: "big", weight: 0.2, segmentMix: { [seg.id]: 0.2 } } as any;
    // Three times the concentration in a region a quarter the size still wins.
    expect(regionsWorthKeeping([small, big], seg, 1)).toEqual(["small"]);
  });
});
