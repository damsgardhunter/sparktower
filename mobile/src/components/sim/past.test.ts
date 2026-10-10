/**
 * Reading the year behind you.
 *
 * Two of these matter more than the rest. `lotOutcome` is the only thing that
 * ever tells a team whether it won a sealed lot — the bids are deleted when they
 * settle, so if this is wrong there is no second source to check it against. And
 * `readDecision` has to keep saying what the web says, which is pinned
 * separately in `test/unit/mobile-mirror.test.ts`; what is checked here is the
 * behaviour that card depends on and the web's version does not have.
 */
import { describe, it, expect } from "vitest";
import {
  creditPlace, lotLabel, lotOutcome, marketRows, readDecision, seatsThatFiledNothing,
  type AuctionRow, type Standing,
} from "./past";

const lot = (over: Partial<AuctionRow> = {}): AuctionRow => ({
  listingId: "l1",
  name: "A warehouse",
  kind: "distribution_hub",
  reserve: 400_000,
  bidders: 3,
  winner: "Bricktop",
  winnerId: "c2",
  price: 520_000,
  yourBid: 480_000,
  ...over,
});

const co = (over: Partial<Standing> = {}): Standing => ({
  id: "c1",
  name: "A Company",
  kind: "player",
  isYou: false,
  price: 100,
  quality: 50,
  service: 50,
  brand: 50,
  customers: 1_000,
  positioning: null,
  grade: "B",
  creditScore: 600,
  ...over,
});

describe("how a sealed lot went", () => {
  it("knows a lot you won, by who the winner was", () => {
    expect(lotOutcome(lot({ winnerId: "c1", winner: "Us" }), "c1")).toBe("won");
  });

  it("knows a lot you bid for and lost", () => {
    expect(lotOutcome(lot(), "c1")).toBe("outbid");
  });

  it("knows a lot you only watched", () => {
    expect(lotOutcome(lot({ yourBid: null }), "c1")).toBe("watched");
    expect(lotOutcome(lot({ yourBid: 0 }), "c1")).toBe("watched");
  });

  it("knows a lot nobody took", () => {
    /* No winner at all is a real outcome: the reserve was never met. */
    expect(lotOutcome(lot({ winner: null, winnerId: null, price: null }), "c1")).toBe("unsold");
  });

  it("does not call a near miss a win when the bid happened to equal the price", () => {
    /*
     * The failure this function exists to avoid. A sealed auction settles at the
     * reserve or at the runner-up's bid depending on how it went, so "your bid
     * equals the price" is neither necessary nor sufficient for having won — and
     * reading it that way tells a team it owns something it does not.
     */
    const row = lot({ winnerId: "c2", winner: "Bricktop", price: 480_000, yourBid: 480_000 });
    expect(lotOutcome(row, "c1")).toBe("outbid");
  });

  it("does not claim a win when it has no idea which company is yours", () => {
    /* A missing company id must read as "not yours", never as "yours". */
    expect(lotOutcome(lot({ winnerId: "c1", winner: "Us" }), null)).toBe("outbid");
  });

  it("says each outcome in words, because a colour is not a sentence", () => {
    for (const outcome of ["won", "outbid", "watched", "unsold"] as const) {
      expect(lotLabel(outcome).length).toBeGreaterThan(2);
    }
    expect(new Set(["won", "outbid", "watched", "unsold"].map((o) => lotLabel(o as any))).size).toBe(4);
  });
});

describe("what the table filed", () => {
  it("names the seats that filed nothing, which is the useful part", () => {
    const filed = { cmo: { price: 40 }, coo: {} };
    expect(seatsThatFiledNothing(["ceo", "cmo", "coo", null], filed)).toEqual(["ceo", "coo"]);
  });

  it("treats a seat with an empty payload as having filed nothing", () => {
    /*
     * `{}` and `undefined` are the same thing to a reader — the caretaker ran
     * the seat either way — and an empty object is what a submitted-but-untouched
     * form leaves behind.
     */
    expect(readDecision({})).toEqual([]);
    expect(seatsThatFiledNothing(["cfo"], { cfo: {} })).toEqual(["cfo"]);
  });

  it("drops the company id, which is plumbing rather than a decision", () => {
    const lines = readDecision({ companyId: "c1", price: 40 });
    expect(lines.map((l) => l.label)).toEqual(["Price"]);
  });

  it("reads money through whatever formatter it was given", () => {
    /*
     * The phone's `money()` carries no currency symbol and the web's has a
     * pound sign baked in, so the formatter is passed rather than chosen here.
     * This checks it is actually used for the keys that are money and not for
     * the ones that are not.
     */
    const lines = readDecision({ brandSpend: 250_000, headcount: 12 }, () => "MONEY");
    expect(lines.find((l) => l.label === "Brand Spend")?.value).toBe("MONEY");
    expect(lines.find((l) => l.label === "Headcount")?.value).toBe("12");
  });

  it("says a blank lever is blank rather than nought", () => {
    /*
     * Nought and "not set" are different decisions and a seat reading this card
     * is often checking which one happened — "positioning 0" would be a lie.
     */
    const lines = readDecision({ positioning: "", rehire: null, targetCities: [] });
    expect(lines.find((l) => l.label === "Positioning")?.value).toBe("—");
    expect(lines.find((l) => l.label === "Rehire")?.value).toBe("—");
    expect(lines.find((l) => l.label === "Target Cities")?.value).toBe("none");
  });
});

describe("where the market sits", () => {
  it("orders by price, which is the axis a table argues about", () => {
    const rows = marketRows([co({ id: "a", price: 10 }), co({ id: "b", price: 90 }), co({ id: "c", price: 50 })]);
    expect(rows.map((r) => r.id)).toEqual(["b", "c", "a"]);
  });

  it("does not reorder the caller's array underneath it", () => {
    /* The payload is shared with every other card on the screen. */
    const given = [co({ id: "a", price: 10 }), co({ id: "b", price: 90 })];
    marketRows(given);
    expect(given.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("places your credit against the other teams, not against the incumbents", () => {
    /*
     * An incumbent is not graded and cannot be in the running, so counting them
     * would put a team "4th of 7" in a market with three rivals.
     */
    const standing = [
      co({ id: "me", isYou: true, creditScore: 620, grade: "B" }),
      co({ id: "r1", creditScore: 700, grade: "A" }),
      co({ id: "inc", kind: "incumbent", grade: null, creditScore: null }),
    ];
    expect(creditPlace(standing)).toEqual({ place: 2, of: 2, grade: "B" });
  });

  it("has nothing to say when you are not in the market it was given", () => {
    expect(creditPlace([co({ id: "r1" })])).toBeNull();
    expect(creditPlace([])).toBeNull();
  });
});
