/**
 * The safety loop's rules, on their own: what a spike is, how an action's
 * before and after are compared when the after is still filling up, and which
 * alerts a review opens with.
 */
import { describe, it, expect } from "vitest";
import {
  compareWindows, isSpike, safetyAlerts, SPIKE_MIN_REFUSALS, STALE_REPORT_HOURS, REVIEW_DUE_HOURS,
} from "@shared/safety";

describe("a spike", () => {
  it("needs both a floor and a doubling", () => {
    expect(isSpike(SPIKE_MIN_REFUSALS, 0)).toBe(true);
    expect(isSpike(SPIKE_MIN_REFUSALS - 1, 0)).toBe(false);   // too few to mean anything
    expect(isSpike(20, 12)).toBe(false);                       // busy, but not a jump
    expect(isSpike(24, 12)).toBe(true);
  });
});

describe("comparing either side of an action", () => {
  it("reads a partial after-window as a pace over a full one", () => {
    // 2 in the first 6 hours is a pace of 8 a day, against 4 the day before.
    expect(compareWindows(4, 2, 6)).toMatchObject({ afterPace: 8, changePercent: 100, direction: "up" });
    expect(compareWindows(10, 0, 12)).toMatchObject({ afterPace: 0, changePercent: -100, direction: "down" });
  });

  it("caps the after-window at a full window, and has no percentage from zero", () => {
    expect(compareWindows(3, 3, 40)).toMatchObject({ afterHours: 24, afterPace: 3, direction: "flat" });
    expect(compareWindows(0, 1, 24).changePercent).toBeNull();
    expect(compareWindows(0, 0, 0)).toMatchObject({ afterPace: 0, direction: "flat" });
  });
});

describe("the alerts a review opens with", () => {
  const quiet = { openReports: 0, oldestOpenHours: null, newReports: 0, newReportsBefore: 0, limits: [], hoursSinceReview: 1, surfacesOff: [] };

  it("is nothing on a quiet day with a fresh review", () => {
    expect(safetyAlerts(quiet)).toEqual([]);
  });

  it("puts an overdue report first, and flags spikes, a due review and switched-off surfaces", () => {
    const alerts = safetyAlerts({
      ...quiet,
      openReports: 2, oldestOpenHours: STALE_REPORT_HOURS + 3,
      newReports: 9, newReportsBefore: 2,
      limits: [{ action: "message", refused: 12, refusedBefore: 1 }, { action: "comment", refused: 3, refusedBefore: 0 }],
      hoursSinceReview: REVIEW_DUE_HOURS + 1,
      surfacesOff: ["Backing & merch"],
    });
    expect(alerts.map((a) => a.id)).toEqual(["stale-reports", "report-spike", "limit-spike-message", "review-due", "surfaces-off"]);
    expect(alerts[0].level).toBe("urgent");
  });

  it("says a review has never happened", () => {
    expect(safetyAlerts({ ...quiet, hoursSinceReview: null })[0]).toMatchObject({ id: "review-due", title: "No safety review yet" });
  });
});
