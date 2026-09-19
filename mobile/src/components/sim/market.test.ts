/**
 * The market's arithmetic, driven through the cases that would cost somebody
 * an asset or a year's cash.
 *
 * Two of these matter more than the rest. `effectLines` is the only place the
 * engine's unit-cost *multiplier* becomes a sentence a player can act on, and
 * a sign error there would sell a team a cost increase as a saving.
 * `validateBid` has to refuse exactly what the server refuses and no more —
 * a local rule the server doesn't share is a screen that quietly plays the
 * game for you.
 */
import { describe, it, expect } from "vitest";
import {
  bidsOutstanding, canSell, effectLines, lifePill, lifeRead, marketNotesRead,
  saleRead, validateBid, validateReserve, type MarketListing,
} from "./market";
import type { ReportMarketNote } from "./desk";

describe("what an asset does, in plain terms", () => {
  it("reads the 0-100 scores as the same numbers the desk draws bars for", () => {
    expect(effectLines({ brand: 14 })).toEqual(["+14 brand"]);
    expect(effectLines({ quality: 9, service: 6 })).toEqual(["+9 quality", "+6 service"]);
  });

  it("turns the cost multiplier into the percentage a person would have said", () => {
    // 0.93 means seven per cent off every unit, and "×0.93" means nothing on a
    // phone. The sign is the part worth pinning: above 1 is worse, not better.
    expect(effectLines({ unitCost: 0.93 })).toEqual(["−7% unit cost"]);
    expect(effectLines({ unitCost: 0.88 })).toEqual(["−12% unit cost"]);
    expect(effectLines({ unitCost: 1.05 })).toEqual(["+5% unit cost"]);
  });

  it("says nothing about a multiplier that changes nothing", () => {
    expect(effectLines({ unitCost: 1, brand: 4 })).toEqual(["+4 brand"]);
  });

  it("counts capacity in people rather than money", () => {
    expect(effectLines({ capacity: 500_000 })).toEqual(["+500k capacity"]);
    expect(effectLines({ capacity: 1_250_000 })).toEqual(["+1.3m capacity"]);
  });

  it("lists every effect a real listing carries, in a fixed order", () => {
    // The second operations centre, as shared/simulation/assets.ts writes it.
    expect(effectLines({ capacity: 240_000, service: 6, unitCost: 0.96 }))
      .toEqual(["+6 service", "+240k capacity", "−4% unit cost"]);
  });

  it("is honest about an asset that does nothing", () => {
    expect(effectLines({})).toEqual([]);
    expect(effectLines(null)).toEqual([]);
  });
});

describe("how long a thing lasts", () => {
  it("distinguishes the rare permanent one, because that is the reason to pay for it", () => {
    expect(lifeRead(null)).toMatch(/permanently/);
    expect(lifePill(null)).toBe("Permanent");
  });

  it("counts the years, and says when this is the last of them", () => {
    expect(lifeRead(4)).toBe("4 years, then it lapses");
    expect(lifeRead(1)).toBe("One year, then it lapses");
    expect(lifePill(1)).toBe("Last year");
  });
});

describe("whether a bid can be sent", () => {
  const base = { reserve: 1_000_000, funds: 4_000_000 };

  it("takes any number at or above the reserve", () => {
    expect(validateBid({ ...base, amount: 1_000_000 })).toMatchObject({ ok: true, error: null, warning: null });
    expect(validateBid({ ...base, amount: "2500000" })).toMatchObject({ ok: true });
  });

  it("stops a bid under the reserve, which could never buy anything", () => {
    const check = validateBid({ ...base, amount: 900_000 });
    expect(check.ok).toBe(false);
    expect(check.error).toMatch(/1,000,000/);
  });

  it("refuses what the server refuses, and nothing else", () => {
    expect(validateBid({ ...base, amount: -5 }).ok).toBe(false);
    expect(validateBid({ ...base, amount: "many" }).ok).toBe(false);
    expect(validateBid({ ...base, amount: "" }).ok).toBe(false);
  });

  it("warns about overreaching without blocking it", () => {
    // The route accepts a bid the company can't currently back on purpose: the
    // money may be back by the tick, and refusing now would leak that it moved.
    const check = validateBid({ ...base, amount: 5_000_000 });
    expect(check.ok).toBe(true);
    expect(check.warning).toMatch(/can back today/);
  });

  it("notices when this bid plus the others outruns the money", () => {
    const check = validateBid({ ...base, amount: 2_500_000, otherBids: 2_000_000 });
    expect(check.ok).toBe(true);
    expect(check.warning).toMatch(/add up to more/);
  });

  it("says nothing when the bids together still fit", () => {
    expect(validateBid({ ...base, amount: 1_500_000, otherBids: 1_000_000 }).warning).toBeNull();
  });
});

describe("what is already promised", () => {
  const listing = (id: string, yourBid: number | null): MarketListing => ({
    id, name: id, kind: "patent", blurb: "", effect: {}, expiresIn: null,
    reserve: 100_000, seller: null, yourBid,
  });

  it("adds up only your own bids — there is nothing else in the payload to add", () => {
    const out = bidsOutstanding([listing("a", 1_000_000), listing("b", null), listing("c", 500_000)], 4_000_000);
    expect(out).toMatchObject({ count: 2, total: 1_500_000, overcommitted: false });
    expect(out.line).toMatch(/2 bids out/);
  });

  it("says so when winning everything isn't something you could pay for", () => {
    const out = bidsOutstanding([listing("a", 3_000_000), listing("b", 2_000_000)], 4_000_000);
    expect(out.overcommitted).toBe(true);
    expect(out.line).toMatch(/won't clear/);
  });

  it("keeps quiet when nothing is bid", () => {
    expect(bidsOutstanding([listing("a", null)], 1_000).line).toBeNull();
    expect(bidsOutstanding(undefined, 0)).toMatchObject({ count: 0, total: 0 });
  });
});

describe("selling what the company owns", () => {
  it("is the chief executive's or the finance seat's, matching the route's 403", () => {
    expect(canSell("ceo")).toBe(true);
    expect(canSell("cfo")).toBe(true);
    expect(canSell("cmo")).toBe(false);
    expect(canSell(null)).toBe(false);
  });

  it("takes any reserve, and warns about one above the going rate", () => {
    expect(validateReserve({ reserve: 400_000, willingSale: 500_000 })).toMatchObject({ ok: true, warning: null });
    const high = validateReserve({ reserve: 900_000, willingSale: 500_000 });
    expect(high.ok).toBe(true);
    expect(high.warning).toMatch(/500,000/);
  });

  it("needs a number", () => {
    expect(validateReserve({ reserve: "", willingSale: 1 }).ok).toBe(false);
    expect(validateReserve({ reserve: -1, willingSale: 1 }).ok).toBe(false);
  });

  it("names the discount a forced sale costs, which is the whole price of trouble", () => {
    const read = saleRead({ bookValue: 1_000_000, willingSale: 800_000, forcedSale: 480_000 });
    expect(read.discount).toBeCloseTo(0.4, 10);
    expect(read.line).toMatch(/40% less/);
  });

  it("doesn't divide by a worthless asset", () => {
    expect(saleRead({ bookValue: 0, willingSale: 0, forcedSale: 0 }).line).toMatch(/nothing/);
  });
});

describe("saying what the year's bids came to", () => {
  /*
   * The outcomes arrive typed (CompanyReport["market"] in
   * shared/simulation/resolve.ts), so there is nothing to parse and nothing
   * here testing that there is. What is left worth pinning is the summary: it
   * is the line a player reads before the sentences, and "you won one" and
   * "none of your bids took" are the same length of list.
   */
  const note = (kind: ReportMarketNote["kind"], text: string): ReportMarketNote => ({ kind, text });
  const won = note("won", "Won Carrier bundle for 1,200,000.");
  const lost = note("lost", "Carrier bundle went to somebody who bid more. Your money stays where it is.");
  const sold = note("sold", "Sold Three-year ambassador for 900,000.");
  const unsold = note("unsold", "Nobody met your reserve on Core process patent.");

  it("leads with what was gained when anything was", () => {
    expect(marketNotesRead([won, lost])).toBe("You won one.");
    expect(marketNotesRead([won, sold])).toBe("You won one and sold one.");
    expect(marketNotesRead([won, won, lost])).toBe("You won 2.");
  });

  it("says a losing year plainly rather than counting it", () => {
    expect(marketNotesRead([lost])).toBe("Your bid didn't take it.");
    expect(marketNotesRead([lost, lost])).toBe("None of your bids took.");
  });

  it("has something true to say about a year that only failed to sell", () => {
    expect(marketNotesRead([unsold])).toBe("Nothing changed hands.");
  });

  it("says nothing at all about a year with no bids in it", () => {
    // The card isn't rendered in this case; the empty string is what says so.
    expect(marketNotesRead([])).toBe("");
    expect(marketNotesRead(undefined)).toBe("");
  });
});
