/**
 * How reliable a seat has been, in one line.
 *
 * The desk says "still deciding" and nothing about the eleven periods before it,
 * which is the question somebody actually has when deciding whether to chase a
 * filing: is this period unusual for them, or is this what they always do?
 *
 * `missedRunning` is the distinction that matters and the one easiest to flatten.
 * Somebody who missed three early and has filed every period since is not the
 * same problem as somebody who has missed the last three, and a line that only
 * reported totals would read identically for both.
 */
import { describe, it, expect } from "vitest";
import { turnoutRead } from "./profiles";

describe("reading a seat's turnout", () => {
  it("says so plainly when somebody has never missed", () => {
    expect(turnoutRead({ filed: 6, of: 6, missedRunning: 0 })).toContain("every period");
  });

  it("leads with the run of misses when there is one", () => {
    /*
     * The important case. Three filed of six is the same total whether the misses
     * were at the start or are happening now, and only one of those is a reason
     * to go and find somebody.
     */
    const now = turnoutRead({ filed: 3, of: 6, missedRunning: 3 });
    expect(now).toContain("missed the last 3");
    const past = turnoutRead({ filed: 3, of: 6, missedRunning: 0 });
    expect(past).not.toContain("missed the last");
    expect(past, "and still reports the total").toContain("3 of 6");
  });

  it("does not call a single miss a pattern", () => {
    // One missed period is a busy evening, not a habit.
    expect(turnoutRead({ filed: 5, of: 6, missedRunning: 1 })).not.toContain("missed the last");
  });

  it("says there is nothing to go on before a season has run", () => {
    expect(turnoutRead({ filed: 0, of: 0, missedRunning: 0 })).toContain("Nothing to go on");
    expect(turnoutRead(undefined)).toContain("Nothing to go on");
  });

  it("never reports a number it was not given", () => {
    for (const t of [undefined, { filed: 0, of: 0, missedRunning: 0 }, { filed: 2, of: 3, missedRunning: 2 }]) {
      expect(turnoutRead(t)).not.toMatch(/undefined|NaN/);
    }
  });
});
