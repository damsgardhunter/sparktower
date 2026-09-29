/**
 * The money a business is counted in — which is not the money this product
 * charges in.
 *
 * Two different sums appear on the same screen and they are not the same kind
 * of number. What SparkTower costs — one price for the whole-business build, $1 for
 * a day pass — is priced in dollars because Stripe takes dollars, and changing
 * that is a payments decision, not a display one. What the *business* takes in
 * a month, what is in its bank, what a third shop would cost: those are the
 * owner's own figures, and telling a café in Leeds that it turns over "$430k"
 * and has "$22k in the bank" is simply wrong. It was wrong everywhere — the
 * intake asked for turnover in dollar bands, the simulator answered in dollars,
 * and the funding module offered SBA loans to a business in Yorkshire.
 *
 * So: a project says what it counts in, everything about the business is
 * written in that, and the price list stays in dollars. `shared/plans.ts`
 * formats prices; this formats businesses.
 *
 * Deliberately a short list. A currency here is one the copy and the examples
 * can be honest about, and an owner whose currency is missing is better served
 * by a plain "another currency" than by a symbol nobody checked.
 */
export const CURRENCIES = [
  { code: "USD", symbol: "$", label: "US dollars", locale: "en-US" },
  { code: "GBP", symbol: "£", label: "Pounds sterling", locale: "en-GB" },
  { code: "EUR", symbol: "€", label: "Euros", locale: "en-IE" },
  { code: "CAD", symbol: "CA$", label: "Canadian dollars", locale: "en-CA" },
  { code: "AUD", symbol: "A$", label: "Australian dollars", locale: "en-AU" },
  { code: "NZD", symbol: "NZ$", label: "New Zealand dollars", locale: "en-NZ" },
] as const;

export type CurrencyCode = (typeof CURRENCIES)[number]["code"];

/** The codes alone, for a zod enum and anything else that wants a tuple. */
export const CURRENCY_CODES = CURRENCIES.map((c) => c.code) as unknown as [CurrencyCode, ...CurrencyCode[]];
export const DEFAULT_CURRENCY: CurrencyCode = "USD";

export const isCurrencyCode = (v: unknown): v is CurrencyCode =>
  typeof v === "string" && CURRENCIES.some((c) => c.code === v);

/** Whatever was stored, as a currency this product can write. */
export const currencyOf = (v: unknown): CurrencyCode => (isCurrencyCode(v) ? v : DEFAULT_CURRENCY);

export const symbolOf = (code: unknown): string =>
  CURRENCIES.find((c) => c.code === currencyOf(code))?.symbol ?? "$";

/**
 * A business figure, short.
 *
 * The same shape the simulator has always used — £22,000 as "£22k", £1.2m as
 * "£1.20m" — because the point of these numbers is to be read at a glance in a
 * sentence, not reconciled. The minus is a true minus sign, not a hyphen: an
 * overdrawn balance is the number most likely to be misread.
 */
export function businessMoney(n: number, code: unknown = DEFAULT_CURRENCY): string {
  const symbol = symbolOf(code);
  const a = Math.abs(Math.round(n));
  const body = a >= 1_000_000 ? `${(a / 1_000_000).toFixed(2)}m`
    : a >= 10_000 ? `${Math.round(a / 1000)}k`
    : a.toLocaleString("en-GB");
  return `${n < 0 ? "−" : ""}${symbol}${body}`;
}

/** The same, in full, for a field somebody is going to type over. */
export function businessMoneyExact(n: number, code: unknown = DEFAULT_CURRENCY): string {
  return `${n < 0 ? "−" : ""}${symbolOf(code)}${Math.abs(Math.round(n)).toLocaleString("en-GB")}`;
}
