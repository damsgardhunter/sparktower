/**
 * What one decision is called, and how many of them a season is.
 *
 * Mirrors `PERIOD_NAME`, `PERIODS_PER_YEAR`, `periodsPerYear` and `totalPeriods`
 * in `shared/simulation/cadence.ts`, and is checked against them by
 * `test/unit/mobile-mirror.test.ts`.
 *
 * ## The bug this exists to end
 *
 * `year` on every sim payload counts *periods*, not years. `totalYears` is in
 * years. Four phone screens divided one by the other, so a quarterly season four
 * years long told its players they were on **"Year 7 of 4"** — past its own end,
 * with the progress bar pinned at full. The server's own comment on
 * `totalPeriods` names this exact failure and says the field was added to fix it:
 * *"The engine has never been confused about this; only the screens were."* The
 * web was fixed. The phone read `totalPeriods` nowhere at all.
 *
 * It was never only the arithmetic. A season can be run yearly, quarterly or
 * monthly, and every word on these screens said "year" — so a table deciding
 * every quarter read "Year 7", "this year", "last year" and "N years, then it
 * lapses" about something that had nothing to do with years.
 *
 * ## Where the words come from
 *
 * Most routes send `period` and `totalPeriods` ready-made and those are preferred,
 * because the server knows the cadence and the client should not have to agree
 * with it independently. The room route (`GET /api/sim/ventures/:id`) sends bare
 * `cadence` instead, which is why the mirrors below exist rather than this being a
 * pure reading of the payload.
 *
 * No React Native imports, so the mirror test can load it.
 */

export type Cadence = "yearly" | "quarterly" | "monthly";

export interface PeriodWords {
  one: string;
  many: string;
  of: string;
}

/** Mirrors `PERIOD_NAME` in shared/simulation/cadence.ts. */
export const PERIOD_NAME: Record<Cadence, PeriodWords> = {
  yearly: { one: "year", many: "years", of: "this year" },
  quarterly: { one: "quarter", many: "quarters", of: "this quarter" },
  monthly: { one: "month", many: "months", of: "this month" },
};

/** Mirrors `PERIODS_PER_YEAR`. */
export const PERIODS_PER_YEAR: Record<Cadence, number> = {
  yearly: 1,
  quarterly: 4,
  monthly: 12,
};

const asCadence = (v: unknown): Cadence =>
  v === "quarterly" || v === "monthly" ? v : "yearly";

export const periodsPerYear = (cadence: unknown): number =>
  PERIODS_PER_YEAR[asCadence(cadence)];

/** How many decisions a season of this many years is. Mirrors `totalPeriods`. */
export const totalPeriodsIn = (totalYears: number | null | undefined, cadence: unknown): number =>
  Math.max(1, Math.round(Number(totalYears) || 0)) * periodsPerYear(cadence);

/**
 * The words for one decision, from whatever the payload carries.
 *
 * The server's own `period` first, then the cadence, then years — and years last
 * rather than first because that is the answer that used to be assumed. A screen
 * with neither field is a screen talking to an older server, and "year" is what
 * it would have said anyway.
 */
export function periodWords(input: {
  period?: Partial<PeriodWords> | null;
  cadence?: unknown;
}): PeriodWords {
  const sent = input.period;
  if (sent?.one && sent?.many && sent?.of) return { one: sent.one, many: sent.many, of: sent.of };
  if (input.cadence) return PERIOD_NAME[asCadence(input.cadence)];
  return PERIOD_NAME.yearly;
}

/**
 * How many decisions the season is, which is the denominator `year` belongs over.
 *
 * `totalPeriods` where the route sends it, derived from the cadence where it sends
 * that instead, and `totalYears` only when there is nothing better — which is
 * correct for a yearly season and is the one case where the old arithmetic was
 * right by accident.
 */
export function seasonSpan(input: {
  totalPeriods?: number | null;
  totalYears?: number | null;
  cadence?: unknown;
}): number {
  const sent = Number(input.totalPeriods);
  if (Number.isFinite(sent) && sent > 0) return Math.round(sent);
  if (input.cadence) return totalPeriodsIn(input.totalYears, input.cadence);
  const years = Number(input.totalYears);
  return Number.isFinite(years) && years > 0 ? Math.round(years) : 0;
}

/**
 * "Quarter 7 of 16", for a heading.
 *
 * Capitalised, because it leads a line. The count is never allowed past the
 * total: a season resolving its last period can momentarily report a `year` one
 * beyond its span, and "Quarter 17 of 16" is the same class of nonsense as the
 * bug this file exists to fix.
 */
export function periodLabel(year: number | null | undefined, span: number, words: PeriodWords): string {
  const one = words.one.charAt(0).toUpperCase() + words.one.slice(1);
  const at = Math.max(1, Math.round(Number(year) || 1));
  return span > 0 ? `${one} ${Math.min(at, span)} of ${span}` : `${one} ${at}`;
}

/** How many decisions are left, floored at nothing. */
export const periodsLeft = (year: number | null | undefined, span: number): number =>
  Math.max(0, span - Math.max(0, Math.round(Number(year) || 0)));

/**
 * How long something lasts, in the unit the table actually decides in.
 *
 * Mirrors `lastsFor` in `client/src/components/sim/desk-currency.tsx`.
 *
 * `expiresIn` is decremented once a *tick*, not once a year — so in a quarterly
 * season a three-year licence arrives as twelve. The market screen printed that
 * number with the word "years" after it, which made a three-year asset read as
 * "12 years, then it lapses" on the one screen where somebody is deciding what to
 * bid for it. A four-fold overstatement of the thing being bought.
 *
 * Whole years are said in years, because "3 years" is what somebody means; a
 * remainder is said in periods, because "2.5 years" is not a sentence and
 * rounding it would be the same bug in a smaller coat.
 */
export function lastsFor(n: number, period?: Partial<PeriodWords>, periods?: number): string {
  const plural = (v: number, one: string, many: string) => `${v} ${v === 1 ? one : many}`;
  const per = Number.isFinite(Number(periods)) && Number(periods) > 0 ? Number(periods) : 1;
  if (per <= 1) return plural(n, "year", "years");
  const years = n / per;
  return Number.isInteger(years)
    ? plural(years, "year", "years")
    : plural(n, period?.one ?? "period", period?.many ?? "periods");
}
