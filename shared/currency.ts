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

/**
 * Which of the six a region uses.
 *
 * Only the regions whose currency is on the list above — a country that uses
 * something this product cannot write honestly is better left to the default and
 * the dropdown than guessed at. The euro countries are listed out rather than
 * inferred, because "in the EU" and "uses the euro" are different sets and
 * Sweden, Denmark, Poland and the Czech Republic are all in the first and not the
 * second.
 */
const BY_REGION: Record<string, CurrencyCode> = {
  GB: "GBP",
  US: "USD",
  CA: "CAD",
  AU: "AUD",
  NZ: "NZD",
  IE: "EUR", FR: "EUR", DE: "EUR", ES: "EUR", IT: "EUR", NL: "EUR", BE: "EUR",
  AT: "EUR", PT: "EUR", FI: "EUR", GR: "EUR", LU: "EUR", SK: "EUR", SI: "EUR",
  EE: "EUR", LV: "EUR", LT: "EUR", CY: "EUR", MT: "EUR", HR: "EUR",
};

/**
 * Which of the six a language suggests, where it suggests anything at all.
 *
 * A short list on purpose, and shorter than the language picker. A language is a
 * weak signal for money and often no signal: Spanish is spoken by far more people
 * in the Americas than in Spain, Portuguese more in Brazil than in Portugal, and
 * English covers five of the six currencies on the list. Guessing euros for a
 * Spanish speaker in Mexico would be worse than leaving it at the default, where
 * at least the dropdown beside it is the obvious next thing to touch.
 *
 * So only the two where the language genuinely narrows it down, and even then the
 * region wins when there is one — `de-CH` is a Swiss franc the list cannot write,
 * and it should fall to the default rather than be called euros.
 */
const BY_LANGUAGE: Record<string, CurrencyCode> = {
  fr: "EUR",
  de: "EUR",
};

/**
 * The currency to *offer* somebody, from where their browser says they are and
 * what language they chose.
 *
 * A suggestion and never a decision. What a business counts in belongs to the
 * business — the whole point of the module above — so this only picks what the
 * dropdown starts on when a project is being created. The owner of a café in
 * Leeds who happens to be reading in French still files their books in pounds,
 * and the control is right there.
 *
 * It exists because the alternative was worse in one specific way: the field
 * started on US dollars for everybody, so every project built outside America
 * began life mis-denominated, and a field that is already filled in is a field
 * people skip.
 *
 * The region decides and the language only fills in, because that is the
 * direction the information actually runs: `en-GB` and `en-US` are the same
 * language and different money, and no amount of knowing somebody reads English
 * tells you which. A language with no region attached is the only case where the
 * language is asked at all.
 */
export function suggestedCurrency(input: {
  /** Locales most-preferred first, as `navigator.languages` gives them. */
  locales?: readonly string[] | null;
  /** The language chosen in the product, if one has been. */
  language?: string | null;
}): CurrencyCode {
  const locales = (input.locales ?? []).filter((l): l is string => typeof l === "string" && l.length > 0);

  /*
   * The first locale that carries a region at all — and then that region decides,
   * whether or not this product can write its currency.
   *
   * The "whether or not" is the part worth stating. Skipping an unrecognised
   * region and asking the language instead would call `de-CH` euros, and a Swiss
   * business is francs: knowing somebody is in Switzerland is *positive evidence*
   * that the language guess is wrong, so it has to stop the guess rather than be
   * passed over. Falling to the default there is the honest answer, and the
   * dropdown is beside it.
   */
  for (const locale of locales) {
    const region = locale.split(/[-_]/)[1]?.toUpperCase();
    if (region) return BY_REGION[region] ?? DEFAULT_CURRENCY;
  }

  /*
   * No locale carried a region, so the language is all there is. `fr` and
   * `fr-FR` should land in the same place and one of them arrives without a
   * region to read.
   */
  const languages = [input.language, ...locales.map((l) => l.split(/[-_]/)[0])]
    .filter((l): l is string => typeof l === "string" && l.length > 0)
    .map((l) => l.toLowerCase());
  for (const language of languages) {
    if (BY_LANGUAGE[language]) return BY_LANGUAGE[language];
  }

  return DEFAULT_CURRENCY;
}
