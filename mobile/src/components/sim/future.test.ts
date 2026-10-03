/**
 * Reading the year in front of you.
 *
 * `capacityRisk` is checked against the engine's own copy in
 * `test/unit/mobile-mirror.test.ts` — that is the one that matters and it lives
 * there because only that file can import both. What is checked here is the
 * reading built on top of it: the price curve, which decides which number a seat
 * is shown, and the over-ordering line, which is the one warning on the screen
 * that interrupts somebody.
 */
import { describe, it, expect } from "vitest";
import {
  ORDER_FAR_TOO_MUCH, VERDICT_READ, capacityRisk, comingUp, demandAtPrice,
  forecastAtPrice, overOrdering, whoseBet, type Forecast,
} from "./future";

const forecast = (over: Partial<Forecast> = {}): Forecast => ({
  likely: 1_000,
  low: 800,
  high: 1_200,
  band: 0.2,
  bySegment: [],
  curve: [
    { price: 20, likely: 1_600 },
    { price: 40, likely: 1_200 },
    { price: 60, likely: 1_000 },
    { price: 80, likely: 700 },
    { price: 100, likely: 400 },
  ],
  price: 60,
  ...over,
});

describe("demand at the price on the table", () => {
  it("reads a price the curve was drawn at", () => {
    expect(demandAtPrice(forecast(), 60)).toBe(1_000);
    expect(demandAtPrice(forecast(), 40)).toBe(1_200);
  });

  it("interpolates between the prices it has", () => {
    /* Halfway between 40 (1,200) and 60 (1,000). */
    expect(demandAtPrice(forecast(), 50)).toBe(1_100);
  });

  it("stops at the ends rather than inventing demand beyond them", () => {
    /*
     * Extrapolating past the curve would put a number on a price nobody
     * modelled, and the honest answer at the edge is the edge. Charging nothing
     * does not bring infinite customers.
     */
    expect(demandAtPrice(forecast(), 1)).toBe(1_600);
    expect(demandAtPrice(forecast(), 10_000)).toBe(400);
  });

  it("falls back to the middle when there is no curve or no price", () => {
    expect(demandAtPrice(forecast({ curve: [] }), 55)).toBe(1_000);
    expect(demandAtPrice(forecast(), Number.NaN)).toBe(1_000);
  });

  it("rebuilds the range around the new middle rather than shifting it", () => {
    /*
     * The band is a fraction, not a fixed spread, so a range read at a different
     * price has to be rebuilt — sliding the old low and high would understate
     * the uncertainty at a cheaper price and overstate it at a dearer one.
     */
    const at = forecastAtPrice(forecast(), 100);
    expect(at.likely).toBe(400);
    expect(at.low).toBe(320);
    expect(at.high).toBe(480);
  });
});

describe("the bet the room makes", () => {
  it("prices being wrong in both directions", () => {
    const risk = capacityRisk({ capacity: 1_000, forecast: forecast(), price: 60, idleCostPerUnit: 5 });
    /* 200 spare if it comes in at 800, 200 turned away if it comes in at 1,200. */
    expect(risk.idleAtLow).toBe(200);
    expect(risk.idleCostAtLow).toBe(1_000);
    expect(risk.shortAtHigh).toBe(200);
    expect(risk.revenueLostAtHigh).toBe(12_000);
  });

  it("walks the verdict from too little room to far too much", () => {
    const f = forecast();
    const at = (capacity: number) =>
      capacityRisk({ capacity, forecast: f, price: 60, idleCostPerUnit: 5 }).verdict;
    expect(at(700)).toBe("short");
    expect(at(900)).toBe("tight");
    expect(at(1_100)).toBe("balanced");
    expect(at(1_300)).toBe("generous");
    expect(at(5_000)).toBe("idle");
  });

  it("says which way the risk runs in words, for every verdict", () => {
    /*
     * "Tight" and "generous" are the same word to anybody who has not read the
     * manual, and a coloured chip does not say whether the problem is too much
     * room or too little. Every verdict has to carry a sentence.
     */
    for (const verdict of ["short", "tight", "balanced", "generous", "idle"] as const) {
      expect(VERDICT_READ[verdict].title.length).toBeGreaterThan(4);
      expect(VERDICT_READ[verdict].means.length).toBeGreaterThan(10);
    }
  });
});

describe("ordering room that could never be filled", () => {
  it("leaves building ahead of demand alone", () => {
    /*
     * Deliberately permissive, and the reasoning is on the constant: a plant held
     * at 1.25× what a company serves never turns a profit, so a warning that
     * fired there would tell a founder their only winning move was a mistake.
     */
    expect(overOrdering(1_200 * 2, forecast())).toBe(false);
    expect(overOrdering(1_200 * ORDER_FAR_TOO_MUCH, forecast())).toBe(false);
  });

  it("interrupts an order that is multiples of anything the market could bring", () => {
    /* The founder who ordered 3,000 seats against 87 customers. */
    expect(overOrdering(1_200 * ORDER_FAR_TOO_MUCH + 1, forecast())).toBe(true);
    expect(overOrdering(40_000, forecast())).toBe(true);
  });

  it("does not divide by a forecast of nothing", () => {
    /* A market with no demand at this price still must not warn on an order of zero. */
    expect(overOrdering(0, forecast({ high: 0, likely: 0, low: 0 }))).toBe(false);
    expect(overOrdering(100, forecast({ high: 0, likely: 0, low: 0 }))).toBe(true);
  });
});

describe("what is already paid for", () => {
  it("says when each thing lands, which is the point of the list", () => {
    const rows = comingUp({ pipeline: 6, pipelineLater: 3, brandPipeline: 4 });
    expect(rows.map((r) => r.id)).toEqual(["quality", "research", "brand"]);
    expect(rows[0].when).toContain("next year");
    expect(rows[1].when).toContain("two years");
  });

  it("leaves out what is not coming, rather than showing it as nought", () => {
    expect(comingUp({})).toEqual([]);
    expect(comingUp({ pipeline: 0, brandPipeline: 0, techDebt: 0 })).toEqual([]);
  });

  it("carries what technical debt is costing right now, not just its score", () => {
    const rows = comingUp({ techDebt: 60, techDebtCost: { product: 30, unitCost: 12 } });
    expect(rows[0].value).toBe("60");
    expect(rows[0].when).toContain("30%");
    expect(rows[0].warn).toBe(true);
  });

  it("does not alarm over debt small enough to live with", () => {
    const rows = comingUp({ techDebt: 20, techDebtCost: { product: 10, unitCost: 4 } });
    expect(rows[0].warn).toBe(false);
  });

  it("survives a company payload with nothing in it", () => {
    /* Year one, before anything has been bought. */
    expect(comingUp({ pipeline: undefined, techDebt: undefined })).toEqual([]);
  });
});

describe("whose decision this screen is about", () => {
  it("names the lever for the two seats that own the argument", () => {
    expect(whoseBet("coo")).toBe("capacity");
    expect(whoseBet("cmo")).toBe("price");
  });

  it("says nothing to the three seats whose levers are elsewhere", () => {
    for (const role of ["ceo", "cfo", "cto", null, undefined]) {
      expect(whoseBet(role)).toBeNull();
    }
  });
});
