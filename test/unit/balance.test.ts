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
import { botDecision, type BotSkill } from "@shared/simulation/bots";
import { resolveYear } from "@shared/simulation/resolve";
import { forecastDemand } from "@shared/simulation/forecast";
import { buildWorld, economyFor, decisionsForYear, SEASON_YEARS } from "@shared/simulation/season";
import { NICHES, nicheById } from "@shared/simulation/niches";
import { marketPotential } from "@shared/simulation/world";
import { ROLES, type Company, type Niche, type Role, type World } from "@shared/simulation/types";
import type { TeamDecisions } from "@shared/simulation/decisions";

type Play = (year: number, company: Company, niche: Niche, world: World) => TeamDecisions | null;

/*
 * Capacity sized against the forecast, the way a competent operations seat now
 * has to size it.
 *
 * These strategies used to grow capacity by a fixed ten to forty per cent a
 * year, compounding — thirty-odd times the opening figure by year fourteen.
 * That was harmless while capacity was free, and it is ruinous now that idle
 * headroom is paid for, which is the whole point of charging for it. A
 * strategy that ignores the forecast is not a strategy any real team would
 * run, so it is not a fair test of whether the market can be won.
 *
 * `headroom` is each strategy's appetite for risk: the grower builds for a
 * good year, the premium house for an ordinary one.
 */
function sizeTo(world: World, year: number, d: TeamDecisions, headroom: number): TeamDecisions {
  /*
   * For next year, because that is when it opens (see `lag.ts`). A strategy
   * that sized to this year's demand was a year short every year of the
   * season, which is not a strategy a competent operations seat plays — and
   * it made the balance of the market look like the balance of that mistake.
   */
  const f = forecastDemand({ world: { ...world, year: year + 1 }, companyId: d.companyId, year: year + 1, economy: world.economy, draft: d });
  if (!f || !d.coo) return d;
  return { ...d, coo: { ...d.coo, capacityTarget: Math.max(1_000, Math.round(f.likely * headroom)) } };
}

/** Run one season of one strategy against the incumbents. */
function season(niche: Niche, play: Play, seasonId = "bal") {
  let world = buildWorld({ seasonId, niche, teams: [{ id: "t", name: "T", seats: [...ROLES] as Role[] }] });
  let previous: TeamDecisions | undefined;
  const history = [];
  let marketRevenue = 0;

  for (let year = 1; year <= SEASON_YEARS; year++) {
    const company = world.companies.find((c) => c.id === "t")!;
    const chosen = play(year, company, niche, world);
    const submitted: Partial<Record<Role, any>> = {};
    if (chosen) for (const role of ROLES) if ((chosen as any)[role]) submitted[role] = (chosen as any)[role];

    const { decisions } = decisionsForYear({ company, niche, submitted, previous });
    const out = resolveYear({ ...world, year }, [decisions], economyFor(seasonId, year));
    world = out.world;
    if (chosen) previous = chosen;
    history.push(out.reports.find((r) => r.companyId === "t")!);
    marketRevenue = out.reports.reduce((sum, r) => sum + r.revenue, 0);
  }

  const final = history[history.length - 1];
  return {
    share: final.marketShare,
    /** Share of the money in the market, rather than of the heads in it. */
    revenueShare: marketRevenue > 0 ? final.revenue / marketRevenue : 0,
    /*
     * What the league table actually ranks by. Share is still checked — a
     * market that falls over is a market that falls over — but "which strategy
     * wins" has to be asked in the currency the game scores in, or these tests
     * go on measuring a scoreboard the product stopped using.
     */
    value: final.founderValue,
    profit: final.profit,
    cash: final.cash,
    bankrupt: history.some((h) => h.bankrupt),
    reputation: final.reputation,
    history,
  };
}

/*
 * The broad strategies open as far as the market goes; the focused ones stay
 * deliberately narrow, which is their whole identity. The caps used to be the
 * literal 6, which was "everywhere" when every market had six regions and
 * became "most of it" when they grew to ten.
 */
const cities = (niche: Niche, n: number) =>
  [...niche.cities].sort((a, b) => b.weight - a.weight).slice(0, n).map((c) => c.id);

/**
 * The biggest regions for one segment rather than the biggest regions.
 *
 * Regions differ in who lives in them (`City.mix`), so a company selling to
 * one segment picks its places by where those people are. A national play
 * still takes the biggest; a focused one that ignored the difference would be
 * a strategy nobody would actually run.
 */
const citiesFor = (niche: Niche, segmentId: string, n: number) =>
  [...niche.cities]
    .sort((a, b) => b.weight * (b.mix?.[segmentId] ?? 1) - a.weight * (a.mix?.[segmentId] ?? 1))
    .slice(0, n)
    .map((c) => c.id);
const cheapest = (niche: Niche) => [...niche.segments].sort((a, b) => a.referencePrice - b.referencePrice)[0];
const dearest = (niche: Niche) => [...niche.segments].sort((a, b) => b.referencePrice - a.referencePrice)[0];

/** Spend everywhere, sell everywhere, take share and worry later. */
const grower: Play = (year, c, niche, world) => sizeTo(world, year, (() => {
  const s = Math.round(Math.max(250_000, c.cash * 0.07));
  return {
    companyId: c.id,
    cmo: { price: Math.round(dearest(niche).referencePrice * 0.55), brandSpend: s, performanceSpend: s, celebritySpend: 0, targetCities: cities(niche, Math.min(niche.cities.length, 1 + year)) },
    cto: { featureSpend: s, reliabilitySpend: s, techDebtPaydown: 0 },
    coo: { capacityTarget: Math.round(c.capacity * 1.35), supportSpend: s, efficiencySpend: 0, headcount: 6 },
    cfo: { borrow: 0, repay: 0, cashBuffer: 0 },
    ceo: { focus: "growth" },
  };
})(), 1.25);

/** Be the best thing in the market and charge for it. One or two places, done properly. */
const premium: Play = (year, c, niche, world) => sizeTo(world, year, (() => {
  const s = Math.round(Math.max(250_000, c.cash * 0.07));
  const target = dearest(niche);
  return {
    companyId: c.id,
    cmo: { price: Math.round(target.referencePrice * 1.05), brandSpend: Math.round(s * 0.6), performanceSpend: 0, celebritySpend: 0, targetCities: citiesFor(niche, target.id, 2) },
    cto: { featureSpend: Math.round(s * 0.5), reliabilitySpend: Math.round(s * 0.5), techDebtPaydown: 0, researchSpend: s },
    coo: { capacityTarget: Math.round(c.capacity * 1.1), supportSpend: s, efficiencySpend: 0, headcount: 4 },
    cfo: { borrow: 0, repay: 0, cashBuffer: 0 },
    ceo: { focus: "quality", positioning: target.id },
  };
})(), 1.05);

/** Undercut everyone, take the price-sensitive end, live on volume. */
const cheap: Play = (year, c, niche, world) => sizeTo(world, year, (() => {
  const s = Math.round(Math.max(200_000, c.cash * 0.05));
  const target = cheapest(niche);
  return {
    companyId: c.id,
    cmo: { price: Math.max(2, Math.round(target.referencePrice * 0.8)), brandSpend: Math.round(s * 0.5), performanceSpend: s, celebritySpend: 0, targetCities: cities(niche, Math.min(niche.cities.length, 2 + year)) },
    cto: { featureSpend: Math.round(s * 0.3), reliabilitySpend: Math.round(s * 0.3), techDebtPaydown: 0 },
    coo: { capacityTarget: Math.round(c.capacity * 1.4), supportSpend: Math.round(s * 0.3), efficiencySpend: s, headcount: 5 },
    cfo: { borrow: 0, repay: 0, cashBuffer: 0 },
    ceo: { focus: "margin", positioning: target.id },
  };
})(), 1.2);

/** One place, served properly, and never mind the rest of the country. */
const local: Play = (year, c, niche, world) => sizeTo(world, year, (() => {
  const s = Math.round(Math.max(200_000, c.cash * 0.06));
  return {
    companyId: c.id,
    cmo: { price: Math.round(dearest(niche).referencePrice * 0.7), brandSpend: s, performanceSpend: Math.round(s * 0.5), celebritySpend: 0, targetCities: citiesFor(niche, dearest(niche).id, 1) },
    cto: { featureSpend: Math.round(s * 0.6), reliabilitySpend: s, techDebtPaydown: 0 },
    coo: { capacityTarget: Math.round(c.capacity * 1.2), supportSpend: s, efficiencySpend: Math.round(s * 0.4), headcount: 3 },
    cfo: { borrow: 0, repay: 0, cashBuffer: 0 },
    ceo: { focus: "quality" },
  };
})(), 1.1);

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
     *
     * Measured in money, not in heads. These markets differ by a thousand
     * times in what one customer pays, and within one market by fifteen: a
     * construction firm that wins the public sector holds four per cent of the
     * clients and most of the value — the best result in that market by a
     * distance — and a count of heads called that "nothing works". The ceiling
     * below is still on heads, so this does not loosen anything.
     */
    for (const niche of NICHES) {
      const best = Math.max(...STRATEGIES.map((s) => season(niche, s.play).revenueShare));
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

  it("winds up a team that never turns up, in every market", () => {
    /*
     * The floor used to be that an idle team survived everywhere. Measured,
     * that meant doing nothing was a viable way to finish a season — more
     * than half of them alive, some of them richer than they started. A game
     * about running a company cannot make running it optional.
     */
    for (const niche of NICHES) {
      expect(season(niche, idle).bankrupt, `${niche.id} lets an idle team trade on`).toBe(true);
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
      const scored = STRATEGIES.map((s) => ({ name: s.name, value: season(niche, s.play).value }));
      return scored.sort((a, b) => b.value - a.value)[0].name;
    });
    expect(new Set(winners).size, `the same strategy won everywhere: ${winners.join(", ")}`).toBeGreaterThan(1);
  });

  it("makes every strategy viable somewhere", () => {
    // Not necessarily a winner — but never a joke. A plan that is hopeless in
    // all four markets is a plan nobody should have been offered.
    for (const strategy of STRATEGIES) {
      const bestForThem = Math.max(...NICHES.map((niche) => season(niche, strategy.play).value));
      expect(bestForThem, `${strategy.name} is hopeless everywhere`).toBeGreaterThan(50_000_000);
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
        .map((s) => ({ name: s.name, value: season(niche, s.play).value }))
        .sort((a, b) => b.value - a.value)
        .map((s) => s.name)
        .join(">");

    const orders = new Set(NICHES.map(ranking));
    expect(orders.size, "every market rewards exactly the same plan").toBeGreaterThan(1);
  });
});

describe("five teams in one market, which is the actual game", () => {
  /*
   * Everything above runs one team against the incumbents. The product is
   * five teams in the same market taking customers from each other as well,
   * and that is a different question: a market can be perfectly balanced
   * against the machines and still produce one runaway winner and four people
   * who stopped opening the app on day five.
   */
  const niche = nicheById("dating_apps")!;

  function crowdedSeason(seasonId = "crowd") {
    const teams = STRATEGIES.map((s, i) => ({ id: `t${i}`, name: s.name, seats: [...ROLES] as Role[] }));
    let world = buildWorld({ seasonId, niche, teams });
    const previous = new Map<string, TeamDecisions>();
    let reports: any[] = [];

    for (let year = 1; year <= SEASON_YEARS; year++) {
      const decisions: TeamDecisions[] = [];
      for (const [i, strategy] of STRATEGIES.entries()) {
        const id = `t${i}`;
        const company = world.companies.find((c) => c.id === id)!;
        const chosen = strategy.play(year, company, niche, world);
        const submitted: Partial<Record<Role, any>> = {};
        if (chosen) for (const role of ROLES) if ((chosen as any)[role]) submitted[role] = (chosen as any)[role];
        const { decisions: theirs } = decisionsForYear({
          company, niche, submitted, previous: previous.get(id),
        });
        decisions.push({ ...theirs, companyId: id });
        if (chosen) previous.set(id, chosen);
      }
      const out = resolveYear({ ...world, year }, decisions, economyFor(seasonId, year));
      world = out.world;
      reports = out.reports;
    }

    const players = reports.filter((r) => STRATEGIES.some((s, i) => `t${i}` === r.companyId));
    return { world, players: players.sort((a, b) => b.founderValue - a.founderValue) };
  }

  it("does not hand the whole market to one team", () => {
    /*
     * Share alone is the wrong question here and worth saying why. In a market
     * whose flighty segment holds two customers in three, a volume strategy
     * taking most of the *heads* is structurally expected and not the failure
     * anybody would feel. What would be felt is one team finishing with a
     * company and the rest finishing with nothing.
     *
     * So this checks both: a ceiling on share that catches a genuine runaway,
     * and — the part that matters — that the teams who lost still have
     * businesses worth something at the end of the fortnight.
     */
    const { players } = crowdedSeason();
    const best = players[0];
    expect(best.marketShare, `${best.name} took the lot`).toBeLessThan(0.6);

    /*
     * "Worth something" as a share of the market rather than a figure in
     * pounds. It was 20m, which was about a twentieth of this market when it
     * was written — and the moment the markets grew (regions ten deep rather
     * than six) that number started measuring the market's size as much as
     * the also-rans' companies. A twentieth of a year of the market is the
     * claim: a business, not a crater.
     */
    const worthSomething = marketPotential(niche) * 0.04;
    const alsoRans = players.slice(1);
    const standing = alsoRans.filter((p) => p.founderValue > worthSomething);
    expect(standing.length, `only ${best.name} came out of this with a company`).toBeGreaterThanOrEqual(2);
  });

  it("leaves the team in last place with a company, not a crater", () => {
    /*
     * The retention question. Four people who finish fourteen days with
     * nothing are four people who do not come back for the next season, and a
     * multiplayer game that eliminates most of its players every fortnight
     * runs out of players.
     */
    const { players } = crowdedSeason();
    const last = players[players.length - 1];
    expect(last.bankrupt, `${last.name} was wiped out`).toBe(false);
    expect(last.customers, `${last.name} finished with nobody`).toBeGreaterThan(0);
  });

  it("keeps the gap between first and last worth playing for", () => {
    /*
     * Both failure modes at once. If the spread is tiny nothing anybody chose
     * mattered; if it is enormous the season was decided early and the rest
     * was homework.
     */
    const { players } = crowdedSeason();
    const first = players[0].founderValue;
    const last = players[players.length - 1].founderValue;
    expect(first, "everybody finished in the same place").toBeGreaterThan(last * 1.3);
    expect(first, "first place ran away with it").toBeLessThan(Math.max(last, 1) * 60);
  });

  it("still leaves the incumbents holding a real share of a contested market", () => {
    // Four teams competing is not a reason for the companies that were here
    // first to evaporate.
    const { world } = crowdedSeason();
    const total = world.companies.reduce((sum, c) => sum + Object.values(c.customers).reduce((s, n) => s + n, 0), 0);
    const held = world.companies
      .filter((c) => c.kind === "incumbent")
      .reduce((sum, c) => sum + Object.values(c.customers).reduce((s, n) => s + n, 0), 0);
    expect(held / total, "four teams emptied the market").toBeGreaterThan(0.2);
  });

  it("gives a different room a different season", () => {
    const a = crowdedSeason("room-one").players.map((p) => p.companyId);
    const b = crowdedSeason("room-two").players.map((p) => Math.round(p.customers));
    const aCustomers = crowdedSeason("room-one").players.map((p) => Math.round(p.customers));
    expect(aCustomers).not.toEqual(b);
    expect(a.length).toBe(STRATEGIES.length);
  });
});

describe("a season is a story, not a coin flip", () => {
  const niche = nicheById("dating_apps")!;

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
    const stopsEarly = season(niche, (year, c, n, w) => (year <= 4 ? grower(year, c, n, w) : null));
    const keepsGoing = season(niche, grower);
    expect(stopsEarly.share).toBeLessThan(keepsGoing.share);
  });
});

/*
 * Skill has to be worth something.
 *
 * For a long time it was not: the deliberately weak `filler` bot and the
 * `survivor` tier built to play better finished 168 seasons within a point of
 * each other, and on survival the weak one was ahead. A game whose purpose is
 * teaching people how to enter a market and survive cannot be indifferent to
 * how well it is played, so this is a guard, not a nicety.
 */
describe("does playing well pay", () => {
  const MARKETS = ["dating_apps", "podcasts", "mmos", "project_saas"] as const;
  const YEARS = 14;

  const play = (nicheId: string, skill: BotSkill, seed: string) => {
    const niche = nicheById(nicheId)!;
    let world: World = buildWorld({ seasonId: seed, niche, teams: [{ id: "us", name: "Us", seats: [...ROLES] }] });
    let prev: Record<string, unknown> = {};
    for (let y = 1; y <= YEARS; y++) {
      const me = world.companies.find((c) => c.id === "us");
      if (!me || me.bankruptSince) return { alive: false, cash: me?.cash ?? 0 };
      const d: Record<string, unknown> = { companyId: "us" };
      for (const r of ROLES) {
        d[r] = botDecision({
          ventureId: "us", year: y, role: r, company: me,
          previous: prev[r] as Record<string, unknown> | undefined,
          niche, rivals: world.companies.filter((c) => c.id !== "us"), skill,
        });
      }
      prev = d;
      world = resolveYear({ ...world, year: y }, [d as never]).world;
    }
    const e = world.companies.find((c) => c.id === "us");
    return { alive: !!e && !e.bankruptSince, cash: e?.cash ?? 0 };
  };

  const sweep = (skill: BotSkill) => {
    let richer = 0, runs = 0;
    for (const m of MARKETS) {
      for (let i = 0; i < 4; i++) {
        const r = play(m, skill, `skill-${m}-${i}`);
        runs++;
        // Started on £6m: ending above it is the plainest test of a good season.
        if (r.alive && r.cash > 6_000_000) richer++;
      }
    }
    return richer / runs;
  };

  it("pays a survivor better than a filler, and by a margin worth the name", () => {
    const good = sweep("survivor");
    const weak = sweep("filler");
    // A real gap, not noise. Measured at ~13 points over 84 seasons a side.
    expect(good).toBeGreaterThan(weak + 0.1);
  }, 120_000);
});
