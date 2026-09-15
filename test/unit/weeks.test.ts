/**
 * The week boundary.
 *
 * `weekStartOf` decides which week a piece of work belongs to — the path's
 * weekly return and Nova's briefing both group by its answer — so an
 * off-by-one on Sundays doesn't throw, it quietly merges two weeks into one.
 */
import { describe, it, expect } from "vitest";
import { weekStartOf } from "@shared/weeks";

const weekKey = (d: Date) => d.toISOString().slice(0, 10);

/** Every case is stated as a UTC instant, because the function works in UTC. */
const at = (iso: string) => new Date(iso);

describe("weekStartOf", () => {
  it("returns the Monday of that week, at UTC midnight", () => {
    const monday = weekStartOf(at("2026-09-09T13:45:00Z")); // a Wednesday
    expect(monday.toISOString()).toBe("2026-09-07T00:00:00.000Z");
  });

  it("leaves a Monday where it is", () => {
    expect(weekStartOf(at("2026-09-07T00:00:00Z")).toISOString()).toBe("2026-09-07T00:00:00.000Z");
    // Including late on that Monday.
    expect(weekStartOf(at("2026-09-07T23:59:59Z")).toISOString()).toBe("2026-09-07T00:00:00.000Z");
  });

  it("puts Sunday in the week that is ending, not the one starting", () => {
    /*
     * The classic failure. JavaScript's getUTCDay makes Sunday 0, so the naive
     * shift sends Sunday forward to the next Monday and splits a week in two —
     * or, depending on the sign, collapses two weeks into one.
     */
    expect(weekStartOf(at("2026-09-13T12:00:00Z")).toISOString()).toBe("2026-09-07T00:00:00.000Z");
  });

  it("handles the turn of a year", () => {
    // Fri 1 Jan 2027 belongs to the week beginning Mon 28 Dec 2026.
    expect(weekStartOf(at("2027-01-01T09:00:00Z")).toISOString()).toBe("2026-12-28T00:00:00.000Z");
  });

  it("gives every day of one week the same key", () => {
    const days = ["07", "08", "09", "10", "11", "12", "13"]
      .map((d) => weekKey(weekStartOf(at(`2026-09-${d}T06:00:00Z`))));
    expect(new Set(days).size).toBe(1);
    expect(days[0]).toBe("2026-09-07");
  });

  it("accepts a string as readily as a Date", () => {
    expect(weekStartOf("2026-09-09T13:45:00Z").toISOString())
      .toBe(weekStartOf(at("2026-09-09T13:45:00Z")).toISOString());
  });
});
