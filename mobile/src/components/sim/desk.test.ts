/**
 * The desk's arithmetic, driven through the cases that would show five people
 * a number the engine disagrees with.
 *
 * `commitment()` gets the most attention by a distance. It is a mirror of
 * shared/simulation/levers.ts maintained by hand, and the failure mode isn't a
 * crash — it is a screen that calmly reads 0.88 while the tick resolves 1.12
 * and bankrupts the company. Every term of the sum is pinned separately here,
 * so a drift shows up as one failing expectation naming the term that moved.
 */
import { describe, it, expect } from "vitest";
import {
  bump, clampToField, commitment, commitmentLevel, draftMatches, exact,
  executiveSalariesFrom, fixedCosts, formatUntil, money, percent,
  resolveIsImminent, secondsUntil, shortfall, signed, stepFor, tableStatus,
  validateDraft, waitingOn, withYourDraft,
  type DeskTableSeat, type FiledDecisions, type LeverField,
} from "./desk";

const company = { cash: 4_000_000, debt: 1_000_000, creditLimit: 3_000_000 };

/** A full table, the numbers chosen so every term of the sum is distinguishable. */
const table: FiledDecisions = {
  cmo: { price: 40, brandSpend: 1_000_000, performanceSpend: 500_000, celebritySpend: 0 },
  cto: { featureSpend: 300_000, reliabilitySpend: 200_000, techDebtPaydown: 0 },
  coo: { capacityTarget: 100_000, supportSpend: 100_000, efficiencySpend: 0, headcount: 20 },
  cfo: { borrow: 500_000, repay: 250_000, cashBuffer: 1_000_000 },
  ceo: { focus: "growth" },
};

// Five filled seats at 140,000 each, as fixedCosts() in
// shared/simulation/decisions.ts charges them.
const EXECS = 700_000;
const run = (decisions: FiledDecisions = table, costIndex = 1.05) =>
  commitment({ company, decisions, costIndex, executiveSalaries: EXECS });

describe("what the table has committed", () => {
  it("adds the four spending seats and leaves the chief executive at zero", () => {
    const c = run();
    // 1.5m marketing + 0.5m product + 0.1m support + 0.25m repayment.
    expect(c.spend).toBe(2_350_000);
    expect(Object.fromEntries(c.bySeat.map((s) => [s.role, s.spend]))).toEqual({
      cmo: 1_500_000, cto: 500_000, coo: 100_000, cfo: 250_000, ceo: 0,
    });
  });

  it("counts a repayment as spend and a drawdown as money arriving, not leaving", () => {
    // The pairing that is easiest to get backwards, and the one that would
    // make a CFO's prudent year look like their most extravagant.
    const repaid = run({ cfo: { borrow: 0, repay: 400_000, cashBuffer: 0 } });
    const borrowed = run({ cfo: { borrow: 400_000, repay: 0, cashBuffer: 0 } });
    expect(repaid.spend).toBe(400_000);
    expect(borrowed.spend).toBe(0);
    expect(borrowed.available - repaid.available).toBe(400_000);
  });

  it("never lets a negative repayment subtract from the table's spend", () => {
    expect(run({ cfo: { borrow: 0, repay: -900_000, cashBuffer: 0 } }).spend).toBe(0);
  });

  it("charges salaries at the cost index and adds the executive bill", () => {
    // 20 × 85,000 × 1.05 = 1,785,000, plus 700,000 of executive salaries.
    expect(run().fixed).toBe(2_485_000);
    expect(fixedCosts(20, 1.05, EXECS)).toBe(2_485_000);
  });

  it("counts unused credit as available, and the buffer as unavailable", () => {
    // 4m cash + 0.5m drawn + (3m limit − 1m owed) − 1m held back.
    expect(run().available).toBe(5_500_000);
  });

  it("gives the ratio the whole bill, fixed costs included", () => {
    const c = run();
    expect(c.ratio).toBeCloseTo((2_350_000 + 2_485_000) / 5_500_000, 10);
    expect(shortfall(c)).toBe(-665_000);
  });

  it("treats a company with nothing available as infinitely over-committed", () => {
    // Division by zero would give NaN, and NaN renders as an empty bar rather
    // than as the loudest state on the screen.
    const c = commitment({
      company: { cash: 0, debt: 5_000_000, creditLimit: 1_000_000 },
      decisions: { cto: { featureSpend: 50_000 } },
      costIndex: 1,
      executiveSalaries: EXECS,
    });
    expect(c.available).toBe(0);
    expect(c.ratio).toBe(Infinity);
    expect(commitmentLevel(c.ratio)).toBe("over");
  });

  it("clamps available at zero when the buffer exceeds everything the company has", () => {
    const c = commitment({
      company: { cash: 500_000, debt: 3_000_000, creditLimit: 3_000_000 },
      decisions: { cfo: { borrow: 0, repay: 0, cashBuffer: 9_000_000 } },
      costIndex: 1,
      executiveSalaries: 0,
    });
    expect(c.available).toBe(0);
  });

  it("reads an empty table as no spend rather than as an error", () => {
    const c = run({}, 1);
    expect(c.spend).toBe(0);
    expect(c.fixed).toBe(EXECS);
  });

  it("copes with numbers that arrived from a text input as strings", () => {
    // Everything the form holds is a string until it isn't; a total that goes
    // "1000000500000" because two of them were concatenated is a real bug.
    const c = run({ cmo: { brandSpend: "1000000" as any, performanceSpend: "500000" as any } });
    expect(c.spend).toBe(1_500_000);
  });

  it("ignores a half-typed number instead of poisoning the total with NaN", () => {
    expect(run({ cmo: { brandSpend: "" as any, performanceSpend: 250_000 } }).spend).toBe(250_000);
  });
});

describe("the executive half of the fixed bill, backed out of the server's number", () => {
  it("recovers the seat salaries the response doesn't send", () => {
    expect(executiveSalariesFrom(2_485_000, 20, 1.05)).toBe(700_000);
  });

  it("is the whole of fixed when nobody has filed a headcount", () => {
    expect(executiveSalariesFrom(700_000, 0, 1.05)).toBe(700_000);
  });

  it("round-trips: the local sum reproduces the server's fixed before anything is edited", () => {
    const serverFixed = 2_485_000;
    const execs = executiveSalariesFrom(serverFixed, 20, 1.05);
    expect(fixedCosts(20, 1.05, execs)).toBeCloseTo(serverFixed, 6);
  });

  it("moves with the headcount the player is editing", () => {
    const execs = executiveSalariesFrom(2_485_000, 20, 1.05);
    expect(fixedCosts(30, 1.05, execs)).toBe(700_000 + 30 * 85_000 * 1.05);
  });

  it("refuses to go negative if the response and the mirror ever disagree", () => {
    // Too low a total is the dangerous direction; better to over-state the
    // fixed bill than to quietly hide part of it.
    expect(executiveSalariesFrom(100_000, 20, 1.05)).toBe(0);
  });
});

describe("your unsaved edits count against the table immediately", () => {
  it("stands in for whatever you filed before", () => {
    const merged = withYourDraft(table, "cmo", { brandSpend: 3_000_000, performanceSpend: 0, celebritySpend: 0, price: 40 });
    expect(run(merged).spend).toBe(2_350_000 - 1_500_000 + 3_000_000);
  });

  it("leaves the other four alone", () => {
    const merged = withYourDraft(table, "cmo", { brandSpend: 0, performanceSpend: 0, celebritySpend: 0, price: 40 });
    expect(merged.cto).toEqual(table.cto);
  });

  it("changes nothing for a seat that doesn't exist yet", () => {
    expect(withYourDraft(table, null, { brandSpend: 9_000_000 })).toEqual(table);
  });
});

describe("how loudly to say it", () => {
  it("matches the thresholds the server warns at", () => {
    // draftPreview() in shared/simulation/levers.ts warns above 0.9 and shouts
    // above 1; the colour and the sentence must not contradict each other.
    expect(commitmentLevel(0.5)).toBe("clear");
    expect(commitmentLevel(0.9)).toBe("clear");
    expect(commitmentLevel(0.91)).toBe("tight");
    expect(commitmentLevel(1)).toBe("tight");
    expect(commitmentLevel(1.0001)).toBe("over");
    expect(commitmentLevel(Infinity)).toBe("over");
    expect(commitmentLevel(NaN)).toBe("over");
  });
});

describe("the clock to the tick", () => {
  const now = Date.parse("2026-09-18T09:00:00.000Z");

  it("counts down to an absolute time", () => {
    expect(secondsUntil("2026-09-18T09:30:00.000Z", now)).toBe(1_800);
  });

  it("stops at zero once the tick is due rather than going negative", () => {
    expect(secondsUntil("2026-09-18T08:00:00.000Z", now)).toBe(0);
  });

  it("has nothing to show for a finished season", () => {
    expect(secondsUntil(null, now)).toBeNull();
    expect(secondsUntil(undefined, now)).toBeNull();
    expect(secondsUntil("not a date", now)).toBeNull();
    expect(formatUntil(null)).toBe("—");
  });

  it("drops the seconds while the deadline is a day away and finds them again at the end", () => {
    expect(formatUntil(63_600)).toBe("17h 40m");
    expect(formatUntil(3_600)).toBe("1h");
    expect(formatUntil(2_520)).toBe("42m");
    expect(formatUntil(59)).toBe("0:59");
    expect(formatUntil(0)).toBe("0:00");
  });

  it("calls the last half hour urgent and the rest of the day not", () => {
    expect(resolveIsImminent(60 * 60)).toBe(false);
    expect(resolveIsImminent(29 * 60)).toBe(true);
    expect(resolveIsImminent(null)).toBe(false);
  });
});

describe("the steppers", () => {
  const brand: LeverField = { id: "brandSpend", label: "Brand", help: "", kind: "money", min: 0, step: 50_000 };
  const heads: LeverField = { id: "headcount", label: "Headcount", help: "", kind: "count", min: 0, max: 400, step: 1 };

  it("tidies a carried-over draft onto the step rather than keeping its offset forever", () => {
    expect(bump(brand, 1_237_000, 1)).toBe(1_250_000);
    expect(bump(brand, 1_237_000, -1)).toBe(1_200_000);
  });

  it("moves a whole step from a value already on one", () => {
    expect(bump(brand, 1_200_000, 1)).toBe(1_250_000);
    expect(bump(brand, 1_200_000, -1)).toBe(1_150_000);
  });

  it("stops at the field's floor instead of committing a negative budget", () => {
    expect(bump(brand, 0, -1)).toBe(0);
    expect(bump(brand, 20_000, -1)).toBe(0);
  });

  it("stops at the ceiling", () => {
    expect(bump(heads, 400, 1)).toBe(400);
  });

  it("starts from zero for a field that has never been touched", () => {
    expect(bump(brand, undefined, 1)).toBe(50_000);
    expect(bump(brand, "", 1)).toBe(50_000);
  });

  it("never leaves a fractional person", () => {
    expect(clampToField(heads, 12.4)).toBe(12);
  });

  it("falls back to a sensible step for a field that doesn't name one", () => {
    expect(stepFor({ id: "x", label: "", help: "", kind: "money" })).toBe(50_000);
    expect(stepFor({ id: "x", label: "", help: "", kind: "count" })).toBe(1);
    expect(stepFor({ id: "x", label: "", help: "", kind: "money", step: 0 })).toBe(50_000);
  });
});

describe("what the form refuses, and what it deliberately doesn't", () => {
  const fields: LeverField[] = [
    { id: "borrow", label: "Draw down", help: "", kind: "money", min: 0, step: 100_000 },
    { id: "repay", label: "Repay", help: "", kind: "money", min: 0, step: 100_000 },
    { id: "cashBuffer", label: "Buffer", help: "", kind: "money", min: 0, step: 100_000 },
  ];
  const focus: LeverField[] = [{
    id: "focus", label: "Focus", help: "", kind: "choice",
    options: [{ value: "growth", label: "Growth", help: "" }, { value: "margin", label: "Margin", help: "" }],
  }];

  it("accepts an expensive year, because an expensive year is a decision", () => {
    const check = validateDraft(fields, { borrow: 9_000_000, repay: 0, cashBuffer: 0 }, { debt: 1_000_000 }, "cfo");
    expect(check.ok).toBe(true);
  });

  it("refuses a repayment larger than the debt, as the server does", () => {
    const check = validateDraft(fields, { borrow: 0, repay: 2_000_000, cashBuffer: 0 }, { debt: 1_000_000 }, "cfo");
    expect(check.ok).toBe(false);
    expect(check.errors.repay).toContain("1,000,000");
  });

  it("leaves that rule to the CFO's seat alone", () => {
    const check = validateDraft(fields, { borrow: 0, repay: 2_000_000, cashBuffer: 0 }, { debt: 1_000_000 }, "cto");
    expect(check.ok).toBe(true);
  });

  it("catches a blank and a below-floor number under the field that caused it", () => {
    const check = validateDraft(fields, { borrow: "", repay: -5, cashBuffer: 0 }, { debt: 0 }, "cfo");
    expect(check.errors.borrow).toBe("Needs a number.");
    expect(check.errors.repay).toBe("Can't go below 0.");
    expect(check.errors.cashBuffer).toBeUndefined();
  });

  it("insists a choice is one of the offered ones", () => {
    expect(validateDraft(focus, { focus: "vibes" }, { debt: 0 }, "ceo").ok).toBe(false);
    expect(validateDraft(focus, { focus: "margin" }, { debt: 0 }, "ceo").ok).toBe(true);
  });
});

describe("whether anything has changed since you filed", () => {
  it("sees a number that only differs by its type as unchanged", () => {
    // The server hands back numbers; the form holds strings while being typed,
    // and a button that says "Update" on an untouched form is a lie.
    expect(draftMatches({ brandSpend: 50_000 }, { brandSpend: "50000" as any })).toBe(true);
  });

  it("notices a real edit", () => {
    expect(draftMatches({ brandSpend: 50_000 }, { brandSpend: 100_000 })).toBe(false);
  });

  it("compares the CMO's city list by content", () => {
    expect(draftMatches({ targetCities: ["leeds"] }, { targetCities: ["leeds"] })).toBe(true);
    expect(draftMatches({ targetCities: [] }, { targetCities: ["leeds"] })).toBe(false);
  });

  it("is false when there is nothing filed to compare against", () => {
    expect(draftMatches(null, { brandSpend: 0 })).toBe(false);
  });
});

describe("reading the numbers", () => {
  it("shortens money without a currency symbol the server doesn't use", () => {
    expect(money(6_200_000)).toBe("6.2m");
    expect(money(12_000_000)).toBe("12m");
    expect(money(1_000_000)).toBe("1m");
    expect(money(850_000)).toBe("850k");
    expect(money(1_500)).toBe("1.5k");
    expect(money(999)).toBe("999");
    expect(money(-1_400_000)).toBe("−1.4m");
    expect(money(NaN)).toBe("—");
  });

  it("keeps an exact figure for the places rounding would hide the point", () => {
    expect(exact(4_835_000)).toBe((4_835_000).toLocaleString());
  });

  it("puts the direction in front of a change", () => {
    expect(signed(3)).toBe("+3");
    expect(signed(-2.4, 1)).toBe("−2.4");
    expect(signed(0)).toBe("0");
  });

  it("turns a share into a percentage", () => {
    expect(percent(0.1237)).toBe("12.4%");
  });
});

describe("who the table is waiting on", () => {
  const seat = (over: Partial<DeskTableSeat>): DeskTableSeat =>
    ({ userId: "u", name: "Someone", role: "cto", title: null, filed: true, isYou: false, ...over });

  it("says nothing is outstanding when everyone has filed", () => {
    expect(tableStatus([seat({ userId: "a" }), seat({ userId: "b", role: "cmo" })]))
      .toBe("Everyone has filed. The year resolves on the tick.");
  });

  it("names the people, not a count", () => {
    expect(tableStatus([
      seat({ userId: "a", name: "Priya", role: "cfo", filed: false }),
      seat({ userId: "b", name: "Sam", role: "coo", filed: false }),
      seat({ userId: "c", name: "You", role: "cmo", isYou: true }),
    ])).toBe("Waiting on Priya and Sam.");
  });

  it("includes you when you're one of the ones holding it up", () => {
    expect(tableStatus([
      seat({ userId: "a", name: "Priya", role: "cfo", filed: false }),
      seat({ userId: "c", name: "You", role: "cmo", isYou: true, filed: false }),
    ])).toBe("Waiting on Priya — and on you.");
  });

  it("is blunt when it's only you", () => {
    expect(tableStatus([
      seat({ userId: "a", name: "Priya", role: "cfo" }),
      seat({ userId: "c", name: "You", role: "cmo", isYou: true, filed: false }),
    ])).toBe("You're the only one who hasn't filed.");
  });

  it("lists the outstanding seats in seat order rather than join order", () => {
    const pending = waitingOn([
      seat({ userId: "a", role: "coo", name: "Sam", filed: false }),
      seat({ userId: "b", role: "ceo", name: "Ada", filed: false }),
      seat({ userId: "c", role: "cmo", name: "Ken", filed: false }),
    ]);
    expect(pending.map((s) => s.role)).toEqual(["ceo", "cmo", "coo"]);
  });

  it("doesn't pretend an empty table is a finished one", () => {
    expect(tableStatus([])).toBe("Nobody at the table yet.");
    expect(tableStatus(undefined)).toBe("Nobody at the table yet.");
  });
});
