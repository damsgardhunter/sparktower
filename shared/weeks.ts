/**
 * Week boundaries, in UTC.
 *
 * UTC throughout so a piece of work doesn't belong to two different weeks
 * depending on who is reading it.
 */

/** The Monday of a date's week, at UTC midnight. */
export function weekStartOf(date: Date | string = new Date()): Date {
  const d = new Date(date);
  const utc = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  // getUTCDay: 0 = Sunday. Shift so Monday is the first day.
  const shift = (utc.getUTCDay() + 6) % 7;
  utc.setUTCDate(utc.getUTCDate() - shift);
  return utc;
}
