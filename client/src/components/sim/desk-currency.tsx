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

/** Formatters in this company's currency: "$1,400" and "$1.4k". */
export function useMoney() {
  const sym = symbolOf(useContext(DeskCurrency));
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
