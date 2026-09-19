/**
 * The first million.
 *
 * Round five hands the pair a million dollars and a year, and asks where it
 * goes. It is the round the valuation leans on hardest, because it is the only
 * one where the players commit to something with a cost: anybody can say they
 * are building a marketplace, but a budget with nothing in marketing and
 * nothing in sales is a company that has decided, in public, how it intends to
 * find customers.
 *
 * ## Why a million and a year
 *
 * Both numbers are chosen to make the trade-offs legible rather than
 * realistic. A million is small enough that a senior engineer is visibly a
 * sixth of it — you cannot have one of everything, and finding that out by
 * watching the bar refuse to fit is the entire lesson of the round. A year is
 * long enough that "keep it in the bank" is a real strategy rather than
 * cowardice.
 *
 * ## How two people share one budget
 *
 * They each build their own, and the committed budget is the **average**.
 *
 * The alternatives are worse. Letting one person hold the money makes the
 * other a spectator in the round that matters most. Requiring them to agree
 * line by line turns a six-minute round into a negotiation that cannot
 * finish. Averaging means both are always heard, a disagreement lands
 * somewhere between the two positions rather than on one of them, and — the
 * part that makes it a game rather than a formality — you can see in the
 * result exactly where you were talked round and where you weren't.
 *
 * Pure: no database, no clock.
 */
import { SPEND_OPTIONS, type SpendOption } from "./cards";

/** What they are given. */
export const BUDGET_TOTAL = 1_000_000;

/** An allocation: option id → dollars. Missing means zero. */
export type Allocation = Record<string, number>;

export const emptyAllocation = (): Allocation =>
  Object.fromEntries(SPEND_OPTIONS.map((o) => [o.id, 0]));

export const allocated = (a: Allocation): number =>
  Object.values(a).reduce((sum, n) => sum + (Number.isFinite(n) ? n : 0), 0);

export const unallocated = (a: Allocation): number => BUDGET_TOTAL - allocated(a);

/**
 * An allocation cleaned up into something that can be committed.
 *
 * Everything here is a rule the screen should already be enforcing; this is
 * what makes it true anyway, because the screen is not the authority and a
 * crafted request is not an unusual thing to receive.
 *
 *   - unknown lines are dropped, so nobody funds a category that doesn't exist
 *   - negatives become zero, because a negative line is a loan, not a budget
 *   - each line is snapped to its own step, so the committed numbers look like
 *     numbers a person chose
 *   - the total can never exceed the budget
 */
export function cleanAllocation(raw: unknown): Allocation {
  const source = (raw ?? {}) as Record<string, unknown>;
  const out = emptyAllocation();

  for (const option of SPEND_OPTIONS) {
    const n = Number(source[option.id]);
    if (!Number.isFinite(n) || n <= 0) continue;
    out[option.id] = Math.min(BUDGET_TOTAL, Math.round(n / option.step) * option.step);
  }

  return trimToBudget(out);
}

/**
 * Bring an over-committed allocation back inside the budget.
 *
 * Takes the overspend off the largest lines first, which is both the least
 * destructive way to do it — a 5,000 line survives intact rather than being
 * wiped by a proportional trim — and the least surprising, since the line you
 * see shrink is the one you put the most into.
 */
export function trimToBudget(a: Allocation): Allocation {
  const out = { ...a };
  let over = allocated(out) - BUDGET_TOTAL;
  if (over <= 0) return out;

  const byLargest = Object.keys(out).sort((x, y) => (out[y] ?? 0) - (out[x] ?? 0));
  for (const id of byLargest) {
    if (over <= 0) break;
    const take = Math.min(out[id] ?? 0, over);
    out[id] = (out[id] ?? 0) - take;
    over -= take;
  }
  return out;
}

/**
 * Two allocations into the one they commit to.
 *
 * The mean, line by line, then snapped and trimmed so the result is a budget
 * somebody could have built by hand rather than an artefact of the averaging.
 * Any rounding shortfall goes to the bank, which is the only line where an
 * arbitrary few thousand dollars means something honest.
 */
export function mergeAllocations(allocations: Allocation[]): Allocation {
  if (allocations.length === 0) return emptyAllocation();
  if (allocations.length === 1) return cleanAllocation(allocations[0]);

  const merged = emptyAllocation();
  for (const option of SPEND_OPTIONS) {
    const mean = allocations.reduce((sum, a) => sum + (Number(a[option.id]) || 0), 0) / allocations.length;
    merged[option.id] = Math.round(mean / option.step) * option.step;
  }

  const trimmed = trimToBudget(merged);
  const left = unallocated(trimmed);
  if (left > 0) trimmed.runway = (trimmed.runway ?? 0) + left;
  return trimmed;
}

/**
 * What a budget actually bought.
 *
 * A line funded below its `minimumUseful` is money spent on something that
 * doesn't exist — half a senior engineer is not half a product, it is an
 * unfilled role and a hole in the bank. The screen shows these as underfunded
 * rather than silently counting them, and the valuation is told about them,
 * because "we funded seven things badly" is the single most common way a first
 * million disappears.
 */
export interface BudgetLine {
  option: SpendOption;
  amount: number;
  /** Funded, but not enough to buy the thing it names. */
  underfunded: boolean;
}

export interface BudgetSummary {
  total: number;
  unallocated: number;
  lines: BudgetLine[];
  /** Funded lines, largest first — what the company actually did this year. */
  funded: BudgetLine[];
  underfunded: BudgetLine[];
  /** Share of the budget by group, for the visual breakdown. */
  byGroup: { group: string; amount: number; share: number }[];
  /**
   * How much of the million went into things that might pay it back, as
   * opposed to sitting in the bank. Not a judgement — a budget that is all
   * bank is cautious, and one that is none is brave — but it is the number the
   * capital-efficiency score is largely about.
   */
  deployed: number;
}

export function summariseBudget(a: Allocation): BudgetSummary {
  const clean = cleanAllocation(a);
  const lines: BudgetLine[] = SPEND_OPTIONS.map((option) => {
    const amount = clean[option.id] ?? 0;
    return {
      option,
      amount,
      underfunded: amount > 0 && amount < option.minimumUseful,
    };
  });

  const groups = new Map<string, number>();
  for (const line of lines) groups.set(line.option.group, (groups.get(line.option.group) ?? 0) + line.amount);

  const total = allocated(clean);
  const deployed = total - (clean.runway ?? 0);

  return {
    total,
    unallocated: BUDGET_TOTAL - total,
    lines,
    funded: lines.filter((l) => l.amount > 0).sort((x, y) => y.amount - x.amount),
    underfunded: lines.filter((l) => l.underfunded),
    byGroup: [...groups.entries()]
      .map(([group, amount]) => ({ group, amount, share: total > 0 ? amount / total : 0 }))
      .sort((x, y) => y.amount - x.amount),
    deployed,
  };
}

/** Whether a budget is finished enough to commit. */
export function budgetIsReady(a: Allocation): { ok: true } | { ok: false; reason: string } {
  const left = unallocated(cleanAllocation(a));
  if (left < 0) return { ok: false, reason: "That's more than a million." };
  /*
   * Leaving some unspent is a real decision — "keep it in the bank" is a line
   * on the board — so the only thing refused here is a budget nobody touched.
   * A player who wants to bank the lot can, by putting it there on purpose.
   */
  if (left === BUDGET_TOTAL) return { ok: false, reason: "Spend at least some of it." };
  return { ok: true };
}

/** Money, the way the screens write it. */
export function money(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000_000) return `$${(n / 1_000_000_000_000).toFixed(abs >= 10_000_000_000_000 ? 0 : 1)}T`;
  if (abs >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(abs >= 10_000_000_000 ? 0 : 1)}B`;
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 1_000) return `$${Math.round(n / 1_000)}k`;
  return `$${Math.round(n)}`;
}
