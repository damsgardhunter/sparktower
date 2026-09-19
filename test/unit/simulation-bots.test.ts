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
  BOT_FILL_AFTER_SECONDS, BOT_JITTER, botDecision, botDisplayName, botIdentity,
  botsForVenture, botsNeeded, decisionSeed, jitter,
  botCapacity,
} from "@shared/simulation/bots";
import { LEVER_FIELDS, cleanDecision, defaultDraft, validateDecision } from "@shared/simulation/levers";
import { nextPhase } from "@shared/simulation/lobby";
import { ROLES } from "@shared/simulation/types";
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
    // Every year, since levers arrive over the season and a bot must file only what it has.
    for (const year of [1, 2, 3, 4, 5]) for (const role of ROLES) {
      const d = botDecision({ ventureId: "v1", year, role, company: company() });
      const clean = cleanDecision(role, d, [], { year });
      expect(clean, `${role} in year ${year} loses something on the way in`).toEqual(d);
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

  it("trims only a mostly idle company, and gently", () => {
    const idle = company({ capacity: 500_000, customers: { swipers: 100_000 } as any, assets: [] });
    for (let i = 0; i < 50; i++) {
      const v = botCapacity({ seed: `i${i}`, company: idle, step: 10_000 });
      expect(v).toBeLessThanOrEqual(500_000);
      expect(v).toBeGreaterThanOrEqual(450_000);
    }
  });
});
