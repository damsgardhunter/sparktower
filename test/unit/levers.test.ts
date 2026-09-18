/**
 * What the table can see before it commits.
 *
 * The claims here are about information rather than arithmetic: that five
 * people each spending a reasonable amount can see they have collectively
 * spent an unreasonable amount, that the engine's own warnings reach them
 * while they can still act on them, and that a seat cannot file a decision
 * belonging to somebody else.
 */
import { describe, it, expect } from "vitest";
import {
  LEVER_FIELDS, defaultDraft, validateDecision, commitment, draftPreview, filedRoles,
} from "@shared/simulation/levers";
import { startingCompany, economyFor } from "@shared/simulation/season";
import { nicheById } from "@shared/simulation/niches";
import { ROLES, type Role } from "@shared/simulation/types";
import type { TeamDecisions } from "@shared/simulation/decisions";

const niche = nicheById("fitness_app")!;
const economy = economyFor("s", 1);
const company = () => startingCompany({ id: "t", name: "T", niche, seats: [...ROLES] });

describe("the levers themselves", () => {
  it("gives every seat something to do", () => {
    for (const role of ROLES) {
      expect(LEVER_FIELDS[role].length, `${role} has no levers`).toBeGreaterThan(0);
      for (const field of LEVER_FIELDS[role]) {
        // A control with no explanation is a control people set to zero and
        // resent when it turns out to have mattered.
        expect(field.help.length, `${role}.${field.id} has no help`).toBeGreaterThan(20);
      }
    }
  });

  it("starts a seat from last year rather than from zero", () => {
    const previous = { price: 19, brandSpend: 300_000, performanceSpend: 100_000, celebritySpend: 900_000, targetCities: [] };
    const draft = defaultDraft("cmo", company(), previous);
    expect(draft.price).toBe(19);
    expect(draft.brandSpend).toBe(300_000);
    // A campaign that ran once does not re-book itself just by opening the screen.
    expect(draft.celebritySpend).toBe(0);
  });

  it("does not pre-fill a loan", () => {
    const draft = defaultDraft("cfo", company(), { borrow: 2_000_000, repay: 0, cashBuffer: 0 });
    expect(draft.borrow).toBe(0);
  });
});

describe("what a seat may file", () => {
  it("refuses a repayment of money nobody owes", () => {
    const c = { ...company(), debt: 100_000 };
    const bad = validateDecision("cfo", { borrow: 0, repay: 500_000, cashBuffer: 0 }, c);
    expect(bad.ok).toBe(false);
    expect(bad.errors.repay).toMatch(/only owe/i);
  });

  it("allows a reckless year", () => {
    /*
     * Deliberate. Spending everything the company has is a decision a team is
     * allowed to make and sometimes the right one; a validator that refuses
     * risk turns a business simulation into a form that only accepts the safe
     * answer. The screen's job is to say what it costs, not to forbid it.
     */
    const ok = validateDecision("cmo", {
      price: 12, brandSpend: 50_000_000, performanceSpend: 50_000_000, celebritySpend: 0, targetCities: [],
    }, company());
    expect(ok.ok).toBe(true);
  });

  it("insists on a choice the engine understands", () => {
    expect(validateDecision("ceo", { focus: "vibes" }, company()).ok).toBe(false);
    expect(validateDecision("ceo", { focus: "survival" }, company()).ok).toBe(true);
  });
});

describe("what the table has committed", () => {
  it("adds up what no single seat could see", () => {
    /*
     * The failure this exists to prevent: four people each commit an amount
     * that is reasonable on its own screen, and the company is bankrupt before
     * the year runs. Each of them sees only their own number; only the sum is
     * alarming, and nobody was looking at the sum.
     */
    const c = company();
    const decisions: TeamDecisions = {
      companyId: "t",
      cmo: { price: 22, brandSpend: 2_000_000, performanceSpend: 0, celebritySpend: 0, targetCities: [] },
      cto: { featureSpend: 2_000_000, reliabilitySpend: 0, techDebtPaydown: 0 },
      coo: { capacityTarget: c.capacity, supportSpend: 2_000_000, efficiencySpend: 0, headcount: 0 },
    };

    const money = commitment(c, decisions, economy);
    expect(money.spend).toBe(6_000_000);
    // And the salary bill nobody chose is in there too.
    expect(money.fixed).toBeGreaterThan(0);
    // Past the cash in the bank: from here the year is funded on credit, which
    // is the line the table needs to see itself crossing.
    expect(money.spend + money.fixed).toBeGreaterThan(c.cash);
    expect(money.ratio).toBeGreaterThan(0.8);
  });

  it("counts what finance has ring-fenced as unavailable", () => {
    const c = company();
    const withoutBuffer = commitment(c, { companyId: "t" }, economy).available;
    const withBuffer = commitment(c, { companyId: "t", cfo: { borrow: 0, repay: 0, cashBuffer: 3_000_000 } }, economy).available;
    expect(withBuffer).toBe(withoutBuffer - 3_000_000);
  });

  it("counts a drawdown as money the table can spend", () => {
    const c = company();
    const plain = commitment(c, { companyId: "t" }, economy).available;
    const borrowed = commitment(c, { companyId: "t", cfo: { borrow: 1_000_000, repay: 0, cashBuffer: 0 } }, economy).available;
    expect(borrowed).toBe(plain + 1_000_000);
  });

  it("attributes the spend to the seat that chose it", () => {
    const money = commitment(company(), {
      companyId: "t",
      cmo: { price: 22, brandSpend: 500_000, performanceSpend: 0, celebritySpend: 0, targetCities: [] },
    }, economy);
    expect(money.bySeat.find((s) => s.role === "cmo")!.spend).toBe(500_000);
    expect(money.bySeat.find((s) => s.role === "cto")!.spend).toBe(0);
  });
});

describe("the preview", () => {
  it("says how short the year is, in money", () => {
    const c = company();
    const preview = draftPreview({
      company: c, niche, economy,
      decisions: {
        companyId: "t",
        cmo: { price: 22, brandSpend: 20_000_000, performanceSpend: 0, celebritySpend: 0, targetCities: [] },
      },
    });
    expect(preview.warnings.join(" ")).toMatch(/short/i);
    // And says what happens anyway, rather than just refusing.
    expect(preview.warnings.join(" ")).toMatch(/credit|insolvent/i);
  });

  it("warns before a year that leaves nothing in reserve", () => {
    const c = company();
    const available = commitment(c, { companyId: "t" }, economy).available;
    const fixed = commitment(c, { companyId: "t" }, economy).fixed;
    const preview = draftPreview({
      company: c, niche, economy,
      decisions: {
        companyId: "t",
        cmo: { price: 22, brandSpend: Math.round(available * 0.95 - fixed), performanceSpend: 0, celebritySpend: 0, targetCities: [] },
      },
    });
    expect(preview.warnings.join(" ")).toMatch(/nothing left|almost everything/i);
  });

  it("says when a year stops being funded by cash and starts being funded by the bank", () => {
    /*
     * Not the same as spending too much. A team can commit every pound they
     * have, still be inside what they could technically borrow, and hear
     * nothing from a plain ratio — while having just moved onto the credit
     * line, which costs interest every year afterwards.
     */
    const c = company();
    const preview = draftPreview({
      company: c, niche, economy,
      decisions: {
        companyId: "t",
        cmo: { price: 22, brandSpend: c.cash, performanceSpend: 0, celebritySpend: 0, targetCities: [] },
      },
    });
    expect(preview.commitment.ratio, "still inside what they could raise").toBeLessThan(0.9);
    expect(preview.warnings.join(" ")).toMatch(/credit line|comes out of the credit/i);
    expect(preview.warnings.join(" ")).toMatch(/interest/i);
  });

  it("tells operations that marketing is about to outrun them", () => {
    /*
     * The coupling that is invisible from either seat alone, shown before the
     * tick instead of explained after it.
     */
    const c = company();
    const preview = draftPreview({
      company: c, niche, economy,
      decisions: {
        companyId: "t",
        cmo: { price: 22, brandSpend: 3_000_000, performanceSpend: 3_000_000, celebritySpend: 0, targetCities: [] },
        coo: { capacityTarget: 1_000, supportSpend: 0, efficiencySpend: 0, headcount: 0 },
      },
    });
    expect(preview.notes.join(" ")).toMatch(/more people than operations could serve/i);
  });

  it("says nothing about seats that simply haven't filed yet", () => {
    /*
     * The engine writes "no finance decision was made this year" once the year
     * has run, which is true then and merely nagging at nine in the morning
     * while the CFO is still asleep. The screen shows empty seats as empty
     * seats instead.
     */
    const preview = draftPreview({ company: company(), niche, economy, decisions: { companyId: "t" } });
    expect(preview.notes.join(" ")).not.toMatch(/no finance decision was made/i);
  });

  it("flags a price below what a unit costs to make", () => {
    const c = company();
    const preview = draftPreview({
      company: c, niche, economy,
      decisions: { companyId: "t", cmo: { price: 1, brandSpend: 0, performanceSpend: 0, celebritySpend: 0, targetCities: [] } },
    });
    expect(preview.notes.join(" ")).toMatch(/costs .* to make/i);
  });
});

describe("who has filed", () => {
  it("lists the seats that committed and not the ones that didn't", () => {
    const filed = filedRoles({
      companyId: "t",
      cmo: { price: 1, brandSpend: 0, performanceSpend: 0, celebritySpend: 0, targetCities: [] },
      ceo: { focus: "growth" },
    });
    expect(filed.sort()).toEqual(["ceo", "cmo"]);
  });
});
