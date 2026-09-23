/**
 * The track record is read by companies deciding whether to approach
 * somebody, so the thing under test is mostly that it says nothing the plays
 * don't: counts add up, unresolved years don't count, a running season is not
 * a finish, and every strength is a threshold someone could check.
 */
import { describe, it, expect } from "vitest";
import { buildTrackRecord, summaryOf, type SeatPlay } from "@shared/track-record";

const play = (over: Partial<SeatPlay> = {}): SeatPlay => ({
  seasonId: `s${Math.random()}`, seasonName: "Spring", nicheName: "Podcasts", seasonStatus: "finished",
  role: "cfo", yearsPlayed: 14, yearsFiled: 14, rank: 2, fieldSize: 8,
  objectives: { met: 8, partial: 3, missed: 3 },
  ...over,
});

describe("building a track record", () => {
  it("is empty, and says so, for somebody who has never played", () => {
    const r = buildTrackRecord([], []);
    expect(r).toMatchObject({ empty: true, seasonsPlayed: 0, turnout: null, bestFinish: null, averagePercentile: null, strengths: [], score: 0 });
    expect(r.startupGames).toEqual({ scored: 0, average: null, best: null });
  });

  it("counts seasons, seats, turnout and objectives from the plays", () => {
    const r = buildTrackRecord([
      play({ role: "cfo", yearsPlayed: 14, yearsFiled: 13, objectives: { met: 6, partial: 4, missed: 4 } }),
      play({ role: "ceo", yearsPlayed: 6, yearsFiled: 6, seasonStatus: "running", rank: 1, objectives: { met: 2, partial: 0, missed: 4 } }),
    ], []);
    expect(r.seasonsPlayed).toBe(2);
    expect(r.seats).toEqual([{ role: "ceo", title: "Chief Executive", count: 1 }, { role: "cfo", title: "Chief Financial Officer", count: 1 }]);
    expect(r.yearsPlayed).toBe(20);
    expect(r.yearsFiled).toBe(19);
    expect(r.turnout).toBeCloseTo(19 / 20);
    expect(r.objectives).toMatchObject({ met: 8, partial: 4, missed: 8, total: 20, metRate: 0.4 });
    // A running season's first place is a standing, not a finish.
    expect(r.finishes).toBe(1);
    expect(r.bestFinish).toEqual({ rank: 2, of: 8, role: "cfo", seasonName: "Spring" });
  });

  it("leaves out lobbies, and never counts more years filed than played", () => {
    const r = buildTrackRecord([play({ yearsPlayed: 0, yearsFiled: 0 }), play({ yearsPlayed: 3, yearsFiled: 5, seasonStatus: "running" })], []);
    expect(r.seasonsPlayed).toBe(1);
    expect(r.yearsFiled).toBe(3);
    expect(r.turnout).toBe(1);
    expect(r.seasons).toHaveLength(1);
  });

  it("averages finishing position as a percentile of the field", () => {
    const r = buildTrackRecord([play({ rank: 1, fieldSize: 5 }), play({ rank: 5, fieldSize: 5 }), play({ rank: 3, fieldSize: 5 })], []);
    expect(r.averagePercentile).toBe(50);
    expect(r.bestFinish?.rank).toBe(1);
  });

  it("counts only the startup games it is given, with average and best", () => {
    const r = buildTrackRecord([], [{ overall: 600 }, { overall: 800 }]);
    expect(r.empty).toBe(false);
    expect(r.startupGames).toEqual({ scored: 2, average: 700, best: 800 });
    expect(r.strengths).toContain("Scored 800 out of 1000 in the startup game");
  });

  it("says strengths only when the counts support them", () => {
    const strong = buildTrackRecord([
      play({ role: "cfo", rank: 2, fieldSize: 8 }),
      play({ role: "cfo", rank: 3, fieldSize: 8 }),
      play({ role: "ceo", rank: 1, fieldSize: 8 }),
    ], []);
    expect(strong.strengths).toEqual(expect.arrayContaining([
      "Files every year (42 of 42)",
      "Won a season",
      "Finished top 3 twice as Chief Financial Officer",
    ]));

    // One missed year of three: no "files every year"; a top 3 in a field of three is not worth saying.
    const thin = buildTrackRecord([play({ yearsPlayed: 3, yearsFiled: 2, rank: 2, fieldSize: 3, objectives: { met: 1, partial: 0, missed: 2 } })], []);
    expect(thin.strengths).toEqual([]);
  });

  it("ranks more evidence of doing well above less", () => {
    const solid = buildTrackRecord([play(), play(), play()], []);
    const once = buildTrackRecord([play({ yearsPlayed: 2, yearsFiled: 1, rank: 6, fieldSize: 8, objectives: { met: 0, partial: 0, missed: 2 } })], []);
    expect(solid.score).toBeGreaterThan(once.score);
    expect(summaryOf(solid)).not.toHaveProperty("seasons");
  });
});
