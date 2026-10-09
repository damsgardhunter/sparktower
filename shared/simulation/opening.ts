/**
 * Where a company starts, when it starts where it actually is.
 *
 * Every season so far has opened the same way: a funded company with money in
 * the bank, a credit line, and nobody to serve. That is a fair contest and it
 * is not most people's situation. Somebody four milestones into a path has no
 * money, no credit and no customers, and a simulation that hands them six
 * million pounds is teaching them to run a company that is not theirs.
 *
 * So a season can be opened two ways.
 *
 *   - **Competitive**: everyone starts level, funded, with room to move. The
 *     right choice for a table competing against other tables, and for
 *     learning the levers without the first three years being about survival.
 *   - **Where you actually are**: the balance sheet the project has earned.
 *     Little or no cash, a credit rating that reflects having no trading
 *     history, and whatever customers and reputation the work so far implies.
 *     Harder, and the only version that answers "what would happen if we did
 *     this for real".
 *
 * The second is not a handicap setting. It is a different question, and the
 * lesson it teaches is the one people came for: with nothing in the bank the
 * first decision is where money comes from, and borrowing against a thin
 * rating is expensive in a way no amount of reading conveys.
 */
import type { Company, Niche } from "./types";

export type Opening = "competitive" | "actual";

/**
 * How far into the work a project is, 0 to 1.
 *
 * The honest signal available: a path's milestones done against its total.
 * Not revenue, because the product does not know anybody's revenue, and
 * asking would be asking somebody to type their own handicap.
 */
export interface Standing {
  /** Milestones done over milestones total, 0–1. */
  progress: number;
  /** How many people are actually on it. A solo founder is a different company from five. */
  people: number;
}

/**
 * What the balance sheet looks like at a given point in the work.
 *
 * The bands are deliberately coarse. A percentage of a path is not an
 * accounting fact, and pretending it maps to a precise bank balance would be
 * false precision about somebody's real business. Four recognisable stages,
 * each of which changes what the first year is about.
 */
export interface OpeningPosition {
  /** Multiplier on the funded opening cash. Zero means exactly that. */
  cash: number;
  /** Multiplier on the funded credit line. */
  credit: number;
  /** Credit score, 0–100. Thin files borrow expensively, if at all. */
  creditScore: number;
  /** Brand, 0–100, against the funded opening of 8. */
  brand: number;
  /** Reputation, 0–100, against the funded opening of 50. */
  reputation: number;
  /** Share of the opening capacity already serving somebody. */
  customers: number;
  /**
   * What the founders draw, against a full executive salary each.
   *
   * A funded season pays five market salaries from the first day, which is
   * right for a company that raised money to hire a team and wrong for the
   * people this opening is for: nobody starting a business out of their own
   * savings pays themselves £140,000 before they have a customer. They take
   * what is left, which early on is nothing.
   *
   * It is also what made this opening unplayable. A competent founder on
   * £60,000 was insolvent by year three in two markets out of three, and the
   * one that lived turned £60,000 into £14,418 — because the executive bill
   * arrived every year from the first, against a plant at two per cent of the
   * funded size and no customers at all. Nothing in the suite noticed, because
   * all 261 balance guards test the funded opening.
   */
  officerPay: number;
  /**
   * How much of the funded opening plant this company has built.
   *
   * Left at the full opening on purpose, and this is the interesting part.
   *
   * A company with £0 in the bank opens with a factory sized for a tenth of
   * its region, paying £289,440 a year of idle rent before it sells a thing,
   * which looks exactly like the bug that dooms it. It is not. Cutting the
   * plant to a twentieth — which is what a real founder at that stage would
   * have — took survival from 2 in 16 to 0 in 16 across every band, because
   * capacity is not only rent, it is the ceiling on what the company can
   * earn, and the salary bill underneath does not shrink with it.
   *
   * So the plant stays, and the idle rent with it. Kept as a dial rather than
   * deleted because it is the honest one to reach for if the cost of existing
   * ever scales with the company rather than the market.
   */
  capacity: number;
  /** What this is, in the words somebody would use about themselves. */
  label: string;
  /** And what it means for the first year. */
  note: string;
}

/*
 * ## Why the capacity shares are small, and were all 1
 *
 * Every band used to say `capacity: 1` — a multiplier, so an "actual" opening
 * took cash to zero and customers to zero and left the plant at the full
 * funded size. That is worse than either extreme: a company with no money and
 * no customers paying idle-capacity costs on a plant built for a business it
 * does not have, from its first month, with no lever reached in time to stop
 * it.
 *
 * Measured on a one-van bike-repair round opened on £2,000 and allowed to
 * commit £1,000 a month: the funded opening handed it 508 riders and £2,223 of
 * revenue in month one, before a single decision. There was no bottom to start
 * at, and nothing to decide — it spent nothing in 22 of 24 months because
 * nothing affordable moved anything, and banked £36,677 by doing so. A passive
 * annuity rather than a business.
 *
 * So the plant now scales with the stage, because that is what "where you
 * actually are" means: somebody with an idea has a van and a toolkit, not a
 * depot. Floored at one by `atStanding`, so nothing divides by zero.
 *
 * Only the "actual" opening is touched. A competitive season is bit-for-bit
 * what it was, which is what every balance guard is written against.
 */
export const OPENING_BANDS: { upTo: number; position: OpeningPosition }[] = [
  {
    upTo: 0.15,
    position: {
      cash: 0, credit: 0.1, creditScore: 20, brand: 0, reputation: 35, customers: 0, capacity: 0.02, officerPay: 0,
      label: "An idea, and the work so far",
      note: "No money and no trading history. The first decision is where money comes from, and on a rating this thin it will be expensive.",
    },
  },
  {
    upTo: 0.4,
    position: {
      cash: 0.08, credit: 0.25, creditScore: 32, brand: 2, reputation: 40, customers: 0, capacity: 0.08, officerPay: 0.2,
      label: "Building it",
      note: "A little put in and nothing coming back yet. Enough to move on one thing, not on three.",
    },
  },
  {
    upTo: 0.7,
    position: {
      cash: 0.2, credit: 0.5, creditScore: 45, brand: 5, reputation: 46, customers: 0.08, capacity: 0.25, officerPay: 0.5,
      label: "Something people use",
      note: "The first customers, and a lender who will now return a call. Still far short of a year's costs.",
    },
  },
  {
    upTo: Infinity,
    position: {
      cash: 0.35, credit: 0.8, creditScore: 55, brand: 9, reputation: 52, customers: 0.2, capacity: 0.5, officerPay: 1,
      label: "Trading",
      note: "Revenue, a record, and a credit line worth having. The question stops being survival and starts being growth.",
    },
  },
];

export function positionFor(standing: Standing): OpeningPosition {
  const p = Math.max(0, Math.min(1, standing.progress));
  return (OPENING_BANDS.find((b) => p <= b.upTo) ?? OPENING_BANDS[OPENING_BANDS.length - 1]).position;
}

/**
 * The funded company, moved to where this project actually is.
 *
 * Applied after `startingCompany` rather than inside it, so the funded
 * opening stays the one definition of what a company is and this is visibly
 * a departure from it — and so a competitive season is bit-for-bit what it
 * always was.
 */
export function atStanding(company: Company, standing: Standing, niche: Niche): Company {
  const at = positionFor(standing);
  const capacity = Math.max(0, company.capacity ?? 0);

  /*
   * The customers a business at this point already has, placed where a real
   * one would have them: in the segment it prices for. Spreading them across
   * the market would hand somebody with one product a foothold in every kind
   * of buyer at once, which is the opposite of what having early customers
   * is like.
   */
  /*
   * The plant this company has actually built, and the customers it already
   * serves — both against the funded opening rather than against each other,
   * so a company at this stage is small in the way a real one is rather than
   * merely underfunded.
   */
  const built = Math.max(1, Math.round(capacity * at.capacity));
  const held = Math.min(built, Math.round(capacity * at.customers));
  const home = [...niche.segments].sort((a, b) => Math.abs(a.referencePrice - company.price) - Math.abs(b.referencePrice - company.price))[0];
  const customers = held > 0 && home ? { ...(company.customers ?? {}), [home.id]: held } : (company.customers ?? {});

  return {
    ...company,
    capacity: built,
    /* Founders take what is left, which at the start is nothing. See `officerPay`. */
    officerPay: at.officerPay,
    cash: Math.round((company.cash ?? 0) * at.cash),
    creditLimit: Math.round((company.creditLimit ?? 0) * at.credit),
    creditScore: at.creditScore,
    brand: at.brand,
    reputation: at.reputation,
    customers,
  };
}
