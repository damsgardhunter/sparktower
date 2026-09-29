/**
 * How often a table decides.
 *
 * A season has always been fourteen years, one decision each. That is the
 * right rhythm for learning what the levers do — a year is long enough that a
 * decision has visibly landed before the next one — and it is not how anybody
 * runs a business. Real operators decide quarterly at worst and monthly at
 * best, and "we saw it in March and moved" is a skill a game of annual
 * decisions cannot teach.
 *
 * So a season can be run in years, quarters or months. The market is the same
 * market and the levers are the same levers; what changes is how often the
 * table is asked, and therefore how quickly it can answer a year that is
 * going wrong.
 *
 * ## The rule everything here rests on
 *
 * Divide the flows, keep the stocks.
 *
 * A **flow** is a quantity per unit of time: salaries, marketing spend,
 * interest, revenue, the money a lever costs. Ask a table four times a year
 * instead of once and each answer covers a quarter, so each is a quarter of
 * the size — including the thresholds, or a lever that cost £220,000 a year
 * would cost £880,000 a year in a quarterly season and every quarterly season
 * would be unplayable.
 *
 * A **stock** is a quantity at a moment: cash in the bank, customers held,
 * capacity built, brand, quality, how many people work here. Those do not
 * care how often anybody is asked. A company with sixty thousand customers
 * has sixty thousand customers whether the table meets monthly or annually.
 *
 * Getting that split wrong in either direction breaks a season: divide a
 * stock and the company shrinks every time it is asked, forget to divide a
 * flow and it pays its salary bill twelve times a year.
 */

export type Cadence = "yearly" | "quarterly" | "monthly";

export const CADENCES: Cadence[] = ["yearly", "quarterly", "monthly"];

/** How many decisions make a year. */
export const PERIODS_PER_YEAR: Record<Cadence, number> = {
  yearly: 1,
  quarterly: 4,
  monthly: 12,
};

/** What one period is called, for a screen. */
export const PERIOD_NAME: Record<Cadence, { one: string; many: string; of: string }> = {
  yearly: { one: "year", many: "years", of: "this year" },
  quarterly: { one: "quarter", many: "quarters", of: "this quarter" },
  monthly: { one: "month", many: "months", of: "this month" },
};

export const periodsPerYear = (cadence: Cadence | null | undefined): number =>
  PERIODS_PER_YEAR[(cadence ?? "yearly") as Cadence] ?? 1;

/** One real day, which is what a period has always been worth. */
export const PERIOD_MS = 24 * 60 * 60 * 1000;

/**
 * How long a season runs, and how long one decision gets, by default.
 *
 * Two separate things, and the temptation is to conflate them. A season's
 * *span* is how many simulated years it covers; a *period* is how much real
 * time the table gets to answer. Fourteen years at a day each is fourteen
 * days of play, and that day is the rhythm people have learned.
 *
 * So the default keeps the day and shortens the span, because the alternative
 * — fourteen simulated years at monthly — is a hundred and sixty-eight days
 * of play, and nobody finishes that. A monthly season is a year of trading
 * gone through properly, which is a different and better thing to sell than
 * the same fourteen years at twelve times the length.
 *
 * Whoever creates the season can override both; these are where the form
 * starts, not what it allows.
 */
export const DEFAULT_YEARS: Record<Cadence, number> = {
  yearly: 14,
  quarterly: 4,
  /*
   * Two, not one. Every lag in this game is a year long — brand lands over a
   * year, quality over one or two, room opens a year after it is ordered, a
   * hire is useful in their second year — so a one-year monthly season is
   * twelve decisions none of which ever pay off. A table finished it with
   * brand 16 and quality 38 having done everything right. Two years is the
   * shortest span in which a monthly table sees its own work arrive.
   */
  monthly: 2,
};

/** How many decisions a season of this many years asks for. */
export const totalPeriods = (years: number, cadence: Cadence | null | undefined): number =>
  Math.max(1, Math.round(years * periodsPerYear(cadence)));

/**
 * The shortest and longest a season can be, counted in decisions.
 *
 * Four is the floor because fewer than four and nothing a team does has time
 * to come back to them — which was the old four-year minimum, said in the
 * unit that actually governs it. Twenty-four is the ceiling for the finer
 * cadences because at a day each that is already over three weeks of play,
 * and a yearly season keeps its own fourteen.
 */
export const PERIODS_MIN = 4;
export const PERIODS_MAX: Record<Cadence, number> = { yearly: 14, quarterly: 24, monthly: 24 };

/** The fewest simulated years this cadence can be asked for. */
export const yearsMin = (cadence: Cadence | null | undefined): number =>
  Math.max(1, Math.ceil(PERIODS_MIN / periodsPerYear(cadence)));

/** The most simulated years this cadence can be asked for. */
export const yearsMax = (cadence: Cadence | null | undefined): number =>
  Math.max(yearsMin(cadence), Math.floor(PERIODS_MAX[(cadence ?? "yearly") as Cadence] / periodsPerYear(cadence)));

/**
 * The same sentence, in the unit this season actually decides in.
 *
 * The engine's prose was written when a decision was always a year, so a
 * monthly table read "The year was run for growth" twelve times a year. Done
 * here rather than at twenty-nine call sites, and deliberately narrow: only
 * the phrases that mean *the span just decided* are touched.
 *
 * "Next year" is left alone on purpose. The lags really are a year — room
 * ordered now opens a year from now however often the table meets, and a new
 * hire is useful in their second year — so "it opens next year" is true in a
 * monthly season and rewriting it to "next month" would be a lie. Same for
 * "last year's work", which at a monthly cadence is a slice of a year's
 * shipping arriving, not last month's.
 *
 * At yearly cadence this returns the string it was given, untouched.
 */
export function inPeriodWords(text: string, periods: number): string {
  const word = periods >= 12 ? "month" : periods >= 4 ? "quarter" : "year";
  if (word === "year") return text;
  return text
    .replace(/\bThis year\b/g, `This ${word}`)
    .replace(/\bthis year\b/g, `this ${word}`)
    .replace(/\bThe year\b/g, `The ${word}`)
    .replace(/\bthe year\b/g, `the ${word}`)
    .replace(/\bthis year's\b/g, `this ${word}'s`)
    .replace(/\bin a year\b/g, `in a ${word}`)
    .replace(/\ba year\b(?! from now)/g, `a ${word}`);
}

/** Which year of the season a period falls in, counting from one. */
export const yearOfPeriodIn = (period: number, cadence: Cadence | null | undefined): number =>
  Math.floor((period - 1) / periodsPerYear(cadence)) + 1;

/**
 * A yearly amount, as one period's worth.
 *
 * For every flow: salaries, interest, spend, the money a lever costs, and the
 * thresholds those are measured against. A quarterly season asks four times,
 * so each answer is a quarter of a year's worth.
 */
export const perPeriod = (annual: number, cadence: Cadence | null | undefined): number =>
  annual / periodsPerYear(cadence);

/**
 * A number of years, as a number of periods.
 *
 * For every lag. Research that landed two years out still lands two years
 * out — which is eight quarters, not two. A lag left in periods would mean a
 * monthly season where everything arrives six times faster than the game was
 * balanced for, which is the same mistake as not dividing a flow and harder
 * to see.
 */
export const periodsFor = (years: number, cadence: Cadence | null | undefined): number =>
  Math.max(1, Math.round(years * periodsPerYear(cadence)));

/**
 * A yearly growth rate, as one period's worth.
 *
 * The root rather than the quotient: growth compounds, so a segment growing
 * 8% a year grows about 1.94% a quarter, not 2%. Small on one period and
 * material over fourteen years, which is exactly the kind of error that
 * makes a quarterly season quietly diverge from a yearly one.
 */
export const growthPerPeriod = (annual: number, cadence: Cadence | null | undefined): number =>
  Math.pow(1 + annual, 1 / periodsPerYear(cadence)) - 1;

/**
 * Which year a period falls in, and where it sits inside it.
 *
 * Periods are numbered from one across the whole season, so period 5 of a
 * quarterly season is the first quarter of year two. Years still exist and
 * still matter: targets are annual, the report is annual, and levers unlock
 * by year — a table should not get four times as many new decisions for
 * choosing to meet quarterly.
 */
export function yearOfPeriod(period: number, cadence: Cadence | null | undefined): { year: number; within: number } {
  const n = periodsPerYear(cadence);
  const index = Math.max(1, Math.round(period)) - 1;
  return { year: Math.floor(index / n) + 1, within: (index % n) + 1 };
}

/** How many periods a season of this many years runs for. */
export const periodsInSeason = (years: number, cadence: Cadence | null | undefined): number =>
  Math.max(1, Math.round(years * periodsPerYear(cadence)));

/** How a period reads on a screen: "Q2 of year 3", "month 7 of year 1", "year 4". */
export function periodLabel(period: number, cadence: Cadence | null | undefined): string {
  const c = (cadence ?? "yearly") as Cadence;
  const { year, within } = yearOfPeriod(period, c);
  if (c === "yearly") return `Year ${year}`;
  if (c === "quarterly") return `Q${within} of year ${year}`;
  return `Month ${within} of year ${year}`;
}
