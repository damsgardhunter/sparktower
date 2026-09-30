/**
 * Every market can be won by somebody playing competently.
 *
 * The other balance tests ask whether a lever is worth pulling or whether five
 * teams in one market end up somewhere reasonable. This asks the flatter
 * question underneath all of them, for every market in the catalogue and
 * across several season seeds: can a founder who plays sensibly build a
 * business here at all, or is this a market that cannot be played?
 *
 * It exists because three separate faults have now produced markets that could
 * not be, and none of them were visible from inside a single season:
 *
 *  - rivals seated holding more of a segment than it contained, so the unowned
 *    pool opened negative, clamped to zero, and a founder won **nothing** for
 *    sixteen quarters at every level of spending;
 *  - the same thing arriving through the economy, because rivals were seated
 *    against the size a market is written with while a segment only holds
 *    `size * demand` people;
 *  - an opening plant sized against the whole unowned pool of a region, whose
 *    idle cost was the largest line in a founder's accounts and bankrupted
 *    them in the markets with the thinnest margin per customer.
 *
 * Each was found by sweeping markets against seeds and noticing a column of
 * zeros. This is that sweep, kept.
 *
 * The three things asserted are deliberately the weakest interesting ones.
 * Whether a market is *fun* is not something a test can hold; whether it can be
 * played at all is.
 */
import { describe, it, expect } from "vitest";
import { buildWorld } from "@shared/simulation/season";
import { resolveYear } from "@shared/simulation/resolve";
import { defaultDraft } from "@shared/simulation/levers";
import { NICHES } from "@shared/simulation/niches";
import { ROLES, type Role, type TeamDecisions, type World } from "@shared/simulation/types";

const held = (c: any) => Object.values(c?.customers ?? {}).reduce((sum: number, n: any) => sum + Number(n || 0), 0);

/**
 * A season played the way somebody sensible would play it: quality first while
 * the company is small, growth once it has something to grow, capacity kept
 * ahead of what is served, and a steady share of the money spent each period.
 *
 * `rate` is that share. Nothing here is tuned to any particular market — the
 * point is that an ordinary competent plan works everywhere, not that a
 * market-specific one does.
 */
function play(niche: any, seasonId: string, rate: number, withEvents = false) {
  let world: World = buildWorld({
    seasonId, niche, cadence: "quarterly",
    teams: [{ id: "me", name: "Mine", seats: [...ROLES] as Role[], officers: 1 }],
  });
  let previous: any;
  let last: any;
  for (let period = 1; period <= 16; period++) {
    const me: any = world.companies.find((c) => c.id === "me")!;
    const spend = Math.max(0, Number(me.cash) * rate);
    const want: Record<string, any> = {
      ceo: { focus: period <= 6 ? "quality" : "growth" },
      cmo: { brandSpend: Math.round(spend * 0.25), performanceSpend: Math.round(spend * 0.15) },
      cto: { featureSpend: Math.round(spend * 0.2), reliabilitySpend: Math.round(spend * 0.2), researchSpend: Math.round(spend * 0.1) },
      coo: { capacityTarget: Math.max(Number(me.capacity) || 0, Math.round(held(me) * 2)), supportSpend: Math.round(spend * 0.1) },
    };
    const filed: any = { companyId: "me" };
    for (const role of ROLES) filed[role] = { ...defaultDraft(role, me, previous?.[role]), ...(want[role] ?? {}) };
    const out = resolveYear({ ...world, year: period }, [filed as TeamDecisions], undefined, withEvents ? {} : { withoutEvent: true });
    last = out.reports.find((r: any) => r.companyId === "me");
    previous = filed;
    world = out.world;
  }
  return {
    worth: last.value ?? last.founderValue ?? 0,
    customers: held(world.companies.find((c: any) => c.id === "me")),
    bankrupt: !!last.bankrupt,
  };
}

/* Three seeds spanning the economy's range: below trend, near it, and a boom. */
const SEEDS = ["w", "a", "h"];
/* Two honest rates. The best of them is what "played competently" means here. */
const RATES = [0.06, 0.12];

describe("every market can be won", () => {
  for (const niche of NICHES) {
    describe(niche.id, () => {
      /*
       * Run twice, because the year's events were never part of this.
       *
       * Everything measured about balance in this file, and every sweep behind
       * it, passed `withoutEvent: true` — so a season's recalls, shortages,
       * shocks and windfalls had never been exercised against the claim that a
       * market can be played. The first thing running it with them on found
       * was a recall costing a flat GBP 450,000 in markets whose founders open
       * with GBP 15,485, which is 29x everything they have.
       */
      const seasons = [false, true].flatMap((withEvents) => SEEDS.map((seed) => {
        const nothing = play(niche, seed, 0, withEvents);
        const best = RATES.map((rate) => play(niche, seed, rate, withEvents))
          .reduce((a, b) => (b.worth > a.worth ? b : a));
        return { seed: withEvents ? `${seed} (with the year's events)` : seed, nothing, best };
      }));

      it("gives a competent founder customers to win", () => {
        for (const { seed, best } of seasons) {
          expect(best.customers, `${niche.id} on seed "${seed}": won nobody in sixteen quarters`).toBeGreaterThan(0);
        }
      });

      it("does not bankrupt one for playing it", () => {
        for (const { seed, best } of seasons) {
          expect(best.bankrupt, `${niche.id} on seed "${seed}": the best plan tried still ended bankrupt`).toBe(false);
        }
      });

      it("pays better than filing nothing", () => {
        for (const { seed, best, nothing } of seasons) {
          expect(best.worth, `${niche.id} on seed "${seed}": playing well was worth no more than doing nothing`)
            .toBeGreaterThan(nothing.worth);
        }
      });
    });
  }
}, 600_000);
