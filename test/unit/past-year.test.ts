/**
 * Reading a filed decision back to the people who filed it.
 *
 * The card's one piece of logic: every lever a seat committed, in words, with
 * money reading as money and a split reading as a split. It matters that it
 * leaves nothing out — the point of the card is that no decision quietly goes
 * unrecorded, so a curated subset would defeat it.
 */
import { describe, it, expect } from "vitest";
import { readDecision } from "../../client/src/components/sim/past-year";

describe("what a seat filed, read back", () => {
  it("says nothing about a seat that filed nothing", () => {
    expect(readDecision(undefined)).toEqual([]);
  });

  it("keeps every lever, and never the bookkeeping", () => {
    const lines = readDecision({ companyId: "v1", price: 44, brandSpend: 250_000, targetCities: ["leeds"] });
    expect(lines.map((l) => l.label)).not.toContain("Company Id");
    expect(lines).toHaveLength(3);
  });

  it("reads money as money and a share as a share", () => {
    const lines = readDecision({ brandSpend: 250_000, dividendPct: 10, engineerPay: 105, capacityTarget: 90_000 });
    const of = (label: string) => lines.find((l) => l.label === label)?.value;
    expect(of("Brand Spend")).toBe("£250k");
    expect(of("Dividend Pct")).toBe("10%");
    expect(of("Engineer Pay")).toBe("105%");
    // A count is a count: capacity is people, not pounds.
    expect(of("Capacity Target")).toBe("90,000");
  });

  it("reads a split as the split it was, and an empty one as none", () => {
    const lines = readDecision({ budget: { cmo: 40, cto: 30 }, regionFocus: {}, targetCities: [] });
    const of = (label: string) => lines.find((l) => l.label === label)?.value;
    expect(of("Budget")).toBe("cmo 40 · cto 30");
    expect(of("Region Focus")).toBe("none");
    expect(of("Target Cities")).toBe("none");
  });

  it("does not pretend an unanswered choice was answered", () => {
    const lines = readDecision({ overrule: "", promo: "none" });
    const of = (label: string) => lines.find((l) => l.label === label)?.value;
    expect(of("Overrule")).toBe("—");
    expect(of("Promo")).toBe("none");
  });
});
