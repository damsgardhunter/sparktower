/**
 * The season rules, and mostly the empty chair.
 *
 * These tests are design claims rather than coverage. "A team that never opens
 * the app still has a company on day fourteen" and "a team that plays beats a
 * team that doesn't" are both things the simulation promises, and neither is
 * obvious from reading the arithmetic — they only show up when you run the
 * whole fourteen years.
 */
import { describe, it, expect } from "vitest";
import { forecastDemand } from "@shared/simulation/forecast";
import {
  economyFor, startingCompany, buildWorld, openingDecisions, caretakerDecisions, openingRegion, OPENING_BUDGET,
  decisionsForYear, absenceNote, tickDueAt, seasonOver, CARETAKER_RATE, SEASON_YEARS,
} from "@shared/simulation/season";
import { resolveYear } from "@shared/simulation/resolve";
import { nicheById, NICHES } from "@shared/simulation/niches";
import { ROLE_TITLES, type Role, type World } from "@shared/simulation/types";
import type { TeamDecisions } from "@shared/simulation/decisions";

const niche = nicheById("dating_apps")!;

/** Run a whole season, deciding each year with the given strategy. */
function playSeason(decide: (year: number, company: any, world: World) => TeamDecisions | null, seasonId = "s-test") {
  let world = buildWorld({
    seasonId,
    niche,
    teams: [{ id: "team", name: "Team", seats: ["ceo", "cmo", "cfo", "cto", "coo"] as Role[] }],
  });
  let previous: TeamDecisions | undefined;
  const history = [];

  for (let year = 1; year <= SEASON_YEARS; year++) {
    const company = world.companies.find((c) => c.id === "team")!;
    const chosen = decide(year, company, { ...world, year });
    const submitted: Partial<Record<Role, any>> = {};
    if (chosen) {
      for (const role of ["ceo", "cmo", "cfo", "cto", "coo"] as Role[]) {
        if ((chosen as any)[role]) submitted[role] = (chosen as any)[role];
      }
    }
    const { decisions } = decisionsForYear({ company, niche, submitted, previous });
    const result = resolveYear({ ...world, year }, [decisions], economyFor(seasonId, year));
    world = result.world;
    history.push(result.reports.find((r) => r.companyId === "team")!);
    // Only real submissions become "last year's plan" — the caretaker's own
    // output must never be the baseline for the next caretaker year.
    if (chosen) previous = chosen;
  }
  return { world, history };
}

/**
 * A competent, unspectacular year: spend within your means, hold the opening
 * price, keep enough capacity to serve who you win.
 *
 * Derived from the company rather than hard-coded, because a strategy written
 * against fixed numbers stops being a strategy the moment the market is
 * rebalanced — it quietly becomes a company throttling itself, and the test
 * then claims playing is worse than not playing.
 */
function playedYear(company: { cash: number; capacity: number; price: number }, world?: World): TeamDecisions {
  /*
   * A steady hand, and steady has to mean affordable.
   *
   * This was eight per cent of the bank on each of six levers — some forty
   * per cent of the company's cash every year, for fourteen years. It stood
   * up while a market could hold half again as many customers as it had
   * people, because the growth that bought paid for it. Against a market that
   * is now finite it is not a plan, it is a burn: the "played" team reached
   * the last year insolvent at minus £3.9m, and lost a comparison against
   * doing nothing that it should win easily.
   *
   * Three per cent a lever is a company investing seriously and still able to
   * pay for it, and the floor has to be small enough that a company having a
   * thin year cuts its cloth instead of spending itself into the ground — a
   * £120,000 floor across six levers was £720,000 a year against a million of
   * revenue, and the engine simply refused most of it: "there was only 0 to
   * spend, cash and credit together". A team that cannot pay for its plan is
   * not playing well, it is playing badly, and this test is about the former.
   */
  const spend = Math.round(Math.max(40_000, company.cash * 0.03));
  const d: TeamDecisions = {
    companyId: "team",
    cmo: { price: company.price, brandSpend: spend, performanceSpend: spend, celebritySpend: 0, targetCities: [] },
    /*
     * And it pays down what the shipping borrows. Features accrue technical
     * debt, debt buys outages and breaches, and those cost reputation — so a
     * fixture that shipped hard for fourteen years and never paid any of it
     * back finished with a worse name than a company that did nothing at all,
     * which says more about the plan than about playing.
     */
    cto: { featureSpend: spend, reliabilitySpend: spend, techDebtPaydown: Math.round(spend * 0.5) },
    coo: { capacityTarget: Math.round(company.capacity * 1.15), supportSpend: spend, efficiencySpend: Math.round(spend * 0.4), headcount: 5 },
    cfo: { borrow: 0, repay: 0, cashBuffer: 0 },
    /*
     * And it answers when something goes wrong. A shock met with silence
     * recovers far less of the reputation it cost, and a bigger company draws
     * more shocks — so a fixture that never filed a `shockAnswer` in fourteen
     * years was being punished for growing, and finished with a worse name
     * than a company that did nothing.
     */
    ceo: { focus: "growth", shockAnswer: "statement" },
  };
  /*
   * A steady hand builds to the forecast. Growing capacity a fixed fifteen per
   * cent a year was steady while headroom was free; now that too little sends
   * customers to rivals and too much is paid for, it is simply wrong, and a
   * test of whether playing beats not playing should not have the player
   * making a mistake the desk warns them about.
   */
  if (!world) return d;
  const f = forecastDemand({ world, companyId: "team", year: world.year, economy: world.economy, draft: d });
  return f ? { ...d, coo: { ...d.coo!, capacityTarget: Math.max(1_000, Math.round(f.likely * 1.15)) } } : d;
}

describe("the weather", () => {
  it("is the same for everyone in a season and different between seasons", () => {
    expect(economyFor("season-a", 3)).toEqual(economyFor("season-a", 3));
    // Two seasons sitting at the same point in the cycle would make year one
    // always feel the same, which is the thing the per-season offset prevents.
    const a = Array.from({ length: 14 }, (_, i) => economyFor("season-a", i + 1).demand);
    const b = Array.from({ length: 14 }, (_, i) => economyFor("season-b", i + 1).demand);
    expect(a).not.toEqual(b);
  });

  it("describes the year ahead, not the one you're in", () => {
    /*
     * The outlook exists so a finance seat can act before the weather arrives.
     * If it described the current year it would be a label on something you
     * can already see, and borrowing ahead of a tightening would be luck.
     */
    for (const seasonId of ["s1", "s2", "s3"]) {
      for (let year = 1; year < 14; year++) {
        const here = economyFor(seasonId, year);
        const next = economyFor(seasonId, year + 1);
        if (here.outlook === "expansion") expect(next.demand).toBeGreaterThan(here.demand);
        if (here.outlook === "tightening") expect(next.demand).toBeLessThan(here.demand);
      }
    }
  });

  it("never lets costs fall back to where they started", () => {
    const early = economyFor("s", 1).costIndex;
    const late = economyFor("s", 14).costIndex;
    expect(late).toBeGreaterThan(early);
  });
});

describe("where a company opens", () => {
  /*
   * A person's team gets the same defensible home every season, so teams are
   * comparable. A bot-run company picks its own, which is the only reason a
   * season does not begin with every company in one region fighting over a
   * twelfth of the market.
   */
  it("gives a team the cheapest region that is still somewhere", () => {
    for (const n of NICHES) {
      const home = openingRegion(n);
      expect(home, n.id).toBeTruthy();
      const cheaperReal = n.cities.filter((c) => c.weight >= 0.08 && c.entryCost < home.entryCost);
      expect(cheaperReal, `${n.id}: something real and cheaper was passed over`).toEqual([]);
    }
  });

  it("sends a bot to the best region it can afford about half the time, and anywhere it can the rest", () => {
    for (const n of NICHES) {
      const affordable = n.cities.filter((c) => c.entryCost <= OPENING_BUDGET);
      const best = [...affordable].sort((a, b) => b.weight - a.weight)[0];
      const homes = Array.from({ length: 300 }, (_, i) => openingRegion(n, { botRun: true, seed: `v${i}` }));
      for (const h of homes) expect(h.entryCost, `${n.id}: opened somewhere it cannot pay for`).toBeLessThanOrEqual(OPENING_BUDGET);
      const bestShare = homes.filter((h) => h.id === best.id).length / homes.length;
      // Half on the coin, plus the times the random half lands on it anyway.
      expect(bestShare, `${n.id} picks the best region ${Math.round(bestShare * 100)}% of the time`).toBeGreaterThan(0.45);
      expect(bestShare, `${n.id} always picks the best region`).toBeLessThan(0.85);
      if (affordable.length > 2) {
        expect(new Set(homes.map((h) => h.id)).size, `${n.id}: bots all opened in the same place`).toBeGreaterThan(1);
      }
    }
  });

  it("opens the same venture in the same place every time", () => {
    const n = NICHES[0];
    const once = openingRegion(n, { botRun: true, seed: "venture-1" });
    const again = openingRegion(n, { botRun: true, seed: "venture-1" });
    expect(again.id).toBe(once.id);
  });
});

describe("a company on day one", () => {
  it("starts owing nothing", () => {
    // By the brief, and because a team that starts in debt spends its first
    // years digging out rather than learning the market.
    const c = startingCompany({ id: "t", name: "T", niche, seats: ["ceo"] as Role[] });
    expect(c.debt).toBe(0);
    expect(c.cash).toBeGreaterThan(0);
  });

  it("is unknown rather than bad", () => {
    const c = startingCompany({ id: "t", name: "T", niche, seats: ["ceo"] as Role[] });
    // The product exists; nobody has heard of it. That is the actual starting
    // problem, and brand being the lowest number says so.
    expect(c.brand).toBeLessThan(c.quality);
    expect(c.brand).toBeLessThan(c.service);
  });

  it("puts the incumbents in front of you holding the market", () => {
    const world = buildWorld({ seasonId: "s", niche, teams: [{ id: "t", name: "T", seats: ["ceo"] as Role[] }] });
    const incumbents = world.companies.filter((c) => c.kind === "incumbent");
    expect(incumbents.length).toBe(niche.incumbents.length);
    expect(world.companies.filter((c) => c.kind === "player")).toHaveLength(1);
  });
});

describe("the chair nobody sat in", () => {
  it("does not borrow money on your behalf", () => {
    /*
     * The one that would actually hurt. A CFO who borrowed once and then
     * stopped playing would, under plain carry-forward, take the same loan
     * every year for the rest of the season — and their team comes back on day
     * nine to a company buried in debt none of them agreed to.
     */
    const company = startingCompany({ id: "t", name: "T", niche, seats: ["cfo"] as Role[] });
    const last: TeamDecisions = {
      companyId: "t",
      cfo: { borrow: 500_000, repay: 0, cashBuffer: 0, raise: { amount: 1_000_000, equityPct: 20 } },
    };
    const caretaker = caretakerDecisions(last, company);
    expect(caretaker.cfo?.borrow).toBe(0);
    expect(caretaker.cfo?.raise).toBeUndefined();
  });

  it("does not re-run a one-off campaign or re-bid for a rival", () => {
    const company = startingCompany({ id: "t", name: "T", niche, seats: ["cmo", "ceo"] as Role[] });
    const last: TeamDecisions = {
      companyId: "t",
      cmo: { price: 20, brandSpend: 100_000, performanceSpend: 50_000, celebritySpend: 400_000, targetCities: [] },
      ceo: { focus: "growth", offer: { targetCompanyId: "rival", kind: "acquire", amount: 2_000_000 }, dissolveSeats: ["cto"] as Role[] },
    };
    const caretaker = caretakerDecisions(last, company);
    expect(caretaker.cmo?.celebritySpend).toBe(0);
    expect(caretaker.ceo?.offer).toBeUndefined();
    // Nobody fires a colleague twice by not being there.
    expect(caretaker.ceo?.dissolveSeats).toBeUndefined();
  });

  it("keeps the lights on at a caretaker's pace", () => {
    const company = startingCompany({ id: "t", name: "T", niche, seats: ["cmo"] as Role[] });
    const last: TeamDecisions = {
      companyId: "t",
      cmo: { price: 19, brandSpend: 100_000, performanceSpend: 50_000, celebritySpend: 0, targetCities: [] },
    };
    const caretaker = caretakerDecisions(last, company);
    expect(caretaker.cmo?.brandSpend).toBe(100_000 * CARETAKER_RATE);
    // Price is a standing position, not a spend. It holds.
    expect(caretaker.cmo?.price).toBe(19);
  });

  it("fills only the empty chairs, not the whole team", () => {
    /*
     * The common case is one person away, not five. A team whose CFO is
     * missing must keep the marketing its CMO chose an hour ago.
     */
    const company = startingCompany({ id: "t", name: "T", niche, seats: ["cmo", "cfo"] as Role[] });
    const previous: TeamDecisions = {
      companyId: "t",
      cmo: { price: 15, brandSpend: 10_000, performanceSpend: 0, celebritySpend: 0, targetCities: [] },
      cfo: { borrow: 100_000, repay: 0, cashBuffer: 0 },
    };
    const { decisions, absent } = decisionsForYear({
      company,
      niche,
      submitted: { cmo: { price: 30, brandSpend: 900_000, performanceSpend: 0, celebritySpend: 0, targetCities: [] } },
      previous,
    });

    expect(absent).toEqual(["cfo"]);
    expect(decisions.cmo?.price).toBe(30);
    expect(decisions.cmo?.brandSpend).toBe(900_000);
    expect(decisions.cfo?.borrow).toBe(0);
  });

  it("runs the opening plan for a chair with no decision to fall back on", () => {
    /*
     * `previous` is built from each seat's last filing, and a seat that never
     * filed has no entry in it. The caretaker only scales what it is given,
     * so that chair came back undefined — which the engine reads as nobody on
     * the payroll and nothing spent. Everyone fired because one chair was
     * empty while another was not.
     */
    const company = startingCompany({ id: "t", name: "T", niche, seats: ["cmo", "coo"] as Role[] });
    const previous: TeamDecisions = {
      companyId: "t",
      cmo: { price: 15, brandSpend: 10_000, performanceSpend: 0, celebritySpend: 0, targetCities: [] },
    };
    const { decisions, absent } = decisionsForYear({ company, niche, submitted: {}, previous });
    expect(absent).toEqual(["cmo", "coo"]);
    expect(decisions.coo, "an operations plan, not nothing").toBeDefined();
    expect(decisions.coo!.headcount).toBeGreaterThan(0);
    // The chair that did file keeps its own last plan, stepped down.
    expect(decisions.cmo?.price).toBe(15);
  });

  it("explains itself to the teammate who did show up", () => {
    // The person reading this is usually not the person who missed it.
    const note = absenceNote(["cfo"] as Role[], ROLE_TITLES, 5)!;
    expect(note).toContain(ROLE_TITLES.cfo);
    expect(note).toMatch(/last year's plan/i);
    expect(absenceNote([], ROLE_TITLES, 5)).toBeNull();
  });

  it("only says nobody filed when nobody filed", () => {
    /*
     * Four of five is the ordinary bad week, and it used to be described as
     * "Nobody filed decisions this year" — read by the one person who had
     * filed, about the year they had spent an evening on. The note names who
     * was missing instead, which is both true and the thing a chief executive
     * can act on.
     */
    const four = ["cmo", "cfo", "cto", "coo"] as Role[];
    const partial = absenceNote(four, ROLE_TITLES, 5)!;
    expect(partial, "somebody was there").not.toMatch(/nobody/i);
    for (const role of four) expect(partial).toContain(ROLE_TITLES[role]);

    // And when the table really is empty, it says so.
    const all = ["ceo", ...four] as Role[];
    expect(absenceNote(all, ROLE_TITLES, 5)).toMatch(/nobody filed/i);

    /*
     * A table that has lost seats counts by the seats it has, not by five. A
     * three-person company where all three missed is just as empty.
     */
    expect(absenceNote(["ceo", "cmo", "cfo"] as Role[], ROLE_TITLES, 3)).toMatch(/nobody filed/i);
    expect(absenceNote(["cmo", "cfo"] as Role[], ROLE_TITLES, 3)).not.toMatch(/nobody/i);
  });
});

describe("a whole season", () => {
  it("winds up a company nobody ever opened the app for", () => {
    /*
     * This used to be the opposite rule: five people join, never come back,
     * and a fortnight later there is still something standing, because the
     * one who wanders back on day twelve is the player worth having.
     *
     * It could not survive the measurement. Idle tables were finishing more
     * than half of all seasons alive and occasionally richer than they
     * started, coasting on an opening position nobody had earned while the
     * business rotted underneath — which makes the one thing the game is
     * about, running a company, optional.
     *
     * The two rules cannot both hold: a company nobody runs for ten years
     * cannot be both closed and recoverable. What is kept is the part that
     * still makes sense, and the next test holds it — a table that misses a
     * year and comes back finds a company that lost ground, not one that
     * ended.
     */
    const { world, history } = playSeason(() => null);
    const team = world.companies.find((c) => c.id === "team")!;

    expect(history).toHaveLength(SEASON_YEARS);
    expect(team.bankruptSince, "a company nobody ran should not still be trading").toBeDefined();
    expect(Object.values(team.customers).reduce((a, b) => a + b, 0)).toBe(0);
  });

  it("rewards the team that actually played", () => {
    /*
     * The other half of the same claim, and the one that stops the floor from
     * eating the game: if not playing did as well as playing, there would be
     * no reason to open the app at all.
     */
    const idle = playSeason(() => null);
    // A steady hand, not a perfect one.
    const played = playSeason((_, company, world) => playedYear(company, world));

    const idleFinal = idle.history[idle.history.length - 1];
    const playedFinal = played.history[played.history.length - 1];
    expect(playedFinal.marketShare).toBeGreaterThan(idleFinal.marketShare);
    expect(playedFinal.reputation).toBeGreaterThan(idleFinal.reputation);
  });

  it("does not compound one absence into a death spiral", () => {
    /*
     * Miss day four and day five, and the second caretaker year must scale
     * from the last real decision rather than from the first caretaker year.
     * Otherwise 60% of 60% of 60% turns a fortnight's holiday into a company
     * that cannot be rescued, which is the exact moment a player gives up.
     */
    const startCompany = startingCompany({ id: "team", name: "T", niche, seats: ["cmo"] as Role[] });
    const real: TeamDecisions = {
      companyId: "team",
      cmo: { price: 20, brandSpend: 100_000, performanceSpend: 0, celebritySpend: 0, targetCities: [] },
    };

    const firstMiss = decisionsForYear({ company: startCompany, niche, submitted: {}, previous: real });
    const secondMiss = decisionsForYear({ company: startCompany, niche, submitted: {}, previous: real });

    expect(firstMiss.decisions.cmo?.brandSpend).toBe(60_000);
    expect(secondMiss.decisions.cmo?.brandSpend, "the floor holds, it does not keep falling").toBe(60_000);
  });

  it("gives a team that comes back something to come back to", () => {
    /*
     * Nobody plays until day ten, then three good years. The recovery has to be
     * possible — not guaranteed, but possible — or the message to a returning
     * player is "you already lost" and they leave again.
     */
    /*
     * Returning after two quiet years, not ten. A company left alone for a
     * decade is wound up now (see above), and the guarantee worth keeping is
     * the one about a table that goes quiet for a while and comes back.
     */
    const { history } = playSeason((year, company) => (year >= 4 ? playedYear(company) : null));
    const atReturn = history[2];
    const atEnd = history[history.length - 1];

    expect(atEnd.marketShare).toBeGreaterThan(atReturn.marketShare);
    expect(atEnd.customers).toBeGreaterThan(atReturn.customers);
  });
});

describe("the chief executive's chair", () => {
  /*
   * The seat five people race each other for in the lobby. Its decision was
   * declared, displayed, and read by nothing — so the most contested chair in
   * the game was the only one that could not change the outcome. These tests
   * exist to stop that being true again.
   */
  const withFocus = (focus: string) => playSeason((_, company, world) => ({
    ...playedYear(company, world),
    ceo: { focus } as any,
  }));

  it("changes the outcome at all", () => {
    const growth = withFocus("growth");
    const margin = withFocus("margin");
    const end = (r: ReturnType<typeof withFocus>) => r.history[r.history.length - 1];
    expect(end(growth).marketShare).not.toBe(end(margin).marketShare);
  });

  it("trades reach against cost, in the year it is chosen", () => {
    /*
     * One year, not fourteen. Over a whole season a cash-proportional strategy
     * turns margin's lower costs into more money to spend, which out-grows
     * growth — a real and interesting outcome, and not a test of what the
     * lever does. The lever's own effect is a single year: the same company,
     * the same spending, one word different.
     */
    const world = buildWorld({ seasonId: "s", niche, teams: [{ id: "team", name: "T", seats: ["ceo", "cmo", "cto"] as Role[] }] });
    const company = world.companies.find((c) => c.id === "team")!;
    const base = playedYear(company);

    const year = (focus: string) => {
      const { reports, world: after } = resolveYear(world, [{ ...base, ceo: { focus } as any }], economyFor("s", 1));
      return { report: reports.find((r) => r.companyId === "team")!, company: after.companies.find((c) => c.id === "team")! };
    };

    const growth = year("growth");
    const margin = year("margin");

    // Growth reaches further for the same money.
    expect(growth.report.brand).toBeGreaterThan(margin.report.brand);
    // Margin makes each unit cheaper to produce.
    expect(margin.company.unitCost).toBeLessThan(growth.company.unitCost);
  });

  it("makes survival the cheapest year and the one you come out of behind", () => {
    const survival = withFocus("survival");
    const growth = withFocus("growth");
    const end = (r: ReturnType<typeof withFocus>) => r.history[r.history.length - 1];

    // Spending, not tax: a lean year that turns a profit pays tax on it, and
    // that is not the survival focus costing anything.
    const spent = (r: any) => r.costs - (r.pnl?.tax ?? 0);
    expect(spent(end(survival))).toBeLessThan(spent(end(growth)));
    expect(end(survival).marketShare).toBeLessThan(end(growth).marketShare);
  });

  it("cannot win a year on its own", () => {
    /*
     * A chief executive who could out-decide the other four would make their
     * seats decorative. A focus with nothing behind it does nothing much.
     */
    const idle = playSeason(() => null);
    const focusOnly = playSeason((_, company) => ({ companyId: "team", ceo: { focus: "growth" } } as any));
    const end = (r: any) => r.history[r.history.length - 1];
    expect(end(focusOnly).marketShare).toBeLessThan(0.02);
  });

  it("tells the team what it did", () => {
    const { history } = withFocus("quality");
    expect(history[0].notes.join(" ")).toMatch(/run for quality/i);
  });
});

describe("the clock", () => {
  it("puts a year between years and stops at the end of the season", () => {
    const start = new Date("2026-01-01T12:00:00Z");
    expect(tickDueAt(start, 1).getTime() - start.getTime()).toBe(24 * 60 * 60 * 1000);
    expect(tickDueAt(start, 14).getTime() - start.getTime()).toBe(14 * 24 * 60 * 60 * 1000);
    expect(seasonOver(14)).toBe(false);
    expect(seasonOver(15)).toBe(true);
  });
});
