/**
 * The bots that fill an empty simulation lobby.
 *
 * What's worth pinning here isn't that they work — it's the three properties
 * that stop them being a bad idea:
 *
 *   - they only appear when somebody is actually waiting,
 *   - they play the obvious move rather than a good one, and
 *   - they do the same thing twice given the same season, so a strange result
 *     can be traced instead of shrugged at.
 */
import { describe, it, expect } from "vitest";
import {
  BOT_FILL_AFTER_SECONDS, BOT_JITTER, botAmbition, botBids, botDecision, botDisplayName, botIdentity,
  botsForVenture, botsNeeded, decisionSeed, jitter,
  botCapacity,
} from "@shared/simulation/bots";
import type { Listing } from "@shared/simulation/assets";
import { LEVER_FIELDS, cleanDecision, defaultDraft, validateDecision } from "@shared/simulation/levers";
import { nextPhase } from "@shared/simulation/lobby";
import { ROLES } from "@shared/simulation/types";
import { NICHES, nicheById } from "@shared/simulation/niches";
import type { Company } from "@shared/simulation/types";

/** A company mid-season, plain enough that any lever can be filed against it. */
const company = (over: Partial<Company> = {}): Company => ({
  cash: 6_000_000,
  price: 40,
  capacity: 250_000,
  positioning: "",
  cities: [],
  ...(over as any),
} as Company);

describe("when bots appear at all", () => {
  it("waits a minute — long enough for two people arriving together to play together", () => {
    expect(BOT_FILL_AFTER_SECONDS).toBe(60);
  });

  /*
   * The rule that keeps this from being a fake product: an empty room is not a
   * room to fill. Bots exist so the person who turned up isn't punished for
   * being early, not so seasons run with nobody watching.
   */
  it("fills nothing when nobody is waiting", () => {
    expect(botsNeeded({ humans: 0, lobbySize: 5 })).toBe(0);
  });

  it("tops a partial room up to the lobby size", () => {
    expect(botsNeeded({ humans: 1, lobbySize: 5 })).toBe(4);
    expect(botsNeeded({ humans: 3, lobbySize: 5 })).toBe(2);
  });

  it("adds none to a full room, and never overfills", () => {
    expect(botsNeeded({ humans: 5, lobbySize: 5 })).toBe(0);
    expect(botsNeeded({ humans: 7, lobbySize: 5 })).toBe(0);
  });
});

describe("who the bots are", () => {
  it("has an ordinary name, so a league table reads like a league table", () => {
    const b = botIdentity(3);
    expect(botDisplayName(b)).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
  });

  it("is the same person every time — the account is looked up by this address", () => {
    expect(botIdentity(7)).toEqual(botIdentity(7));
    expect(botIdentity(7).email).toBe(botIdentity(7).email);
  });

  /*
   * `.invalid` is reserved by RFC 2606 and resolves nowhere, so even a bug
   * that tried to email a bot could not reach a real person.
   */
  it("has an address that can never receive mail", () => {
    for (const i of [0, 5, 25]) expect(botIdentity(i).email).toMatch(/@bots\.sparktower\.invalid$/);
  });

  it("gives one venture distinct bots — two of one name reads as a bug", () => {
    const bots = botsForVenture("venture-1", 4);
    expect(bots).toHaveLength(4);
    expect(new Set(bots.map((b) => b.email)).size).toBe(4);
  });

  it("picks the same cast when a fill is retried", () => {
    expect(botsForVenture("venture-1", 4)).toEqual(botsForVenture("venture-1", 4));
  });

  it("gives different ventures different casts", () => {
    const a = botsForVenture("venture-a", 4).map((b) => b.email);
    const b = botsForVenture("venture-b", 4).map((x) => x.email);
    expect(a).not.toEqual(b);
  });

  it("never asks for more bots than it has names for", () => {
    expect(botsForVenture("v", 999).length).toBeLessThanOrEqual(26);
  });
});

describe("the hint of randomness", () => {
  it("moves a number without deciding it", () => {
    const out = jitter({ seed: "s", value: 100 });
    expect(out).not.toBe(100);
    expect(Math.abs(out - 100) / 100).toBeLessThanOrEqual(BOT_JITTER + 0.001);
  });

  it("gives the same answer for the same seed, and a different one for another", () => {
    expect(jitter({ seed: "a", value: 100 })).toBe(jitter({ seed: "a", value: 100 }));
    expect(jitter({ seed: "a", value: 100 })).not.toBe(jitter({ seed: "b", value: 100 }));
  });

  it("keeps a whole number whole — nobody can file 7.3 people", () => {
    expect(Number.isInteger(jitter({ seed: "s", value: 12 }))).toBe(true);
  });

  it("respects the lever's own bounds, so a bot can't file what a person would be refused for", () => {
    expect(jitter({ seed: "s", value: 10, min: 10 })).toBeGreaterThanOrEqual(10);
    expect(jitter({ seed: "s", value: 10, max: 10 })).toBeLessThanOrEqual(10);
  });

  it("separates roles and years, so levers don't move in lockstep", () => {
    const base = { ventureId: "v", year: 1 } as const;
    const seeds = new Set([
      decisionSeed({ ...base, role: "cfo", field: "borrow" }),
      decisionSeed({ ...base, role: "cto", field: "borrow" }),
      decisionSeed({ ...base, year: 2, role: "cfo", field: "borrow" }),
      decisionSeed({ ...base, role: "cfo", field: "repay" }),
    ]);
    expect(seeds.size, "venture, year, role and field must each change the seed").toBe(4);
  });
});

describe("what a bot files", () => {
  /*
   * The one that matters most. A bot's decision goes through the same
   * validator a person's does — if a bot could file something a person is
   * refused for, the rules would only apply to humans.
   */
  it("is always something a person would have been allowed to file", () => {
    for (const role of ROLES) {
      for (const year of [1, 2, 3]) {
        const d = botDecision({ ventureId: "v1", year, role, company: company() });
        const checked = validateDecision(role, d, company());
        expect(checked.ok, `${role} year ${year}: ${JSON.stringify(checked.errors)}`).toBe(true);
      }
    }
  });

  it("plays the obvious move — every field it files is one the role actually has", () => {
    for (const role of ROLES) {
      const d = botDecision({ ventureId: "v1", year: 1, role, company: company() });
      const known = new Set(Object.keys(defaultDraft(role, company())));
      for (const key of Object.keys(d)) expect(known.has(key), `${role} invented a field: ${key}`).toBe(true);
    }
  });

  it("files the same thing twice for the same company and year", () => {
    const args = { ventureId: "v1", year: 2, role: "cmo" as const, company: company() };
    expect(botDecision(args)).toEqual(botDecision(args));
  });

  it("moves between years, so a bot isn't filing one number forever", () => {
    const one = botDecision({ ventureId: "v1", year: 1, role: "cmo", company: company() });
    const two = botDecision({ ventureId: "v1", year: 2, role: "cmo", company: company() });
    expect(one).not.toEqual(two);
  });

  it("differs between companies, so five bot-run ventures don't dead-heat", () => {
    const a = botDecision({ ventureId: "v-a", year: 1, role: "coo", company: company() });
    const b = botDecision({ ventureId: "v-b", year: 1, role: "coo", company: company() });
    expect(a).not.toEqual(b);
  });

  /*
   * A spend that starts at zero stays at zero under a multiplier, which would
   * leave every bot filing a year of doing nothing at all.
   */
  it("actually spends something rather than filing a year of zeroes", () => {
    const spent = ROLES.flatMap((role) => {
      const d = botDecision({ ventureId: "v1", year: 1, role, company: company() });
      return (LEVER_FIELDS[role] ?? [])
        .filter((f) => f.kind === "money")
        .map((f) => Number(d[f.id]) || 0);
    });
    expect(spent.some((n) => n > 0), "a lobby of bots that spends nothing is a season of nothing").toBe(true);
  });

  it("carries last year's decision forward as its starting point", () => {
    const previous = { price: 99, brandSpend: 1000, performanceSpend: 0, celebritySpend: 500, targetCities: [] };
    const d = botDecision({ ventureId: "v1", year: 2, role: "cmo", company: company(), previous });
    // Nudged from 99, not reset to the company's price.
    expect(Math.abs(Number(d.price) - 99) / 99).toBeLessThanOrEqual(BOT_JITTER + 0.001);
  });
});

/*
 * A bot never claims a seat — taking whatever nobody else wanted is the whole
 * arrangement. That leaves the lobby's clocks pointed at choices that are
 * never going to be made: three minutes of claiming and two of naming, five
 * minutes of one real person watching an empty room tick down. These are the
 * two places the room is allowed to stop waiting early.
 */
describe("a room that is waiting on bots", () => {
  const seat = (userId: string, role: any, isBot = false) => ({ userId, role, assigned: false, isBot });
  const claiming = (seats: any[], secondsLeft = 120) =>
    nextPhase({ phase: "claiming" as const, seats, secondsLeft, named: false });

  it("deals the rest out as soon as every person has chosen", () => {
    const move = claiming([seat("a", "ceo"), seat("b", "cmo"), seat("bot-1", null, true), seat("bot-2", null, true)]);
    expect(move?.phase).toBe("naming");
    expect(move?.assign, "the unclaimed seats go to the bots now, not in three minutes").toBe(true);
  });

  it("still waits while a person hasn't chosen", () => {
    expect(claiming([seat("a", "ceo"), seat("b", null), seat("bot-1", null, true)])).toBeNull();
  });

  it("waits out the clock in a room of only people", () => {
    expect(claiming([seat("a", "ceo"), seat("b", null)])).toBeNull();
  });

  it("starts the season rather than waiting for a name a bot will never give", () => {
    const move = nextPhase({
      phase: "naming",
      seats: [seat("bot-1", "ceo", true), seat("a", "cmo")],
      secondsLeft: 100,
      named: false,
    });
    expect(move?.phase, "a placeholder now beats two minutes of nothing").toBe("running");
  });

  it("gives a human chief executive their full two minutes to name it", () => {
    const move = nextPhase({
      phase: "naming",
      seats: [seat("a", "ceo"), seat("bot-1", "cmo", true)],
      secondsLeft: 100,
      named: false,
    });
    expect(move, "naming is the one thing the room is actually waiting for").toBeNull();
  });
});

/*
 * The cleaning a submission goes through on its way into the database. It was
 * inline in the decisions route; bots file through the same door, so there is
 * one definition of what a seat may say rather than two that can drift.
 */
describe("what a seat is allowed to file", () => {
  it("keeps only the fields the role owns", () => {
    const clean = cleanDecision("cmo", { price: 30, borrow: 500_000, nonsense: 1 });
    expect(clean.borrow, "a CMO must not be able to take out a loan").toBeUndefined();
    expect(clean.nonsense).toBeUndefined();
    expect(clean.price).toBe(30);
  });

  it("fills in what wasn't sent rather than leaving a hole", () => {
    const clean = cleanDecision("cfo", {});
    /*
     * Except the levers whose answer is a map — price tiers, a budget split,
     * a vote on each offer. There, empty means "none filed", and writing an
     * empty object would file a decision nobody made.
     */
    const maps = new Set(["tiers", "allocation", "levels"]);
    for (const field of LEVER_FIELDS.cfo) {
      if (maps.has(field.kind)) expect(clean).not.toHaveProperty(field.id);
      else expect(clean).toHaveProperty(field.id);
    }
  });

  it("turns a number that isn't one into zero, not NaN", () => {
    expect(cleanDecision("cfo", { borrow: "banana" }).borrow).toBe(0);
  });

  it("keeps a city list a list, filtered to places that exist", () => {
    const clean = cleanDecision("cmo", { targetCities: ["real", "nowhere"] }, ["real"]);
    expect(clean.targetCities).toEqual(["real"]);
  });

  it("passes everything a bot files", () => {
    /*
     * Every year of a season, not just the early ones. This used to stop at
     * five and so never reached the levers that arrive later — one of which
     * the bot filed in the wrong type, failing validation and quietly falling
     * back to bare defaults for the rest of the game.
     */
    for (const year of [1, 2, 3, 4, 5, 6, 7, 8, 10, 14]) for (const role of ROLES) {
      const d = botDecision({ ventureId: "v1", year, role, company: company() });
      const clean = cleanDecision(role, d, [], { year });
      expect(clean, `${role} in year ${year} loses something on the way in`).toEqual(d);
    }
  });
});

describe("a bot that knows the market", () => {
  const niche = nicheById("dating_apps")!;
  const running = (over: Partial<Company> = {}) => company({
    capacity: 50_000,
    customers: { swipers: 20_000, recently_single: 18_000, long_haulers: 4_000 } as any,
    cities: ["leeds", "manchester"],
    automation: 10,
    ...(over as any),
  });

  it("files a year that survives the same cleaning a person's does", () => {
    const cityIds = niche.cities.map((c) => c.id);
    const segmentIds = niche.segments.map((g) => g.id);
    for (const year of [1, 3, 5, 7, 9, 14]) for (const role of ROLES) {
      const d = botDecision({ ventureId: "v1", year, role, company: running(), niche });
      const clean = cleanDecision(role, d, cityIds, { year, segmentIds });
      expect(clean, `${role} in year ${year} loses something on the way in`).toEqual(d);
    }
  });

  /*
   * The point of the coin. Five bot companies in a season used to answer every
   * standing question identically for fourteen years, which made them one
   * company copied five times.
   */
  it("does not make the same calls as the company next door", () => {
    const shown = ["alpha", "beta", "gamma", "delta"].map((v) =>
      JSON.stringify(ROLES.map((role) => botDecision({ ventureId: v, year: 6, role, company: running(), niche }))));
    expect(new Set(shown).size, "every bot company filed the same year").toBeGreaterThan(1);
  });

  it("makes the same calls twice for the same company and year", () => {
    const once = botDecision({ ventureId: "v1", year: 6, role: "coo", company: running(), niche });
    const again = botDecision({ ventureId: "v1", year: 6, role: "coo", company: running(), niche });
    expect(again).toEqual(once);
  });

  it("changes its mind from one year to the next", () => {
    const years = [3, 4, 5, 6, 7, 8].map((year) =>
      JSON.stringify(botDecision({ ventureId: "v1", year, role: "cfo", company: running(), niche })));
    expect(new Set(years).size, "filed the identical year six times").toBeGreaterThan(1);
  });

  /*
   * The hard rule: a bot may be wrong, but it may not spend money the company
   * does not have. Everything that costs cash is offered only while the purse
   * covers it, so a company with nothing buys nothing.
   */
  it("buys nothing when there is no money", () => {
    const broke = running({ cash: 0, creditLimit: 0, debt: 0 });
    for (const v of ["a", "b", "c", "d", "e", "f"]) {
      const coo: any = botDecision({ ventureId: v, year: 9, role: "coo", company: broke, niche });
      expect(coo.automationTarget, "automated a plant it cannot pay for").toBe(Math.round(broke.automation ?? 0));
      expect(coo.shiftCapacity).toBe(0);
      expect(coo.stockTarget).toBe(0);
      const cmo: any = botDecision({ ventureId: v, year: 9, role: "cmo", company: broke, niche });
      expect(cmo.research, "bought research it cannot pay for").toBe("none");
      expect(cmo.targetCities, "opened a region it cannot pay for").toEqual(broke.cities);
    }
  });

  it("opens a region once it has filled the one it is in, and only one", () => {
    const full = running({ capacity: 40_000, cash: 8_000_000 });
    const opened = ["a", "b", "c", "d", "e", "f", "g", "h"].map((v) => {
      const d: any = botDecision({ ventureId: v, year: 9, role: "cmo", company: full, niche });
      return (d.targetCities as string[]).filter((c) => !(full.cities ?? []).includes(c));
    });
    for (const added of opened) expect(added.length, "opened more than one region in a year").toBeLessThanOrEqual(1);
    expect(opened.some((added) => added.length === 1), "never left home").toBe(true);
  });

  it("aims its marketing at the regions and segments that are actually there", () => {
    const d: any = botDecision({ ventureId: "v1", year: 9, role: "cmo", company: running(), niche });
    for (const key of Object.keys(d.regionFocus ?? {})) expect(running().cities).toContain(key);
    for (const key of Object.keys(d.segmentFocus ?? {})) expect(niche.segments.map((g) => g.id)).toContain(key);
    const total = (map: Record<string, number>) => Object.values(map ?? {}).reduce((a, b) => a + b, 0);
    expect(total(d.regionFocus), "a split that is not a hundred points").toBeLessThanOrEqual(100);
    expect(total(d.segmentFocus)).toBeLessThanOrEqual(100);
  });

  it("files a legal year in every market", () => {
    for (const n of NICHES) for (const role of ROLES) {
      const d = botDecision({ ventureId: "v1", year: 9, role, company: running(), niche: n });
      expect(validateDecision(role, d, running()).ok, `${n.id}/${role}`).toBe(true);
    }
  });
});

describe("an operations bot's capacity", () => {
  const full = { capacity: 231_000, customers: { swipers: 300_000, recently_single: 250_000, long_haulers: 100_000 } } as any;
  const cluster = { id: "c", kind: "facility", name: "Cluster", bookValue: 1, effect: { capacity: 484_000 } } as any;

  /*
   * The bug: capacity was jittered either way at random, and a bot cut a
   * company serving 650,000 from 231,000 built to 210,000.
   */
  it("never cuts a company that is running full", () => {
    for (let i = 0; i < 200; i++) {
      const c = company({ ...full, assets: [{ ...cluster, expiresIn: 3 }] });
      expect(botCapacity({ seed: `s${i}`, company: c, step: 10_000, min: 0 })).toBeGreaterThanOrEqual(230_000);
    }
  });

  it("builds to replace room its assets stop adding after this year", () => {
    const lapsing = company({ ...full, assets: [{ ...cluster, expiresIn: 1 }] });
    const lasting = company({ ...full, assets: [{ ...cluster, expiresIn: 4 }] });
    expect(botCapacity({ seed: "x", company: lapsing, step: 10_000 })).toBeGreaterThan(botCapacity({ seed: "x", company: lasting, step: 10_000 }));
  });

  it("gives back room a mostly idle company is paying to keep empty", () => {
    /*
     * It used to trim up to a tenth and no more, which on a plant four fifths
     * empty is a shrug: the seat holding the company's costs down watched a
     * quarter of a million a year go on room nobody used.
     */
    const idle = company({ capacity: 500_000, customers: { swipers: 100_000 } as any, assets: [] });
    for (let i = 0; i < 50; i++) {
      const v = botCapacity({ seed: `i${i}`, company: idle, step: 10_000 });
      expect(v, "half the plant is the most it will give back in one year").toBe(250_000);
    }
    // Still room to grow into: half as much again as it serves now, at least.
    const lopsided = company({ capacity: 500_000, customers: { swipers: 40_000 } as any, assets: [] });
    expect(botCapacity({ seed: "x", company: lopsided, step: 10_000 })).toBe(250_000);
    // And a company that has not opened yet keeps what it was given.
    const unopened = company({ capacity: 90_000, customers: {} as any, assets: [] });
    expect(botCapacity({ seed: "x", company: unopened, step: 10_000 })).toBe(90_000);
  });
});

/**
 * Keeping up.
 *
 * A bot carried last year's plan forward and nudged it, which meant a company
 * that started modestly stayed that size for the whole season while the people
 * next door grew out of a growing balance. These are the two places that was
 * decided: what a seat spends, and how much room operations builds.
 */
describe("a bot company that is growing", () => {
  const grown = company({ cash: 60_000_000, capacity: 900_000, customers: { commuters: 800_000 } as any });
  const small = company({ cash: 6_000_000, capacity: 250_000, customers: { commuters: 100_000 } as any });

  const spend = (c: Company, role: "cmo" | "cto" | "coo", previous?: any) =>
    Object.entries(botDecision({ ventureId: "v-growth", year: 4, role, company: c, previous }))
      .filter(([k]) => k.endsWith("Spend"))
      .reduce((sum, [, v]) => sum + (Number(v) || 0), 0);

  it("spends against the company it has now, not the one it had in year one", () => {
    for (const role of ["cmo", "cto", "coo"] as const) {
      // Last year's plan, from when the company was small, carried forward.
      const lastYear = botDecision({ ventureId: "v-growth", year: 3, role, company: small });
      expect(spend(grown, role, lastYear), role).toBeGreaterThan(spend(small, role, lastYear) * 2);
    }
  });

  it("never commits more than a quarter of the money it could raise", () => {
    const tight = company({ cash: 2_000_000, creditLimit: 1_000_000, debt: 1_000_000, customers: { commuters: 500_000 } as any });
    for (const role of ["cmo", "cto", "coo"] as const) {
      // The budget, plus at most the rounding each lever's own step adds.
      expect(spend(tight, role), role).toBeLessThanOrEqual(2_000_000 * 0.25 + 150_000);
    }
  });

  it("builds room for the customers it is serving, capped at half again a year", () => {
    const full = company({ capacity: 400_000, customers: { commuters: 400_000 } as any });
    const target = Number(botDecision({ ventureId: "v-growth", year: 5, role: "coo", company: full }).capacityTarget);
    expect(target, "more room than it is already filling").toBeGreaterThan(400_000);
    expect(target, "and not a factory it cannot pay for").toBeLessThanOrEqual(600_000);
  });

  it("stops the bleeding when the money is gone, whatever its appetite", () => {
    const broke = company({ cash: -2_000_000, customers: { commuters: 10_000 } as any });
    expect(botDecision({ ventureId: "v-growth", year: 6, role: "ceo", company: broke }).focus).toBe("survival");
  });

  it("gives two companies different appetites, and keeps each one's for the season", () => {
    expect(botAmbition("v1")).toBe(botAmbition("v1"));
    expect(botAmbition("v1")).not.toBe(botAmbition("v2"));
    for (const id of ["v1", "v2", "v3", "v4"]) {
      expect(botAmbition(id)).toBeGreaterThanOrEqual(0.75);
      expect(botAmbition(id)).toBeLessThanOrEqual(1.4);
    }
  });
});

/**
 * The auction. Nothing bid for the things on sale but the teams with a person
 * in the chief executive's chair, so a bot company never bought anything.
 */
describe("what a bot bids for", () => {
  const listing = (id: string, reserve: number, sellerId: string | null = null): Listing => ({
    id, reserve, sellerId, blurb: "A thing.",
    asset: { id: `ast_${id}`, kind: "distribution", name: `Lot ${id}`, effect: { capacity: 50_000 }, bookValue: reserve },
  });
  const listings = [listing("a", 1_000_000), listing("b", 2_000_000), listing("c", 3_000_000)];
  const rich = company({ cash: 40_000_000, creditLimit: 10_000_000, debt: 0 });

  it("bids, which is the whole point", () => {
    const bids = botBids({ ventureId: "v1", year: 2, company: rich, listings });
    expect(bids.length).toBeGreaterThan(0);
    for (const bid of bids) {
      const lot = listings.find((l) => l.id === bid.listingId)!;
      expect(bid.amount, "over the reserve, or it buys nothing").toBeGreaterThanOrEqual(lot.reserve);
      expect(bid.amount, "and not a number nobody could be outbid on").toBeLessThanOrEqual(lot.reserve * 2);
    }
  });

  it("bids for at most two things, and within what it could raise", () => {
    for (const id of ["v1", "v2", "v3", "v4", "v5"]) {
      const bids = botBids({ ventureId: id, year: 3, company: rich, listings });
      expect(bids.length).toBeLessThanOrEqual(2);
      const total = bids.reduce((sum, b) => sum + b.amount, 0);
      expect(total).toBeLessThanOrEqual(40_000_000 * 0.6 * 1.4);
      expect(new Set(bids.map((b) => b.listingId)).size, "never twice for one lot").toBe(bids.length);
    }
  });

  it("buys nothing while it is in the red, and nothing it is selling itself", () => {
    expect(botBids({ ventureId: "v1", year: 2, company: company({ cash: -1 }), listings })).toEqual([]);
    const own = [listing("mine", 1_000_000, "v1")];
    expect(botBids({ ventureId: "v1", year: 2, company: rich, listings: own })).toEqual([]);
  });

  it("bids the same numbers on a re-run, and different ones from the company next door", () => {
    const args = { year: 2, company: rich, listings };
    expect(botBids({ ventureId: "v1", ...args })).toEqual(botBids({ ventureId: "v1", ...args }));
    expect(botBids({ ventureId: "v1", ...args })).not.toEqual(botBids({ ventureId: "v2", ...args }));
  });
});
