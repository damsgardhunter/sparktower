/**
 * What the simulator said would happen, against what did.
 *
 * Every projection here was written and never marked. A founder could run a
 * scenario in March, watch six months go by, and the page would still show the
 * March answer as confidently as the day it was made — with no way to learn the
 * one thing this tool is uniquely placed to teach them, which is how good their
 * own forecasting is. A simulator that never tells you it was wrong is a
 * simulator nobody gets better at using.
 *
 * So: for a scenario old enough to have been overtaken by real weeks, line its
 * projected months up against the revenue actually filed in the check-ins and
 * say plainly how far apart they were, and in which direction. Not to score the
 * engine — the engine only did what its assumptions said — but to score the
 * assumptions, which are the owner's.
 *
 * Deliberately one-directional and blunt. "You were 40% over" is useful.
 * A confidence interval around the error is not: it would be a second
 * projection about the first, and the person reading it has a business to run.
 */
import type { Run } from "./decision-sim";

export interface MonthMarked {
  /** Month of the projection, 1-based. */
  month: number;
  predicted: number;
  actual: number;
  /** actual/predicted − 1. Positive means it beat the projection. */
  off: number;
}

export interface Hindsight {
  /** How many months could be checked at all. */
  checked: number;
  months: MonthMarked[];
  /** The median of `off`, which is the honest headline. */
  typicalOff: number;
  /** Whether the projection ran high, low, or close. */
  lean: "over" | "under" | "close";
  /** One sentence, written for the owner. */
  line: string;
}

/** Inside this, a projection was right for any purpose anybody uses one for. */
const CLOSE_ENOUGH = 0.15;

/**
 * Mark a projection against what was filed.
 *
 * `actualByMonth` is revenue actually recorded for month 1, 2, 3… of the
 * projection — whatever the caller can reconstruct from the check-ins. A month
 * with no figure is skipped rather than counted as zero, because a week nobody
 * filed is not a week with no trade, and treating it as one would tell every
 * owner who went on holiday that they had missed their forecast.
 */
export function markProjection(run: Run, actualByMonth: (number | null)[]): Hindsight | null {
  const months: MonthMarked[] = [];
  for (let i = 0; i < Math.min(run.months.length, actualByMonth.length); i += 1) {
    const actual = actualByMonth[i];
    if (actual == null) continue;
    const predicted = run.months[i].revenue;
    // Nothing predicted and nothing happened is agreement, not a division by zero.
    if (predicted <= 0 && actual <= 0) continue;
    if (predicted <= 0) continue;
    months.push({ month: i + 1, predicted, actual, off: actual / predicted - 1 });
  }
  if (!months.length) return null;

  const offs = months.map((m) => m.off).sort((a, b) => a - b);
  const typicalOff = offs[Math.floor(offs.length / 2)];
  const lean = Math.abs(typicalOff) <= CLOSE_ENOUGH ? "close" : typicalOff < 0 ? "over" : "under";

  const pct = Math.abs(Math.round(typicalOff * 100));
  const line = lean === "close"
    ? `Checked against what you actually filed, this projection has been within ${pct}% — close, across ${months.length} month${months.length === 1 ? "" : "s"}. Worth trusting the next one about this much.`
    : lean === "over"
      ? `Checked against what you actually filed, this projection ran about ${pct}% high across ${months.length} month${months.length === 1 ? "" : "s"}. The assumptions underneath it were optimistic by roughly that much, and the next one probably is too.`
      : `Checked against what you actually filed, this projection ran about ${pct}% low across ${months.length} month${months.length === 1 ? "" : "s"}. You did better than you told it you would.`;

  return { checked: months.length, months, typicalOff, lean, line };
}
