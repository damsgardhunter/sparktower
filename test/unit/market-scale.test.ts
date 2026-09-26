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
import { COMPANIES_A_MARKET_IS_WRITTEN_FOR, marketFor, startingCompany, STARTING_CASH } from "@shared/simulation/season";
import { fixedCosts } from "@shared/simulation/decisions";
import { NICHES, nicheById } from "@shared/simulation/niches";
import { buildCustomMarket } from "@shared/simulation/custom-market";
import { ROLES, type Niche } from "@shared/simulation/types";
import { distressOf } from "@shared/simulation/recovery";
import { yearOfCostsFor } from "@shared/simulation/decisions";
import { TRULY_OPEN_SHARE, seedFragmentedTail, seedIncumbents } from "@shared/simulation/incumbents";
import { resolveYear } from "@shared/simulation/resolve";
import { ROLES } from "@shared/simulation/types";

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

/**
 * A founder on their own pays one salary, and the screen says so.
 *
 * Two separate things decide the executive half of a company's fixed costs,
 * and the browser recomputes the whole figure live as somebody types — so the
 * desk sends what the arithmetic needs. It sent `seats` and, for a while,
 * nothing else, which was right only while "one salary per chair" was true.
 * A solo founder holds all five desks and employs one person, so the screen
 * read five chairs and told a startup with £46,000 in the bank that it had
 * committed £700,000 a year to a board of itself. The market's own scale was
 * missing from the same payload, which multiplied the error by another
 * hundred.
 */
describe("what a table has committed to salaries", () => {
  const niche = nicheById(NICHES[0].id)!;
  const solo = { ...startingCompany({ id: "s", name: "S", niche, seats: ["ceo", "cmo", "cfo", "cto", "coo"], officers: 1 }), scale: 0.01 };
  const econ = { demand: 1, interestRate: 0.06, costIndex: 1, outlook: "steady" } as const;

  it("charges one executive for one founder, not one per desk", () => {
    const five = fixedCosts({ ...solo, officers: 5 }, 0, econ as any, 1, niche);
    const one = fixedCosts(solo, 0, econ as any, 1, niche);
    expect(one).toBeLessThan(five);
    expect(five / one, "five chairs cost five times one person").toBeCloseTo(5, 1);
  });

  /*
   * The exact failure, reproduced: a company object stripped of the two fields
   * the desk had not been sending is what the browser was computing with.
   */
  it("is five hundred times wrong when officers and scale go missing", () => {
    const honest = fixedCosts(solo, 0, econ as any, 1, niche);
    const asClientSawIt = fixedCosts({ ...solo, officers: undefined, scale: undefined }, 0, econ as any, 1, niche);
    expect(asClientSawIt / honest).toBeGreaterThan(100);
  });

  it("keeps every lever's salary at the size of the market it is in", () => {
    const big = fixedCosts({ ...solo, scale: 1 }, 0, econ as any, 1, niche);
    const small = fixedCosts({ ...solo, scale: 0.01 }, 0, econ as any, 1, niche);
    expect(small / big).toBeCloseTo(0.01, 4);
  });
});

/**
 * A profitable company with no debt is not in trouble.
 *
 * `distressOf` measured headroom against a flat 1,100,000 — the salary bill of
 * a company in one of the seven catalogue markets, which are all sized around
 * it. A market Nova wrote for a startup runs at a hundredth of that and a solo
 * founder employs one person, so a company holding $308,000 against $1,400 of
 * yearly costs was told every period that it had less than a year of costs in
 * reach, and offered a rescue investor who would take a third of it. Nothing
 * it could earn would ever have cleared a bar set for a business a hundred
 * times its size.
 */
describe("whether a company is in trouble", () => {
  const niche = nicheById(NICHES[0].id)!;
  const startup = (over: Record<string, unknown> = {}) => ({
    ...startingCompany({ id: "s", name: "S", niche, seats: ["ceo", "cmo", "cfo", "cto", "coo"], officers: 1 }),
    scale: 0.01, officers: 1, cash: 12_000, debt: 0, creditLimit: 296_000,
    ...over,
  }) as any;

  it("measures a year of costs at the size of the company", () => {
    // A fifth of a full table, at a hundredth of catalogue scale.
    expect(yearOfCostsFor(startup())).toBeCloseTo(1_100_000 * (1 / 5) * 0.01, 6);
  });

  /* And a full table at full scale is exactly the figure it always was. */
  it("leaves the reference company's number untouched", () => {
    expect(yearOfCostsFor({ seats: [...ROLES], scale: 1 })).toBe(1_100_000);
  });

  it("calls a solvent, debt-free startup healthy", () => {
    expect(distressOf(startup())).toBe("healthy");
  });

  /* The bar still exists — it is just set where this company lives. */
  it("still says distressed when the money really is nearly gone", () => {
    expect(distressOf(startup({ cash: 200, creditLimit: 0 }))).toBe("distressed");
    expect(distressOf(startup({ cash: 0, creditLimit: 0 }))).toBe("insolvent");
  });

  /* And a catalogue-scale company is judged exactly as it always was. */
  it("leaves a full-size company where it was", () => {
    const big = startup({ scale: 1, officers: 5, cash: 100_000, creditLimit: 0 });
    expect(distressOf(big)).toBe("distressed");
  });
});

/**
 * Somebody holds the rest of the market.
 *
 * The world contained the named rivals and nothing else, so every customer
 * they did not hold belonged to no one. In the seven catalogue markets that is
 * a tenth and barely matters. In a market Nova wrote it can be half: a
 * founder's own season came back 23/12/9/6, leaving nineteen thousand
 * customers in the middle of the board to be collected by whoever built room
 * fastest. They took 6.6% of the market in their first quarter and 22% in
 * their second — more than the largest incumbent — and were never once limited
 * by demand.
 */
describe("who holds a market nobody named", () => {
  const fragmented = buildCustomMarket({
    name: "Builder tools", premise: "Tools.", baseUnitCost: 20, innovationPace: 1,
    segments: [
      { id: "a", name: "A", description: "x", size: 20_000, growth: 0.05, priceSensitivity: 0.5, qualityFocus: 0.5, brandFocus: 0.3, serviceFocus: 0.5, loyalty: 0.5, referencePrice: 40 },
      { id: "b", name: "B", description: "y", size: 18_800, growth: 0.05, priceSensitivity: 0.5, qualityFocus: 0.5, brandFocus: 0.3, serviceFocus: 0.5, loyalty: 0.5, referencePrice: 40 },
    ],
    regions: [
      { id: "r1", name: "R1", weight: 0.4, entryCost: 1_000, note: "" },
      { id: "r2", name: "R2", weight: 0.35, entryCost: 1_000, note: "" },
      { id: "r3", name: "R3", weight: 0.25, entryCost: 1_000, note: "" },
    ],
    /* Exactly the shares the founder's own market came back with. */
    incumbents: [0.23, 0.12, 0.09, 0.06].map((startingShare, i) => ({
      id: `r${i}`, name: `Rival ${i}`, posture: "coaster", startingShare,
      quality: 50, brand: 50, service: 50, priceIndex: 1,
    })),
  }, "f")!;

  const total = (n: typeof fragmented) => n.segments.reduce((s, x) => s + x.size, 0);
  const holds = (c: { customers: Record<string, number> } | null) =>
    c ? Object.values(c.customers).reduce((a, b) => a + b, 0) : 0;

  it("seats a tail for the half nobody named", () => {
    const tail = seedFragmentedTail(fragmented);
    expect(tail, "half a market cannot belong to nobody").toBeTruthy();
    expect(tail!.name).toBe("Everybody else");
  });

  it("leaves about a tenth genuinely free, as the catalogue markets do", () => {
    const named = seedIncumbents(fragmented).reduce((s, c) => s + holds(c), 0);
    const free = total(fragmented) - named - holds(seedFragmentedTail(fragmented));
    expect(free / total(fragmented)).toBeCloseTo(TRULY_OPEN_SHARE, 1);
  });

  /* And the seven, which already hold 90%, get no tail and are unchanged. */
  it("seats nothing in a market that is already spoken for", () => {
    for (const n of NICHES) expect(seedFragmentedTail(n), n.id).toBeNull();
  });

  /* It is meant to be beatable — the easiest share in the market, still taken. */
  it("is weak, because a fragmented tail should be the easiest share to take", () => {
    const tail = seedFragmentedTail(fragmented)!;
    for (const rival of seedIncumbents(fragmented)) {
      expect(tail.brand, "weaker than anyone worth naming").toBeLessThan(rival.brand);
    }
  });
});

/**
 * Where you sell is a ceiling, not a handicap.
 *
 * `regionalReach` already multiplied appeal, which makes a company in one
 * region less attractive than the same company everywhere. But a weight is
 * relative and appeal is squared, so a good enough company still won customers
 * in regions it had never opened — and a founder selling in one region worth
 * 9% of the market ended a period holding 21% of it. That is not a hard market
 * to enter; it is a market where the regions are decoration.
 *
 * The lever already said the true thing: "only builders in a city cluster you
 * have opened can choose you, however good you are."
 */
describe("what selling in one region can win", () => {
  const niche = nicheById(NICHES[0].id)!;
  const home = niche.cities[niche.cities.length - 1];
  const everywhere = niche.cities.map((c) => c.id);
  const market = niche.segments.reduce((s, x) => s + x.size, 0);

  const play = (cities: string[], customers: Record<string, number> = {}) => ({
    ...startingCompany({ id: "p", name: "P", niche, seats: [...ROLES] }),
    cities, customers, capacity: market, cash: 50_000_000,
    /* Far better than anybody, so only the ceiling can hold it back. */
    quality: 99, brand: 99, service: 99, price: 1,
  });

  const after = (company: any) => {
    const world = { seasonId: "reach", niche, year: 3, economy: { demand: 1, interestRate: 0.06, costIndex: 1, outlook: "steady" as const }, companies: [...seedIncumbents(niche), company] };
    const out = resolveYear(world as any, [{ companyId: "p" }], world.economy, { withoutEvent: true });
    const me = out.world.companies.find((c) => c.id === "p")!;
    return Object.values(me.customers).reduce((a, b) => a + b, 0);
  };

  it("cannot take more of the market than it sells to", () => {
    const held = after(play([home.id]));
    expect(held / market, "one region, however good the company is")
      .toBeLessThanOrEqual(home.weight + 0.02);
  });

  it("lets the same company take far more when it sells everywhere", () => {
    expect(after(play(everywhere))).toBeGreaterThan(after(play([home.id])));
  });

  /* The overflow route too: customers a rival turned away still live somewhere. */
  it("does not hand it customers a rival turned away in a region it never opened", () => {
    const narrow = after(play([home.id], {}));
    expect(narrow / market, "spill cannot carry it past its own reach either")
      .toBeLessThanOrEqual(home.weight + 0.02);
  });
});

/**
 * A price that goes up is an event the people already paying it notice.
 *
 * Everything else judges the price a company is *at*: it lowers appeal, and
 * appeal decides who chooses them. Nothing noticed a company putting its price
 * up on the customers it already had. A founder took theirs from 19 to 91 and
 * lost nobody — defensible while every seat they had was full, and still a
 * company nobody walked out of.
 */
describe("putting the price up", () => {
  const niche = nicheById(NICHES[0].id)!;
  const market = niche.segments.reduce((s, x) => s + x.size, 0);

  /*
   * `was` is what the company is charging when the period opens and `price` is
   * what the decision sets — which is how a rise actually happens. Setting
   * `priceWas` on the company directly does nothing: resolve derives it from
   * the price the company walked in with, so the fixture has to walk in with
   * it.
   */
  const held = (price: number, was?: number) => {
    const company: any = {
      ...startingCompany({ id: "p", name: "P", niche, seats: [...ROLES] }),
      cities: niche.cities.map((c) => c.id),
      customers: Object.fromEntries(niche.segments.map((s) => [s.id, Math.round(s.size * 0.05)])),
      capacity: market, cash: 50_000_000, price: was ?? price,
    };
    const world = { seasonId: "price", niche, year: 3, economy: { demand: 1, interestRate: 0.06, costIndex: 1, outlook: "steady" as const }, companies: [...seedIncumbents(niche), company] };
    const out = resolveYear(world as any, [{ companyId: "p", cmo: { price } as any }], world.economy, { withoutEvent: true });
    const me = out.world.companies.find((c) => c.id === "p")!;
    return Object.values(me.customers).reduce((a, b) => a + b, 0);
  };

  it("costs customers that holding the same price does not", () => {
    const steady = held(40, 40);
    const doubled = held(40, 20);
    expect(doubled, "a rise from 20 to 40 is worse than having always been 40").toBeLessThan(steady);
  });

  it("costs more the bigger the rise", () => {
    expect(held(40, 20)).toBeLessThan(held(40, 32));
  });

  /* A world written before this existed reads as no change, not as a rise. */
  it("treats no change as no change at all", () => {
    expect(held(40)).toBe(held(40, 40));
  });

  /* And cutting the price is never punished as though it were a rise. */
  it("never punishes a price cut", () => {
    expect(held(20, 40)).toBeGreaterThanOrEqual(held(20, 20));
  });
});

/**
 * A market grows to fit the people in it.
 *
 * A season can seat five hundred — a hundred tables of five, or five hundred
 * founders each running their own company — and the customers never moved. A
 * market of 38,800 split between a hundred companies is 388 each before
 * anybody has decided anything, which is not a hard market; it is a market
 * where nothing anybody does is visible.
 */
describe("a market with a crowd in it", () => {
  const niche = nicheById(NICHES[0].id)!;
  const size = (n: typeof niche) => n.segments.reduce((s, x) => s + x.size, 0);

  it("leaves a small field exactly as written", () => {
    for (const field of [0, 1, 2, COMPANIES_A_MARKET_IS_WRITTEN_FOR]) {
      expect(size(marketFor(niche, field)), `${field} companies`).toBe(size(niche));
    }
  });

  it("grows with the field, and keeps growing", () => {
    expect(size(marketFor(niche, 20))).toBeGreaterThan(size(marketFor(niche, 8)));
    expect(size(marketFor(niche, 100))).toBeGreaterThan(size(marketFor(niche, 20)));
  });

  /*
   * By the square root, not one for one. A crowded market should still be
   * harder to enter than an empty one — scaling linearly would make the number
   * of rivals free, which is the opposite of what a competitor is.
   */
  it("still leaves each company worse off in a crowd", () => {
    const each = (field: number) => size(marketFor(niche, field)) / field;
    expect(each(100)).toBeLessThan(each(20));
    expect(each(20)).toBeLessThan(each(4));
  });

  it("gives a field four times the size twice the customers", () => {
    const four = size(marketFor(niche, 4));
    expect(size(marketFor(niche, 16)) / four).toBeCloseTo(2, 1);
  });

  /* The incumbents hold shares of the bigger market, so it is not emptier. */
  it("seeds the incumbents from the grown market", () => {
    const grown = marketFor(niche, 100);
    const held = seedIncumbents(grown).reduce(
      (sum, c) => sum + Object.values(c.customers).reduce((a, b) => a + b, 0), 0);
    const small = seedIncumbents(niche).reduce(
      (sum, c) => sum + Object.values(c.customers).reduce((a, b) => a + b, 0), 0);
    expect(held).toBeGreaterThan(small);
    expect(held / size(grown), "and hold about the same share of it")
      .toBeCloseTo(small / size(niche), 2);
  });
});
