/**
 * The founders' own time, which is the only lever that costs no money.
 *
 * Every other way to get better at something in this engine is bought: brand,
 * quality, service, a lower cost of serving. A company with nothing in the bank
 * could not improve at anything, which is wrong about the thing being
 * simulated — the first version of most products is built by the person who had
 * the idea, at night, for nothing.
 *
 * So there are action items, and four promises hold them together:
 *
 *   - **The allowance is the period.** One a month, two a quarter, three a
 *     year, enforced where filings are cleaned rather than only in the control.
 *   - **Only what the market offered.** An id nobody put on the list cannot buy
 *     three points of quality.
 *   - **It is spent when it is done.** The next period starts empty, so this
 *     stays a decision rather than a standing bonus.
 *   - **It matters most when you are poor.** The effects are flat points, not
 *     `atScale`d — decisive on an empty balance sheet, a rounding error against
 *     a real budget. That is the balance claim and it is measured below.
 */
import { describe, it, expect } from "vitest";
import {
  ACTION_SLOTS, WRITTEN_ACTIONS, actionsForPeriods, actionsPerPeriod,
  actionsTaken, founderEffects, founderPace, founderShare, foundersActions,
} from "@shared/simulation/actions";
import { cleanDecision, defaultDraft, offerActions, LEVER_FIELDS } from "@shared/simulation/levers";
import { buildWorld, economyFor } from "@shared/simulation/season";
import { resolveYear } from "@shared/simulation/resolve";
import { NICHES, nicheById } from "@shared/simulation/niches";
import { ROLES, type Company, type World } from "@shared/simulation/types";

const niche = nicheById("dating_apps")!;
const ALL = foundersActions(niche).map((a) => a.id);

describe("how many the founders can take on", () => {
  it("allows one a month, two a quarter and three a year", () => {
    /*
     * Not because founders are more productive in a yearly season — there is
     * simply more of it between decisions. A year in which they could only do
     * one thing would make the annual cadence a worse game than the monthly
     * one for no reason anybody could defend.
     */
    expect(actionsPerPeriod("monthly")).toBe(1);
    expect(actionsPerPeriod("quarterly")).toBe(2);
    expect(actionsPerPeriod("yearly")).toBe(3);
  });

  it("says the same thing when asked in periods, which is how the engine asks", () => {
    /*
     * `resolveYear` holds a count and not a cadence, so the rule lives in
     * `actionsForPeriods` and `actionsPerPeriod` delegates to it. Two copies of
     * this ladder would drift, and the drift would be a filing the cleaner
     * accepted and the engine ignored.
     */
    expect(actionsForPeriods(12)).toBe(actionsPerPeriod("monthly"));
    expect(actionsForPeriods(4)).toBe(actionsPerPeriod("quarterly"));
    expect(actionsForPeriods(1)).toBe(actionsPerPeriod("yearly"));
  });

  it("takes the allowance and no more, however many the filing names", () => {
    expect(actionsTaken(ALL, niche, 12)).toHaveLength(1);
    expect(actionsTaken(ALL, niche, 4)).toHaveLength(2);
    expect(actionsTaken(ALL, niche, 1)).toHaveLength(3);
  });

  it("counts the same action named twice once", () => {
    // A founder cannot do the same fortnight's work twice over.
    const twice = actionsTaken(["build", "build", "fix"], niche, 1);
    expect(twice.map((a) => a.id)).toEqual(["build", "fix"]);
  });

  it("drops an action the market never offered", () => {
    expect(actionsTaken(["not_a_real_action"], niche, 1)).toEqual([]);
  });
});

describe("the filing, cleaned", () => {
  const clean = (chosen: unknown, periods: number) =>
    cleanDecision("ceo", { focus: "growth", founderActions: chosen }, [], {
      year: 1, periods, actionIds: ALL,
    }).founderActions;

  it("caps a monthly filing at one however many it names", () => {
    /*
     * The allowance is a rule of the game and not a hint to the control. A
     * screen is one client; a script posting straight at the route is another,
     * and it would otherwise take nine free points of everything a month.
     */
    expect(clean(ALL, 12)).toHaveLength(1);
    expect(clean(ALL, 4)).toHaveLength(2);
    expect(clean(ALL, 1)).toHaveLength(3);
  });

  it("refuses an id the market did not put on the list", () => {
    expect(clean(["build", "invented"], 1)).toEqual(["build"]);
    // And nothing at all when nothing was offered, which is what a market
    // with no action list means.
    expect(cleanDecision("ceo", { focus: "growth", founderActions: ["build"] }, [], { year: 1, periods: 1 })
      .founderActions).toEqual([]);
  });

  it("reads a missing or malformed value as nothing chosen", () => {
    expect(clean(undefined, 1)).toEqual([]);
    expect(clean("build", 1)).toEqual([]);
    expect(clean(42, 1)).toEqual([]);
  });

  it("does not quietly take city ids, which is what it used to do", () => {
    /*
     * This lever began life as `kind: "cities"` to reuse the array handling,
     * and the cost of that was real: the web desk rendered London and
     * Manchester under "What you'll do yourself", and the cleaner filtered the
     * founders' work against the map. Its own kind, its own cleaner.
     */
    const cityIds = niche.cities.map((c) => c.id);
    expect(clean(cityIds, 1)).toEqual([]);
    const field = LEVER_FIELDS.ceo.find((f) => f.id === "founderActions");
    expect(field?.kind).toBe("actions");
  });
});

describe("it is spent when it is done", () => {
  it("starts the next period empty rather than carrying last period's work", () => {
    /*
     * Carried, the one lever that costs time would be the one lever nobody has
     * to choose: last month's fortnight would be re-done every month, free,
     * for ever.
     */
    const company = { id: "us", cities: [], capacity: 10, price: 10, positioning: "" } as unknown as Company;
    const carried = defaultDraft("ceo", company, { focus: "growth", founderActions: ["build", "fix"] } as never);
    expect(carried.founderActions).toEqual([]);
    expect(defaultDraft("ceo", company).founderActions).toEqual([]);
  });
});

describe("what the desk is offered", () => {
  it("says the choices in the market's own words, with the allowance on the field", () => {
    const base = LEVER_FIELDS.ceo.find((f) => f.id === "founderActions")!;
    const monthly = offerActions(base, niche, 12);
    expect(monthly.pick).toBe(1);
    expect(monthly.help).toContain("One a month");
    expect(monthly.options).toHaveLength(ACTION_SLOTS.length);
    /* Dating apps bring their own list, so the generic wording is gone. */
    expect(monthly.options?.map((o) => o.label)).toContain("Moderate the reports yourself");
    expect(offerActions(base, niche, 1).help).toContain("Three a year");
    expect(offerActions(base, niche, 4).pick).toBe(2);
  });

  it("leaves every other lever alone", () => {
    const price = LEVER_FIELDS.cmo.find((f) => f.id === "price")!;
    expect(offerActions(price, niche, 1)).toBe(price);
  });
});

describe("every market's written list", () => {
  /*
   * Placed by position, because each slot carries its own economics and the
   * result has no `kind` to re-key by. So the order is load-bearing, and a
   * list of eight would move "renegotiate what you pay" onto the hours worked.
   */
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
    /*
     * A blank name holds the position and takes the generic line — which is
     * the whole reason `cleanActions` pads rather than compacts. Compacted,
     * one missing entry slides every later one up and a market ends up with
     * the cost renegotiation's four per cent under "work the hours".
     */
    const half = [{ name: "Write the thing yourself" }, { name: "" }, { name: "" }, { name: "Pick up the phone" }];
    const said = foundersActions({ id: "custom", voice: niche.voice, actions: half });
    expect(said[0].name).toBe("Write the thing yourself");
    expect(said[1].name).toBe(ACTION_SLOTS[1].name);
    expect(said[3].name).toBe("Pick up the phone");
    expect(said[3].moves).toBe("service");
    expect(said[8]).toEqual(ACTION_SLOTS[8]);
  });
});

describe("what a period of founder work does", () => {
  it("adds points on the axis each action moves, and nothing on the others", () => {
    const quality = founderEffects(actionsTaken(["build"], niche, 1));
    expect(quality.quality).toBe(3);
    expect(quality.brand).toBe(0);
    expect(quality.unitCost).toBe(1);
    expect(quality.capacity).toBe(1);

    const bills = founderEffects(actionsTaken(["haggle"], niche, 1));
    expect(bills.unitCost).toBeLessThan(1);
    const hours = founderEffects(actionsTaken(["stretch"], niche, 1));
    expect(hours.capacity).toBeGreaterThan(1);
  });

  it("does nothing at all when nothing was chosen", () => {
    expect(founderEffects([])).toEqual({ quality: 0, brand: 0, service: 0, unitCost: 1, capacity: 1 });
  });
});

/**
 * One company, one plan, held for a season, with and without the founders'
 * own time. Nothing optimised: the question is what the lever is worth, and an
 * optimiser would find its own answer and hide the comparison.
 */
function play(actions: string[], spend: number, headcount: number): Company {
  const seasonId = "founder-actions";
  let world: World = buildWorld({
    seasonId, niche,
    teams: [{ id: "us", name: "Us", seats: [...ROLES] }],
    cadence: "quarterly",
  });
  /* Opened at £60,000, which is what somebody starting a business actually has. */
  world = {
    ...world,
    companies: world.companies.map((c) => (c.id === "us" ? { ...c, cash: 60_000 } : c)),
  };

  for (let p = 1; p <= 8; p++) {
    const us = world.companies.find((c) => c.id === "us");
    if (!us) break;
    const decision = {
      companyId: "us",
      cmo: { price: us.price, brandSpend: spend, performanceSpend: spend, celebritySpend: 0, targetCities: us.cities },
      cto: { featureSpend: spend, reliabilitySpend: spend, techDebtPaydown: 0 },
      coo: { capacityTarget: us.capacity, supportSpend: spend, efficiencySpend: 0, headcount },
      cfo: { borrow: 0, repay: 0, cashBuffer: 0 },
      ceo: { focus: "growth" as const, founderActions: actions },
    };
    world = resolveYear({ ...world, year: p }, [decision as never], economyFor(seasonId, p, 4)).world;
  }
  return world.companies.find((c) => c.id === "us")!;
}

const BEST = ["build", "serve"];

describe("the founders' share of the work", () => {
  it("is all of it when they are the company, and little of it once they have hired", () => {
    expect(founderShare(3, 0)).toBe(1);
    expect(founderShare(3, 5)).toBeGreaterThan(0.6);
    expect(founderShare(3, 20)).toBeLessThan(0.5);
    expect(founderShare(3, 500)).toBeLessThan(0.05);
  });

  it("never turns the lever off entirely, because the founders are still there", () => {
    expect(founderShare(3, 100_000)).toBeGreaterThan(0);
  });

  it("scales what every action does, and leaves doing nothing at nothing", () => {
    const whole = founderEffects(actionsTaken(BEST, niche, 1), 1);
    const tenth = founderEffects(actionsTaken(BEST, niche, 1), 0.1);
    expect(tenth.quality).toBeCloseTo(whole.quality * 0.1, 6);
    expect(tenth.service).toBeCloseTo(whole.service * 0.1, 6);
    expect(founderEffects(actionsTaken(["haggle", "stretch"], niche, 1), 0))
      .toEqual({ quality: 0, brand: 0, service: 0, unitCost: 1, capacity: 1 });
  });
});

describe("a year of it is a year of it, however often the table files", () => {
  /*
   * The bug this file found, and the reason `founderPace` exists.
   *
   * One a month, two a quarter and three a year are the right *counts* — they
   * are what was asked for and they make the decision the same shape at every
   * cadence. Counted straight they are not the same amount of work: twelve
   * action items a year against three, four times the labour out of the same
   * calendar. Measured at £60,000 over two years, the free lever was worth
   * +226% in dating apps and it carried two markets that otherwise went
   * bankrupt. After the pace fix: +8% to +84%, and the bankruptcies stayed.
   */
  it("gives the same year of founder labour at every cadence", () => {
    const yearOf = (periods: number) => actionsForPeriods(periods) * periods * founderPace(periods);
    expect(yearOf(1)).toBeCloseTo(yearOf(4), 6);
    expect(yearOf(4)).toBeCloseTo(yearOf(12), 6);
  });

  it("plays a yearly season at full strength, and scales the shorter periods down", () => {
    /*
     * The yearly season is the reference, so three actions in a year are worth
     * what they say on the slot. A monthly action is a quarter of one and a
     * quarterly action three eighths — which is also why the monthly control
     * offering one is not a worse deal than the yearly one offering three.
     */
    expect(founderPace(1)).toBe(1);
    expect(founderPace(4)).toBeCloseTo(0.375, 6);
    expect(founderPace(12)).toBeCloseTo(0.25, 6);
  });

  it("never scales it to nothing, whatever cadence somebody invents", () => {
    for (const periods of [1, 2, 3, 4, 6, 12, 52]) {
      expect(founderPace(periods), `${periods} periods`).toBeGreaterThan(0);
      expect(founderPace(periods), `${periods} periods`).toBeLessThanOrEqual(1);
    }
    /* And a nonsense cadence is read as a year rather than dividing by zero. */
    expect(Number.isFinite(founderPace(0))).toBe(true);
  });
});

describe("the balance claim", () => {
  /*
   * Measured rather than argued from the arithmetic, and the first version of
   * this failed — which is why `founderShare` exists.
   *
   * Written against *spend* to begin with: £0 a quarter against £300,000 a
   * quarter, both on a payroll of five. Two action items moved the funded
   * company 30.9% and the broke one 28.1%, the wrong way round. Flat points are
   * not enough on their own, because they are free and a funded company has
   * bought the awareness that converts them — quality nobody has heard of moves
   * nothing. What makes founder labour shrink is **hiring**, not having money,
   * so that is what this measures.
   */
  const aloneIdle = play([], 0, 0);
  const aloneWorks = play(BEST, 0, 0);
  const staffedIdle = play([], 0, 200);
  const staffedWorks = play(BEST, 0, 200);
  const funded = play([], 300_000, 0);

  const served = (c: Company) => Object.values(c.customers ?? {}).reduce((a, b) => a + Number(b), 0);
  const gain = (idle: Company, works: Company) => (served(works) - served(idle)) / Math.max(1, served(idle));
  const story = `founders alone ${served(aloneIdle)}→${served(aloneWorks)}, two hundred staff ${served(staffedIdle)}→${served(staffedWorks)}`;

  it("gets a company that is only its founders visibly further", () => {
    expect(aloneWorks.quality, story).toBeGreaterThan(aloneIdle.quality);
    expect(aloneWorks.service, story).toBeGreaterThan(aloneIdle.service);
    expect(served(aloneWorks), `founder work bought no customers at all: ${story}`)
      .toBeGreaterThan(served(aloneIdle));
  }, 120_000);

  it("is worth proportionally less to a company with two hundred people on the payroll", () => {
    /*
     * The point of the whole design: three people rewriting the onboarding is
     * the engineering department at nought staff and a rounding error at two
     * hundred. The same two actions, the same market, the same eight quarters.
     */
    expect(gain(aloneIdle, aloneWorks), `founder work was not worth more to the smaller company: ${story}`)
      .toBeGreaterThan(gain(staffedIdle, staffedWorks));
  }, 120_000);

  it("never outruns what money buys, so it is not a free win", () => {
    /*
     * The other half of balance. If a founder's fortnight beat a real budget
     * then spending would be pointless and the game would be a checklist.
     */
    expect(served(funded), `founder work alone beat a funded plan: ${story}, funded ${served(funded)}`)
      .toBeGreaterThan(served(aloneWorks));
  }, 120_000);
});
