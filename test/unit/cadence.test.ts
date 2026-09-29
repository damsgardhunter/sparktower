/**
 * Years, quarters and months.
 *
 * The whole thing rests on one rule: divide the flows, keep the stocks. Get
 * it wrong in either direction and a season breaks quietly — divide a stock
 * and the company shrinks every time it is asked, forget to divide a flow and
 * it pays its salary bill twelve times a year.
 *
 * So these test the arithmetic hard, and especially the two places it is
 * tempting to be lazy: growth compounds rather than divides, and a lag
 * measured in years is a *longer* number of periods, not the same one.
 */
import { describe, it, expect } from "vitest";
import {
  CADENCES, PERIODS_PER_YEAR, perPeriod, periodsFor, growthPerPeriod,
  yearOfPeriod, periodsInSeason, periodLabel, periodsPerYear,
  DEFAULT_YEARS, PERIODS_MAX, PERIOD_MS, totalPeriods, yearsMax, yearsMin,
} from "@shared/simulation/cadence";
import { buildWorld, economyFor, seasonOver, tickDueAt } from "@shared/simulation/season";
import { resolveYear } from "@shared/simulation/resolve";
import { nicheById } from "@shared/simulation/niches";
import { eventsDue, grainDueAt, periodsOfGrain, nextWeather } from "@shared/simulation/events";
import { ROLES, type Company, type World } from "@shared/simulation/types";
import { PERIOD_NAME } from "@shared/simulation/cadence";
import { LEVER_FIELDS, speak } from "@shared/simulation/levers";
import { nicheById } from "@shared/simulation/niches";
import { capacityBuild } from "@shared/simulation/lag";
import { totalPeriods } from "@shared/simulation/cadence";
import { seasonOver } from "@shared/simulation/season";
import { capacityBuild } from "@shared/simulation/lag";

describe("how often a table decides", () => {
  it("is a year, a quarter or a month, and nothing else", () => {
    expect(CADENCES).toEqual(["yearly", "quarterly", "monthly"]);
    expect(Object.values(PERIODS_PER_YEAR)).toEqual([1, 4, 12]);
  });

  it("treats anything it does not recognise as a year", () => {
    expect(periodsPerYear(null)).toBe(1);
    expect(periodsPerYear(undefined)).toBe(1);
    expect(periodsPerYear("fortnightly" as never)).toBe(1);
  });
});

describe("flows are divided", () => {
  it("so a year's worth costs the same however often it is asked for", () => {
    const salary = 140_000;
    for (const cadence of CADENCES) {
      const year = perPeriod(salary, cadence) * periodsPerYear(cadence);
      expect(year, cadence).toBeCloseTo(salary, 6);
    }
  });

  it("including the thresholds, or every lever would cost four times as much", () => {
    /*
     * The failure this prevents. £220,000 buys sixteen points of brand in a
     * year. Left undivided, a quarterly table spends £220,000 four times for
     * the same sixteen points, and every quarterly season is unplayable.
     */
    expect(perPeriod(220_000, "quarterly")).toBe(55_000);
    expect(perPeriod(220_000, "monthly")).toBeCloseTo(18_333.33, 2);
  });
});

describe("growth compounds rather than divides", () => {
  it("so a year of periods comes out where the year does", () => {
    for (const annual of [0.08, 0.2, -0.05]) {
      for (const cadence of CADENCES) {
        const compounded = Math.pow(1 + growthPerPeriod(annual, cadence), periodsPerYear(cadence)) - 1;
        expect(compounded, `${annual} ${cadence}`).toBeCloseTo(annual, 9);
      }
    }
  });

  it("is not simply the annual rate over four, which is the tempting mistake", () => {
    const quarterly = growthPerPeriod(0.08, "quarterly");
    expect(quarterly).toBeLessThan(0.08 / 4);
    expect(quarterly).toBeCloseTo(0.0194, 3);
  });
});

describe("lags stay as long as they were", () => {
  it("so research that landed in two years still lands in two years", () => {
    expect(periodsFor(2, "yearly")).toBe(2);
    expect(periodsFor(2, "quarterly")).toBe(8);
    expect(periodsFor(2, "monthly")).toBe(24);
  });

  it("never lands in the same period it was decided", () => {
    // A lag of nothing is still a lag of one period, or a bet resolves before
    // anybody has left the room.
    for (const cadence of CADENCES) expect(periodsFor(0, cadence)).toBeGreaterThanOrEqual(1);
  });
});

describe("years still exist inside the periods", () => {
  it("puts each period in the right year", () => {
    expect(yearOfPeriod(1, "quarterly")).toEqual({ year: 1, within: 1 });
    expect(yearOfPeriod(4, "quarterly")).toEqual({ year: 1, within: 4 });
    expect(yearOfPeriod(5, "quarterly")).toEqual({ year: 2, within: 1 });
    expect(yearOfPeriod(13, "monthly")).toEqual({ year: 2, within: 1 });
    expect(yearOfPeriod(7, "yearly")).toEqual({ year: 7, within: 1 });
  });

  it("runs a fourteen-year season for the right number of periods", () => {
    expect(periodsInSeason(14, "yearly")).toBe(14);
    expect(periodsInSeason(14, "quarterly")).toBe(56);
    expect(periodsInSeason(14, "monthly")).toBe(168);
  });

  it("says where you are in words a person would use", () => {
    expect(periodLabel(6, "quarterly")).toBe("Q2 of year 2");
    expect(periodLabel(13, "monthly")).toBe("Month 1 of year 2");
    expect(periodLabel(3, "yearly")).toBe("Year 3");
  });
});

/*
 * The invariant the conversion exists to satisfy: four quarters of the same
 * decisions land where one year does. Anything else means a flow was kept or a
 * stock was divided.
 *
 * Measured over one year, because past that a season that runs out of money
 * legitimately diverges — a quarterly table sees the hole two quarters sooner
 * and reacts to it, which is the thing people are paying for.
 */
describe("a year resolved four and twelve times over", () => {
  const niche = nicheById("dating_apps");
  const plan = (c: Company, n: number) => ({
    companyId: "t",
    cmo: { price: 44, brandSpend: 180_000 / n, performanceSpend: 120_000 / n, celebritySpend: 0, targetCities: c.cities },
    cto: { featureSpend: 150_000 / n, reliabilitySpend: 80_000 / n, techDebtPaydown: 0 },
    coo: { capacityTarget: c.capacity, supportSpend: 90_000 / n, efficiencySpend: 0, headcount: 8 },
    cfo: { borrow: 0, repay: 0, cashBuffer: 0 },
    ceo: { focus: "growth" as const },
  });

  const runYear = (periodsPerYear: number) => {
    let world: World = { ...buildWorld({ seasonId: "inv", niche, teams: [{ id: "t", name: "T", seats: [...ROLES] }] }), periodsPerYear };
    for (let p = 1; p <= periodsPerYear; p++) {
      const c = world.companies.find((x) => x.id === "t")!;
      world = resolveYear({ ...world, year: p }, [plan(c, periodsPerYear) as never]).world;
    }
    return world.companies.find((c) => c.id === "t")!;
  };

  const yearly = runYear(1);

  it.each([[4], [12]])("lands the year's cash within a few per cent at %i periods", (n) => {
    const spent = 3_500_000 - runYear(n).cash;
    const spentYearly = 3_500_000 - yearly.cash;
    expect(Math.abs(spent - spentYearly) / Math.abs(spentYearly)).toBeLessThan(0.15);
  });

  it.each([[4], [12]])("opens the same room at %i periods, because capacity is a stock", (n) => {
    expect(runYear(n).capacity).toBe(yearly.capacity);
  });

  it.each([[4], [12]])("builds brand to within a fifth of the year's at %i periods", (n) => {
    expect(Math.abs(runYear(n).brand - yearly.brand) / yearly.brand).toBeLessThan(0.2);
  });
});

/*
 * Three grains of news. The rule that matters most is the last one: a yearly
 * season has to meet exactly the news it met before any of this existed, or
 * every season already running quietly changes story.
 */
describe("news at three grains", () => {
  const at = (grain: "year" | "quarter" | "month", period: number, periods: number) =>
    grainDueAt(grain, period, periods);

  it("gives a yearly season year boundaries and nothing finer", () => {
    expect(at("year", 1, 1)).toBe(1);
    expect(at("year", 5, 1)).toBe(5);
    expect(at("quarter", 3, 1)).toBeNull();
    expect(at("month", 3, 1)).toBeNull();
  });

  it("puts a quarter boundary on every period of a quarterly season", () => {
    expect(at("quarter", 1, 4)).toBe(1);
    expect(at("quarter", 4, 4)).toBe(4);
    // ...and a year boundary on the first period of each year, not the last.
    expect(at("year", 1, 4)).toBe(1);
    expect(at("year", 2, 4)).toBeNull();
    expect(at("year", 5, 4)).toBe(2);
    expect(at("month", 2, 4)).toBeNull();
  });

  it("puts all three on the month a year begins in", () => {
    expect(at("month", 13, 12)).toBe(13);
    expect(at("quarter", 13, 12)).toBe(5);
    expect(at("year", 13, 12)).toBe(2);
    // ...and only a month boundary on an ordinary month.
    expect(at("month", 14, 12)).toBe(14);
    expect(at("quarter", 14, 12)).toBeNull();
    expect(at("year", 14, 12)).toBeNull();
  });

  it("lasts a year, a quarter or a period, whatever a period is", () => {
    expect(periodsOfGrain("year", 12)).toBe(12);
    expect(periodsOfGrain("quarter", 12)).toBe(3);
    expect(periodsOfGrain("month", 12)).toBe(1);
    expect(periodsOfGrain("year", 1)).toBe(1);
  });

  describe("what a season actually meets", () => {
    const niche = nicheById("dating_apps");
    const drawn = (periods: number) => {
      let world: World = { ...buildWorld({ seasonId: "ev", niche, teams: [{ id: "t", name: "T", seats: [...ROLES] }] }), periodsPerYear: periods };
      const tally = { year: 0, quarter: 0, month: 0 };
      for (let p = 1; p <= 4 * periods; p++) {
        for (const e of eventsDue({ world, period: p, periods, economy: world.economy })) tally[e.grain!]++;
        world = resolveYear({ ...world, year: p }, []).world;
      }
      return tally;
    };

    it("meets one a year at yearly, and nothing finer", () => {
      // Three, not four: the first year is the team's own and has no news in it.
      expect(drawn(1)).toEqual({ year: 3, quarter: 0, month: 0 });
    });

    it("adds a quarter's worth at quarterly, keeping the same three yearly ones", () => {
      expect(drawn(4)).toEqual({ year: 3, quarter: 12, month: 0 });
    });

    it("adds a month's worth on top of both at monthly", () => {
      expect(drawn(12)).toEqual({ year: 3, quarter: 12, month: 36 });
    });
  });

  it("keeps a year event's weather in force for the whole year", () => {
    const winter = [{ id: "e", year: 2, grain: "year" as const, scope: "market" as const, headline: "A funding winter", body: "", advice: "", effect: { demand: 0.85 } }];
    // Drawn at the first period of year two of a quarterly season...
    const carried = nextWeather([], winter, 5, 4);
    expect(carried[0].until).toBe(8);
    // ...still there in the fourth quarter, gone by the next year.
    expect(nextWeather(carried, [], 8, 4)).toHaveLength(1);
    expect(nextWeather(carried, [], 9, 4)).toHaveLength(0);
  });
});

/*
 * The clock. Two numbers that used to be one: how much simulated time a
 * season covers, and how much real time a table gets to answer.
 */
describe("how long a season is", () => {
  it("counts the finish line in decisions, not years", () => {
    expect(totalPeriods(14, "yearly")).toBe(14);
    expect(totalPeriods(4, "quarterly")).toBe(16);
    expect(totalPeriods(1, "monthly")).toBe(12);
  });

  it("is not over until the last period has resolved", () => {
    const quarterly = totalPeriods(4, "quarterly");
    expect(seasonOver(16, quarterly)).toBe(false);
    expect(seasonOver(17, quarterly)).toBe(true);
    // The bug this replaced: four years read as four periods ended the season
    // three quarters into the first year.
    expect(seasonOver(5, 4)).toBe(true);
  });

  it("offers a span that narrows as the cadence gets finer", () => {
    expect([yearsMin("yearly"), yearsMax("yearly")]).toEqual([4, 14]);
    expect([yearsMin("quarterly"), yearsMax("quarterly")]).toEqual([1, 6]);
    expect([yearsMin("monthly"), yearsMax("monthly")]).toEqual([1, 2]);
  });

  it("defaults to a season somebody will actually finish", () => {
    for (const c of CADENCES) {
      expect(DEFAULT_YEARS[c]).toBeGreaterThanOrEqual(yearsMin(c));
      expect(DEFAULT_YEARS[c]).toBeLessThanOrEqual(yearsMax(c));
      // At a day a decision, every default lands inside about three weeks.
      expect(totalPeriods(DEFAULT_YEARS[c], c)).toBeLessThanOrEqual(PERIODS_MAX[c]);
      /*
       * And long enough that the game's lags have somewhere to land. Every
       * one of them is a year — brand, quality, a room, a hire — so a season
       * of a single simulated year is one in which nothing a table does ever
       * comes back to it.
       */
      expect(DEFAULT_YEARS[c]).toBeGreaterThanOrEqual(2);
    }
  });

  it("schedules a tick per period, whatever a period covers", () => {
    const start = new Date("2026-01-01T00:00:00Z");
    const hour = 60 * 60 * 1000;
    expect(tickDueAt(start, 1, PERIOD_MS).getTime() - start.getTime()).toBe(24 * hour);
    // A workshop on twenty-minute periods, which is what period length is for.
    expect(tickDueAt(start, 3, 20 * 60_000).getTime() - start.getTime()).toBe(60 * 60_000);
  });
});

describe("the economic cycle", () => {
  it("stays nine years long however often the table is asked", () => {
    // The same point in simulated time, reached three different ways.
    const yearly = economyFor("s", 3, 1);
    const quarterly = economyFor("s", 9, 4);
    const monthly = economyFor("s", 25, 12);
    expect(quarterly.demand).toBeCloseTo(yearly.demand, 6);
    expect(monthly.demand).toBeCloseTo(yearly.demand, 6);
    expect(quarterly.interestRate).toBeCloseTo(yearly.interestRate, 6);
  });
});

/**
 * A quarterly season does not call its quarters years.
 *
 * The engine has counted periods rather than years for a long time and a
 * season can be run monthly, quarterly or yearly — but every word on the desk
 * still said "year", so somebody deciding four times a simulated year was told
 * that each of those four was a year and that the season was fourteen of them.
 *
 * In lever copy "year" means the decision, consistently: `resolve` charges
 * salaries, interest and fixed costs per period, so a salary really is paid
 * every quarter in a quarterly season. Where a word means a calendar year it
 * lives somewhere else — asset lives, compound segment growth — and is not
 * touched by this.
 */
describe("what a season calls one decision", () => {
  const niche = nicheById("dating_apps")!;
  const focus = LEVER_FIELDS.ceo.find((f) => f.id === "focus")!;

  it("leaves a yearly season exactly as it was", () => {
    expect(speak(focus, niche.voice, PERIOD_NAME.yearly)).toEqual(speak(focus, niche.voice));
  });

  it("says quarter on a quarterly season, in the label and the help", () => {
    const q = speak(focus, niche.voice, PERIOD_NAME.quarterly);
    expect(q.label).toBe("Where the quarter goes");
    expect(q.help).toContain("what the company is for this quarter".replace("what", "What"));
    expect(q.help).not.toMatch(/\byear\b/);
  });

  it("says month on a monthly season", () => {
    expect(speak(focus, niche.voice, PERIOD_NAME.monthly).label).toBe("Where the month goes");
  });

  /* The options and choices carry copy too, and were missed the first time. */
  it("follows the cadence into the options a lever offers", () => {
    const headcount = LEVER_FIELDS.coo.find((f) => f.id === "headcount")!;
    const q = speak(headcount, niche.voice, PERIOD_NAME.quarterly);
    expect(q.help).toContain("every quarter");
    for (const o of [...(q.options ?? []), ...(q.choices ?? [])]) {
      expect(`${o.label} ${o.help ?? ""}`).not.toMatch(/\byear\b/);
    }
  });
});

/**
 * The one sentence on the desk that needs both words at once.
 *
 * Building capacity takes a *year* however often the table decides, and what
 * opens each *quarter* is a quarter of it. `capacityBuild` caps what you can
 * serve now at what you already had and adds only (wanted − current)/periods
 * for next time, so asking for ten thousand seats in a quarterly season opens
 * about a quarter of the increase a quarter later and none of it immediately.
 * The lever never said so, which made correct arithmetic read as a broken
 * number: ask for 10,000, see 1,500, conclude the game is lying.
 */
describe("what the capacity lever admits about the wait", () => {
  const niche = nicheById("dating_apps")!;
  const cap = LEVER_FIELDS.coo.find((f) => f.id === "capacityTarget")!;
  const help = (cadence: "yearly" | "quarterly" | "monthly", perYear: number) =>
    speak(cap, niche.voice, { ...PERIOD_NAME[cadence], perYear }).help ?? "";

  it("says building takes a year, whatever the cadence is", () => {
    for (const [c, p] of [["yearly", 1], ["quarterly", 4], ["monthly", 12]] as const) {
      expect(help(c, p), c).toContain("Building takes a year");
    }
  });

  it("says how much of it arrives each period", () => {
    expect(help("quarterly", 4)).toContain("a quarter of any increase opens each quarter");
    expect(help("monthly", 12)).toContain("a twelfth of any increase opens each month");
  });

  /* And the arithmetic it describes is the arithmetic that runs. */
  it("matches what capacityBuild actually does", () => {
    const built = capacityBuild({ capacity: 157 }, 10_000, 1 / 4);
    expect(built.now, "none of it in the period you ask").toBe(157);
    expect(built.next).toBe(Math.round(157 + (10_000 - 157) / 4));
  });

  /* Only this lever, and only its own sentence — the swap must not eat it. */
  it("is not itself turned into 'takes a quarter' by the period swap", () => {
    expect(help("quarterly", 4)).not.toContain("Building takes a quarter");
  });
});

/**
 * A season's length, counted in the unit its progress is counted in.
 *
 * `year` on a season row has counted periods for a long time, and `totalYears`
 * is in years. Every screen that showed progress divided one by the other, so
 * a four-year quarterly season — sixteen decisions — announced "Year 5 of 4"
 * the moment it passed its first year, and went on counting down to a next one
 * it claimed not to have. The engine was never confused: `seasonOver` takes
 * `totalPeriods`, which is why the season kept running, correctly, while the
 * header said it was over.
 */
describe("how long a season is", () => {
  it("is counted in decisions, not in years", () => {
    expect(totalPeriods(4, "quarterly"), "four years of quarters").toBe(16);
    expect(totalPeriods(4, "monthly")).toBe(48);
    expect(totalPeriods(4, "yearly"), "a yearly season is unchanged").toBe(4);
  });

  /* The exact season that showed it. */
  it("puts a quarterly season's fifth decision inside its first year", () => {
    const total = totalPeriods(4, "quarterly");
    const year = 5;
    expect(year, "period five of sixteen is not past the end").toBeLessThanOrEqual(total);
    expect(seasonOver(year, total)).toBe(false);
    expect(seasonOver(total + 1, total), "and the end is still the end").toBe(true);
  });
});

/**
 * "Building takes a year" has to mean a year.
 *
 * `capacityBuild` was `current + (wanted - current) * per`, recomputed each
 * period against a capacity that had already moved — so every quarter closed a
 * quarter of what was *left* of the gap and the build approached its target
 * without ever arriving. Asking for 1,000 from 168 gave 376, then 532, 649,
 * 737: after a full year, 74% of what was asked for, and 98% only in the third
 * year. The lever's own sentence said a year and meant it; the arithmetic was
 * Zeno's, and a founder reported it as capacity they could not raise.
 */
describe("how long building room actually takes", () => {
  const run = (from: number, target: number, periods: number, howMany: number) => {
    let co: { capacity: number; buildFrom?: number; buildTo?: number } = { capacity: from };
    const seen: number[] = [];
    for (let i = 0; i < howMany; i += 1) {
      const b = capacityBuild(co, target, 1 / periods);
      co = { capacity: b.next, buildFrom: b.buildFrom, buildTo: b.buildTo };
      seen.push(co.capacity);
    }
    return seen;
  };

  it("arrives in four quarters, in equal steps", () => {
    expect(run(168, 1_000, 4, 4)).toEqual([376, 584, 792, 1_000]);
  });

  it("arrives in twelve months, and in one year", () => {
    expect(run(0, 1_200, 12, 12).at(-1)).toBe(1_200);
    expect(run(168, 1_000, 1, 1)).toEqual([1_000]);
  });

  it("does not overshoot once it has arrived", () => {
    expect(run(168, 1_000, 4, 6).slice(4)).toEqual([1_000, 1_000]);
  });

  /* Changing your mind starts a new build from wherever you have got to. */
  it("starts again when the target changes", () => {
    let co: { capacity: number; buildFrom?: number; buildTo?: number } = { capacity: 0 };
    for (let i = 0; i < 2; i += 1) {
      const b = capacityBuild(co, 1_000, 1 / 4);
      co = { capacity: b.next, buildFrom: b.buildFrom, buildTo: b.buildTo };
    }
    expect(co.capacity, "halfway to the first target").toBe(500);
    const next = capacityBuild(co, 2_000, 1 / 4);
    expect(next.next, "a quarter of the new gap, from here").toBe(500 + Math.round((2_000 - 500) / 4));
  });

  /* And a cut is still immediate, and abandons what was being built. */
  it("cuts at once and drops the build", () => {
    const cut = capacityBuild({ capacity: 800, buildFrom: 168, buildTo: 1_000 }, 300, 1 / 4);
    expect(cut.next).toBe(300);
    expect(cut.now).toBe(300);
    expect(cut.buildTo).toBeUndefined();
  });

  /* None of it lands in the period it is asked for. */
  it("opens nothing in the period you ask", () => {
    expect(capacityBuild({ capacity: 168 }, 1_000, 1 / 4).now).toBe(168);
  });
});
