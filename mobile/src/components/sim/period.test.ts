/**
 * What one decision is called, and how many of them a season is.
 *
 * The bug this file guards is arithmetic, not copy: `year` on every sim payload
 * counts *periods* and `totalYears` is in years, and four phone screens divided
 * one by the other. A quarterly season four years long told its players they were
 * on "Year 7 of 4" — past its own end, with the progress bar pinned at full.
 *
 * The mirrors against `shared/simulation/cadence.ts` live in
 * `test/unit/mobile-mirror.test.ts`, which can import both halves. What is here
 * is the reading built on top: which denominator wins, and what happens when a
 * payload carries none of them.
 */
import { describe, it, expect } from "vitest";
import {
  PERIOD_NAME, lastsFor, periodLabel, periodWords, periodsLeft, periodsPerYear,
  seasonSpan, totalPeriodsIn,
} from "./period";

describe("how many decisions a season is", () => {
  it("prefers the figure the route sends", () => {
    /* Four routes send it ready-made; the server knows the cadence and the client
       should not have to agree with it independently. */
    expect(seasonSpan({ totalPeriods: 16, totalYears: 4 })).toBe(16);
  });

  it("derives it from the cadence for the room route, which sends that instead", () => {
    expect(seasonSpan({ totalYears: 4, cadence: "quarterly" })).toBe(16);
    expect(seasonSpan({ totalYears: 4, cadence: "monthly" })).toBe(48);
    expect(seasonSpan({ totalYears: 4, cadence: "yearly" })).toBe(4);
  });

  it("falls back to years only when there is nothing better", () => {
    /*
     * Correct for a yearly season, and the one case where the old arithmetic was
     * right by accident. A screen with neither field is talking to an older
     * server.
     */
    expect(seasonSpan({ totalYears: 14 })).toBe(14);
    expect(seasonSpan({})).toBe(0);
  });

  it("does not let a count run past the total", () => {
    /*
     * A season resolving its last period can momentarily report a `year` one
     * beyond its span, and "Quarter 17 of 16" is the same nonsense as the bug
     * this exists to fix.
     */
    expect(periodLabel(17, 16, PERIOD_NAME.quarterly)).toBe("Quarter 16 of 16");
    expect(periodsLeft(17, 16)).toBe(0);
  });

  it("never reports the wrong total for the shape that was broken", () => {
    /* The exact failure: a quarterly four-year season, past period four. */
    const span = seasonSpan({ totalPeriods: 16, totalYears: 4 });
    const words = periodWords({ period: PERIOD_NAME.quarterly });
    expect(periodLabel(7, span, words)).toBe("Quarter 7 of 16");
    expect(periodLabel(7, span, words)).not.toContain("of 4");
    expect(periodsLeft(7, span)).toBe(9);
  });
});

describe("the word for one decision", () => {
  it("takes the route's own words first", () => {
    expect(periodWords({ period: PERIOD_NAME.monthly }).one).toBe("month");
  });

  it("then the cadence, for the route that sends that", () => {
    expect(periodWords({ cadence: "quarterly" }).one).toBe("quarter");
    expect(periodWords({ cadence: "monthly" }).of).toBe("this month");
  });

  it("and says year when it has nothing, which is what it used to assume", () => {
    expect(periodWords({}).one).toBe("year");
    expect(periodWords({ period: null, cadence: null }).one).toBe("year");
  });

  it("ignores a half-built `period` rather than printing a gap", () => {
    /*
     * A payload carrying `{ one: "quarter" }` and nothing else would otherwise
     * produce "Quarter 7 of 16" beside "undefined" somewhere else on the screen.
     */
    expect(periodWords({ period: { one: "quarter" } as any }).one).toBe("year");
    expect(periodWords({ period: { one: "quarter" } as any, cadence: "quarterly" }).one).toBe("quarter");
  });

  it("treats a cadence it does not know as yearly", () => {
    for (const odd of ["weekly", "", null, undefined, 4]) {
      expect(periodsPerYear(odd)).toBe(1);
      expect(periodWords({ cadence: odd as any }).one).toBe("year");
    }
  });

  it("capitalises for a heading, because it leads a line", () => {
    expect(periodLabel(3, 16, PERIOD_NAME.quarterly)).toBe("Quarter 3 of 16");
    expect(periodLabel(3, 0, PERIOD_NAME.yearly)).toBe("Year 3");
  });
});

describe("how long something lasts", () => {
  it("says three years for twelve quarters, which is what was bought", () => {
    expect(lastsFor(12, PERIOD_NAME.quarterly, 4)).toBe("3 years");
  });

  it("says periods where the years do not divide, rather than rounding", () => {
    expect(lastsFor(10, PERIOD_NAME.quarterly, 4)).toBe("10 quarters");
  });

  it("keeps saying years when a decision is a year", () => {
    expect(lastsFor(3)).toBe("3 years");
    expect(lastsFor(3, undefined, 1)).toBe("3 years");
  });
});

describe("a season of n years, in decisions", () => {
  it("multiplies out", () => {
    expect(totalPeriodsIn(4, "quarterly")).toBe(16);
    expect(totalPeriodsIn(14, "yearly")).toBe(14);
    expect(totalPeriodsIn(2, "monthly")).toBe(24);
  });

  it("never returns nothing, because a season is at least one decision", () => {
    for (const bad of [0, -3, null, undefined, Number.NaN]) {
      expect(totalPeriodsIn(bad as any, "quarterly")).toBeGreaterThan(0);
    }
  });
});
