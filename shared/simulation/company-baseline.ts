/**
 * The company's own numbers, turned into a starting position for the
 * simulator.
 *
 * ## Why this is not simply "read the check-ins"
 *
 * The weekly check-in asks a business for the five numbers that tell it
 * whether the week went well. The simulator needs a different five: what comes
 * in, what goes out, what is in the bank, what is owed and how many people are
 * on the payroll. Those overlap and do not coincide. A restaurant files covers
 * and average spend, which is revenue; nothing it files is its cost base. A
 * software company files new revenue and churn, neither of which is a total.
 * Nobody files their loan.
 *
 * So this reads what it honestly can, says where each figure came from, and
 * leaves the rest at zero for the owner to fill in. The alternative — deriving
 * a cost base from a margin from a revenue, or assuming everybody's loan is
 * nothing — would produce a complete-looking baseline that is mostly invention,
 * and the first projection run off it would be wrong in a way nobody could
 * trace.
 *
 * ## The owner's number always wins
 *
 * A field the owner has typed is never overwritten by a later read, which is
 * what `overridden` is for. Someone who corrects their cost base to $14,000
 * and comes back next week to find the check-ins have quietly put it back to
 * zero will not correct it twice.
 *
 * Pure: the check-in rows come in, a baseline goes out.
 */
import { metricFor, type CheckinLike } from "../company-rhythm";
import { readMargin, readWeeklyRevenue } from "../what-would-it-take";
import { cleanBaseline, emptyBaseline, type Baseline } from "./decision-sim";
import { symbolOf } from "../currency";

/** Weeks to a month, for turning a weekly check-in into a monthly figure. */
export const WEEKS_PER_MONTH = 52 / 12;

export type BaselineField = keyof Baseline;

/** Where one field's number came from, for showing the owner what they are looking at. */
export interface FieldSource {
  field: BaselineField;
  /** "Covers × average spend, averaged over the last 6 weeks you filed." */
  from: string;
}

export interface BaselineRead {
  baseline: Baseline;
  /** Only for the fields the check-ins could actually answer. */
  sources: FieldSource[];
  /** Fields nobody has filled in and the check-ins cannot answer. */
  missing: BaselineField[];
}

/** What each field is called on screen, and the one line explaining it. */
export const FIELD_COPY: Record<BaselineField, { label: string; hint: string }> = {
  monthlyRevenue: { label: "Money in, a month", hint: "What the business takes in an ordinary month, before any costs." },
  monthlyCosts: { label: "Money out, a month", hint: "Everything it pays out in an ordinary month: wages, rent, stock, software, the lot." },
  cash: { label: "In the bank", hint: "What is actually there today. Overdrawn is a number too — put it in as a minus." },
  debt: { label: "Owed", hint: "Loans, finance agreements, anything with a balance. Not this month's unpaid bills." },
  interestRate: { label: "Interest on it", hint: "What that borrowing costs a year, as a percentage." },
  debtRepayment: { label: "Repaid a month", hint: "What comes off the balance each month, on top of the interest." },
  growth: { label: "Growing by, a month", hint: "How much revenue moves on its own each month without any new decision. Most businesses are near zero, and a minus is allowed." },
  // Names a currency, so it is the one label `fieldCopyIn` has to rewrite.
  // The default is the default currency's; nothing should render this copy
  // directly on a project that has said what it counts in.
  grossMargin: { label: "Kept per extra $1", hint: "Of every extra unit of revenue, what is left once the cost of delivering it is paid. A restaurant is around 25–30%; software is 80%+." },
  staff: { label: "People on the payroll", hint: "Including you, if the business pays you." },
  ownerHours: { label: "Hours a week you can give it", hint: "What you can honestly put in, after the day job and everything else. Leave it at 0 and the plan is never held back by your time — which is rarely true and is how a plan built on your evenings reads as working." },
  daysToGetPaid: { label: "Days before you're paid", hint: "0 if the money arrives when the work does. 30 or 60 if you invoice. The commonest way a profitable business runs out of cash." },
  taxRate: { label: "Tax on profit", hint: "Roughly what goes to the taxman out of the profit. Leave it at 0 only if you genuinely pay none." },
  seasonalSwing: { label: "How far the quiet months fall", hint: "0 for a business that is the same all year. 30% means your worst month is about a third down and your best about a third up." },
  bestMonth: { label: "Your best month", hint: "Which month of the year is the busiest. Only matters if the quiet months fall at all." },
};

/**
 * The same copy, in the money this business actually counts in.
 *
 * One label names a currency, and it used to name two at once — "Kept per
 * extra £1/$1" — which was an honest hedge back when a project could not say
 * what it counted in. It can (migration 0056), and the hedge had become the
 * only wrong number on a screen whose summary line above it already read
 * "€0 in, €0 out, €0 in the bank". A business counting in euros, Canadian or
 * Australian dollars was offered a pound and a US dollar and neither was its.
 */
export function fieldCopyIn(currency: unknown): Record<BaselineField, { label: string; hint: string }> {
  return {
    ...FIELD_COPY,
    grossMargin: { ...FIELD_COPY.grossMargin, label: `Kept per extra ${symbolOf(currency)}1` },
  };
}

/** The order the fields read best in, which is not the order they are declared in. */
export const FIELD_ORDER: BaselineField[] = [
  "monthlyRevenue", "monthlyCosts", "grossMargin", "cash",
  "debt", "interestRate", "debtRepayment", "staff", "growth",
  // The facts of a real business that the arithmetic used to assume away:
  // that the owner's week is finite, that money arrives later than the work,
  // that the taxman takes a share, and that most trades have a bad January.
  "ownerHours", "daysToGetPaid", "taxRate", "seasonalSwing", "bestMonth",
];

/** How a field is typed and shown: money, a percentage, or a count. */
export const FIELD_UNIT: Record<BaselineField, "money" | "percent" | "count"> = {
  monthlyRevenue: "money", monthlyCosts: "money", cash: "money", debt: "money",
  interestRate: "percent", debtRepayment: "money", growth: "percent",
  grossMargin: "percent", staff: "count",
  ownerHours: "count", daysToGetPaid: "count", taxRate: "percent",
  seasonalSwing: "percent", bestMonth: "count",
};

/**
 * What the check-ins can answer, on top of what the owner has already saved.
 *
 * `saved` is the stored baseline, or null before one exists. `overridden` is
 * the fields the owner has typed; those are returned untouched whatever the
 * check-ins say.
 */
export function readBaseline(input: {
  subcategory: unknown;
  checkins: CheckinLike[];
  saved?: Baseline | null;
  overridden?: readonly string[];
  weeks?: number;
}): BaselineRead {
  const { subcategory, checkins, weeks = 8 } = input;
  const owner = new Set(input.overridden ?? []);
  const base = cleanBaseline(input.saved ?? emptyBaseline());
  const sources: FieldSource[] = [];

  /** Set a field from the check-ins, unless the owner has had their say about it. */
  const fill = (field: BaselineField, value: number, from: string) => {
    if (owner.has(field) || !Number.isFinite(value)) return;
    base[field] = value;
    sources.push({ field, from });
  };

  const revenue = readWeeklyRevenue(subcategory, checkins, weeks);
  if (revenue) fill("monthlyRevenue", Math.round(revenue.weekly * WEEKS_PER_MONTH), revenue.from);

  /*
   * Cash is the one balance a check-in holds, and it is a balance rather than
   * a flow — so the latest filed figure, not an average. An average of the
   * last eight weeks' bank balance is not a number that means anything.
   */
  const sorted = [...checkins].sort((a, b) => b.weekOf.localeCompare(a.weekOf));
  for (const checkin of sorted) {
    const numbers = (checkin.numbers ?? {}) as Record<string, unknown>;
    const value = Number(numbers.cash);
    if (Number.isFinite(value)) {
      fill("cash", Math.round(value), `${metricFor("cash").label}, as filed for the week of ${checkin.weekOf}.`);
      break;
    }
  }

  const margin = readMargin(subcategory, checkins, weeks);
  if (margin) fill("grossMargin", Math.round(margin.fraction * 100) / 100, margin.from);

  const missing = FIELD_ORDER.filter((f) => {
    if (owner.has(f)) return false;
    // A rate and a margin have defaults that are defensible; a revenue does not.
    if (f === "interestRate" || f === "grossMargin" || f === "growth") return false;
    return !base[f];
  });

  return { baseline: cleanBaseline(base), sources, missing };
}
