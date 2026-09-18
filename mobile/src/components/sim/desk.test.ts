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
  bump, capUse, challengeProgress, challengeStanding, citiesOpening, clampToField,
  commitment, commitmentLevel, covenantProgress, dilutionPreview, discretionarySpend,
  dissolvableSeats, draftMatches, exact, fixedCosts, footprint, formatUntil, inTrouble,
  metricRead, money, openingCost, percent, reachOf, reachRead, resolveIsImminent,
  qualityRead, researchLanding, rewardRead, saturate, secondsUntil, selectedCities,
  shareOwnedRead, shortfall, signed,
  stepFor, tableStatus, targetGoalRead, targetProgress, toggleCity, validateDraft,
  validateRecovery, waitingOn, withYourDraft,
  type Challenge, type DeskCity, type DeskCompany, type DeskTableSeat, type FiledDecisions,
  type LeverField, type Target,
} from "./desk";

// Five filled seats: the engine charges 140,000 for each, so this is the
// constant half of the fixed bill. It comes down in the payload now — see
// company.seats in server/simulation-desk-routes.ts.
const company = {
  cash: 4_000_000, debt: 1_000_000, creditLimit: 3_000_000,
  seats: ["ceo", "cmo", "cfo", "cto", "coo"] as const as any,
};

/** A full table, the numbers chosen so every term of the sum is distinguishable. */
const table: FiledDecisions = {
  cmo: { price: 40, brandSpend: 1_000_000, performanceSpend: 500_000, celebritySpend: 0 },
  cto: { featureSpend: 300_000, reliabilitySpend: 200_000, techDebtPaydown: 0 },
  coo: { capacityTarget: 100_000, supportSpend: 100_000, efficiencySpend: 0, headcount: 20 },
  cfo: { borrow: 500_000, repay: 250_000, cashBuffer: 1_000_000 },
  ceo: { focus: "growth" },
};

const EXECS = 700_000;
const run = (decisions: FiledDecisions = table, costIndex = 1.05) =>
  commitment({ company, decisions, costIndex });

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
    expect(fixedCosts(20, 1.05, 5)).toBe(2_485_000);
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
      company: { ...company, cash: 0, debt: 5_000_000, creditLimit: 1_000_000 },
      decisions: { cto: { featureSpend: 50_000 } },
      costIndex: 1,
    });
    expect(c.available).toBe(0);
    expect(c.ratio).toBe(Infinity);
    expect(commitmentLevel(c.ratio)).toBe("over");
  });

  it("clamps available at zero when the buffer exceeds everything the company has", () => {
    const c = commitment({
      company: { ...company, cash: 500_000, debt: 3_000_000, creditLimit: 3_000_000, seats: [] },
      decisions: { cfo: { borrow: 0, repay: 0, cashBuffer: 9_000_000 } },
      costIndex: 1,
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

describe("the executive half of the fixed bill", () => {
  it("charges a salary for every seat the engine still holds", () => {
    expect(fixedCosts(0, 1.05, 5)).toBe(700_000);
    expect(fixedCosts(0, 1.05, 0)).toBe(0);
  });

  it("comes off the bill when a seat is dissolved, which is the trade the CEO is offered", () => {
    // The reason this counts company.seats and not the table: a dissolved seat
    // leaves the table but stops costing a salary, and only one of those two
    // numbers is the bill.
    const four = commitment({ company: { ...company, seats: ["ceo", "cmo", "cfo", "cto"] as any }, decisions: table, costIndex: 1.05 });
    expect(four.fixed).toBe(2_485_000 - 140_000);
  });

  it("moves with the headcount the player is editing", () => {
    const edited = run({ ...table, coo: { ...table.coo, headcount: 30 } });
    expect(edited.fixed).toBe(EXECS + 30 * 85_000 * 1.05);
  });

  it("treats a payload without a seat list as no executive salaries rather than as a crash", () => {
    // The field arrived after the code that reads it once already. A total
    // that is wrong is recoverable; a screen that threw is not.
    const c = commitment({ company: { ...company, seats: undefined as any }, decisions: {}, costIndex: 1 });
    expect(c.fixed).toBe(0);
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

  it("spells out the units past an hour, mirroring longCountdown()", () => {
    // The bug this replaces: a day-scale deadline rendered as mm:ss came out
    // as "2878:46". Thresholds match longCountdown() in
    // shared/simulation/lobby-copy.ts exactly, so the phone and the web never
    // describe the same deadline differently.
    expect(formatUntil(24 * 3_600)).toBe("1d 0h");
    expect(formatUntil(47 * 3_600 + 60)).toBe("1d 23h");
    expect(formatUntil(63_600)).toBe("17h 40m");
    expect(formatUntil(12_300)).toBe("3h 25m");
    expect(formatUntil(3_600)).toBe("1h 0m");
  });

  it("keeps the seconds inside the last hour, where people are watching them", () => {
    expect(formatUntil(3_599)).toBe("59:59");
    expect(formatUntil(2_520)).toBe("42:00");
    expect(formatUntil(60)).toBe("1:00");
    expect(formatUntil(59)).toBe("59s");
    expect(formatUntil(9)).toBe("9s");
    expect(formatUntil(0)).toBe("0s");
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

  it("compares a list field by content rather than by identity", () => {
    // No lever sends a list today; the comparison stays because a silent
    // false-equal would show "nothing to change" over a real edit.
    expect(draftMatches({ tags: ["a"] }, { tags: ["a"] })).toBe(true);
    expect(draftMatches({ tags: [] }, { tags: ["a"] })).toBe(false);
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

// --- Your own year -------------------------------------------------------

/**
 * A company mid-year, with a distinguishable value in every field the
 * challenge metrics can read.
 */
const standing: DeskCompany = {
  cash: 2_000_000, debt: 500_000, creditLimit: 3_000_000,
  reputation: 54, quality: 61, brand: 38, service: 47,
  capacity: 120_000, unitCost: 23.4, price: 40, customers: 88_000,
  bankruptSince: null, seats: ["ceo", "cmo", "cfo", "cto", "coo"],
};

const target = (over: Partial<Target> = {}): Target => ({
  id: "t", label: "Do the thing", goal: 100_000, compare: "at_least", metric: "customers", ...over,
});

describe("how far along a target is", () => {
  it("reads the metrics the company already carries, as they stand now", () => {
    const p = targetProgress(target({ metric: "brand", goal: 50 }), { company: standing });
    expect(p).toMatchObject({ actual: 38, source: "now", met: false });
    expect(p.fraction).toBeCloseTo(38 / 50, 10);
  });

  it("refuses to invent the numbers only the tick can produce", () => {
    // The four that are outcomes of a year rather than states of a company.
    for (const metric of ["profit", "revenue", "market_share", "turned_away"] as const) {
      const p = targetProgress(target({ metric }), { company: standing });
      expect(p).toMatchObject({ actual: null, source: "unknown", met: null, fraction: null });
    }
  });

  it("answers a spending ceiling from what the table has committed this year", () => {
    // The point of the live number: a CMO about to break their own ceiling
    // finds out while their thumb is still on it.
    const p = targetProgress(
      target({ metric: "spend", goal: 500_000, compare: "at_most" }),
      { company: standing, committedSpend: 620_000 },
    );
    expect(p).toMatchObject({ actual: 620_000, source: "committed", met: false });
  });

  it("says nothing about spend when there is no draft to say it from", () => {
    expect(targetProgress(target({ metric: "spend" }), { company: standing }).source).toBe("unknown");
  });

  it("knows nothing at all without a company", () => {
    expect(targetProgress(target(), { company: null }).actual).toBeNull();
  });

  it("draws an at-most target as room left, not distance travelled", () => {
    // A budget bar fills as you spend it, so inside the cap is a full bar.
    const inside = targetProgress(target({ metric: "unit_cost", goal: 25, compare: "at_most" }), { company: standing });
    expect(inside.met).toBe(true);
    expect(inside.fraction).toBe(1);

    const over = targetProgress(target({ metric: "unit_cost", goal: 20, compare: "at_most" }), { company: standing });
    expect(over.met).toBe(false);
    expect(over.fraction).toBeCloseTo(20 / 23.4, 10);
  });

  it("handles the zero goals the engine actually writes", () => {
    // "Turn nobody away" is goal 0 at_most; "still solvent" is goal 1 at_least.
    const solvent = targetProgress(target({ metric: "cash", goal: 1, compare: "at_least" }), { company: standing });
    expect(solvent.met).toBe(true);

    const broke = targetProgress(
      target({ metric: "cash", goal: 1, compare: "at_least" }),
      { company: { ...standing, cash: 0 } },
    );
    expect(broke.met).toBe(false);
    expect(broke.fraction).toBe(0);
  });
});

describe("where a challenge stands", () => {
  const challenge = (targets: Target[]): Challenge => ({
    id: "c", role: "cmo", year: 3, title: "Take the amateurs", brief: "…",
    targets,
    reward: { kind: "reputation", amount: 5, label: "Reputation." },
    partialReward: { kind: "reputation", amount: 2, label: "Some of it." },
  });

  it("counts what is met, missed and not yet knowable, separately", () => {
    const progress = challengeProgress(
      challenge([
        target({ id: "a", metric: "brand", goal: 20 }),
        target({ id: "b", metric: "profit", goal: 1 }),
      ]),
      { company: standing },
    );
    expect(challengeStanding(progress)).toMatchObject({ met: 1, missing: 0, pending: 1, of: 2 });
  });

  it("does not describe a year that hasn't run as a half-failure", () => {
    const progress = challengeProgress(
      challenge([target({ id: "a", metric: "profit" }), target({ id: "b", metric: "revenue" })]),
      { company: standing },
    );
    expect(challengeStanding(progress).line).toBe("Both settle when the year runs.");
  });

  it("says so plainly when both are on", () => {
    const progress = challengeProgress(
      challenge([target({ id: "a", metric: "brand", goal: 10 }), target({ id: "b", metric: "quality", goal: 10 })]),
      { company: standing },
    );
    expect(challengeStanding(progress).line).toBe("On both, as things stand.");
  });
});

describe("reading a metric in its own units", () => {
  it("keeps the pennies on the two metrics that have them", () => {
    // The engine sets unit-cost goals to two decimals; rounding to 23 would
    // mark a missed target as met.
    expect(metricRead("unit_cost", 23.4)).toBe("23.4");
    expect(metricRead("unit_cost", 23.15)).toBe("23.15");
    expect(metricRead("price", 40)).toBe("40");
  });

  it("rounds the 0-100 scores and abbreviates the money", () => {
    expect(metricRead("reputation", 54.6)).toBe("55");
    expect(metricRead("customers", 88_000)).toBe("88k");
    expect(metricRead("market_share", 12.42)).toBe("12.4%");
  });

  it("says the goal the way a person would read it aloud", () => {
    expect(targetGoalRead(target({ metric: "customers", goal: 45_000 }))).toBe("at least 45k");
    expect(targetGoalRead(target({ metric: "price", goal: 24, compare: "at_most" }))).toBe("at most 24");
  });
});

describe("what a challenge is worth", () => {
  it("says a capacity reward as the percentage the engine applies", () => {
    // applyReward multiplies capacity by 1 + amount, so 0.08 is eight per cent
    // and showing "+0.08 capacity" would be meaningless.
    expect(rewardRead({ kind: "capacity", amount: 0.08, label: "" })).toBe("+8% capacity");
    expect(rewardRead({ kind: "reputation", amount: 5, label: "" })).toBe("+5 reputation");
    expect(rewardRead({ kind: "credit", amount: 750_000, label: "" })).toBe("+750k credit");
    expect(rewardRead({ kind: "cash", amount: 150_000, label: "" })).toBe("+150k cash");
  });
});

describe("the spend a cap and a challenge both mean", () => {
  it("counts the three seats that buy things and not the repayment", () => {
    // Mirrors both readMetric("spend") and the sum the tick reviews a covenant
    // against: 1.5m marketing + 0.5m product + 0.1m support, no CFO repayment.
    expect(discretionarySpend(table)).toBe(2_100_000);
    expect(run().spend - discretionarySpend(table)).toBe(250_000);
  });

  it("leaves out the two things the meter counts and the rules don't", () => {
    /*
     * Research buys nothing this year and a city's entry fee comes out of
     * cash, so neither is inside a creditor's cap or a "without spending your
     * way there" target — however plainly both are money the table committed.
     * Taking this sum off the meter instead would tell a CTO they had broken a
     * ceiling they were nowhere near.
     */
    const withExtras: FiledDecisions = {
      cmo: { price: 40, brandSpend: 1_000_000, performanceSpend: 0, celebritySpend: 0, targetCities: ["manchester"] },
      cto: { featureSpend: 300_000, reliabilitySpend: 0, techDebtPaydown: 0, researchSpend: 900_000 },
    };
    expect(discretionarySpend(withExtras)).toBe(1_300_000);
    const meter = commitment({ company, decisions: withExtras, costIndex: 1, cities: cities() });
    expect(meter.spend).toBe(2_650_000);
  });
});

// --- Trouble -------------------------------------------------------------

describe("the moves a company in trouble can make", () => {
  const options = [
    { kind: "restructure" as const, title: "", body: "", cost: "", raises: 40_000, from: ["strained" as const] },
    { kind: "dissolve_seat" as const, title: "", body: "", cost: "", raises: 140_000, from: ["distressed" as const] },
  ];
  const seats = ["ceo", "cmo", "cfo", "cto", "coo"] as const;

  it("is the chief executive's call, and says so before anything else", () => {
    const check = validateRecovery({ kind: "restructure", seat: null, options, seats: [...seats], role: "cfo" });
    expect(check.ok).toBe(false);
    expect(check.error).toMatch(/chief executive/);
  });

  it("holds its tongue when the chair hasn't chosen anything yet", () => {
    expect(validateRecovery({ kind: null, seat: null, options, seats: [...seats], role: "ceo" }))
      .toEqual({ ok: false, error: null });
  });

  it("refuses a move this position doesn't offer", () => {
    const check = validateRecovery({ kind: "rescue_raise", seat: null, options, seats: [...seats], role: "ceo" });
    expect(check).toMatchObject({ ok: false });
    expect(check.error).toMatch(/isn't available/);
  });

  it("wants a seat before dissolving one, and never the chair", () => {
    expect(validateRecovery({ kind: "dissolve_seat", seat: null, options, seats: [...seats], role: "ceo" }).ok).toBe(false);
    // The server answers this one with a 400; offering it at all would be the
    // screen teaching people to distrust its own controls.
    expect(validateRecovery({ kind: "dissolve_seat", seat: "ceo", options, seats: [...seats], role: "ceo" }).error)
      .toMatch(/your own chair/);
    expect(validateRecovery({ kind: "dissolve_seat", seat: "cmo", options, seats: [...seats], role: "ceo" }).ok).toBe(true);
  });

  it("won't dissolve a seat that has already gone", () => {
    expect(validateRecovery({ kind: "dissolve_seat", seat: "cto", options, seats: ["ceo", "cmo"], role: "ceo" }).ok).toBe(false);
  });

  it("offers every filled seat except the chair, in the order seats are always listed", () => {
    expect(dissolvableSeats(["coo", "cmo", "ceo", "cfo"])).toEqual(["cmo", "cfo", "coo"]);
    expect(dissolvableSeats(["ceo"])).toEqual([]);
    expect(dissolvableSeats(undefined)).toEqual([]);
  });

  it("treats every state but healthy as worth saying out loud", () => {
    expect(inTrouble("healthy")).toBe(false);
    expect(inTrouble("strained")).toBe(true);
    expect(inTrouble(undefined)).toBe(false);
  });
});

describe("the covenant, which is the way out", () => {
  const covenant = { since: 4, spendCap: 800_000, met: 1, rateRelief: 0.03 };

  it("counts the years met against the two that lift it", () => {
    expect(covenantProgress(covenant)).toMatchObject({ met: 1, of: 2, remaining: 1, fraction: 0.5 });
    expect(covenantProgress(covenant).line).toMatch(/One more year/);
  });

  it("says how many clear years it takes when none have been met", () => {
    expect(covenantProgress({ ...covenant, met: 0 }).line).toMatch(/2 clear years/);
  });

  it("never reads as more than met, however the server counts it", () => {
    expect(covenantProgress({ ...covenant, met: 9 })).toMatchObject({ met: 2, remaining: 0 });
    expect(covenantProgress({ ...covenant, met: -1 }).met).toBe(0);
  });

  it("measures this year's spending against the cap, and knows when it's over", () => {
    expect(capUse(600_000, covenant)).toMatchObject({ over: false, left: 200_000 });
    expect(capUse(900_000, covenant)).toMatchObject({ over: true, left: -100_000 });
    expect(capUse(500_000, null)).toBeNull();
  });
});


// --- Where you sell ------------------------------------------------------
/**
 * The city picker's arithmetic.
 *
 * Two failures worth a test each. The first is a tap that appears to close a
 * city: there is no closing lever, the engine unions what you send with where
 * you already are, and a control that let somebody think otherwise would be
 * lying about a one-way door. The second is the entry fee, which is charged
 * once, comes out of cash, and — because the engine takes it outside
 * discretionary spend — never appears in the commitment meter. A cost that is
 * real and invisible is the exact gotcha this whole screen exists to prevent.
 */
const cities = (): DeskCity[] => [
  { id: "london", name: "London", weight: 0.3, entryCost: 900_000, note: "A third of the market.", open: true },
  { id: "manchester", name: "Manchester", weight: 0.16, entryCost: 450_000, note: "Cheap enough to start.", open: false },
  { id: "leeds", name: "Leeds", weight: 0.12, entryCost: 350_000, note: "The quietest door.", open: false },
  { id: "bristol", name: "Bristol", weight: 0.14, entryCost: 400_000, note: "First to try something new.", open: false },
];

describe("choosing where the company sells", () => {
  it("keeps every open city in the selection whatever the draft says", () => {
    expect(selectedCities(cities(), [])).toEqual(["london"]);
    expect(selectedCities(cities(), ["leeds"])).toEqual(["london", "leeds"]);
  });

  it("refuses to close a city that is already open", () => {
    // There is no closing lever. A tap here is a no-op rather than a removal
    // the server would silently put back.
    expect(toggleCity(cities(), ["london"], "london")).toEqual(["london"]);
  });

  it("ticks and unticks a city that isn't open yet", () => {
    const once = toggleCity(cities(), [], "manchester");
    expect(once).toEqual(["london", "manchester"]);
    expect(toggleCity(cities(), once, "manchester")).toEqual(["london"]);
  });

  it("returns the payload's order, so two equal selections are one array", () => {
    expect(toggleCity(cities(), ["bristol"], "manchester")).toEqual(["london", "manchester", "bristol"]);
  });

  it("ignores a city this market has never heard of", () => {
    expect(toggleCity(cities(), [], "atlantis")).toEqual(["london"]);
  });

  it("counts only the places being opened, and totals what they cost", () => {
    const chosen = ["london", "manchester", "leeds"];
    expect(citiesOpening(cities(), chosen).map((c) => c.id)).toEqual(["manchester", "leeds"]);
    expect(openingCost(cities(), chosen)).toBe(800_000);
  });

  it("charges nothing for standing still, open cities included", () => {
    expect(openingCost(cities(), ["london"])).toBe(0);
    expect(openingCost(cities(), [])).toBe(0);
  });
});

describe("how much of the market can even consider you", () => {
  it("reads the open cities when no selection is given", () => {
    expect(reachOf(cities())).toBeCloseTo(0.3, 5);
  });

  it("adds the weights of a draft's selection", () => {
    expect(reachOf(cities(), ["london", "manchester"])).toBeCloseTo(0.46, 5);
  });

  it("treats a market with no map as the whole market, as the engine does", () => {
    // A company from before cities existed sells everywhere. The alternative
    // to this default is somebody's season collapsing to zero reach because a
    // feature shipped underneath it.
    expect(reachOf([])).toBe(1);
    expect(reachOf(undefined)).toBe(1);
  });

  it("says what reach means rather than printing a score", () => {
    expect(reachRead(1)).toContain("Everyone");
    expect(reachRead(0.3)).toContain("30%");
    expect(reachRead(0.3)).toContain("however good you are");
    expect(reachRead(0.004)).toContain("<1%");
  });

  it("charges the fixed bill against the footprint, not the whole country", () => {
    // 0.4 owed wherever you sell, 0.6 scaled by reach. Mirrors fixedCosts()
    // in shared/simulation/decisions.ts.
    expect(footprint(1)).toBe(1);
    expect(footprint(0)).toBeCloseTo(0.4, 5);
    expect(footprint(0.5)).toBeCloseTo(0.7, 5);
    expect(fixedCosts(0, 1, 5, 0.5)).toBe(700_000 * 0.7);
  });

  it("leaves the bill alone for a company that sells everywhere", () => {
    expect(fixedCosts(20, 1.05, 5, 1)).toBe(fixedCosts(20, 1.05, 5));
  });

  it("shrinks the table's fixed cost when the company is only in one city", () => {
    const national = commitment({ company, decisions: { coo: { headcount: 10 } }, costIndex: 1 });
    const regional = commitment({ company, decisions: { coo: { headcount: 10 } }, costIndex: 1, reach: 0.3 });
    expect(regional.fixed).toBeCloseTo(national.fixed * (0.4 + 0.6 * 0.3), 5);
  });
});

describe("research, which is spent this year and lands in the next", () => {
  it("counts against the table like any other committed money", () => {
    const c = commitment({
      company,
      decisions: { cto: { featureSpend: 0, reliabilitySpend: 0, techDebtPaydown: 0, researchSpend: 600_000 } },
      costIndex: 1,
    });
    expect(c.bySeat.find((s) => s.role === "cto")!.spend).toBe(600_000);
  });
});

describe("what a raise costs in ownership", () => {
  it("prices the dilution against what the company is worth now", () => {
    // 2m raised against a 2m company is half of it, which is the entire point
    // of the lever. Mirrors the sum in shared/simulation/resolve.ts.
    const preview = dilutionPreview({ founderShare: 1, worth: 2_000_000, raise: 2_000_000 })!;
    expect(preview.nextShare).toBeCloseTo(0.5, 5);
    expect(preview.given).toBeCloseTo(0.5, 5);
  });

  it("costs far less against a company that is already worth something", () => {
    const early = dilutionPreview({ founderShare: 1, worth: 1_000_000, raise: 1_000_000 })!;
    const later = dilutionPreview({ founderShare: 1, worth: 20_000_000, raise: 1_000_000 })!;
    expect(later.given).toBeLessThan(early.given);
    expect(later.nextShare).toBeGreaterThan(0.95);
  });

  it("dilutes what is left rather than the whole company", () => {
    const preview = dilutionPreview({ founderShare: 0.5, worth: 4_000_000, raise: 4_000_000 })!;
    expect(preview.nextShare).toBeCloseTo(0.25, 5);
  });

  it("keeps the engine's floor under a worthless company's valuation", () => {
    // Without the floor, raising against a company worth nothing takes
    // everything — and the engine holds the founders at 5% regardless.
    const preview = dilutionPreview({ founderShare: 1, worth: 0, raise: 500_000 })!;
    expect(preview.nextShare).toBeCloseTo(0.5, 5);
    expect(dilutionPreview({ founderShare: 1, worth: 0, raise: 100_000_000 })!.nextShare).toBe(0.05);
  });

  it("says nothing at all when there is no raise or no valuation to price it against", () => {
    expect(dilutionPreview({ founderShare: 1, worth: 5_000_000, raise: 0 })).toBeNull();
    expect(dilutionPreview({ founderShare: 1, worth: null, raise: 1_000_000 })).toBeNull();
  });
});

describe("ownership, at the precision people argue at", () => {
  it("rounds to a whole percent, because no decision turns on a tenth", () => {
    expect(shareOwnedRead(0.617)).toBe("62%");
    expect(shareOwnedRead(1)).toBe("100%");
  });

  it("keeps a decimal where the difference is a footnote versus a founder", () => {
    expect(shareOwnedRead(0.004)).toBe("0.4%");
  });

  it("has an answer for a company that has never sent the field", () => {
    expect(shareOwnedRead(undefined)).toBe("—");
    expect(shareOwnedRead(Number.NaN)).toBe("—");
  });
});

describe("validating the four new levers", () => {
  const cityField: LeverField = { id: "targetCities", label: "Where you sell", help: "", kind: "cities" };
  const segmentField: LeverField = {
    id: "positioning", label: "Who it's for", help: "", kind: "segment",
    options: [{ value: "", label: "Everybody", help: "" }, { value: "pros", label: "Pros", help: "" }],
  };
  const rehire: LeverField = { id: "rehire", label: "Bring a seat back", help: "", kind: "choice", options: [] };

  it("accepts a list of places, and an empty one", () => {
    expect(validateDraft([cityField], { targetCities: [] }, { debt: 0 }, "cmo").ok).toBe(true);
    expect(validateDraft([cityField], { targetCities: ["leeds"] }, { debt: 0 }, "cmo").ok).toBe(true);
  });

  it("refuses a selection that isn't a list at all", () => {
    expect(validateDraft([cityField], { targetCities: "leeds" }, { debt: 0 }, "cmo").ok).toBe(false);
  });

  it("lets a company be for everybody, which is what the empty segment means", () => {
    expect(validateDraft([segmentField], { positioning: "" }, { debt: 0 }, "ceo").ok).toBe(true);
    expect(validateDraft([segmentField], {}, { debt: 0 }, "ceo").ok).toBe(true);
    expect(validateDraft([segmentField], { positioning: "pros" }, { debt: 0 }, "ceo").ok).toBe(true);
  });

  it("never blocks filing on a choice the season has no options for", () => {
    // Every table with five filled seats has an empty rehire list. An error
    // here would disable the file button for almost everybody, over a question
    // the form never actually asked.
    expect(validateDraft([rehire], {}, { debt: 0 }, "ceo").ok).toBe(true);
    expect(validateDraft([rehire], { rehire: "" }, { debt: 0 }, "ceo").ok).toBe(true);
  });

  it("still insists on one of the offered seats when there are some", () => {
    const filled: LeverField = { ...rehire, options: [{ value: "cto", label: "CTO", help: "" }] };
    expect(validateDraft([filled], { rehire: "cto" }, { debt: 0 }, "ceo").ok).toBe(true);
    expect(validateDraft([filled], { rehire: "" }, { debt: 0 }, "ceo").ok).toBe(true);
    expect(validateDraft([filled], { rehire: "ceo" }, { debt: 0 }, "ceo").ok).toBe(false);
  });
});


describe("opening a city, on the table's bill", () => {
  const open3 = (targetCities: string[]) => commitment({
    company,
    decisions: { cmo: { price: 40, brandSpend: 200_000, performanceSpend: 0, celebritySpend: 0, targetCities } },
    costIndex: 1,
    cities: cities(),
  });

  it("puts the entry fee on the seat that decided to spend it", () => {
    // Mirrors the openingCost term in commitment() in
    // shared/simulation/levers.ts: the marketing line carries it, because
    // marketing is who opened the city.
    const c = open3(["london", "manchester", "leeds"]);
    expect(c.openingCost).toBe(800_000);
    expect(c.bySeat.find((s) => s.role === "cmo")!.spend).toBe(1_000_000);
    expect(c.spend).toBe(1_000_000);
  });

  it("charges nothing for the cities the company is already in", () => {
    const c = open3(["london"]);
    expect(c.openingCost).toBe(0);
    expect(c.bySeat.find((s) => s.role === "cmo")!.spend).toBe(200_000);
  });

  it("leaves the total alone when the market's map hasn't arrived", () => {
    // An older payload, or a response that lost a field: the meter falls back
    // to what it can prove rather than inventing a fee.
    const c = commitment({
      company,
      decisions: { cmo: { price: 40, brandSpend: 200_000, performanceSpend: 0, celebritySpend: 0, targetCities: ["leeds"] } },
      costIndex: 1,
    });
    expect(c.openingCost).toBe(0);
    expect(c.spend).toBe(200_000);
  });

  it("stays out of the sum a covenant's cap is reviewed against", () => {
    // On the meter, because it is the table's money leaving; outside the cap,
    // because the engine charges it against cash rather than counting it as
    // discretionary spending. Both of those are true at once and the screen
    // has to say both.
    const opening = open3(["london", "bristol"]);
    expect(opening.spend).toBe(600_000);
    expect(discretionarySpend({
      cmo: { price: 40, brandSpend: 200_000, performanceSpend: 0, celebritySpend: 0, targetCities: ["london", "bristol"] },
    })).toBe(200_000);
  });
});

describe("what a year of research lands", () => {
  it("mirrors the engine's saturation rather than approximating it", () => {
    // saturate(spend, 150_000) × 24 × pace. Half the ceiling at the half-way
    // spend, and never quite the ceiling however much is spent.
    expect(saturate(150_000, 150_000)).toBe(0.5);
    expect(researchLanding(150_000, 1)).toBeCloseTo(12, 6);
    expect(researchLanding(450_000, 1)).toBeCloseTo(18, 6);
  });

  it("scales with how fast the market moves", () => {
    expect(researchLanding(150_000, 1.5)).toBeCloseTo(18, 6);
    expect(researchLanding(150_000, 0.5)).toBeCloseTo(6, 6);
  });

  it("lands nothing for nothing, and never a negative", () => {
    expect(researchLanding(0, 1.2)).toBe(0);
    expect(researchLanding(-500_000, 1.2)).toBe(0);
    expect(researchLanding("", 1.2)).toBe(0);
  });

  it("assumes an ordinary pace when the market hasn't said", () => {
    expect(researchLanding(150_000, undefined)).toBeCloseTo(12, 6);
  });

  it("reads quality points the way the report does", () => {
    expect(qualityRead(12)).toBe("12");
    expect(qualityRead(7.44)).toBe("7.4");
    expect(qualityRead(Number.NaN)).toBe("—");
  });
});
