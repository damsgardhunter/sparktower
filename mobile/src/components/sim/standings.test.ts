/**
 * The league table's arithmetic.
 *
 * The two things worth pinning down here are the ones that would make the
 * screen lie quietly. `shareRead` is the difference between a team with a
 * fiftieth of a per cent and one with a tenth reading identically, and
 * `trajectory` decides the shape of a season — a scaling bug there draws a
 * flat year as a collapse, or a collapse as a flat year, and nobody would
 * check it against the figures printed underneath.
 */
import { describe, it, expect } from "vitest";
import {
  biggestNotBest, gapAhead, movementRead, ordinal, ownershipRead, reputationRead,
  shareRead, soldAway, soldUp, sortRows, standingLine, trajectory, valueGapAhead,
  wholeValue, yourRow, type HistoryPoint, type StandingRow,
} from "./standings";

const row = (over: Partial<StandingRow> = {}): StandingRow => ({
  id: "c1",
  name: "A Company",
  kind: "player",
  customers: 100_000,
  share: 0.1,
  // The table is ordered by this now, so every fixture carries one. Whole
  // ownership is the default; the rows that test dilution say so themselves.
  founderValue: 3_600_000,
  founderShare: 1,
  revenue: 3_000_000,
  reputation: 60,
  price: 30,
  isYou: false,
  distress: "healthy",
  rank: 1,
  ...over,
});

const table = (): StandingRow[] => [
  row({ id: "inc1", name: "Old Guard", kind: "incumbent", distress: null, customers: 600_000, share: 0.6, rank: 1, founderValue: 21_000_000 }),
  row({ id: "inc2", name: "Second Hand", kind: "incumbent", distress: null, customers: 200_000, share: 0.2, rank: 2, founderValue: 7_000_000 }),
  row({ id: "t1", name: "Rivals", customers: 120_000, share: 0.12, rank: 3, founderValue: 4_300_000 }),
  row({ id: "you", name: "Us", customers: 60_000, share: 0.06, rank: 4, isYou: true, founderValue: 2_100_000 }),
  row({ id: "t2", name: "Stragglers", customers: 20_000, share: 0.02, rank: 5, founderValue: 700_000 }),
];

describe("a share, at the precision it deserves", () => {
  it("keeps a decimal where one place would flatten the bottom of the table", () => {
    expect(shareRead(0.062)).toBe("6.2%");
    expect(shareRead(0.004)).toBe("0.4%");
  });

  it("rounds off the decimal once a share is big enough not to need it", () => {
    expect(shareRead(0.42)).toBe("42%");
    expect(shareRead(0.1)).toBe("10%");
  });

  it("refuses to round a sliver up to a tenth of a per cent", () => {
    expect(shareRead(0.0002)).toBe("<0.1%");
  });

  it("keeps a real zero, because a company that sold up genuinely has one", () => {
    expect(shareRead(0)).toBe("0%");
    expect(shareRead(Number.NaN)).toBe("0%");
  });
});

describe("the order of the table", () => {
  it("follows the rank the server sent", () => {
    const shuffled = [table()[3], table()[0], table()[4], table()[2], table()[1]];
    expect(sortRows(shuffled).map((r) => r.id)).toEqual(["inc1", "inc2", "t1", "you", "t2"]);
  });

  it("breaks a tie the same way every poll, so rows don't swap under a thumb", () => {
    const tied = [
      row({ id: "b", name: "Beta", rank: 1, customers: 10 }),
      row({ id: "a", name: "Alpha", rank: 1, customers: 10 }),
    ];
    expect(sortRows(tied).map((r) => r.id)).toEqual(["a", "b"]);
    expect(sortRows(tied).map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("leaves the caller's array alone", () => {
    const rows = table();
    sortRows(rows);
    expect(rows[0].id).toBe("inc1");
  });

  it("finds you, or admits it can't", () => {
    expect(yourRow(table())?.id).toBe("you");
    expect(yourRow([row()])).toBeNull();
    expect(yourRow(undefined)).toBeNull();
  });
});

describe("where you stand", () => {
  it("gives the position in the market and the position among the teams", () => {
    // Fourth of five overall, second of the three teams: both true, and
    // giving only one of them either flatters or buries a team.
    expect(standingLine(table())).toBe("4th of 5 in the market, 2nd of the 3 teams.");
  });

  it("says nothing when you aren't in the table", () => {
    expect(standingLine([row()])).toBeNull();
    expect(standingLine(undefined)).toBeNull();
  });

  it("names the company immediately ahead and the size of the gap", () => {
    expect(gapAhead(table())?.name).toBe("Rivals");
    expect(gapAhead(table())?.line).toBe("60,000 customers behind Rivals.");
  });

  it("has nothing to say to whoever is top", () => {
    const rows = table().map((r) => ({ ...r, isYou: r.id === "inc1" }));
    expect(gapAhead(rows)).toBeNull();
  });

  it("reads a dead heat as a tiebreak rather than a gap of zero", () => {
    const rows = [
      row({ id: "a", name: "Ahead", rank: 1, customers: 50 }),
      row({ id: "you", rank: 2, customers: 50, isYou: true }),
    ];
    expect(gapAhead(rows)?.line).toMatch(/Level with Ahead/);
  });

  it("writes ordinals a person would say out loud", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22].map(ordinal))
      .toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd"]);
  });
});

describe("the season as a shape", () => {
  const history: HistoryPoint[] = [
    { year: 1, share: 0.02, customers: 20_000, profit: -400_000, rank: 6 },
    { year: 2, share: 0.05, customers: 50_000, profit: 120_000, rank: 5 },
    { year: 3, share: 0.1, customers: 100_000, profit: 900_000, rank: 3 },
  ];

  it("scales to the company's own best year, not to the whole market", () => {
    // Four per cent of a crowded market is four flat lines against 100%, and
    // a season with no shape is a chart nobody can read anything from.
    const points = trajectory(history);
    expect(points.map((p) => Number(p.height.toFixed(4)))).toEqual([0.2, 0.5, 1]);
    expect(points.map((p) => p.peak)).toEqual([false, false, true]);
  });

  it("sorts the years even if they arrive out of order", () => {
    expect(trajectory([history[2], history[0], history[1]]).map((p) => p.year)).toEqual([1, 2, 3]);
  });

  it("keeps a zero year visible as a year rather than as a gap", () => {
    // The year a team sold the business is a real year with a real story.
    const points = trajectory([{ year: 1, share: 0.1, customers: 10, profit: 1, rank: 2 },
      { year: 2, share: 0, customers: 0, profit: 4_000_000, rank: 9 }]);
    expect(points[1].height).toBe(0.06);
    expect(points[1].profitable).toBe(true);
  });

  it("marks the losing years apart from the winning ones", () => {
    expect(trajectory(history).map((p) => p.profitable)).toEqual([false, true, true]);
  });

  it("has nothing to draw before the first year resolves", () => {
    expect(trajectory([])).toEqual([]);
    expect(trajectory(undefined)).toEqual([]);
  });

  it("survives a season where nobody has any share at all", () => {
    const points = trajectory([{ year: 1, share: 0, customers: 0, profit: 0, rank: 9 }]);
    expect(points[0].height).toBe(0.06);
    expect(points[0].peak).toBe(false);
  });
});

describe("whether that was a good year", () => {
  it("reports share and rank separately, because they disagree", () => {
    // Gained share and still slipped a place: somebody else gained more, and
    // collapsing that into one verdict would hide the only interesting part.
    const line = movementRead([
      { year: 1, share: 0.05, customers: 50_000, profit: 0, rank: 3 },
      { year: 2, share: 0.06, customers: 62_000, profit: 0, rank: 4 },
    ]);
    expect(line).toBe("Share up 1.0 points and you slipped a place to 4th.");
  });

  it("counts several places at once", () => {
    const line = movementRead([
      { year: 1, share: 0.05, customers: 1, profit: 0, rank: 7 },
      { year: 2, share: 0.09, customers: 1, profit: 0, rank: 4 },
    ]);
    expect(line).toBe("Share up 4.0 points and you climbed 3 places to 4th.");
  });

  it("says a flat year was flat rather than inventing a movement", () => {
    const line = movementRead([
      { year: 1, share: 0.05, customers: 1, profit: 0, rank: 4 },
      { year: 2, share: 0.0501, customers: 1, profit: 0, rank: 4 },
    ]);
    expect(line).toBe("Share held about level and you held 4th.");
  });

  it("introduces a first year instead of comparing it to nothing", () => {
    expect(movementRead([{ year: 1, share: 0.04, customers: 1, profit: 0, rank: 6 }]))
      .toBe("First year on the board: 4.0% of the market, 6th.");
    expect(movementRead([])).toBeNull();
  });
});

describe("the rows that need a sentence", () => {
  it("knows a team with nothing left has sold the business", () => {
    expect(soldUp(row({ customers: 0 }))).toBe(true);
    expect(soldUp(row({ customers: 1 }))).toBe(false);
    // An incumbent with no customers is a different story, and not one this
    // sentence is allowed to tell.
    expect(soldUp(row({ kind: "incumbent", customers: 0 }))).toBe(false);
  });

  it("puts reputation in words, since it decides what a company can borrow", () => {
    expect(reputationRead(90)).toBe("Trusted");
    expect(reputationRead(60)).toBe("Solid");
    expect(reputationRead(45)).toBe("Mixed");
    expect(reputationRead(30)).toBe("Shaky");
    expect(reputationRead(10)).toBe("Poor");
  });
});


// --- The scoreboard, after it stopped being about volume -------------------
/**
 * What the table is ordered by now.
 *
 * Ranking by customers made volume the only strategy worth playing and told
 * the smallest, most profitable company in the market that it was losing every
 * day. These tests pin the two things that replaced it: the order, and the
 * sentence that explains the order when the market produces a disagreement
 * worth explaining.
 */
describe("ordering by what the founders own", () => {
  it("falls back to founder value before customers when two rows share a rank", () => {
    // A malformed response is one bad sort away from a league table that lies,
    // so the tiebreak follows what the server actually ranked by.
    const tied = [
      row({ id: "a", name: "Anna Co", rank: 3, founderValue: 1_000_000, customers: 900_000 }),
      row({ id: "b", name: "Bee Co", rank: 3, founderValue: 4_000_000, customers: 100_000 }),
    ];
    expect(sortRows(tied).map((r) => r.id)).toEqual(["b", "a"]);
  });

  it("still ranks by the rank the server sent", () => {
    expect(sortRows(table()).map((r) => r.rank)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("the gap to whoever is ahead", () => {
  it("measures it in the terms the table is ordered by", () => {
    const gap = valueGapAhead(table())!;
    expect(gap.name).toBe("Rivals");
    expect(gap.value).toBe(2_200_000);
    expect(gap.line).toContain("founder-owned value");
  });

  it("says level rather than zero when two companies own the same", () => {
    const rows = [
      row({ id: "t1", name: "Rivals", rank: 1, founderValue: 2_000_000 }),
      row({ id: "you", name: "Us", rank: 2, isYou: true, founderValue: 2_000_000 }),
    ];
    expect(valueGapAhead(rows)!.line).toContain("Level with Rivals");
  });

  it("has nothing to say to whoever is top, or to a table you are not in", () => {
    expect(valueGapAhead([row({ id: "you", rank: 1, isYou: true })])).toBeNull();
    expect(valueGapAhead(table().map((r) => ({ ...r, isYou: false })))).toBeNull();
  });

  it("keeps the customer gap available and separate, since the two disagree", () => {
    // A team a hundred thousand customers behind and four million of value
    // ahead is a strategy working, and only both numbers say so.
    expect(gapAhead(table())!.line).toContain("customers behind Rivals");
  });
});

describe("what a team gave away to get here", () => {
  const diluted = row({ founderValue: 3_000_000, founderShare: 0.5 });

  it("works back to what the whole business is worth", () => {
    expect(wholeValue(diluted)).toBe(6_000_000);
    expect(soldAway(diluted)).toBe(3_000_000);
  });

  it("treats an undiluted company as owning all of its own value", () => {
    const whole = row({ founderValue: 3_000_000, founderShare: 1 });
    expect(wholeValue(whole)).toBe(3_000_000);
    expect(soldAway(whole)).toBe(0);
  });

  it("says nothing on a row where nothing was sold", () => {
    // An ownership line under every undiluted row would train people to skip
    // the ones where it is the whole story.
    expect(ownershipRead(row({ founderShare: 1 }))).toBeNull();
    expect(ownershipRead(diluted)).toContain("Founders hold 50%");
  });

  it("keeps a decimal for a stake small enough to be a footnote", () => {
    expect(ownershipRead(row({ founderShare: 0.004 }))).toContain("0.4%");
  });
});

describe("the sentence that explains the scoreboard", () => {
  it("names both companies when the biggest one isn't top", () => {
    const rows = [
      row({ id: "small", name: "Few and Rich", rank: 1, customers: 40_000, founderValue: 9_000_000 }),
      row({ id: "big", name: "Everywhere Ltd", rank: 2, customers: 500_000, founderValue: 3_000_000, founderShare: 0.2 }),
    ];
    const line = biggestNotBest(rows)!;
    expect(line).toContain("Everywhere Ltd");
    expect(line).toContain("Few and Rich");
    expect(line).toContain("Owning less of a bigger company");
  });

  it("stays quiet when the biggest company is also the top one", () => {
    // Nothing to explain, and an evergreen caption is read once and skipped
    // for the rest of the season.
    expect(biggestNotBest(table())).toBeNull();
    expect(biggestNotBest([row({ id: "only", rank: 1 })])).toBeNull();
  });

  it("stays quiet in a market where nobody has any customers yet", () => {
    expect(biggestNotBest([
      row({ id: "a", rank: 1, customers: 0 }),
      row({ id: "b", rank: 2, customers: 0 }),
    ])).toBeNull();
  });
});


describe("the shape of a season, in the unit it is scored in", () => {
  const years = (over: Partial<HistoryPoint>[]): HistoryPoint[] =>
    over.map((o, i) => ({ year: i + 1, share: 0.05, customers: 50_000, profit: 1, rank: 4, ...o }));

  it("draws the bars from founder value when every year has one", () => {
    const points = trajectory(years([
      { founderValue: 2_000_000 },
      { founderValue: 8_000_000 },
      { founderValue: 4_000_000 },
    ]));
    expect(points.map((p) => p.basis)).toEqual(["value", "value", "value"]);
    expect(points.map((p) => p.height)).toEqual([0.25, 1, 0.5]);
    expect(points.map((p) => p.peak)).toEqual([false, true, false]);
  });

  it("falls back to share rather than drawing half a season in each unit", () => {
    // A report written before the scoreboard changed has no founder value, and
    // a chart that mixed the two would be the one lie this screen can't afford.
    const points = trajectory(years([
      { share: 0.04, founderValue: null },
      { share: 0.08, founderValue: 6_000_000 },
    ]));
    expect(points.map((p) => p.basis)).toEqual(["share", "share"]);
    expect(points.map((p) => p.height)).toEqual([0.5, 1]);
  });

  it("keeps a zero year visible as a year, whichever unit it is drawn in", () => {
    const points = trajectory(years([{ founderValue: 0 }, { founderValue: 5_000_000 }]));
    expect(points[0].height).toBe(0.06);
  });
});
