/**
 * What this company counts its money in, for every screen that shows any.
 *
 * Its own module rather than a constant in the desk page, because the desk is
 * not the only thing that formats money for a season: the projection dock had
 * its own formatter, named `gbp`, which hardcoded pounds. The result was a
 * desk showing a startup's revenue in dollars and, eight pixels away, its
 * committed salaries in sterling — two currencies in one panel, neither of
 * them necessarily the one the company trades in.
 *
 * A context rather than a prop because the figures are drawn by half a dozen
 * components and threading it through all of them is half a dozen chances to
 * miss one, which is how the first mismatch happened.
 */
import { createContext, useContext } from "react";
import { DEFAULT_CURRENCY, symbolOf, type CurrencyCode } from "@shared/currency";

export const DeskCurrency = createContext<CurrencyCode>(DEFAULT_CURRENCY);

/**
 * Formatters in this company's currency: "$1,400" and "$1.4k".
 *
 * `code` overrides the context, for the one caller that needs it: the desk
 * page renders the provider itself, so a hook called in its body would read
 * the default and quietly format a dollar company in the fallback currency.
 * Everything below the provider passes nothing and inherits.
 */
export function useMoney(code?: CurrencyCode) {
  const inherited = useContext(DeskCurrency);
  const sym = symbolOf(code ?? inherited);
  return {
    money: (n: number) => `${sym}${Math.round(n).toLocaleString()}`,
    compact: (n: number) => {
      const sign = n < 0 ? "−" : "";
      const a = Math.abs(n);
      if (a >= 1_000_000_000) return `${sign}${sym}${(a / 1_000_000_000).toFixed(1)}bn`;
      if (a >= 1_000_000) return `${sign}${sym}${(a / 1_000_000).toFixed(a >= 10_000_000 ? 0 : 1)}m`;
      if (a >= 1_000) return `${sign}${sym}${Math.round(a / 1_000)}k`;
      return `${sign}${sym}${Math.round(a)}`;
    },
  };
}

/**
 * What one decision is called in this season.
 *
 * A context for the same reason the currency is one: the word appears on a
 * dozen components and threading it through all of them is a dozen chances to
 * miss one — which is how a quarterly season came to describe every one of its
 * four decisions a year as "this year".
 *
 * "year" is the default because it is what every season was until cadence
 * existed, so a screen that has not been told anything is not wrong.
 */
export interface PeriodWords {
  one: string; many: string; of: string;
  /**
   * How many of these make a year, so a life counted in periods can be said
   * back in years. An asset's `expiresIn` is decremented once a tick, so a
   * three-year agreement in a quarterly season is twelve — which is what got
   * printed as "12 years".
   */
  perYear?: number;
}

/** A life counted in periods, said in years where it divides evenly. */
export function lastsFor(n: number, period: PeriodWords): string {
  const plural = (v: number, one: string, many: string) => `${v} ${v === 1 ? one : many}`;
  const per = period.perYear ?? 1;
  if (per <= 1) return plural(n, "year", "years");
  const years = n / per;
  return Number.isInteger(years) ? plural(years, "year", "years") : plural(n, period.one, period.many);
}

export const DeskPeriod = createContext<PeriodWords>({ one: "year", many: "years", of: "this year" });

/** `words` overrides the context, for the desk page — see `useMoney`. */
export function usePeriod(words?: PeriodWords): PeriodWords {
  const inherited = useContext(DeskPeriod);
  return words ?? inherited;
}
