/**
 * The year-end report, on a phone.
 *
 * Mirrors `client/src/pages/simulation-report.tsx`, whose own header calls it the
 * most important screen in the simulation and is right to: a decision you cannot
 * trace to an outcome is a decision you cannot learn from, and the whole promise
 * of a fortnight-long season is fourteen chances to learn. The phone had no such
 * screen and never called `/api/sim/ventures/:id/reports` at all, so a phone
 * player could read the one-line summary of the period just gone and never the
 * accounts, never the cash, never which rival took their customers, and never any
 * year before the last one.
 *
 * Laid out in the order a team argues about a bad year, which is the web's order
 * and worth keeping identical — two people in the same conversation should be
 * looking at the same thing in the same sequence:
 *
 *   1. The result, in one line.
 *   2. The accounts, every cost with the seat that spent it named beside it.
 *   3. The cash, from what it opened with to what it closed with.
 *   4. The customers, segment by segment: who took them and why.
 *   5. Everybody else, because that is half of why the year went as it did.
 *
 * **Every total here is the sum of the lines above it.** `accountsReconcile`
 * exists so that is a checked claim rather than a hopeful one, and the mirror
 * test runs it against accounts the real engine produced. A report that does not
 * add up is the one people stop reading.
 *
 * No React Native imports. That is what lets the mirror test load this.
 */

/** The year's accounts. Mirrors `ProfitAndLoss` in shared/simulation/resolve.ts. */
export interface ProfitAndLoss {
  revenue: number;
  costToServe: number;
  salaries: number;
  marketing: number;
  product: number;
  operations: number;
  idleCapacity: number;
  capacity?: number;
  planning?: number;
  incidents?: number;
  partners?: number;
  insurance?: number;
  interest: number;
  operatingProfit: number;
  tax: number;
  profit: number;
  lossesCarried: number;
}

export interface CashLine { label: string; amount: number }
export interface CashBridge { opening: number; lines: CashLine[]; closing: number }

/** One group of customers moving one way. Mirrors `Flow`. */
export interface Flow { id: string; name: string; count: number }

/** Mirrors `SegmentBridge` in shared/simulation/resolve.ts. */
export interface SegmentBridge {
  segmentId: string;
  name: string;
  start: number;
  lostTo: Flow[];
  wonFrom: Flow[];
  fresh: number;
  turnedAway: number;
  sentTo: Flow[];
  pickedUp: number;
  leftMarket: number;
  other: number;
  end: number;
  /** The biggest loss, in one sentence. Null when nothing was lost. */
  why: string | null;
  /** Where the company fell below what this segment expected. */
  shortOf: { axis: string; by: number; expected: number }[];
}

/** Mirrors `RivalMove`. What one other company visibly did. */
export interface RivalMove {
  id: string;
  name: string;
  kind: "player" | "incumbent";
  priceBefore: number;
  priceAfter: number;
  positioning: string | null;
  conceded: string[];
  spent: number;
  shareBefore: number;
  shareAfter: number;
  capacityBefore: number;
  capacityAfter: number;
}

/** What GET /api/sim/ventures/:id/reports{/:year} answers with. */
export interface ReportPayload {
  years: number[];
  year?: number;
  totalYears?: number;
  companyName?: string | null;
  niche: { id: string; name: string; voice: Record<string, string> };
  report: {
    year: number;
    customers: number;
    marketShare: number;
    shareChange: number;
    turnedAway: number;
    revenue: number;
    costs: number;
    profit: number;
    cash: number;
    debt: number;
    reputation: number;
    reputationChange: number;
    quality: number;
    brand: number;
    service: number;
    rank: number;
    value?: number;
    founderValue?: number;
    founderShare?: number;
    notes: string[];
    bankrupt?: boolean;
    pnl?: ProfitAndLoss;
    cashBridge?: CashBridge;
    segments?: SegmentBridge[];
    rivals?: RivalMove[];
  } | null;
}

const n = (v: unknown): number => (Number.isFinite(Number(v)) ? Number(v) : 0);

export interface AccountLine {
  label: string;
  /** The seat that spent it, named. */
  seat: string;
  amount: number;
  help?: string;
  /** True for the two lines that are not costs: sales, and a forecast that paid. */
  positive?: boolean;
}

/**
 * The accounts, each line with its owner.
 *
 * The seat that spent it is named beside each cost, and that is the entire point
 * of the card: it is what turns "we lost two million" into "marketing spent 2.1m
 * to win 900k", which is the argument the table is actually trying to have.
 *
 * Costs only — sales, planning, tax and the two profit lines are drawn separately
 * because they do not share a sign and a column that mixes them cannot be read as
 * a column. Lines worth nothing are kept rather than dropped: a zero against
 * "Idle capacity" is a fact about the year, and a seat looking for it should find
 * it rather than wonder whether it was omitted or never happened.
 */
export function accountLines(pnl: ProfitAndLoss): AccountLine[] {
  return [
    { label: "Cost to serve", seat: "operations", amount: n(pnl.costToServe), help: "Making and delivering what was sold." },
    { label: "Salaries", seat: "the table", amount: n(pnl.salaries), help: "Five seats, the staff, and more of both the wider you sell." },
    { label: "Marketing", seat: "marketing", amount: n(pnl.marketing) },
    { label: "Product", seat: "technology", amount: n(pnl.product), help: "Features, reliability, research and paying down debt." },
    { label: "Support and efficiency", seat: "operations", amount: n(pnl.operations), help: "Support, efficiency, recruiting, training, and the plant." },
    { label: "Capacity", seat: "operations", amount: n(pnl.capacity), help: "Room built and room leased this year." },
    { label: "Idle capacity", seat: "operations", amount: n(pnl.idleCapacity), help: "Room that was paid for and never used." },
    { label: "Incidents", seat: "the table", amount: n(pnl.incidents), help: "What a breach, lawsuit or recall cost to clean up, after any insurer paid." },
    { label: "Partner share", seat: "the table", amount: n(pnl.partners), help: "The cut of revenue owed on a distribution deal." },
    { label: "Insurance", seat: "finance", amount: n(pnl.insurance), help: "The premium on whatever the company chose to cover." },
    { label: "Interest", seat: "finance", amount: n(pnl.interest) },
  ];
}

/**
 * Does the column add up to the number at the bottom of it?
 *
 * The web's report says every total is the sum of the lines above it. This makes
 * that checkable from the phone's side, against accounts the engine actually
 * produced, because the failure it guards against is silent: a cost added to the
 * engine and not to `accountLines` leaves a report that is wrong by exactly the
 * new line and looks perfectly reasonable. Nobody reconciles a screen by hand.
 *
 * Returns the discrepancy rather than a boolean so a test can say how far out it
 * is, and so a tolerance is the caller's decision — these are floats summed in a
 * different order from the engine's own.
 */
export function accountsReconcile(pnl: ProfitAndLoss): {
  costs: number;
  expectedOperating: number;
  operatingOut: number;
  profitOut: number;
} {
  const costs = accountLines(pnl).reduce((sum, line) => sum + line.amount, 0);
  const expectedOperating = n(pnl.revenue) - costs + n(pnl.planning);
  return {
    costs,
    expectedOperating,
    operatingOut: expectedOperating - n(pnl.operatingProfit),
    profitOut: n(pnl.operatingProfit) - n(pnl.tax) - n(pnl.profit),
  };
}

/**
 * How a year went, in one word, from the figure the league table is ordered by.
 *
 * Profit rather than share, and said rather than coloured: a year can lose money
 * and be the right year, and a team reading a red number needs the sentence more
 * than it needs the colour.
 */
export function resultRead(report: NonNullable<ReportPayload["report"]>): { word: string; means: string } {
  if (report.bankrupt) return { word: "Over", means: "The company ran out of money and credit. There is nothing left to decide." };
  const profit = n(report.profit);
  const share = n(report.shareChange);
  if (profit > 0 && share > 0) return { word: "A good year", means: "Profitable, and a larger share of the market than you started it with." };
  if (profit > 0) return { word: "Profitable", means: "It made money, and it is not yet growing." };
  if (share > 0) return { word: "Bought growth", means: "A larger share of the market, paid for out of the bank." };
  return { word: "A bad year", means: "It lost money and it lost ground. The accounts below say which seat." };
}

/**
 * The biggest thing that happened to one segment, as a number and a direction.
 *
 * A segment's bridge has nine ways in and out and reading all nine on a phone is
 * not reading. This picks the largest single movement so the card can lead with
 * it and leave the rest to the detail underneath.
 */
export function biggestMove(segment: SegmentBridge): { label: string; count: number; good: boolean } | null {
  const moves: { label: string; count: number; good: boolean }[] = [
    ...segment.wonFrom.map((f) => ({ label: `won from ${f.name}`, count: n(f.count), good: true })),
    ...segment.lostTo.map((f) => ({ label: `lost to ${f.name}`, count: n(f.count), good: false })),
    { label: "new to the market", count: n(segment.fresh), good: true },
    { label: "picked up when a rival was full", count: n(segment.pickedUp), good: true },
    { label: "turned away", count: n(segment.turnedAway), good: false },
    { label: "left the market", count: n(segment.leftMarket), good: false },
  ].filter((m) => m.count > 0);
  if (moves.length === 0) return null;
  return moves.sort((a, b) => b.count - a.count)[0];
}

/**
 * What one rival visibly did, in the fewest words that are still true.
 *
 * Only the things that actually moved. A rival that changed nothing is worth
 * saying so about — "held everything" is information, and an empty row reads as a
 * bug — but a list of four unchanged numbers is not.
 */
export function rivalRead(rival: RivalMove): string[] {
  const out: string[] = [];
  const priceBefore = n(rival.priceBefore);
  const priceAfter = n(rival.priceAfter);
  if (Math.round(priceBefore) !== Math.round(priceAfter)) {
    out.push(`${priceAfter > priceBefore ? "raised" : "cut"} its price to ${Math.round(priceAfter)}`);
  }
  const shareMove = n(rival.shareAfter) - n(rival.shareBefore);
  if (Math.abs(shareMove) >= 0.005) {
    out.push(`${shareMove > 0 ? "took" : "gave up"} ${Math.abs(shareMove * 100).toFixed(1)}% of the market`);
  }
  const roomMove = n(rival.capacityAfter) - n(rival.capacityBefore);
  if (Math.abs(roomMove) > 0) {
    out.push(`${roomMove > 0 ? "built" : "closed"} room for ${Math.abs(Math.round(roomMove)).toLocaleString()}`);
  }
  if (rival.positioning) out.push(`is for ${rival.positioning}`);
  if (rival.conceded.length > 0) out.push(`stopped defending ${rival.conceded.join(" and ")}`);
  return out;
}

/**
 * Which year to show, and which years can be shown.
 *
 * The web has a route per year and the phone has one screen with a picker, so
 * this is the phone's own and has no mirror. A year asked for that does not exist
 * falls back to the latest rather than erroring: the only way to ask for a
 * missing year is a stale link, and a stale link should land on the report rather
 * than on an apology.
 */
export function yearToShow(years: number[], asked: number | null | undefined): number | null {
  const have = [...years].sort((a, b) => a - b);
  if (have.length === 0) return null;
  if (asked != null && have.includes(asked)) return asked;
  return have[have.length - 1];
}
