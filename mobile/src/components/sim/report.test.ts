/**
 * Reading a year that has already happened.
 *
 * The reconciliation — that the cost lines add up to the profit the engine wrote —
 * is checked in `test/unit/mobile-mirror.test.ts` against accounts from real
 * seasons, because that is the only place both halves can be imported and a
 * fixture could not catch the failure it guards against. What is checked here is
 * the reading laid on top: which movement a segment leads with, what a rival is
 * said to have done, and which year gets shown.
 */
import { describe, it, expect } from "vitest";
import {
  accountLines, accountsReconcile, biggestMove, resultRead, rivalRead, yearToShow,
  type ProfitAndLoss, type RivalMove, type SegmentBridge,
} from "./report";

const pnl = (over: Partial<ProfitAndLoss> = {}): ProfitAndLoss => ({
  revenue: 1_000_000,
  costToServe: 300_000,
  salaries: 200_000,
  marketing: 150_000,
  product: 100_000,
  operations: 50_000,
  idleCapacity: 0,
  capacity: 0,
  planning: 0,
  incidents: 0,
  partners: 0,
  insurance: 0,
  interest: 20_000,
  operatingProfit: 180_000,
  tax: 36_000,
  profit: 144_000,
  lossesCarried: 0,
  ...over,
});

const segment = (over: Partial<SegmentBridge> = {}): SegmentBridge => ({
  segmentId: "s1",
  name: "Homeowners",
  start: 1_000,
  lostTo: [],
  wonFrom: [],
  fresh: 0,
  turnedAway: 0,
  sentTo: [],
  pickedUp: 0,
  leftMarket: 0,
  other: 0,
  end: 1_000,
  why: null,
  shortOf: [],
  ...over,
});

const rival = (over: Partial<RivalMove> = {}): RivalMove => ({
  id: "r1",
  name: "Bricktop",
  kind: "player",
  priceBefore: 100,
  priceAfter: 100,
  positioning: null,
  conceded: [],
  spent: 0,
  shareBefore: 0.2,
  shareAfter: 0.2,
  capacityBefore: 5_000,
  capacityAfter: 5_000,
  ...over,
});

describe("the accounts", () => {
  it("reconciles a clean set to the profit on it", () => {
    const r = accountsReconcile(pnl());
    expect(r.costs).toBe(820_000);
    expect(r.operatingOut).toBe(0);
    expect(r.profitOut).toBe(0);
  });

  it("counts a forecast that paid as income rather than as a cost", () => {
    /*
     * Planning is the odd line: positive when the forecast was close, negative
     * when it was wide. Folding it in with the costs would make a good forecast
     * look like money spent.
     */
    const r = accountsReconcile(pnl({ planning: 50_000, operatingProfit: 230_000 }));
    expect(r.operatingOut).toBe(0);
  });

  it("reports the discrepancy rather than hiding it", () => {
    /*
     * The whole point of returning a number: a cost added to the engine and not
     * to `accountLines` has to be visible as exactly the size of the missing
     * line, so the failure names itself.
     */
    const r = accountsReconcile(pnl({ operatingProfit: 180_000 - 7_000 }));
    expect(r.operatingOut).toBe(7_000);
  });

  it("treats a missing optional line as nought, not as absent arithmetic", () => {
    /* Older reports have no `capacity`, `incidents`, `partners` or `insurance`. */
    const sparse = { ...pnl() } as any;
    delete sparse.capacity; delete sparse.incidents; delete sparse.partners; delete sparse.insurance;
    expect(accountsReconcile(sparse).operatingOut).toBe(0);
    expect(accountLines(sparse).length).toBe(accountLines(pnl()).length);
  });
});

describe("how a year reads", () => {
  it("leads with the ending when there is one", () => {
    const r = resultRead({ ...base(), bankrupt: true, profit: 500_000, shareChange: 0.1 });
    expect(r.word).toBe("Over");
  });

  it("separates profitable-and-growing from profitable-and-still", () => {
    expect(resultRead({ ...base(), profit: 10, shareChange: 0.01 }).word).toBe("A good year");
    expect(resultRead({ ...base(), profit: 10, shareChange: -0.01 }).word).toBe("Profitable");
  });

  it("names growth that was bought rather than earned", () => {
    /*
     * Losing money while taking share is a strategy, not a failure, and a screen
     * that calls it a bad year is arguing with the player about something they
     * did on purpose.
     */
    expect(resultRead({ ...base(), profit: -1_000, shareChange: 0.03 }).word).toBe("Bought growth");
  });

  it("says plainly when a year was simply bad", () => {
    const r = resultRead({ ...base(), profit: -1_000, shareChange: -0.03 });
    expect(r.word).toBe("A bad year");
    expect(r.means).toContain("which seat");
  });
});

describe("where the customers went", () => {
  it("leads with the largest single movement", () => {
    const move = biggestMove(segment({
      lostTo: [{ id: "r1", name: "Bricktop", count: 400 }],
      wonFrom: [{ id: "r2", name: "Ironwood", count: 90 }],
      fresh: 120,
    }));
    expect(move).toEqual({ label: "lost to Bricktop", count: 400, good: false });
  });

  it("knows which movements are good news", () => {
    expect(biggestMove(segment({ fresh: 500 }))?.good).toBe(true);
    expect(biggestMove(segment({ turnedAway: 500 }))?.good).toBe(false);
    expect(biggestMove(segment({ leftMarket: 500 }))?.good).toBe(false);
    expect(biggestMove(segment({ pickedUp: 500 }))?.good).toBe(true);
  });

  it("has nothing to say about a segment where nothing moved", () => {
    /* Better than inventing a movement of zero and leading the card with it. */
    expect(biggestMove(segment())).toBeNull();
  });
});

describe("what a rival did", () => {
  it("says only what actually moved", () => {
    const said = rivalRead(rival({ priceAfter: 120, shareAfter: 0.26, capacityAfter: 7_000 }));
    expect(said.some((s) => s.includes("raised its price to 120"))).toBe(true);
    expect(said.some((s) => s.includes("took 6.0%"))).toBe(true);
    expect(said.some((s) => s.includes("built room for 2,000"))).toBe(true);
  });

  it("says a cut is a cut and a retreat is a retreat", () => {
    const said = rivalRead(rival({ priceAfter: 80, shareAfter: 0.14, capacityAfter: 4_000 }));
    expect(said.some((s) => s.includes("cut its price"))).toBe(true);
    expect(said.some((s) => s.includes("gave up"))).toBe(true);
    expect(said.some((s) => s.includes("closed room"))).toBe(true);
  });

  it("stays quiet about a company that held everything", () => {
    /*
     * Nothing to say is the honest answer, and the screen renders its own
     * sentence for it — a row of four unchanged numbers is not information.
     */
    expect(rivalRead(rival())).toEqual([]);
  });

  it("ignores a share wobble too small to mean anything", () => {
    /* A tenth of a point is rounding in a market of millions, not a move. */
    expect(rivalRead(rival({ shareAfter: 0.2004 }))).toEqual([]);
  });

  it("carries a declared position and a conceded one", () => {
    const said = rivalRead(rival({ positioning: "homeowners", conceded: ["public", "developers"] }));
    expect(said.some((s) => s.includes("is for homeowners"))).toBe(true);
    expect(said.some((s) => s.includes("stopped defending public and developers"))).toBe(true);
  });
});

describe("which year to show", () => {
  it("shows the year asked for when there is one", () => {
    expect(yearToShow([1, 2, 3], 2)).toBe(2);
  });

  it("shows the latest when nothing was asked for", () => {
    /* Opening the report means "how did we just do", not "how did year one go". */
    expect(yearToShow([1, 2, 3], null)).toBe(3);
    expect(yearToShow([3, 1, 2], undefined)).toBe(3);
  });

  it("falls back to the latest rather than erroring on a stale link", () => {
    /*
     * The only way to ask for a year that does not exist is an old link, and an
     * old link should land on the report rather than on an apology.
     */
    expect(yearToShow([1, 2], 9)).toBe(2);
  });

  it("has no year to show before anything has resolved", () => {
    expect(yearToShow([], 1)).toBeNull();
    expect(yearToShow([], null)).toBeNull();
  });
});

function base() {
  return {
    year: 3, customers: 1_000, marketShare: 0.1, shareChange: 0, turnedAway: 0,
    revenue: 1_000, costs: 900, profit: 100, cash: 500, debt: 0,
    reputation: 50, reputationChange: 0, quality: 50, brand: 50, service: 50,
    rank: 2, notes: [] as string[],
  };
}
