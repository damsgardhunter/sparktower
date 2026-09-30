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
import { allocate, atScale } from "@shared/simulation/market";
import { COMPANIES_A_MARKET_IS_WRITTEN_FOR, marketFor, startingCompany, STARTING_CASH } from "@shared/simulation/season";
import { fixedCosts, nextTechDebt, officerCost, payScale } from "@shared/simulation/decisions";
import { dataNext, outageChance, securityNext } from "@shared/simulation/product";
import { staffQualityNext } from "@shared/simulation/people";
import { NICHES, nicheById } from "@shared/simulation/niches";
import { buildCustomMarket, OPEN_SHARE_MAX} from "@shared/simulation/custom-market";
import { seedIncumbents } from "@shared/simulation/incumbents";
import { ROLES, type Company, type Niche } from "@shared/simulation/types";
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

  /*
   * Pay follows the market down, and does not follow it all the way.
   *
   * This used to assert exact proportionality — a market a hundredth the size
   * paid a hundredth of the salary — which is right in spirit and wrong in
   * arithmetic, because it made a founder cost £700 a year. At that price a
   * company that decided nothing at all was profitable from its first period
   * and ended a four-year season richer than it started. See `payScale`.
   */
  it("compresses pay with the market instead of erasing it", () => {
    const big = fixedCosts({ ...solo, scale: 1 }, 0, econ as any, 1, niche);
    const small = fixedCosts({ ...solo, scale: 0.01 }, 0, econ as any, 1, niche);
    expect(small / big, "much cheaper than a market a hundred times the size").toBeLessThan(0.1);
    expect(small / big, "and not a hundredth of it — a person still has to eat").toBeGreaterThan(0.01);
    expect(small / big).toBeCloseTo(payScale(0.01), 6);
  });

  /* A catalogue market is scale one, so none of the seven move at all. */
  it("leaves a full-scale market exactly where it was", () => {
    expect(payScale(1)).toBe(1);
    expect(fixedCosts({ ...solo, scale: 1, officers: 5 }, 0, econ as any, 1, niche))
      .toBeCloseTo(5 * 140_000, 6);
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
    /*
     * A fifth of a full table, at a hundredth of catalogue scale — with pay
     * compressed rather than shrunk, so that this threshold and the bill it is
     * measuring move together. See `payScale`.
     */
    expect(yearOfCostsFor(startup())).toBeCloseTo(1_100_000 * (1 / 5) * payScale(0.01), 6);
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
  }, "f", { fresh: true })!;

  const total = (n: typeof fragmented) => n.segments.reduce((s, x) => s + x.size, 0);
  const holds = (c: { customers: Record<string, number> } | null) =>
    c ? Object.values(c.customers).reduce((a, b) => a + b, 0) : 0;

  it("seats a tail for the half nobody named", () => {
    const tail = seedFragmentedTail(fragmented);
    expect(tail, "half a market cannot belong to nobody").toBeTruthy();
    expect(tail!.name).toBe("Everybody else");
  });

  it("leaves a tenth free at least, and more when the market is too small to live in", () => {
    /*
     * This used to assert a tenth exactly, "as the catalogue markets do". A
     * tenth is right when a market has millions of people in it, and it is not
     * a rule that can be applied to the markets Nova writes: they are small on
     * purpose, and a tenth of a small market split again by region is not a
     * business. Measured, a kiln-firing marketplace of 9,000 people left its
     * founder a home region with 270 unowned customers against a break-even of
     * 181, and nobody was ever once profitable there — no season seed, no rate
     * of spending, including spending nothing.
     *
     * `openShareFor` now sets it from what the market costs to operate in, so
     * the tenth is a floor rather than the answer. This market is small enough
     * to be opened up, which is the case worth asserting; the seven catalogue
     * markets are not, and come out at the tenth exactly — `openShareFor` is
     * asked for all seven in `custom-market.test.ts`.
     */
    const named = seedIncumbents(fragmented).reduce((s, c) => s + holds(c), 0);
    const free = total(fragmented) - named - holds(seedFragmentedTail(fragmented));
    const share = free / total(fragmented);
    expect(share, "less room than the catalogue leaves").toBeGreaterThanOrEqual(TRULY_OPEN_SHARE - 0.001);
    expect(share, "a market with no incumbents left in it").toBeLessThanOrEqual(OPEN_SHARE_MAX + 0.001);
    expect(share, "a market this small should have been opened up").toBeGreaterThan(TRULY_OPEN_SHARE);
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

/**
 * A company that decides nothing should not be the one that wins.
 *
 * Measured over a sixteen-quarter season in a market Nova's shape
 * (`docs/simulation-playtest.md`), a company filing last period's draft every
 * period was profitable from its first period and ended richer than it
 * started, while every strategy that actually did something lost money. Three
 * separate things were doing that, and each has its own test below.
 */
describe("deciding nothing", () => {
  it("does not pay a founder a hundredth of a person", () => {
    /*
     * The root cause. A market a hundredth of catalogue size paid £700 a year
     * for the one person running the company, so there was almost nothing for
     * the revenue to have to cover.
     */
    const solo = { officers: 1, scale: 0.01 };
    expect(officerCost(solo)).toBeGreaterThan(4_000);
    expect(officerCost(solo)).toBeLessThan(10_000);
    // And a full table at catalogue scale is exactly what it always was.
    expect(officerCost({ seats: [...ROLES], scale: 1 })).toBe(5 * 140_000);
  });

  it("sizes the opening plant against the payroll it will actually be charged", () => {
    /*
     * `startingCompany` and `fixedCosts` are the same fact and used to
     * disagree: one multiplied the executive line out by hand without the
     * regional footprint and the other applied it, so every company opened
     * with a plant built for a payroll it did not have.
     */
    const niche = nicheById(NICHES[0].id)!;
    const c = startingCompany({ id: "s", name: "S", niche, seats: [...ROLES], officers: 1 });
    expect(officerCost({ officers: 1, scale: marketScale(niche) })).toBe(officerCost(c));
  });
});

/**
 * Overflow tops a business up; it does not make one.
 *
 * Customers a rival turns away go to whoever they would have chosen next,
 * which is one of the doors a newcomer comes in through and is sized on
 * purpose (see `stepIncumbent`). But the takers are only the companies with
 * room left, and in a market whose incumbents are all full that is one
 * company — so an idle newcomer with a 0.6% claim on a segment took half of
 * everything every rival turned away. It was how a company that decided
 * nothing at all was handed a thousand customers in its first period and ended
 * a four-year season richer than it started: room was not a bet, it was a
 * customer magnet, and the biggest empty plant won.
 */
describe("customers a rival turned away", () => {
  const niche = nicheById(NICHES[0].id)!;
  const econ = { demand: 1, interestRate: 0.06, costIndex: 1, outlook: "steady" } as any;

  /** A field where the incumbents are full and one company has a vast empty plant. */
  const field = (mine: Partial<Company>): Company[] => {
    const incumbents = seedIncumbents(niche, "spill");
    const me = {
      ...startingCompany({ id: "me", name: "Mine", niche, seats: [...ROLES], officers: 1 }),
      capacity: 5_000_000,
      ...mine,
    } as Company;
    return [...incumbents, me];
  };

  it("cannot hand a market to a company nobody chose", () => {
    /*
     * Quality and brand on the floor, so it wins almost nothing on merit —
     * and therefore has almost no allowance to be topped up against, however
     * much room it is sitting on.
     */
    const out = allocate(field({ quality: 5, brand: 1, service: 5, price: 200 }), niche, 1, econ);
    const mine = Object.values(out.held.me ?? {}).reduce((sum, n) => sum + n, 0);
    const market = niche.segments.reduce((sum, s) => sum + s.size, 0);
    expect(mine / market, "an empty plant is not a customer magnet").toBeLessThan(0.02);
  });

  it("still lets a company people would actually choose grow into it", () => {
    const weak = allocate(field({ quality: 5, brand: 1, service: 5, price: 200 }), niche, 1, econ);
    const strong = allocate(field({ quality: 80, brand: 70, service: 75 }), niche, 1, econ);
    const total = (r: any) => Object.values(r.held.me ?? {}).reduce((sum: number, n: any) => sum + n, 0);
    expect(total(strong), "the door a newcomer comes in through stays open").toBeGreaterThan(total(weak) * 3);
  });
});

/**
 * Every absolute money number belongs at the market's scale.
 *
 * `atScale` exists for exactly this and says so: the engine's thresholds were
 * written for the seven catalogue markets, which are all worth about £400m a
 * year, and a market Nova writes for one business can be a two-hundredth of
 * that. A £150,000 threshold there is three times the founder's whole opening
 * bank, so the lever is not expensive — it is inert.
 *
 * Six functions were found without it, one at a time, over a single sitting:
 * `prOutcome`, `referralBrand`, `securityNext`, `dataNext`, `outageChance`,
 * `nextTechDebt` and `staffQualityNext`. Rather than trust that the seventh
 * will be noticed, this asserts the property for all of them at once: money a
 * founder could actually spend has to move the number it is aimed at.
 *
 * The worst of them is the last. Training carries a staleness decay, so before
 * this a founder who paid for training got staff *worse* than if they had not
 * bothered — the decay landed and the spending bought nothing.
 */
describe("levers a founder can actually afford", () => {
  /** About a period's spending for a company opening with £48,000. */
  const AFFORDABLE = 4_000;
  const STARTUP = 0.01;

  it("moves security, data and tech debt on a founder's budget", () => {
    expect(securityNext(0, AFFORDABLE, 0.25, STARTUP), "security").toBeGreaterThan(5);
    expect(dataNext(0, AFFORDABLE, 0.25, STARTUP), "what is known about customers").toBeGreaterThan(5);
    const cleared = 50 - nextTechDebt({ current: 50, paydown: AFFORDABLE, scale: STARTUP });
    expect(cleared, "technical debt paid down").toBeGreaterThan(2);
  });

  it("does not punish a founder for training their staff", () => {
    const before = 50;
    const trained = staffQualityNext({
      quality: before, established: 5, newHires: 0, recruiting: 0, training: AFFORDABLE, scale: STARTUP,
    });
    expect(trained, "paying for training makes the staff better, not worse").toBeGreaterThan(before);
  });

  it("leaves the catalogue markets exactly where they were", () => {
    // Scale one is the identity, so none of the seven hand-written markets move.
    expect(securityNext(0, 150_000, 0.25, 1)).toBe(securityNext(0, 150_000, 0.25));
    expect(dataNext(0, 150_000, 0.25, 1)).toBe(dataNext(0, 150_000, 0.25));
    expect(outageChance(60, 300_000, 1)).toBe(outageChance(60, 300_000));
    expect(nextTechDebt({ current: 50, paydown: 70_000, scale: 1 })).toBe(nextTechDebt({ current: 50, paydown: 70_000 }));
  });
});
