import { sql, type SQL } from "drizzle-orm";

const SECONDS = { minutes: 60, hours: 3600, days: 86400 } as const;
export type IntervalUnit = keyof typeof SECONDS;

/**
 * A Postgres interval whose length travels as a bound parameter.
 *
 * Never an interval literal built from the number: that splices the number into the
 * SQL text, which is safe only while every caller passes a trusted constant —
 * the first window read from a query string would make it an injection.
 * `make_interval` takes the seconds as a `$n` parameter, so whatever arrives
 * is a value, and a non-number is refused here before it reaches the database.
 */
export function interval(n: number, unit: IntervalUnit): SQL {
  if (typeof n !== "number" || !Number.isFinite(n)) throw new TypeError(`interval length must be a finite number, got ${String(n)}`);
  return sql`make_interval(secs => ${n * SECONDS[unit]}::double precision)`;
}

/** `now()` minus an interval, for "within the last N" comparisons done in the database's clock. */
export const ago = (n: number, unit: IntervalUnit): SQL => sql`(now() - ${interval(n, unit)})`;
