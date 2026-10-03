/**
 * Which currency a project's form starts on.
 *
 * The field used to start on US dollars for everybody, so every project built
 * outside America began life mis-denominated — and a field that is already filled
 * in is a field people skip. This picks a better starting point from where the
 * browser says somebody is and what language they chose.
 *
 * It is a suggestion and never a decision: what a business counts in belongs to
 * the business, and the dropdown is right there. The tests below are mostly about
 * the cases where guessing would be *worse* than the default, because those are
 * the ones that would ship a wrong number to somebody who trusted the form.
 */
import { describe, it, expect } from "vitest";
import { suggestedCurrency, DEFAULT_CURRENCY, isCurrencyCode } from "@shared/currency";

describe("the currency a project's form starts on", () => {
  it("reads the region, which is where the information actually is", () => {
    expect(suggestedCurrency({ locales: ["en-GB"] })).toBe("GBP");
    expect(suggestedCurrency({ locales: ["en-US"] })).toBe("USD");
    expect(suggestedCurrency({ locales: ["en-CA"] })).toBe("CAD");
    expect(suggestedCurrency({ locales: ["en-AU"] })).toBe("AUD");
    expect(suggestedCurrency({ locales: ["en-NZ"] })).toBe("NZD");
    expect(suggestedCurrency({ locales: ["fr-FR"] })).toBe("EUR");
    expect(suggestedCurrency({ locales: ["de-AT"] })).toBe("EUR");
  });

  it("lets the region beat the language, because the same language is several currencies", () => {
    /*
     * The case the whole ordering exists for. `en-GB` and `en-US` are one
     * language and two currencies, and knowing somebody reads English says
     * nothing about which. The region is asked first for that reason.
     */
    expect(suggestedCurrency({ locales: ["en-GB"], language: "en" })).toBe("GBP");
    /* And a French speaker in Canada is dollars, not euros. */
    expect(suggestedCurrency({ locales: ["fr-CA"], language: "fr" })).toBe("CAD");
  });

  it("asks the language only when no locale carries a region it can read", () => {
    expect(suggestedCurrency({ locales: ["fr"], language: null })).toBe("EUR");
    expect(suggestedCurrency({ locales: [], language: "de" })).toBe("EUR");
    expect(suggestedCurrency({ locales: ["de"] })).toBe("EUR");
  });

  it("takes the first locale that says something, not the first locale", () => {
    /*
     * `navigator.languages` is ordered by preference and the first entry often
     * has no region. Skipping to the next one that does is better than giving up.
     */
    expect(suggestedCurrency({ locales: ["en", "en-GB"] })).toBe("GBP");
    expect(suggestedCurrency({ locales: ["es", "es-ES"] })).toBe("EUR");
  });

  it("falls back rather than guessing where a language is several countries", () => {
    /*
     * The cases where guessing is worse than the default. Spanish is spoken by
     * far more people in the Americas than in Spain and Portuguese more in Brazil
     * than in Portugal, so a bare `es` or `pt` is not evidence of euros — and
     * offering euros to somebody in Mexico is a wrong number in a field they may
     * not re-read.
     */
    expect(suggestedCurrency({ locales: ["es"], language: "es" })).toBe(DEFAULT_CURRENCY);
    expect(suggestedCurrency({ locales: ["pt"], language: "pt" })).toBe(DEFAULT_CURRENCY);
    /* And a region this product cannot write honestly falls back too. */
    expect(suggestedCurrency({ locales: ["de-CH"], language: "de" })).toBe(DEFAULT_CURRENCY);
    expect(suggestedCurrency({ locales: ["ja-JP"], language: "ja" })).toBe(DEFAULT_CURRENCY);
    expect(suggestedCurrency({ locales: ["sv-SE"] })).toBe(DEFAULT_CURRENCY);
  });

  it("does not read the EU as the eurozone", () => {
    /*
     * They are different sets, and this is where a shorter implementation goes
     * wrong: Sweden, Denmark, Poland and the Czech Republic are all in the first
     * and none of them in the second.
     */
    for (const locale of ["sv-SE", "da-DK", "pl-PL", "cs-CZ"]) {
      expect(suggestedCurrency({ locales: [locale] }), `${locale} was called euros`).toBe(DEFAULT_CURRENCY);
    }
  });

  it("survives whatever a browser actually hands it", () => {
    /* All of these have been seen in the wild or are trivially producible. */
    for (const locales of [[], null, undefined, [""], ["en_GB"], ["EN-gb"], ["x"], ["zz-ZZ"]] as any[]) {
      const out = suggestedCurrency({ locales });
      expect(isCurrencyCode(out), `${JSON.stringify(locales)} produced ${out}`).toBe(true);
    }
    /* Underscores and odd casing are the same locale as the canonical spelling. */
    expect(suggestedCurrency({ locales: ["en_GB"] })).toBe("GBP");
    expect(suggestedCurrency({ locales: ["EN-gb"] })).toBe("GBP");
  });

  it("always answers with a currency this product can write", () => {
    expect(isCurrencyCode(suggestedCurrency({}))).toBe(true);
  });
});
