/**
 * Is the game any good?
 *
 * Not "does the arithmetic run" — every other test file covers that. These run
 * whole seasons with genuinely different strategies, in every market, and ask
 * the questions that decide whether a fortnight of somebody's evenings was
 * worth spending:
 *
 *   - Can you win at all? An unwinnable game is a lecture.
 *   - Can you lose? A game you cannot lose is a slideshow.
 *   - Is there more than one way to play? If one strategy wins everywhere, the
 *     other four seats are decoration and the second season is the first one
 *     again.
 *   - Do the markets feel different? Four niches that reward the same plan are
 *     one niche with four names.
 *
 * These are slow and they are worth it: they are the only tests here that
 * would catch the simulation becoming boring, which is the failure that
 * actually loses players.
 */
import { describe, it, expect } from "vitest";
import { resolveYear } from "@shared/simulation/resolve";
import { buildWorld, economyFor, decisionsForYear, SEASON_YEARS } from "@shared/simulation/season";
import { NICHES, nicheById } from "@shared/simulation/niches";
import { ROLES, type Company, type Niche, type Role } from "@shared/simulation/types";
import type { TeamDecisions } from "@shared/simulation/decisions";

type Play = (year: number, company: Company, niche: Niche) => TeamDecisions | null;

/** Run one season of one strategy against the incumbents. */
function season(niche: Niche, play: Play, seasonId = "bal") {
  let world = buildWorld({ seasonId, niche, teams: [{ id: "t", name: "T", seats: [...ROLES] as Role[] }] });
  let previous: TeamDecisions | undefined;
  const history = [];

  for (let year = 1; year <= SEASON_YEARS; year++) {
    const company = world.companies.find((c) => c.id === "t")!;
    const chosen = play(year, company, niche);
    const submitted: Partial<Record<Role, any>> = {};
    if (chosen) for (const role of ROLES) if ((chosen as any)[role]) submitted[role] = (chosen as any)[role];

    const { decisions } = decisionsForYear({ company, niche, submitted, previous });
    const out = resolveYear({ ...world, year }, [decisions], economyFor(seasonId, year));
    world = out.world;
    if (chosen) previous = chosen;
    history.push(out.reports.find((r) => r.companyId === "t")!);
  }

  const final = history[history.length - 1];
  return {
    share: final.marketShare,
    profit: final.profit,
    cash: final.cash,
    bankrupt: history.some((h) => h.bankrupt),
    reputation: final.reputation,
    history,
  };
}

const cities = (niche: Niche, n: number) =>
  [...niche.cities].sort((a, b) => b.weight - a.weight).slice(0, n).map((c) => c.id);
const cheapest = (niche: Niche) => [...niche.segments].sort((a, b) => a.referencePrice - b.referencePrice)[0];
const dearest = (niche: Niche) => [...niche.segments].sort((a, b) => b.referencePrice - a.referencePrice)[0];

/** Spend everywhere, sell everywhere, take share and worry later. */
const grower: Play = (year, c, niche) => {
  const s = Math.round(Math.max(250_000, c.cash * 0.07));
  return {
    companyId: "t",
    cmo: { price: Math.round(dearest(niche).referencePrice * 0.55), brandSpend: s, performanceSpend: s, celebritySpend: 0, targetCities: cities(niche, Math.min(6, 1 + year)) },
    cto: { featureSpend: s, reliabilitySpend: s, techDebtPaydown: 0 },
    coo: { capacityTarget: Math.round(c.capacity * 1.35), supportSpend: s, efficiencySpend: 0, headcount: 6 },
    cfo: { borrow: 0, repay: 0, cashBuffer: 0 },
    ceo: { focus: "growth" },
  };
};

/** Be the best thing in the market and charge for it. One or two places, done properly. */
const premium: Play = (year, c, niche) => {
  const s = Math.round(Math.max(250_000, c.cash * 0.07));
  const target = dearest(niche);
  return {
    companyId: "t",
    cmo: { price: Math.round(target.referencePrice * 1.05), brandSpend: Math.round(s * 0.6), performanceSpend: 0, celebritySpend: 0, targetCities: cities(niche, 2) },
    cto: { featureSpend: Math.round(s * 0.5), reliabilitySpend: Math.round(s * 0.5), techDebtPaydown: 0, researchSpend: s },
    coo: { capacityTarget: Math.round(c.capacity * 1.1), supportSpend: s, efficiencySpend: 0, headcount: 4 },
    cfo: { borrow: 0, repay: 0, cashBuffer: 0 },
    ceo: { focus: "quality", positioning: target.id },
  };
};

/** Undercut everyone, take the price-sensitive end, live on volume. */
const cheap: Play = (year, c, niche) => {
  const s = Math.round(Math.max(200_000, c.cash * 0.05));
  const target = cheapest(niche);
  return {
    companyId: "t",
    cmo: { price: Math.max(2, Math.round(target.referencePrice * 0.8)), brandSpend: Math.round(s * 0.5), performanceSpend: s, celebritySpend: 0, targetCities: cities(niche, Math.min(6, 2 + year)) },
    cto: { featureSpend: Math.round(s * 0.3), reliabilitySpend: Math.round(s * 0.3), techDebtPaydown: 0 },
    coo: { capacityTarget: Math.round(c.capacity * 1.4), supportSpend: Math.round(s * 0.3), efficiencySpend: s, headcount: 5 },
    cfo: { borrow: 0, repay: 0, cashBuffer: 0 },
    ceo: { focus: "margin", positioning: target.id },
  };
};

/** One place, served properly, and never mind the rest of the country. */
const local: Play = (year, c, niche) => {
  const s = Math.round(Math.max(200_000, c.cash * 0.06));
  return {
    companyId: "t",
    cmo: { price: Math.round(dearest(niche).referencePrice * 0.7), brandSpend: s, performanceSpend: Math.round(s * 0.5), celebritySpend: 0, targetCities: cities(niche, 1) },
    cto: { featureSpend: Math.round(s * 0.6), reliabilitySpend: s, techDebtPaydown: 0 },
    coo: { capacityTarget: Math.round(c.capacity * 1.2), supportSpend: s, efficiencySpend: Math.round(s * 0.4), headcount: 3 },
    cfo: { borrow: 0, repay: 0, cashBuffer: 0 },
    ceo: { focus: "quality" },
  };
};

const idle: Play = () => null;

const STRATEGIES: { name: string; play: Play }[] = [
  { name: "grower", play: grower },
  { name: "premium", play: premium },
  { name: "cheap", play: cheap },
  { name: "local", play: local },
];

describe("can you win, and can you lose", () => {
  it("lets a competent team take real share in every market", () => {
    /*
     * "Real" is deliberately modest. The incumbents start with ninety per cent
     * and the brief wanted them to be a wall — but a wall with no door in it is
     * a lecture about how hard business is, not a game.
     */
    for (const niche of NICHES) {
      const best = Math.max(...STRATEGIES.map((s) => season(niche, s.play).share));
      expect(best, `nothing works in ${niche.id}`).toBeGreaterThan(0.05);
    }
  });

  it("does not let the market fall over", () => {
    /*
     * The other half of the same claim: a door, not a demolished wall.
     *
     * The bar is deliberately generous, and it is worth saying what it is and
     * is not guarding. These strategies are synthetic optima — fourteen
     * consecutive years of the right decision, no missed days, no arguments,
     * nobody on holiday. A run like that reaching about half the market is a
     * triumphant best case and should be allowed to happen. What must not
     * happen is a market that cannot hold at all, which is what this catches:
     * measured against the same strategies, an idle team gets under 2%, a
     * moderate one under 10%, and a strong one twenty to thirty.
     */
    for (const niche of NICHES) {
      const best = Math.max(...STRATEGIES.map((s) => season(niche, s.play).share));
      expect(best, `${niche.id} falls over too easily`).toBeLessThan(0.65);
    }
  });

  it("rewards playing over not playing, everywhere", () => {
    for (const niche of NICHES) {
      const lazy = season(niche, idle);
      const best = Math.max(...STRATEGIES.map((s) => season(niche, s.play).share));
      expect(best, `playing ${niche.id} well achieves nothing`).toBeGreaterThan(lazy.share * 2);
    }
  });

  it("leaves a team that never turns up still standing", () => {
    // The floor, checked in every market rather than only the first one.
    for (const niche of NICHES) {
      expect(season(niche, idle).bankrupt, `${niche.id} kills an idle team`).toBe(false);
    }
  });
});

describe("is there more than one way to play", () => {
  it("has no strategy that wins every market", () => {
    /*
     * The test this file exists for. One dominant plan means four of the five
     * seats are decoration, the second season is the first one again, and
     * there is nothing for a team to argue about — which is the entire
     * product.
     */
    const winners = NICHES.map((niche) => {
      const scored = STRATEGIES.map((s) => ({ name: s.name, share: season(niche, s.play).share }));
      return scored.sort((a, b) => b.share - a.share)[0].name;
    });
    expect(new Set(winners).size, `the same strategy won everywhere: ${winners.join(", ")}`).toBeGreaterThan(1);
  });

  it("makes every strategy viable somewhere", () => {
    // Not necessarily a winner — but never a joke. A plan that is hopeless in
    // all four markets is a plan nobody should have been offered.
    for (const strategy of STRATEGIES) {
      const bestForThem = Math.max(...NICHES.map((niche) => season(niche, strategy.play).share));
      expect(bestForThem, `${strategy.name} is hopeless everywhere`).toBeGreaterThan(0.03);
    }
  });

  it("makes the markets feel different from each other", () => {
    /*
     * Four niches that reward the same plan in the same order are one niche
     * with four names. Compared by how the strategies rank, not by absolute
     * numbers, because the interesting difference is which plan is *best*
     * here — not whether everybody scores higher.
     */
    const ranking = (niche: Niche) =>
      STRATEGIES
        .map((s) => ({ name: s.name, share: season(niche, s.play).share }))
        .sort((a, b) => b.share - a.share)
        .map((s) => s.name)
        .join(">");

    const orders = new Set(NICHES.map(ranking));
    expect(orders.size, "every market rewards exactly the same plan").toBeGreaterThan(1);
  });
});

describe("a season is a story, not a coin flip", () => {
  const niche = nicheById("fitness_app")!;

  it("takes years to build, so an early lead is not the whole game", () => {
    const out = season(niche, grower);
    const early = out.history[2].marketShare;
    const late = out.history[out.history.length - 1].marketShare;
    expect(late, "a good plan should still be growing at the end").toBeGreaterThan(early);
  });

  it("gives a different season to a different room", () => {
    // The weather is seeded per season, so two rooms playing identically still
    // live through different years. Otherwise every game has one answer.
    const a = season(niche, grower, "room-a");
    const b = season(niche, grower, "room-b");
    expect(a.history.map((h) => Math.round(h.customers))).not.toEqual(b.history.map((h) => Math.round(h.customers)));
  });

  it("does not let a good year run away with the season", () => {
    /*
     * Decay is what stops year two deciding year fourteen. A team that stops
     * playing after a strong start should fall back, or the game is over on
     * day three for everybody who did not start well.
     */
    const stopsEarly = season(niche, (year, c, n) => (year <= 4 ? grower(year, c, n) : null));
    const keepsGoing = season(niche, grower);
    expect(stopsEarly.share).toBeLessThan(keepsGoing.share);
  });
});
