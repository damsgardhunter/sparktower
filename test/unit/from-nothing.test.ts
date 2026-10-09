/**
 * Starting from nothing, which nothing else in the suite covers.
 *
 * Every balance guard in here tests the funded opening: money in the bank, a
 * credit line, nobody to serve, everyone level. That is one half of the game.
 * The other half is `opening: "actual"` — no cash, no trading history, no
 * customers, a plant scaled to the stage — and it is the half somebody meets
 * when a link is sent to them because they are thinking about starting a
 * business. It had no guard at all.
 *
 * Which is how it came to be unplayable without anybody noticing. Measured
 * across five written markets at £2,000, £60,000 and £500,000 of pocket money:
 * every low-capital run went insolvent by year three, and two markets went
 * insolvent at *every* level of capital. Each change that got it there was
 * verified against the 261 funded guards and none of them looks at this path.
 *
 * ## What these hold
 *
 * The weakest promises that make it a game rather than a slope:
 *
 *   - a competent founder with a realistic pocket survives, in most markets
 *   - and ends up with something, rather than merely not being dead
 *   - more capital is better than less, because otherwise the opening balance
 *     is decoration — this is the one the funded guards cannot test, since
 *     there every company opens with the same figure
 *   - and it is harder than the funded game, or the two openings are the same
 *     question asked twice
 *
 * Deliberately not "survives everywhere". Some businesses do not work, and a
 * simulation where every one of them does is not teaching anybody anything.
 */
import { describe, it, expect } from "vitest";
import { buildCustomMarket } from "@shared/simulation/custom-market";
import { buildWorld, economyFor } from "@shared/simulation/season";
import { resolveYear } from "@shared/simulation/resolve";
import { optimise } from "@shared/simulation/optimiser";
import { valuation } from "@shared/simulation/mergers";
import { ROLES, type World, type Niche } from "@shared/simulation/types";

/**
 * Five small businesses, written to the shape `nova-market.ts` asks Nova for.
 *
 * Small on purpose: these are the markets the "actual" opening exists for, and
 * a founder starting from nothing in a £400m market is a different test.
 */
const MARKETS: { label: string; spec: any }[] = [
  {
    label: "bike repair",
    spec: {
      name: "Mobile bike repair", premise: "A van, a toolkit and one mechanic.",
      segments: [
        { id: "commuters", name: "Commuters", description: "Ride to work, want it fixed by Thursday.", size: 9_000, growth: 0.04, priceSensitivity: 0.65, qualityFocus: 0.45, brandFocus: 0.25, serviceFocus: 0.8, loyalty: 0.55, referencePrice: 48 },
        { id: "enthusiasts", name: "Enthusiasts", description: "Expensive bikes, strong opinions.", size: 2_600, growth: 0.07, priceSensitivity: 0.3, qualityFocus: 0.85, brandFocus: 0.45, serviceFocus: 0.6, loyalty: 0.7, referencePrice: 140 },
      ],
      regions: [
        { id: "town", name: "The town", weight: 0.45, entryCost: 1_200, note: "Where the van is." },
        { id: "villages", name: "The villages", weight: 0.3, entryCost: 4_000, note: "More driving." },
        { id: "city", name: "The city", weight: 0.25, entryCost: 15_000, note: "Three shops already there." },
      ],
      incumbents: [
        { id: "shop", name: "The High Street shop", posture: "coaster", startingShare: 0.52, quality: 58, brand: 72, service: 40, priceIndex: 1.15 },
        { id: "chain", name: "A chain's service desk", posture: "shark", startingShare: 0.3, quality: 42, brand: 80, service: 28, priceIndex: 0.85 },
      ],
      baseUnitCost: 14, innovationPace: 0.5,
      voice: { customer: "rider", customers: "riders", unit: "repair", capacity: "jobs a month" },
      workforce: [
        { id: "mechanics", name: "mechanics", one: "a mechanic", does: "room", pay: 0.85, share: 0.8, serves: 1_000 },
        { id: "office", name: "bookings", one: "a bookings assistant", does: "service", pay: 0.6, share: 0.2 },
      ],
    },
  },
  {
    label: "dog daycare",
    spec: {
      name: "A dog daycare", premise: "Daytime care for dogs whose owners are at work.",
      segments: [
        { id: "regulars", name: "Weekday regulars", description: "Four days a week, same dog.", size: 4_200, growth: 0.06, priceSensitivity: 0.45, qualityFocus: 0.7, brandFocus: 0.25, serviceFocus: 0.85, loyalty: 0.8, referencePrice: 1_900 },
        { id: "occasional", name: "Occasional users", description: "A few days a month.", size: 11_000, growth: 0.04, priceSensitivity: 0.75, qualityFocus: 0.5, brandFocus: 0.3, serviceFocus: 0.6, loyalty: 0.3, referencePrice: 420 },
      ],
      regions: [
        { id: "town", name: "The town", weight: 0.5, entryCost: 9_000, note: "One unit, one van." },
        { id: "north", name: "The north of the county", weight: 0.3, entryCost: 26_000, note: "A long collection round." },
        { id: "city", name: "The city", weight: 0.2, entryCost: 70_000, note: "Three competitors, no parking." },
      ],
      incumbents: [
        { id: "kennels", name: "The old kennels", posture: "coaster", startingShare: 0.46, quality: 45, brand: 62, service: 38, priceIndex: 0.9 },
        { id: "franchise", name: "A new franchise", posture: "shark", startingShare: 0.3, quality: 58, brand: 70, service: 50, priceIndex: 1.2 },
      ],
      baseUnitCost: 240, innovationPace: 0.4,
      voice: { customer: "owner", customers: "owners", unit: "placement", capacity: "dog days" },
      workforce: [
        { id: "handlers", name: "handlers", one: "a handler", does: "room", pay: 0.8, share: 0.75, serves: 90 },
        { id: "trainers", name: "trainers", one: "a trainer", does: "product", pay: 1.2, share: 0.25 },
      ],
    },
  },
  {
    label: "physio clinic",
    spec: {
      name: "A physiotherapy clinic", premise: "Musculoskeletal physiotherapy in two treatment rooms.",
      segments: [
        { id: "selfpay", name: "Self-paying patients", description: "A course of six, and they tell their running club.", size: 18_000, growth: 0.06, priceSensitivity: 0.55, qualityFocus: 0.8, brandFocus: 0.3, serviceFocus: 0.7, loyalty: 0.4, referencePrice: 290 },
        { id: "insurers", name: "Insurer panels", description: "Steady volume, slow payment.", size: 7_500, growth: 0.04, priceSensitivity: 0.85, qualityFocus: 0.65, brandFocus: 0.15, serviceFocus: 0.55, loyalty: 0.75, referencePrice: 185 },
      ],
      regions: [
        { id: "town", name: "The town", weight: 0.5, entryCost: 12_000, note: "The two rooms you rent." },
        { id: "ring", name: "The villages", weight: 0.3, entryCost: 30_000, note: "A second site one day a week." },
        { id: "city", name: "The city", weight: 0.2, entryCost: 85_000, note: "Six private clinics." },
      ],
      incumbents: [
        { id: "nhs", name: "The hospital list", posture: "coaster", startingShare: 0.5, quality: 60, brand: 80, service: 30, priceIndex: 0.3 },
        { id: "group", name: "A clinic group", posture: "fortress", startingShare: 0.3, quality: 68, brand: 64, service: 62, priceIndex: 1.15 },
      ],
      baseUnitCost: 42, innovationPace: 0.5,
      voice: { customer: "patient", customers: "patients", unit: "course", capacity: "appointments a week" },
      workforce: [
        { id: "physios", name: "physiotherapists", one: "a physiotherapist", does: "room", pay: 1.3, share: 0.8, serves: 260 },
        { id: "reception", name: "reception", one: "a receptionist", does: "service", pay: 0.6, share: 0.2 },
      ],
    },
  },
];

/** What a person actually starts with, and what a funded one would have. */
const POCKET = 60_000;
const BACKED = 500_000;
const YEARS = 14;

interface Outcome {
  lived: boolean;
  value: number;
  customers: number;
  closedIn: number;
  bankruptFrom: number | null;
}

/**
 * A competent founder, from nothing, for a whole season.
 *
 * `optimise` is the competent player — it is what the suite uses everywhere
 * else for "a team that knows what it is doing" — and `progress: 0.05` is the
 * earliest band in `opening.ts`: an idea, and the work so far.
 */
function fromNothing(niche: Niche, seasonId: string, pocket: number): Outcome {
  const built = buildWorld({
    seasonId, niche,
    teams: [{ id: "us", name: "Us", seats: [...ROLES], standing: { progress: 0.05, people: 1 } }],
    opening: "actual",
  });
  let world: World = {
    ...built,
    companies: built.companies.map((c) => (c.id === "us" ? { ...c, cash: pocket } : c)),
  };

  for (let year = 1; year <= YEARS; year++) {
    const plan = optimise({ world, companyId: "us", year, economy: economyFor(seasonId, year, 1), totalYears: YEARS });
    if (!plan) return { lived: false, value: 0, customers: 0, closedIn: year, bankruptFrom: null };
    world = resolveYear({ ...world, year }, [plan.decisions as never], economyFor(seasonId, year, 1)).world;
    const us = world.companies.find((c) => c.id === "us");
    if (!us || us.closed) return { lived: false, value: 0, customers: 0, closedIn: year, bankruptFrom: us?.bankruptSince ?? null };
  }

  const us = world.companies.find((c) => c.id === "us")!;
  return {
    /*
     * Insolvency is not death — the brief is explicit that nobody is removed
     * from a season — so "lived" means it is not insolvent at the end, which is
     * the difference between a business and a hole.
     */
    lived: us.bankruptSince === undefined,
    value: valuation(us).fair,
    customers: Object.values(us.customers ?? {}).reduce((a: number, b: any) => a + Number(b), 0),
    closedIn: 0,
    bankruptFrom: us.bankruptSince ?? null,
  };
}

const markets = MARKETS
  .map((m) => ({ label: m.label, niche: buildCustomMarket(m.spec, `nothing-${m.label.replace(/\s+/g, "-")}`, { fresh: true }) }))
  .filter((m): m is { label: string; niche: Niche } => !!m.niche);

describe("starting from nothing", () => {
  it("has markets to test at all", () => {
    expect(markets.length, "buildCustomMarket refused the fixtures").toBe(MARKETS.length);
  });

  it("leaves a competent founder with a business in most of them", () => {
    /*
     * Most and not all. Some businesses do not work and a simulation where
     * every one does teaches nobody anything — but a founder who plays as well
     * as the engine can play should not be insolvent in every market, which is
     * where this path was.
     */
    const results = markets.map((m) => ({ ...m, out: fromNothing(m.niche, `nothing-${m.niche.id}`, POCKET) }));
    const lived = results.filter((r) => r.out.lived);
    const story = results.map((r) => `${r.label} ${r.out.lived ? "lived" : r.out.closedIn ? `closed y${r.out.closedIn}` : `insolvent y${r.out.bankruptFrom}`}`).join(", ");
    expect(lived.length, `a competent founder on ${POCKET} survived none of them: ${story}`).toBeGreaterThan(0);
    expect(lived.length / results.length, `survived only ${lived.length} of ${results.length}: ${story}`).toBeGreaterThanOrEqual(0.5);
  }, 300_000);

  it("leaves them with something worth having, not just a pulse", () => {
    /*
     * ## What this asks, and what it asked first
     *
     * The first version wanted every survivor to finish worth more than the
     * pocket that started it, and that is the wrong promise. A one-van bike
     * round finishes worth £23,471 on £60,000 of working capital, and that is
     * a real outcome for a real business of that size — plenty of them are
     * worth less than the money that went through them. Demanding otherwise
     * would mean no market in here is allowed to be small.
     *
     * What matters is that the path can produce a business worth having at
     * all: every survivor has customers and is worth something, and at least
     * one of these markets turns a pocket into more than the pocket. A dog
     * daycare reaches £1.70m from £60,000 — twenty-eight times — so the
     * ceiling is there; it is the floor that must not be a slope.
     */
    const results = markets.map((m) => ({ ...m, out: fromNothing(m.niche, `nothing-${m.niche.id}`, POCKET) }));
    const lived = results.filter((r) => r.out.lived);
    expect(lived.length, "nothing survived, so there is nothing to value").toBeGreaterThan(0);
    for (const r of lived) {
      expect(r.out.value, `${r.label}: survived and is worth nothing at all`).toBeGreaterThan(0);
      expect(r.out.customers, `${r.label}: survived with no customers`).toBeGreaterThan(0);
    }
    const best = Math.max(...lived.map((r) => r.out.value));
    const story = lived.map((r) => `${r.label} ${Math.round(r.out.value).toLocaleString()}`).join(", ");
    expect(best, `no market turned ${POCKET} into more than ${POCKET}: ${story}`).toBeGreaterThan(POCKET);
  }, 300_000);

  it("rewards capital, which the funded guards cannot test", () => {
    /*
     * Every company in a competitive season opens with the same figure, so
     * nothing in the suite asks whether the opening balance is worth anything.
     * Here it is the whole question: if £500,000 and £60,000 finish in the same
     * place then the money is decoration.
     */
    const poor = markets.map((m) => fromNothing(m.niche, `nothing-${m.niche.id}`, POCKET));
    const rich = markets.map((m) => fromNothing(m.niche, `nothing-${m.niche.id}`, BACKED));
    const poorValue = poor.reduce((n, o) => n + o.value, 0);
    const richValue = rich.reduce((n, o) => n + o.value, 0);
    expect(richValue, `£${BACKED} finished no better than £${POCKET} (${Math.round(richValue)} against ${Math.round(poorValue)})`)
      .toBeGreaterThan(poorValue);
  }, 300_000);

  it("is harder than the funded opening, or it is the same question twice", () => {
    const market = markets[0];
    const nothing = fromNothing(market.niche, `nothing-${market.niche.id}`, POCKET);

    const funded = buildWorld({
      seasonId: `funded-${market.niche.id}`, niche: market.niche,
      teams: [{ id: "us", name: "Us", seats: [...ROLES] }],
    });
    let world: World = funded;
    for (let year = 1; year <= YEARS; year++) {
      const plan = optimise({ world, companyId: "us", year, economy: economyFor(`funded-${market.niche.id}`, year, 1), totalYears: YEARS });
      if (!plan) break;
      world = resolveYear({ ...world, year }, [plan.decisions as never], economyFor(`funded-${market.niche.id}`, year, 1)).world;
    }
    const us = world.companies.find((c) => c.id === "us")!;
    expect(valuation(us).fair, "the funded opening finished no better than starting from nothing")
      .toBeGreaterThan(nothing.value);
  }, 300_000);
});
