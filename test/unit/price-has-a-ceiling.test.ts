/**
 * Charging more has to cost you something.
 *
 * The bug this exists to stop, reported by somebody playing: "I can just
 * forever increase the price of the product and I will gain customers rather
 * than lose them." Swept across every market, a company's customers fell as it
 * put its price up, and then stopped falling — and from there revenue was a
 * straight line, because nothing in the model had any opinion about a price of
 * twenty thousand for a thing whose market pays a hundred and sixty.
 *
 * ## Why it happened, since the reason is defensible and the result was not
 *
 * A segment's `priceCeiling` is what it will pay before it stops listening,
 * and both places that used it — the appeal penalty and the churn — applied it
 * only to a *tier*, a price aimed at one segment. The argument for that is
 * real: one list price has to sit somewhere across segments whose going rates
 * differ fifteenfold, so a company over its cheapest segment's ceiling is
 * positioning, not gouging, and the price curve in `appealFor` already judges
 * it.
 *
 * What the argument does not cover is a list price above *every* ceiling in
 * the market. That is not a compromise between segments; it is a price nobody
 * in the market will pay. It was the only unpriced move in the game.
 *
 * ## What is asserted here
 *
 * Not a particular curve — the tuning is allowed to move. Three things that
 * have to be true of any honest market, in every market the game ships:
 *
 *   1. past the last ceiling, more price means fewer customers;
 *   2. revenue has a peak, so there is a price worth finding;
 *   3. a price far past the ceiling is close to no business at all.
 */
import { describe, it, expect } from "vitest";
import { allocate } from "@shared/simulation/market";
import { topPriceCeiling } from "@shared/simulation/criteria";
import { buildWorld, economyFor } from "@shared/simulation/season";
import { NICHES } from "@shared/simulation/niches";
import { ROLES, type Niche } from "@shared/simulation/types";

/**
 * One market, built once, swept at several prices.
 *
 * `buildWorld` grows the written market to the size of the field, so the niche
 * the companies actually trade in is `world.niche` and not the one handed in.
 * The ceiling has to be read from the same place the allocation is, or the
 * sweep is measured against a market nobody is in.
 */
function market(niche: Niche) {
  const seasonId = `price-ceiling-${niche.id}`;
  const world = buildWorld({ seasonId, niche, teams: [{ id: "t1", name: "Mine", seats: [...ROLES] }] });
  const economy = economyFor(seasonId, 1);
  const me = world.companies.find((c) => c.kind === "player")!;
  const ceiling = topPriceCeiling(world.niche.segments, 1);
  const at = (price: number) => {
    const companies = world.companies.map((c) => (c.id === me.id ? { ...c, price } : c));
    const { held } = allocate(companies, world.niche, 1, economy, 1);
    const customers = Object.values(held[me.id] ?? {}).reduce((sum, n) => sum + n, 0);
    return { customers, revenue: customers * price };
  };
  return { ceiling, at };
}

describe("a price the market will not pay", () => {
  it.each(NICHES.map((n) => [n.name, n] as const))(
    "costs a company its customers in %s",
    (_name, niche) => {
      const { ceiling, at } = market(niche);
      expect(ceiling, "every market has a last price somebody will pay").toBeGreaterThan(0);

      /*
       * Measured past the last ceiling, where the answer is unambiguous.
       * Below it the curve is a matter of tuning and several segments pull
       * against each other; above it every segment in the market has been
       * asked for more than it will pay, and there is only one honest
       * direction for the line to go.
       */
      const atCeiling = at(Math.round(ceiling));
      const wellOver = at(Math.round(ceiling * 8));
      const absurd = at(Math.round(ceiling * 100));

      expect(wellOver.customers, "eight times the last ceiling has to cost customers")
        .toBeLessThan(atCeiling.customers);
      expect(absurd.customers, "and a hundred times it has to cost more still")
        .toBeLessThanOrEqual(wellOver.customers);
      /*
       * "Almost nobody", not "nobody". The allocator never empties a company
       * in a single year on purpose — a total collapse is not how markets
       * behave and it takes the game away from a team that could recover — so
       * the assertion is that the business is gone, not that the row is zero.
       */
      expect(absurd.customers).toBeLessThan(Math.max(1, atCeiling.customers * 0.1));
    },
  );

  it.each(NICHES.map((n) => [n.name, n] as const))(
    "leaves a best price to find in %s, rather than a straight line up",
    (_name, niche) => {
      const { ceiling, at } = market(niche);
      const prices = [0.1, 0.25, 0.5, 1, 2, 4, 8, 20, 60].map((m) => Math.max(1, Math.round(ceiling * m)));
      const revenues = prices.map((p) => at(p).revenue);

      const best = revenues.indexOf(Math.max(...revenues));
      expect(best, "the dearest price on the sweep must not be the best one")
        .toBeLessThan(prices.length - 1);
      /*
       * The point of the whole fix, stated as the thing a player experiences:
       * there is a price beyond which charging more earns less. Without it the
       * last entry was always the winner and "put the price up" was a move
       * with no downside.
       */
      expect(revenues[revenues.length - 1], "charging sixty times the ceiling must not be the best the company can do")
        .toBeLessThan(revenues[best]);
    },
  );
});
