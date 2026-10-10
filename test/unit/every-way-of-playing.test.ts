/**
 * Every market has a route for every kind of player.
 *
 * `every-market-winnable.test.ts` asks whether *a* competent founder can build
 * something. That is the floor, and it is not the same question as whether the
 * market is worth entering for the person you actually are. A market where only
 * one approach works is a market with one answer, and a game of five seats whose
 * answer is always the same is a puzzle somebody solves once.
 *
 * So this walks the archetypes — undercut, go premium, lead on product, grow
 * hard, spend out of revenue, price by segment, keep your powder dry — and
 * insists each of them gets somewhere in every market.
 *
 * Two things it is deliberately *not* asking.
 *
 * It does not ask that every approach do equally well. A market should reward
 * some shapes over others; that is what makes it a market rather than a dial.
 * The bar is a quarter of what the best approach manages, which is "behind, and
 * still playing" rather than "locked out".
 *
 * And it lets each archetype choose how hard it spends. Fixing the rate turns a
 * test of a *strategy* into a test of a number: the first version of this
 * measurement had premium reaching 1% of the best in construction, and the cause
 * was that premium had been written as a single list price at nine tenths of the
 * dearest segment — 12,600 charged to a market whose biggest segment pays 900.
 * That is not a premium strategy, it is a mistake with a strategy's name on it.
 * Tiers are what the engine gives you for pricing by segment, and they arrive in
 * year two for exactly this reason.
 */
import { describe, it, expect } from "vitest";
import { buildWorld, economyFor } from "@shared/simulation/season";
import { resolveYear } from "@shared/simulation/resolve";
import { defaultDraft } from "@shared/simulation/levers";
import { NICHES } from "@shared/simulation/niches";
import { ROLES, type Role, type TeamDecisions, type World, type Niche } from "@shared/simulation/types";

const held = (c: any) => Object.values(c?.customers ?? {}).reduce((sum: number, n: any) => sum + Number(n || 0), 0);
/** Room for what is served plus a margin — grown freely, cut by at most a fifth a period. */
const room = (me: any, mult: number) => {
  const want = Math.round(Math.max(held(me), 1) * mult);
  const now = Math.max(0, Number(me.capacity) || 0);
  return Math.max(want > now ? want : Math.max(want, Math.round(now * 0.8)), 1);
};
const dearest = (n: Niche) => [...n.segments].sort((a, b) => b.referencePrice - a.referencePrice)[0];
const tiersAt = (n: Niche, mult: number) =>
  Object.fromEntries(n.segments.map((s) => [s.id, Math.max(1, Math.round(s.referencePrice * mult))]));

/** Seven ways somebody might actually play, each able to spend harder or softer. */
const WAYS: Record<string, (me: any, n: Niche, k: number, period: number) => Record<string, unknown>> = {
  frugal: (me, _n, k) => ({ ceo: { focus: "quality" }, cmo: { brandSpend: me.cash * 0.01 * k * 0.4 }, cto: { featureSpend: me.cash * 0.01 * k * 0.4 }, coo: { capacityTarget: room(me, 1.5) } }),
  grower: (me, _n, k, p) => ({ ceo: { focus: p <= 6 ? "quality" : "growth" }, cmo: { brandSpend: me.cash * 0.06 * k * 0.35, performanceSpend: me.cash * 0.06 * k * 0.25 }, cto: { featureSpend: me.cash * 0.06 * k * 0.2 }, coo: { capacityTarget: room(me, 2) } }),
  premium: (me, n, k) => ({ ceo: { focus: "quality", positioning: dearest(n).id }, cmo: { tiers: tiersAt(n, 1.1), brandSpend: me.cash * 0.05 * k * 0.3 }, cto: { featureSpend: me.cash * 0.05 * k * 0.4, reliabilitySpend: me.cash * 0.05 * k * 0.2 }, coo: { capacityTarget: room(me, 1.6) } }),
  undercut: (me, n, k) => ({ ceo: { focus: "growth" }, cmo: { tiers: tiersAt(n, 0.82), performanceSpend: me.cash * 0.05 * k * 0.5 }, cto: { featureSpend: me.cash * 0.05 * k * 0.2 }, coo: { capacityTarget: room(me, 2.5), efficiencySpend: me.cash * 0.05 * k * 0.3 } }),
  product: (me, _n, k) => ({ ceo: { focus: "quality" }, cmo: { brandSpend: me.cash * 0.05 * k * 0.15 }, cto: { featureSpend: me.cash * 0.05 * k * 0.45, reliabilitySpend: me.cash * 0.05 * k * 0.25, researchSpend: me.cash * 0.05 * k * 0.15 }, coo: { capacityTarget: room(me, 1.8) } }),
  bySegment: (me, n, k, p) => ({ ceo: { focus: p <= 6 ? "quality" : "growth" }, cmo: { tiers: tiersAt(n, 1), brandSpend: me.cash * 0.05 * k * 0.3, performanceSpend: me.cash * 0.05 * k * 0.2 }, cto: { featureSpend: me.cash * 0.05 * k * 0.25 }, coo: { capacityTarget: room(me, 1.8) } }),
  outOfRevenue: (me, _n, k, p) => {
    const b = Math.max(me.cash * 0.004, (me.lastRevenue ?? 0) * 0.45) * k;
    return { ceo: { focus: p <= 6 ? "quality" : "growth" }, cmo: { brandSpend: b * 0.3, performanceSpend: b * 0.2 }, cto: { featureSpend: b * 0.25, reliabilitySpend: b * 0.15 }, coo: { capacityTarget: room(me, 1.8) } };
  },
};

const SEEDS = ["a", "q", "y"];
/** How hard each way of playing spends, so an archetype is tested rather than a rate. */
const EFFORT = [0.5, 2];

function playSeason(niche: Niche, seasonId: string, way: string, k: number) {
  let world: World = buildWorld({
    seasonId, niche, cadence: "quarterly",
    teams: [{ id: "me", name: "Mine", seats: [...ROLES] as Role[], officers: 1 }],
  });
  let previous: any;
  let last: any;
  let profitable = 0;
  for (let period = 1; period <= 16; period++) {
    const me: any = world.companies.find((c) => c.id === "me")!;
    me.lastRevenue = last?.revenue ?? 0;
    const want = WAYS[way](me, niche, k, period);
    const filed: any = { companyId: "me" };
    for (const role of ROLES) {
      const chosen = (want[role] ?? {}) as Record<string, number>;
      const rounded = Object.fromEntries(Object.entries(chosen).map(([key, v]) => [key, typeof v === "number" ? Math.round(v) : v]));
      filed[role] = { ...defaultDraft(role, me, previous?.[role]), ...rounded };
    }
    const out = resolveYear({ ...world, year: period }, [filed as TeamDecisions], economyFor(seasonId, period, 4), {});
    last = out.reports.find((r: any) => r.companyId === "me");
    if (last.profit > 0) profitable++;
    previous = filed;
    world = out.world;
  }
  return { worth: last.value ?? 0, profitable, bankrupt: !!last.bankrupt };
}

/** An archetype's result in a market: its best effort level, median across the seeds. */
const resultOf = (niche: Niche, way: string) => {
  const atEffort = EFFORT.map((k) => {
    const runs = SEEDS.map((seed) => playSeason(niche, seed, way, k));
    const worths = runs.map((r) => r.worth).sort((a, b) => a - b);
    return { worth: worths[1], profitable: Math.max(...runs.map((r) => r.profitable)), bankrupt: runs.every((r) => r.bankrupt) };
  });
  return atEffort.reduce((best, r) => (r.worth > best.worth ? r : best));
};

/**
 * Is any one way of playing simply the best way, nearly everywhere?
 *
 * `balance.test.ts` guards against a dominant plan already — "has no strategy that
 * wins every market" — but it asks the question of four hand-written strategies
 * and passes as soon as **two** different ones win something. That is a test
 * against a plan winning *all seven*, and it cannot see concentration: measured
 * across the seven ways of playing here, `undercut` is the best in **five of the
 * seven markets**, with `premium` taking construction and `grower` taking MMOs,
 * and the existing guard reads that as three distinct winners and passes
 * comfortably.
 *
 * Whether five of seven is too many is a judgement about the product rather than
 * a bug, and this does not assert a stricter standard than the product has
 * chosen. What it does is stop it getting worse: the figure is pinned where it is
 * so that a change which makes one approach best in six or seven markets fails
 * here, with the count in the message.
 *
 * The companion claim — that nobody is *locked out* — is the per-market block
 * below, and it holds: every way of playing reaches between 29% and 100% of the
 * best, in every market.
 */
describe("whether one way of playing is best nearly everywhere", () => {
  it("has no approach that is the best in more than five of the seven markets", () => {
    const winners = NICHES.map((niche) => {
      const scored = Object.keys(WAYS).map((w) => ({ way: w, worth: resultOf(niche, w).worth }));
      return scored.sort((a, b) => b.worth - a.worth)[0].way;
    });
    const counts = new Map<string, number>();
    for (const w of winners) counts.set(w, (counts.get(w) ?? 0) + 1);
    const [best, times] = [...counts].sort((a, b) => b[1] - a[1])[0];
    expect(times, `${best} is the best way to play in ${times} of ${NICHES.length} markets: ${winners.join(", ")}`)
      .toBeLessThanOrEqual(5);
  }, 600_000);

  it("has at least three different approaches winning something", () => {
    /*
     * The other end of the same measurement, and stronger than the "more than
     * one" it is standing next to: three distinct winners is what the markets
     * currently produce, so three is what a change must not take away.
     */
    const winners = NICHES.map((niche) => {
      const scored = Object.keys(WAYS).map((w) => ({ way: w, worth: resultOf(niche, w).worth }));
      return scored.sort((a, b) => b.worth - a.worth)[0].way;
    });
    expect(new Set(winners).size, `only ${new Set(winners).size} approaches win anything: ${winners.join(", ")}`)
      .toBeGreaterThanOrEqual(3);
  }, 600_000);
});

describe("every way of playing has a route", () => {
  for (const niche of NICHES) {
    describe(niche.id, () => {
      const results = Object.fromEntries(Object.keys(WAYS).map((w) => [w, resultOf(niche, w)]));
      const top = Math.max(...Object.values(results).map((r) => r.worth));

      it("leaves nobody bankrupt for the way they chose to play", () => {
        for (const [way, r] of Object.entries(results)) {
          expect(r.bankrupt, `${niche.id}: playing it ${way} went bankrupt on every seed and effort tried`).toBe(false);
        }
      });

      it("gives every way of playing a profitable quarter", () => {
        for (const [way, r] of Object.entries(results)) {
          expect(r.profitable, `${niche.id}: playing it ${way} never had a quarter that paid for itself`).toBeGreaterThan(0);
        }
      });

      it("leaves nobody locked out of the market", () => {
        /*
         * A quarter of what the best approach manages. Behind is fine and is the
         * point — equal would mean the market had no shape. Near nothing is not:
         * it means the market has one answer and everybody else is playing the
         * wrong game.
         */
        for (const [way, r] of Object.entries(results)) {
          expect(r.worth / Math.max(1, top), `${niche.id}: playing it ${way} reached only ${((r.worth / Math.max(1, top)) * 100).toFixed(0)}% of the best way to play it`)
            .toBeGreaterThan(0.25);
        }
      });
    });
  }
}, 600_000);
