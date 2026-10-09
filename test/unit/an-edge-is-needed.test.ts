/**
 * You cannot buy your way in. You have to be better at something.
 *
 * `winnabilityOf` says a market is winnable if the best plan wins somebody,
 * stays solvent and has a period that pays. All three are about *possibility*,
 * and none of them is about *why*: a market would pass every one of those
 * checks while handing the whole thing to whoever spent most on advertising.
 *
 * What makes this a game is that it does not. To take customers off an
 * incumbent you have to beat it on an axis its buyers weigh — price, quality,
 * brand, service — and money alone moves one of those four a little. So
 * advertising wins you some users and not many, and the company that also got
 * good at something wins more while spending less on being noticed.
 *
 * Measured, over eight quarters in dating apps, priced at the middle segment:
 *
 *     no edge, no spend     3,400 customers    cash left £5,090,400
 *     advertising only      5,544 customers    cash left   £621,788
 *     a real edge           6,589 customers    cash left         £0
 *
 * Advertising alone is worth something — two thousand customers — and it costs
 * seven eighths of the bank to get them. Being better is worth more.
 *
 * These are ratios rather than counts on purpose. The absolute numbers move
 * whenever the engine is retuned, and the ordering is the promise.
 */
import { describe, it, expect } from "vitest";
import { buildWorld, economyFor } from "@shared/simulation/season";
import { resolveYear } from "@shared/simulation/resolve";
import { nicheById } from "@shared/simulation/niches";
import { ROLES, type World, type Niche } from "@shared/simulation/types";

const QUARTERS = 8;

interface Played {
  customers: number;
  cash: number;
  quality: number;
  brand: number;
  service: number;
}

/**
 * One company, one plan held for eight quarters, against the incumbents.
 *
 * Held rather than optimised, because the question is what a *kind* of plan
 * achieves. An optimiser would find the edge on its own, which is the thing
 * being tested.
 */
function play(niche: Niche, label: string, make: (c: any, cash: number) => any): Played {
  /*
   * The same season for all three plans, and that is not incidental.
   *
   * Written first with a seed per plan — `edge-${label}` — which gave each one
   * a different economy and a differently seeded field of incumbents, and so
   * compared the plan with the dice: advertising came out ahead of the edge
   * plan by three thousand customers and the ordering looked broken. It was
   * the harness. One seed, three plans, one answer.
   */
  void label;
  const seasonId = "edge";
  let world: World = buildWorld({
    seasonId, niche,
    teams: [{ id: "us", name: "Us", seats: [...ROLES] }],
    cadence: "quarterly",
  });

  for (let p = 1; p <= QUARTERS; p++) {
    const us = world.companies.find((c) => c.id === "us");
    if (!us || us.closed) break;
    const decision = { companyId: "us", ...make(us, Math.max(0, us.cash ?? 0)) };
    world = resolveYear({ ...world, year: p }, [decision as never], economyFor(seasonId, p, 4)).world;
  }

  const us = world.companies.find((c) => c.id === "us");
  return {
    customers: us ? Object.values(us.customers ?? {}).reduce((a: number, b: any) => a + Number(b), 0) : 0,
    cash: Math.max(0, us?.cash ?? 0),
    quality: Math.round((us as any)?.quality ?? 0),
    brand: Math.round((us as any)?.brand ?? 0),
    service: Math.round((us as any)?.service ?? 0),
  };
}

const niche = nicheById("dating_apps")!;
const market = niche.segments.reduce((sum, s) => sum + s.size, 0);
/* The middle segment's own price: neither undercutting nor charging a premium. */
const price = Math.round([...niche.segments].sort((a, b) => a.referencePrice - b.referencePrice)[Math.floor(niche.segments.length / 2)].referencePrice);
const finance = { cfo: { borrow: 0, repay: 0, cashBuffer: 0 }, ceo: { focus: "growth" as const } };

/** Nothing bought, nothing better. The floor everything else is measured against. */
const idle = play(niche, "idle", (c: any) => ({
  cmo: { price, brandSpend: 0, performanceSpend: 0, celebritySpend: 0, targetCities: c.cities },
  cto: { featureSpend: 0, reliabilitySpend: 0, techDebtPaydown: 0 },
  coo: { capacityTarget: c.capacity, supportSpend: 0, efficiencySpend: 0, headcount: 5 },
  ...finance,
}));

/** A fifth of the bank into being noticed, every quarter, and nothing into being good. */
const adsOnly = play(niche, "ads", (c: any, cash: number) => ({
  cmo: { price, brandSpend: Math.round(cash * 0.1), performanceSpend: Math.round(cash * 0.1), celebritySpend: 0, targetCities: c.cities },
  cto: { featureSpend: 0, reliabilitySpend: 0, techDebtPaydown: 0 },
  coo: { capacityTarget: c.capacity, supportSpend: 0, efficiencySpend: 0, headcount: 5 },
  ...finance,
}));

/** The same money, mostly into the product and the service instead. */
const edge = play(niche, "edge", (c: any, cash: number) => ({
  cmo: { price, brandSpend: Math.round(cash * 0.04), performanceSpend: Math.round(cash * 0.04), celebritySpend: 0, targetCities: c.cities },
  cto: { featureSpend: Math.round(cash * 0.08), reliabilitySpend: Math.round(cash * 0.08), techDebtPaydown: 0 },
  coo: { capacityTarget: Math.round(c.capacity * 1.2), supportSpend: Math.round(cash * 0.06), efficiencySpend: 0, headcount: 6 },
  ...finance,
}));

const story = `idle ${idle.customers}, ads ${adsOnly.customers}, edge ${edge.customers}`;

describe("competing in a market", () => {
  it("gives a company that buys nothing and is better at nothing the least", () => {
    expect(idle.customers, `a company doing nothing did not come last: ${story}`)
      .toBeLessThan(adsOnly.customers);
    expect(idle.customers).toBeLessThan(edge.customers);
  }, 120_000);

  it("lets advertising win some users, because money should do something", () => {
    /*
     * The other half of the promise. If spending on being noticed did nothing
     * at all then marketing is decoration and the only lever is the product,
     * which is not how any market works.
     */
    expect(adsOnly.customers / Math.max(1, idle.customers), `advertising bought nothing: ${story}`)
      .toBeGreaterThan(1.2);
    expect(adsOnly.brand, "advertising did not even move brand").toBeGreaterThan(idle.brand);
  }, 120_000);

  it("and not many, so it cannot stand in for being better at something", () => {
    /*
     * "Not a lot" in two senses, and both matter.
     *
     * By share: advertising alone, a fifth of the bank every quarter for two
     * years, takes a fraction of a per cent of the market. Nobody buys their
     * way to owning one.
     *
     * And by what it costs: the advertising-only company ends with far less
     * money than the one that got good, having won fewer customers with it.
     */
    expect(adsOnly.customers / market, `advertising alone took ${((adsOnly.customers / market) * 100).toFixed(2)}% of the market`)
      .toBeLessThan(0.01);
    expect(adsOnly.cash, "advertising alone did not cost anything").toBeLessThan(idle.cash / 2);
  }, 120_000);

  it("rewards being better at something over being louder about nothing", () => {
    /*
     * The promise itself: to take customers in this market you have to beat
     * the people already in it on something their buyers weigh. The edge plan
     * spends *less* than half as much on being noticed and finishes with more
     * customers, because it moved quality and service instead.
     */
    expect(edge.customers, `being better did not beat being louder: ${story}`)
      .toBeGreaterThan(adsOnly.customers);
    expect(edge.quality, "the edge plan did not actually get better").toBeGreaterThan(idle.quality);
    expect(edge.brand, "the edge plan outspent the advertising plan on brand, so it proves nothing")
      .toBeLessThan(adsOnly.brand);
  }, 120_000);
});
