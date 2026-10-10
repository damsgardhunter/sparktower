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
  bidsOutstanding, canBid, canSell, effectLines, lifePill, lifeRead, marketNotesRead,
  saleRead, validateBid, validateReserve, type MarketListing,
  lastsFor,
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

describe("who may bid", () => {
  it("is the chief executive alone, matching the route's 403", () => {
    expect(canBid("ceo")).toBe(true);
    for (const role of ["cfo", "cmo", "cto", "coo"]) expect(canBid(role), role).toBe(false);
    expect(canBid(null)).toBe(false);
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

/*
 * How long a thing lasts, when a decision is not a year.
 *
 * `expiresIn` is decremented once a *tick*, so a three-year licence in a
 * quarterly season arrives as twelve. This screen printed that number with the
 * word "years" after it — "12 years, then it lapses" for a three-year asset, on
 * the one screen where somebody is deciding what to bid for it. A four-fold
 * overstatement of the thing being bought.
 *
 * The server has sent `period` and `periods` since the auction stopped being
 * annual, with a comment saying this is what they are for. Nothing on the phone
 * read either.
 */
describe("how long a thing lasts, when a decision is not a year", () => {
  const quarterly = { one: "quarter", many: "quarters", of: "this quarter" };

  it("says three years for twelve quarters, which is what was bought", () => {
    expect(lastsFor(12, quarterly, 4)).toBe("3 years");
    expect(lifeRead(12, quarterly, 4)).toBe("3 years, then it lapses");
  });

  it("says periods where the years do not divide, rather than rounding", () => {
    /*
     * "2.5 years" is not a sentence and rounding it to two or three would be the
     * same bug in a smaller coat — so a remainder is said in the unit the table
     * actually decides in.
     */
    expect(lastsFor(10, quarterly, 4)).toBe("10 quarters");
    expect(lifeRead(10, quarterly, 4)).toBe("10 quarters, then it lapses");
  });

  it("keeps saying years when a decision is a year", () => {
    /* The default, and every season before cadence existed. */
    expect(lastsFor(3)).toBe("3 years");
    expect(lastsFor(3, undefined, 1)).toBe("3 years");
    expect(lifeRead(4)).toBe("4 years, then it lapses");
  });

  it("spells a leading one in a sentence and not in a label", () => {
    expect(lifeRead(1)).toBe("One year, then it lapses");
    expect(lifeRead(4, quarterly, 4)).toBe("One year, then it lapses");
    /* The pill is a label, so it stays numeric and short. */
    expect(lifePill(8, quarterly, 4)).toBe("2 years");
  });

  it("names the last period in the table's own word", () => {
    expect(lifeRead(0, quarterly, 4)).toBe("Gone at the end of this quarter");
    expect(lifePill(1, quarterly, 4)).toBe("Last quarter");
    expect(lifePill(1)).toBe("Last year");
  });

  it("does not pretend a permanent thing expires", () => {
    for (const periods of [1, 4, 12]) {
      expect(lifeRead(null, quarterly, periods)).toBe("Doesn't expire — yours permanently");
      expect(lifePill(null, quarterly, periods)).toBe("Permanent");
    }
  });
});

/*
 * What a lot would make *this* company.
 *
 * The server sends `you` for exactly this, with a comment saying a listing said
 * "+6 quality" and left a founder to do the arithmetic against numbers held on a
 * different screen — which is the whole decision. The phone did not read it.
 */
describe("what a lot would make this company", () => {
  const you = { quality: 54, brand: 62, service: 48, capacity: 21_500, unitCost: 4.1 };

  it("reads as a before and after when it knows where the company stands", () => {
    const lines = effectLines({ quality: 6, brand: 14 }, you);
    expect(lines).toContain("quality 54 → 60");
    expect(lines).toContain("brand 62 → 76");
  });

  it("falls back to the bare delta when it does not", () => {
    /* A payload from a server that predates the field still has to read sensibly. */
    expect(effectLines({ quality: 6 })).toContain("+6 quality");
    expect(effectLines({ quality: 6 }, null)).toContain("+6 quality");
    expect(effectLines({ quality: 6 }, undefined)).toContain("+6 quality");
  });

  it("restates room against what the company already has", () => {
    /*
     * The figure that most needed it: "+4,038 capacity" against a company holding
     * 21,500 is a different decision from the same number against one holding 900.
     */
    /*
     * "22k → 26k", not "21,500 → 25,538": `money()` is the phone's shared
     * formatter and rounds thousands above ten, which is the house style and
     * keeps this figure the same shape as the same figure on the desk. The
     * precision lost is smaller than the decision being made.
     */
    expect(effectLines({ capacity: 4_038 }, you).join(" ")).toMatch(/room 22k → 26k/);
    expect(effectLines({ capacity: 4_038 }).join(" ")).toContain("capacity");
  });

  it("restates unit cost, which is a multiplier nobody reads as one", () => {
    const lines = effectLines({ unitCost: 0.93 }, you);
    /* `trim` drops a trailing ".0", so it is "−7%" and not "−7.0%". */
    expect(lines[0]).toContain("−7% unit cost");
    expect(lines[0]).toContain("4.1 → 3.81");
  });

  it("leaves out what an asset does not do", () => {
    expect(effectLines({ quality: 0, brand: 0, unitCost: 1 }, you)).toEqual([]);
    expect(effectLines(null, you)).toEqual([]);
  });

  it("survives a standing it cannot read", () => {
    /* A half-built payload must not turn "+6 quality" into "quality NaN → NaN". */
    const broken = { quality: Number.NaN, brand: 62, service: 48, capacity: Number.NaN, unitCost: 0 } as any;
    const lines = effectLines({ quality: 6, capacity: 100, unitCost: 0.9 }, broken);
    expect(lines.join(" ")).not.toMatch(/NaN/);
    expect(lines).toContain("+6 quality");
  });
});
