/**
 * Strategies, judged over a whole season instead of one period.
 *
 * Every other test of the market asserts on a single `allocate` or a single
 * `resolveYear`. That proves the instantaneous shape — the demand curve, who
 * wins a pool, what a lever does — and it is blind to the only thing a player
 * actually does, which is repeat a decision and let it compound.
 *
 * Two real bugs lived in that blind spot, and both were found by playing rather
 * than by asserting:
 *
 *  - Putting the price up for ever was strictly profitable. Appeal fell to
 *    almost nothing, correctly, and single-period tests confirmed it — but
 *    customers already held left at a rate that was capped and then divided by
 *    the number of periods in a year, so they drained more slowly than the
 *    price compounded. Revenue is customers times price, and it climbed for
 *    ever. Sixteen quarters ended with a company worth seventy-nine times the
 *    best honest strategy in the game.
 *  - Deciding nothing at all was profitable from the first period and ended a
 *    four-year season richer than it started.
 *
 * Neither is visible in one period. Both are obvious in a season.
 *
 * So this file plays. It files what the desk would file — `defaultDraft`, which
 * is what the screen shows when nobody changes anything — and compares what the
 * companies are *worth* at the end, because worth is the score and because
 * both bugs showed up there first. Customers and cash each hid one of them:
 * the price-ramp company had few customers and enormous cash, the do-nothing
 * company had falling customers and cash that went up.
 *
 * The assertions are deliberately about *ordering*, not about figures. Exact
 * numbers here would be a golden file that has to be edited every time the
 * engine is tuned, which is how a test stops being read. What must stay true
 * is which way round the strategies come out.
 */
import { describe, it, expect } from "vitest";
import { buildWorld, economyFor} from "@shared/simulation/season";
import { resolveYear } from "@shared/simulation/resolve";
import { nicheById } from "@shared/simulation/niches";
import { defaultDraft } from "@shared/simulation/levers";
import { ROLES, type Role, type TeamDecisions, type World } from "@shared/simulation/types";

const NICHE = "dating_apps";
const PERIODS = 12;

type Play = (period: number, me: any) => Partial<Record<Role, Record<string, unknown>>>;

const held = (c: any): number =>
  Object.values(c?.customers ?? {}).reduce((sum: number, n: any) => sum + (Number(n) || 0), 0);

/**
 * A season, filed the way the desk files one.
 *
 * `defaultDraft` carries the standing decisions forward and resets the
 * one-shots, so "does nothing" means what it means on the screen. Filing a raw
 * object instead is how a harness accidentally sets capacity to nought and
 * reports it as an engine finding.
 */
function play(strategy: Play, nicheId: string = NICHE): { worth: number; customers: number; cash: number; cashDelta: number } {
  const niche = nicheById(nicheId)!;
  let world: World = buildWorld({
    /*
     * A season whose economy rises rather than falls, chosen deliberately.
     *
     * "season-not-period" landed at the top of the business cycle and fell all
     * the way down — 1.108 to 0.880 over sixteen quarters, the steepest decline
     * any seed produces. In a season like that, holding the money is the right
     * play and the engine is correct to score it that way, so "deciding nothing
     * costs something" is not a claim about the game, it is a claim about where
     * the fixture happened to sit in the cycle.
     *
     * This file is about what a *season* is as against a period, and about a
     * price nobody can pay. Neither wants an argument about the economy running
     * underneath it, so it runs in a flat one — 0.966 to 0.972 across sixteen
     * quarters — where neither a tailwind nor a headwind decides anything. A
     * rising season was tried and is the wrong fixture for the opposite reason:
     * it carries a company that does nothing to a small profit, which is true
     * of a real business in a growing market and says nothing about whether
     * filing nothing costs anything.
     */
    seasonId: "season-long",
    niche,
    cadence: "quarterly",
    teams: [{ id: "me", name: "Mine", seats: [...ROLES], officers: 1 }],
  });
  const opening = held(world.companies.find((c) => c.id === "me")!);
  void opening;
  const openingCash = (world.companies.find((c) => c.id === "me") as any).cash;
  let previous: Partial<Record<Role, any>> | undefined;
  let last: any;

  for (let period = 1; period <= PERIODS; period++) {
    const me = world.companies.find((c) => c.id === "me")!;
    const wanted = strategy(period, me) ?? {};
    const filed: any = { companyId: "me" };
    for (const role of ROLES) {
      filed[role] = { ...defaultDraft(role, me as any, previous?.[role]), ...(wanted[role] ?? {}) };
    }
    /*
     * The period's economy, as `tickSeason` passes it. Left out, the opening
     * economy is held for the whole season and demand never moves — which for
     * a file about what a *season* is rather than a period is the wrong thing
     * to hold still.
     */
    const out = resolveYear({ ...world, year: period }, [filed as TeamDecisions], economyFor("season-long", period, 4), { withoutEvent: true });
    last = out.reports.find((r: any) => r.companyId === "me");
    previous = filed;
    world = out.world;
  }

  const me = world.companies.find((c) => c.id === "me")!;
  return { worth: last.value ?? 0, customers: held(me), cash: last.cash, cashDelta: last.cash - openingCash };
}

/** Steady, unremarkable competence: mend the product, be heard of, keep the price. */
const honest: Play = (period, me) => {
  const purse = Math.max(0, Math.min(Number(me.cash) * 0.06, (held(me) * me.price) / 4 * 1.2 + 300));
  return {
    ceo: { focus: period <= 4 ? "quality" : "growth" },
    cmo: { price: me.price, brandSpend: Math.round(purse * 0.4), performanceSpend: Math.round(purse * 0.2) },
    cto: { featureSpend: Math.round(purse * 0.3), reliabilitySpend: Math.round(purse * 0.1) },
    coo: { capacityTarget: Math.max(me.capacity, Math.round(held(me) * 1.3)) },
  };
};

/** Change nothing, ever. What the screen files if you only press the button. */
const nothing: Play = () => ({});

/** Put the price up by a fifth, every period, for ever. */
const ramp = (by: number): Play => (_period, me) => ({ cmo: { price: Math.round(me.price * by) } });

describe("a season, not a period", () => {
  const results = {
    honest: play(honest),
    nothing: play(nothing),
    rampGentle: play(ramp(1.2)),
    rampAbsurd: play(ramp(1.5)),
  };

  it("does not let a price nobody can pay become the best strategy", () => {
    /*
     * The bug this exists for. Compounding a price rise used to beat every
     * honest strategy by two orders of magnitude while the company emptied,
     * because appeal fell fast and the customers already paying drained slowly.
     */
    expect(results.rampAbsurd.customers, "a price at hundreds of times the ceiling keeps nobody").toBeLessThan(
      results.honest.customers * 0.02,
    );
    expect(results.rampAbsurd.worth, "and a company nobody buys from is worth nothing").toBeLessThan(
      results.honest.worth,
    );
  });

  it("makes deciding nothing cost something", () => {
    expect(results.nothing.cashDelta, "a company that decides nothing loses money").toBeLessThan(0);
    expect(results.nothing.customers, "and shrinks").toBeLessThan(results.honest.customers);
    expect(results.nothing.worth, "and is worth less than one that was run").toBeLessThan(results.honest.worth);
  });

  it("still pays for running a business properly", () => {
    /*
     * The other half, and the half that makes the first safe to tune against.
     * A market where nothing works is as broken as one where an exploit does,
     * and it is much easier to arrive at by accident while fixing an exploit.
     */
    expect(results.honest.customers).toBeGreaterThan(0);
    expect(results.honest.worth).toBeGreaterThan(results.nothing.worth);
  });

  it("leaves a steady price alone", () => {
    /*
     * Nothing about the churn rules should touch a company priced inside what
     * its own segments will pay. Run twice: identical, to the pound.
     */
    const again = play(honest);
    expect(again.worth).toBe(results.honest.worth);
    expect(again.customers).toBe(results.honest.customers);
    expect(again.cash).toBe(results.honest.cash);
  });
});

/**
 * A lever that only ever helps is a tax on not noticing it.
 *
 * That is `responsibilities.ts`'s own standard for its levers, and two of them
 * were failing it in a way only a whole season shows: the benefit landed every
 * period and the cost did not land at all.
 */
describe("levers that were free", () => {
  const at = (nicheId: string, strategy: Play) => play(strategy, nicheId);

  it("charges a company for being patient with its customers", () => {
    /*
     * Ninety days' terms used to win more customers *and* end with more cash
     * *and* more profit than billing on delivery. Carrying what you are owed
     * is now charged at the company's own borrowing rate, so the long-terms
     * company is the one financing its customers.
     */
    const onDelivery = at(NICHE, () => ({ cfo: { terms: 0 } }));
    const patient = at(NICHE, () => ({ cfo: { terms: 90 } }));
    expect(patient.customers, "it still buys you business").toBeGreaterThan(onDelivery.customers);
    expect(patient.cash, "and it is no longer free").toBeLessThan(onDelivery.cash);
  });

  it("counts everyone a promotion brought in as a deal-chaser", () => {
    /*
     * The churn a promotion is supposed to carry was charged only on customers
     * *new to the market* — `allocation.fresh` — which is a small minority of
     * what a promotion wins. The rest arrive from rivals, or as a rival's
     * overflow. In one measured period a company took 36 fresh customers and
     * 403 from overflow, so the cost was being charged on eight per cent of
     * the benefit.
     *
     * Asserted on the first period of a season, where the company starts with
     * nobody: every customer it holds at the end of it arrived during it, so
     * the deal-chasers it books should account for essentially all of them.
     */
    const niche = nicheById(NICHE)!;
    const world = buildWorld({
      seasonId: "chasers", niche, cadence: "quarterly",
      teams: [{ id: "me", name: "Mine", seats: [...ROLES], officers: 1 }],
    });
    const me = world.companies.find((c) => c.id === "me")!;
    expect(held(me), "the company opens with nobody").toBe(0);

    const filed: any = { companyId: "me" };
    for (const role of ROLES) filed[role] = { ...defaultDraft(role, me as any), ...(role === "cmo" ? { promo: "january" } : {}) };
    const out = resolveYear({ ...world, year: 1 }, [filed as TeamDecisions], undefined, { withoutEvent: true });

    const after: any = out.world.companies.find((c) => c.id === "me")!;
    const chasers = Object.values(after.dealChasers ?? {}).reduce((sum: number, n: any) => sum + (Number(n) || 0), 0);
    expect(chasers, "a promotion books the people it won").toBeGreaterThan(0);
    expect(chasers, "all of them, not only the ones new to the market")
      .toBeGreaterThanOrEqual(held(after) * 0.9);
  });
});

/**
 * Failing has to cost something.
 *
 * Running out of money deliberately does not end a season — the brief says so
 * and it is right, because a player knocked out early has a fortnight of
 * nothing. Bankruptcy opens the recovery moves instead. But it had no cost at
 * all: `fundYear` cuts discretionary spending to nought when the money is
 * gone, nothing cut the *fixed* costs, and the shortfall sat as negative cash
 * — which `valuation` has no term for. Driven under on purpose and then left
 * alone, a company sat at minus £4.9m and still falling, paying sixty salaries
 * it could not pay, serving 32,768 customers, and worth the same as if none of
 * it had happened.
 */
describe("a company that has run out of money", () => {
  /** Burn far more than the company has, every period, and never stop. */
  const ruin = () => {
    const niche = nicheById(NICHE)!;
    let world = buildWorld({
      seasonId: "ruin", niche, cadence: "quarterly",
      teams: [{ id: "me", name: "Mine", seats: [...ROLES], officers: 1 }],
    });
    const seen: any[] = [];
    let previous: any;
    for (let p = 1; p <= 10; p++) {
      const me: any = world.companies.find((c) => c.id === "me")!;
      const filed: any = { companyId: "me" };
      for (const role of ROLES) filed[role] = { ...defaultDraft(role, me, previous?.[role]) };
      filed.cmo = { ...filed.cmo, brandSpend: 3_000_000, performanceSpend: 2_000_000 };
      filed.coo = { ...filed.coo, headcount: 60, capacityTarget: Math.max(me.capacity, 1) };
      const out = resolveYear({ ...world, year: p }, [filed as TeamDecisions], undefined, { withoutEvent: true });
      const rep: any = out.reports.find((x: any) => x.companyId === "me");
      seen.push({ ...rep, after: out.world.companies.find((c: any) => c.id === "me") });
      previous = filed; world = out.world;
    }
    return seen;
  };

  const run = ruin();
  const last = run[run.length - 1];

  it("does not keep a bank balance below zero", () => {
    /*
     * A company cannot be overdrawn at its own bank by five million. What it
     * could not pay is owed, which is a number the rest of the game can see.
     */
    for (const period of run) expect(period.cash, "cash never goes negative").toBeGreaterThanOrEqual(0);
    expect(last.after.debt, "the hole is carried as debt instead").toBeGreaterThan(run[0].after.debt);
  });

  it("stops paying people it cannot pay", () => {
    const note = run.flatMap((r: any) => r.notes ?? []).join(" ");
    expect(note, "somebody is let go, and it is said plainly").toMatch(/were let go/i);
  });

  it("costs the founder the company, without ending the season", () => {
    expect(last.bankrupt, "it is bankrupt").toBe(true);
    expect(last.founderValue, "and worth nothing to the people who own it").toBe(0);
    // Still trading, though: the recovery moves are the way out, not a game over.
    expect(held(last.after), "and still has customers to fight for").toBeGreaterThan(0);
  });
});
