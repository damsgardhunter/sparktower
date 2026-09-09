/**
 * The check-in's week boundary and its validation.
 *
 * `weekStartOf` is the riskier of the two despite being six lines. It decides
 * which week a check-in belongs to, and the one-per-week unique constraint is
 * built on its answer — so an off-by-one on Sundays doesn't throw, it merges
 * two weeks into one and rejects the second check-in as a duplicate.
 */
import { describe, it, expect } from "vitest";
import { weekStartOf, weekKey, validateCheckIn, CHECK_IN_LIMITS } from "@shared/check-in";

/** Every case is stated as a UTC instant, because the function works in UTC. */
const at = (iso: string) => new Date(iso);

describe("weekStartOf", () => {
  it("returns the Monday of that week, at UTC midnight", () => {
    const monday = weekStartOf(at("2026-09-09T13:45:00Z")); // a Wednesday
    expect(monday.toISOString()).toBe("2026-09-07T00:00:00.000Z");
  });

  it("leaves a Monday where it is", () => {
    expect(weekStartOf(at("2026-09-07T00:00:00Z")).toISOString()).toBe("2026-09-07T00:00:00.000Z");
    // Including late on that Monday.
    expect(weekStartOf(at("2026-09-07T23:59:59Z")).toISOString()).toBe("2026-09-07T00:00:00.000Z");
  });

  it("puts Sunday in the week that is ending, not the one starting", () => {
    /*
     * The classic failure. JavaScript's getUTCDay makes Sunday 0, so the naive
     * shift sends Sunday forward to the next Monday and splits a week in two —
     * or, depending on the sign, collapses two weeks into one and makes the
     * one-per-week constraint reject a legitimate check-in.
     */
    expect(weekStartOf(at("2026-09-13T12:00:00Z")).toISOString()).toBe("2026-09-07T00:00:00.000Z");
  });

  it("handles the turn of a year", () => {
    // Fri 1 Jan 2027 belongs to the week beginning Mon 28 Dec 2026.
    expect(weekStartOf(at("2027-01-01T09:00:00Z")).toISOString()).toBe("2026-12-28T00:00:00.000Z");
  });

  it("gives every day of one week the same key", () => {
    const days = ["07", "08", "09", "10", "11", "12", "13"]
      .map((d) => weekKey(weekStartOf(at(`2026-09-${d}T06:00:00Z`))));
    expect(new Set(days).size).toBe(1);
    expect(days[0]).toBe("2026-09-07");
  });

  it("accepts a string as readily as a Date", () => {
    expect(weekStartOf("2026-09-09T13:45:00Z").toISOString())
      .toBe(weekStartOf(at("2026-09-09T13:45:00Z")).toISOString());
  });
});

const validDraft = {
  goal: "Get the meal planner generating a full week",
  proof: "Shipped the generator and wired it to the inventory screen",
  blocker: null,
  nextStep: "Add a shopping list export",
};

describe("validateCheckIn", () => {
  it("passes a complete draft", () => {
    expect(validateCheckIn(validDraft)).toEqual({});
  });

  it("wants a goal that is one sentence, not none and not five", () => {
    expect(validateCheckIn({ ...validDraft, goal: "hi" }).goal).toBeTruthy();
    expect(
      validateCheckIn({ ...validDraft, goal: "Did a thing. Then another. And a third." }).goal,
    ).toBeTruthy();
    // A trailing full stop is one sentence, not two.
    expect(validateCheckIn({ ...validDraft, goal: "Ship the meal planner." }).goal).toBeUndefined();
  });

  it("requires proof to name something rather than describe a mood", () => {
    // The whole point of the field: "worked hard" is not evidence.
    expect(
      validateCheckIn({ ...validDraft, proof: "worked really hard on it this week" }).proof,
    ).toBeTruthy();
    // A link counts…
    expect(
      validateCheckIn({ ...validDraft, proof: "It is live at https://example.com/app now" }).proof,
    ).toBeUndefined();
    // …and so does a word that names a completed act.
    expect(
      validateCheckIn({ ...validDraft, proof: "Merged the planner branch after review" }).proof,
    ).toBeUndefined();
  });

  it("treats the blocker as optional but bounded", () => {
    expect(validateCheckIn({ ...validDraft, blocker: null }).blocker).toBeUndefined();
    expect(validateCheckIn({ ...validDraft, blocker: "" }).blocker).toBeUndefined();
    expect(
      validateCheckIn({ ...validDraft, blocker: "x".repeat(CHECK_IN_LIMITS.blocker.max + 1) }).blocker,
    ).toBeTruthy();
  });

  it("counts trimmed length, so whitespace can't satisfy a minimum", () => {
    expect(validateCheckIn({ ...validDraft, nextStep: "          " }).nextStep).toBeTruthy();
  });

  it("reports every bad field at once, not just the first", () => {
    // A form that reveals one problem per submission is a form people abandon.
    const errors = validateCheckIn({ goal: "", proof: "", blocker: null, nextStep: "" });
    expect(Object.keys(errors).sort()).toEqual(["goal", "nextStep", "proof"]);
  });
});
