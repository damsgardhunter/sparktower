/**
 * The founders' own week, which is the only lever that costs no money.
 *
 * Every other way to get better at something in this engine is bought: brand,
 * quality, service, standing, a lower cost of serving. A company with nothing
 * in the bank could not improve at anything, which is wrong about the thing
 * being simulated — the first version of most products is built by the person
 * who had the idea, at night, for nothing.
 *
 * Four promises hold it together, and each of them is here because an earlier
 * version broke it:
 *
 *   - **Sixty hours, split how you like.** It began as an allowance — one
 *     action a month, two a quarter, three a year — which taught the wrong
 *     thing: it asked which single thing you would do, when the decision is
 *     how to carve up a week that is already full.
 *   - **No two of them are the same decision.** The first set had three of
 *     nine moving quality and nothing at all moving reputation, so three
 *     different weeks of work were one choice wearing different words.
 *   - **A year of it is a year of it at every cadence.** Counted straight, one
 *     a month was twelve a year against three in a yearly season — four times
 *     the work out of the same calendar, worth +226% in dating apps when it
 *     was measured.
 *   - **It matters most when you are poor.** Flat points, diluted by the
 *     founders' share of the payroll: decisive on an empty balance sheet, a
 *     rounding error once there is a real team.
 */
import { describe, it, expect } from "vitest";
import {
  ACTION_SLOTS, HOURS_A_WEEK, WRITTEN_ACTIONS,
  founderEffects, founderShare, foundersActions, hoursTaken,
} from "@shared/simulation/actions";
import { cleanDecision, defaultDraft, offerActions, validateDecision, LEVER_FIELDS } from "@shared/simulation/levers";
import { buildWorld, economyFor } from "@shared/simulation/season";
import { resolveYear } from "@shared/simulation/resolve";
import { NICHES, nicheById } from "@shared/simulation/niches";
import { ROLES, type Company, type World } from "@shared/simulation/types";

const niche = nicheById("dating_apps")!;
const ALL = foundersActions(niche).map((a) => a.id);
const all = (hours: number) => Object.fromEntries(ALL.map((id) => [id, hours]));

describe("the week the founders have", () => {
  it("is sixty hours", () => {
    expect(HOURS_A_WEEK).toBe(60);
  });

  it("takes what was filed when it fits", () => {
    expect(hoursTaken({ build: 40, serve: 20 }, niche)).toEqual({ build: 40, serve: 20 });
  });

  it("scales a longer week back in proportion rather than truncating it", () => {
    /*
     * In proportion, not first-come: somebody who asks for forty hours on two
     * things meant an even split, and taking the first forty and discarding
     * the rest would be the engine choosing for them.
     */
    const got = hoursTaken({ build: 60, serve: 60 }, niche);
    expect(got.build).toBeCloseTo(30, 6);
    expect(got.serve).toBeCloseTo(30, 6);
    expect(Object.values(got).reduce((a, b) => a + b, 0)).toBeCloseTo(HOURS_A_WEEK, 6);
  });

  it("drops an action the market never offered", () => {
    expect(hoursTaken({ build: 10, not_a_real_action: 50 }, niche)).toEqual({ build: 10 });
  });

  it("reads negatives, nonsense and the wrong shape as no hours at all", () => {
    expect(hoursTaken({ build: -20 }, niche)).toEqual({});
    expect(hoursTaken({ build: "lots" }, niche)).toEqual({});
    expect(hoursTaken(["build"], niche)).toEqual({});
    expect(hoursTaken(undefined, niche)).toEqual({});
    expect(hoursTaken(null, niche)).toEqual({});
  });
});

describe("the filing, cleaned", () => {
  const clean = (filed: unknown) =>
    cleanDecision("ceo", { focus: "growth", founderHours: filed }, [], {
      year: 1, periods: 12, actionIds: ALL,
    }).founderHours;

  it("holds the week against a filing that claims more", () => {
    /*
     * The week is a rule of the game and not a hint to the control. A screen
     * is one client; a script posting straight at the route is another, and it
     * would otherwise work a five-hundred-hour week.
     */
    const got = clean(all(60)) as Record<string, number>;
    expect(Object.values(got).reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(HOURS_A_WEEK);
  });

  it("refuses an id the market did not put on the list", () => {
    expect(clean({ build: 30, invented: 30 })).toEqual({ build: 30 });
    /* And nothing at all when nothing was offered. */
    expect(cleanDecision("ceo", { focus: "growth", founderHours: { build: 30 } }, [], { year: 1, periods: 1 })
      .founderHours).toEqual({});
  });

  it("reads a missing or malformed value as no hours", () => {
    expect(clean(undefined)).toEqual({});
    expect(clean("build")).toEqual({});
    expect(clean(["build"])).toEqual({});
  });

  it("is accepted by the validator, which once refused it as a number", () => {
    /*
     * The hole the previous version shipped: the lever had a kind of its own
     * and `validateDecision` had no branch for it, so it fell through to the
     * numeric check and every filing that spent an hour on anything came back
     * "Needs a number."
     */
    const field = LEVER_FIELDS.ceo.find((f) => f.id === "founderHours")!;
    expect(field.kind).toBe("hours");
    const ok = validateDecision("ceo", { focus: "growth", founderHours: { build: 60 } }, { year: 1, periods: 12 } as never);
    expect(ok.errors.founderHours).toBeUndefined();
    const bad = validateDecision("ceo", { focus: "growth", founderHours: 12 }, { year: 1, periods: 12 } as never);
    expect(bad.errors.founderHours).toBeTruthy();
  });
});

describe("it is spent when it is worked", () => {
  it("starts the next period with the week unspoken for", () => {
    const company = { id: "us", cities: [], capacity: 10, price: 10, positioning: "" } as unknown as Company;
    const carried = defaultDraft("ceo", company, { focus: "growth", founderHours: { build: 60 } } as never);
    expect(carried.founderHours).toEqual({});
    expect(defaultDraft("ceo", company).founderHours).toEqual({});
  });
});

describe("what the desk is offered", () => {
  it("says the choices in the market's own words, with the week on the field", () => {
    const base = LEVER_FIELDS.ceo.find((f) => f.id === "founderHours")!;
    const monthly = offerActions(base, niche, 12);
    expect(monthly.hours).toBe(HOURS_A_WEEK);
    expect(monthly.help).toContain("60 hours a week");
    expect(monthly.options).toHaveLength(ACTION_SLOTS.length);
    expect(monthly.options?.map((o) => o.label)).toContain("Write the matching yourself");
  });

  it("leaves every other lever alone", () => {
    const price = LEVER_FIELDS.cmo.find((f) => f.id === "price")!;
    expect(offerActions(price, niche, 1)).toBe(price);
  });
});

describe("no two of them are the same decision", () => {
  it("covers every part of the company a founder could improve by hand", () => {
    /*
     * The complaint this answers, in the owner's words: they should not all do
     * the same thing. Reputation is the one that was missing outright — it
     * sets the credit line and what a shock costs, and no amount of a
     * founder's own effort could touch it.
     */
    const axes = new Set(ACTION_SLOTS.map((s) => s.moves));
    for (const axis of ["quality", "brand", "service", "reputation", "efficiency", "reach"]) {
      expect(axes.has(axis as never), `nothing a founder does moves ${axis}`).toBe(true);
    }
  });

  it("never puts more than two on the same axis", () => {
    const count: Record<string, number> = {};
    for (const slot of ACTION_SLOTS) count[slot.moves] = (count[slot.moves] ?? 0) + 1;
    for (const [axis, n] of Object.entries(count)) {
      expect(n, `${n} of the nine move ${axis}`).toBeLessThanOrEqual(2);
    }
  });

  it("makes promoting the business bring people in, not just awareness", () => {
    /*
     * The owner's point: a month spent promoting should end with new users and
     * the room to serve them. Brand alone raised how well known the company
     * was and left capacity untouched, so the customers it won were turned
     * away at the door.
     */
    const tell = ACTION_SLOTS.find((s) => s.id === "tell")!;
    expect(tell.moves).toBe("brand");
    expect(tell.also?.moves).toBe("reach");
    const got = founderEffects({ tell: HOURS_A_WEEK }, niche, 1);
    expect(got.brand).toBeGreaterThan(0);
    expect(got.capacity, "promoting did nothing for the room").toBeGreaterThan(1);
  });
});

describe("what a week of founder work does", () => {
  it("gives a whole week's worth to whatever gets the whole week", () => {
    const build = ACTION_SLOTS.find((s) => s.id === "build")!;
    expect(founderEffects({ build: HOURS_A_WEEK }, niche, 1).quality).toBeCloseTo(build.amount, 6);
  });

  it("splits it in proportion, so three things are three things done less well", () => {
    const whole = founderEffects({ build: HOURS_A_WEEK }, niche, 1).quality;
    const third = founderEffects({ build: HOURS_A_WEEK / 3, serve: HOURS_A_WEEK / 3, tell: HOURS_A_WEEK / 3 }, niche, 1);
    expect(third.quality).toBeCloseTo(whole / 3, 6);
    expect(third.service).toBeGreaterThan(0);
    expect(third.brand).toBeGreaterThan(0);
  });

  it("moves only the axes the chosen work is about", () => {
    const got = founderEffects({ build: HOURS_A_WEEK }, niche, 1);
    expect(got.quality).toBeGreaterThan(0);
    expect(got.brand).toBe(0);
    expect(got.reputation).toBe(0);
    expect(got.unitCost).toBe(1);
    expect(got.capacity).toBe(1);
  });

  it("does nothing at all when the week goes nowhere", () => {
    expect(founderEffects({}, niche, 1))
      .toEqual({ quality: 0, brand: 0, service: 0, reputation: 0, unitCost: 1, capacity: 1 });
  });
});

describe("a year of it is a year of it, however often the table files", () => {
  /*
   * The bug this found. One a month, two a quarter, three a year are sensible
   * *counts* and were not the same amount of work: twelve action items a year
   * against three. Measured at £60,000 over two years, the free lever was
   * worth +226% in dating apps and carried two markets that went bankrupt
   * without it. Each `amount` is now what a year of the whole week buys, and a
   * period takes its share.
   */
  const aYearOf = (periods: number) => {
    let quality = 0;
    for (let p = 0; p < periods; p++) quality += founderEffects({ build: HOURS_A_WEEK }, niche, periods).quality;
    return quality;
  };

  it("adds up to the same year at every cadence", () => {
    expect(aYearOf(1)).toBeCloseTo(aYearOf(4), 6);
    expect(aYearOf(4)).toBeCloseTo(aYearOf(12), 6);
  });

  it("pays a year of total dedication what the slot says it is worth", () => {
    const build = ACTION_SLOTS.find((s) => s.id === "build")!;
    expect(aYearOf(12)).toBeCloseTo(build.amount, 6);
  });

  it("never scales a period to nothing, whatever cadence somebody invents", () => {
    for (const periods of [1, 2, 3, 4, 6, 12, 52]) {
      expect(founderEffects({ build: HOURS_A_WEEK }, niche, periods).quality, `${periods}`).toBeGreaterThan(0);
    }
  });
});

describe("every market's written list", () => {
  it("has one entry per slot, in the slots' own order", () => {
    for (const [id, written] of Object.entries(WRITTEN_ACTIONS)) {
      expect(written, `${id} has the wrong number of actions`).toHaveLength(ACTION_SLOTS.length);
      for (const entry of written) expect(entry.name.length, `${id}: an unnamed action`).toBeGreaterThan(0);
    }
  });

  it("covers every built-in market, since these are the seasons already built", () => {
    for (const built of NICHES) {
      expect(WRITTEN_ACTIONS[built.id], `${built.id} has no action items`).toBeTruthy();
    }
  });

  it("keeps each slot's economics under the market's own name", () => {
    for (const built of NICHES) {
      const said = foundersActions(built);
      expect(said).toHaveLength(ACTION_SLOTS.length);
      said.forEach((action, i) => {
        expect(action.id, `${built.id}[${i}]`).toBe(ACTION_SLOTS[i].id);
        expect(action.moves, `${built.id}[${i}]`).toBe(ACTION_SLOTS[i].moves);
        expect(action.amount, `${built.id}[${i}]`).toBe(ACTION_SLOTS[i].amount);
        expect(action.name, `${built.id}[${i}] was not renamed`).toBe(WRITTEN_ACTIONS[built.id][i].name);
      });
    }
  });

  it("falls back to the generic wording for a market that brought no list", () => {
    const bare = { id: "nothing_written", voice: niche.voice, actions: undefined };
    expect(foundersActions(bare).map((a) => a.name)).toEqual(ACTION_SLOTS.map((s) => s.name));
  });

  it("keeps a slot's effect when a custom market only half-answered", () => {
    const half = [{ name: "Write the thing yourself" }, { name: "" }, { name: "Pick up the phone" }];
    const said = foundersActions({ id: "custom", voice: niche.voice, actions: half });
    expect(said[0].name).toBe("Write the thing yourself");
    expect(said[1].name).toBe(ACTION_SLOTS[1].name);
    expect(said[2].name).toBe("Pick up the phone");
    expect(said[2].moves).toBe(ACTION_SLOTS[2].moves);
    expect(said[8]).toEqual(ACTION_SLOTS[8]);
  });
});

describe("the founders' share of the work", () => {
  it("is all of it when they are the company, and little once they have hired", () => {
    expect(founderShare(3, 0)).toBe(1);
    expect(founderShare(3, 5)).toBeGreaterThan(0.6);
    expect(founderShare(3, 20)).toBeLessThan(0.5);
    expect(founderShare(3, 500)).toBeLessThan(0.05);
  });

  it("never turns the lever off entirely, because the founders are still there", () => {
    expect(founderShare(3, 100_000)).toBeGreaterThan(0);
  });

  it("scales the whole week, and nothing at nothing", () => {
    const whole = founderEffects({ build: HOURS_A_WEEK }, niche, 1, 1);
    const tenth = founderEffects({ build: HOURS_A_WEEK }, niche, 1, 0.1);
    expect(tenth.quality).toBeCloseTo(whole.quality * 0.1, 6);
    expect(founderEffects({ haggle: 30, stretch: 30 }, niche, 1, 0))
      .toEqual({ quality: 0, brand: 0, service: 0, reputation: 0, unitCost: 1, capacity: 1 });
  });
});

/**
 * One company, one plan held for eight quarters, with and without the week.
 * Nothing optimised: the question is what the lever is worth, and an optimiser
 * would find its own answer and hide the comparison.
 */
function play(hours: Record<string, number>, headcount: number): Company {
  const seasonId = "founder-hours";
  let world: World = buildWorld({
    seasonId, niche,
    teams: [{ id: "us", name: "Us", seats: [...ROLES] }],
    cadence: "quarterly",
  });
  /* Opened at £60,000, which is what somebody starting a business actually has. */
  world = { ...world, companies: world.companies.map((c) => (c.id === "us" ? { ...c, cash: 60_000 } : c)) };

  for (let p = 1; p <= 8; p++) {
    const us = world.companies.find((c) => c.id === "us");
    if (!us) break;
    world = resolveYear({ ...world, year: p }, [{
      companyId: "us",
      cmo: { price: us.price, brandSpend: 0, performanceSpend: 0, celebritySpend: 0, targetCities: us.cities },
      cto: { featureSpend: 0, reliabilitySpend: 0, techDebtPaydown: 0 },
      coo: { capacityTarget: us.capacity, supportSpend: 0, efficiencySpend: 0, headcount },
      cfo: { borrow: 0, repay: 0, cashBuffer: 0 },
      ceo: { focus: "growth" as const, founderHours: hours },
    } as never], economyFor(seasonId, p, 4)).world;
  }
  return world.companies.find((c) => c.id === "us")!;
}

const BEST = { build: 30, serve: 30 };

describe("the balance claim", () => {
  const aloneIdle = play({}, 0);
  const aloneWorks = play(BEST, 0);
  const staffedIdle = play({}, 200);
  const staffedWorks = play(BEST, 200);

  const served = (c: Company) => Object.values(c.customers ?? {}).reduce((a, b) => a + Number(b), 0);
  const gain = (idle: Company, works: Company) => (served(works) - served(idle)) / Math.max(1, served(idle));
  const story = `alone ${served(aloneIdle)}→${served(aloneWorks)}, two hundred staff ${served(staffedIdle)}→${served(staffedWorks)}`;

  it("gets a company that is only its founders visibly further", () => {
    expect(aloneWorks.quality, story).toBeGreaterThan(aloneIdle.quality);
    expect(aloneWorks.service, story).toBeGreaterThan(aloneIdle.service);
    expect(served(aloneWorks), `the week bought no customers at all: ${story}`)
      .toBeGreaterThan(served(aloneIdle));
  }, 120_000);

  it("is worth proportionally less to a company with two hundred people on the payroll", () => {
    /*
     * The point of the whole design: three people rewriting the onboarding is
     * the engineering department at nought staff and a rounding error at two
     * hundred.
     */
    expect(gain(aloneIdle, aloneWorks), `the week was not worth more to the smaller company: ${story}`)
      .toBeGreaterThan(gain(staffedIdle, staffedWorks));
  }, 120_000);
});
