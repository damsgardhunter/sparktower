/**
 * The notes that outrank everything, and the bug that made them forget.
 *
 * `projects.novaNotes` is the one thing that overrides the brief, the board
 * and the code. The chat action that writes it replaced the whole field, so
 * the second thing a builder said erased the first — somebody correcting Nova
 * repeatedly made it know less each time.
 */
import { describe, it, expect } from "vitest";
import {
  addStandingNote, readStandingNotes, writeStandingNotes, STANDING_NOTES_MAX,
} from "../../shared/standing-notes";

const DAY = "2026-09-30";

describe("addStandingNote", () => {
  it("keeps what was already there", () => {
    const first = addStandingNote("", "The onboarding quiz is being removed.", { on: "2026-09-01" });
    const second = addStandingNote(first, "Pricing is pay-per-use, not subscriptions.", { on: DAY });
    expect(second).toContain("onboarding quiz");
    expect(second).toContain("pay-per-use");
  });

  it("dates each one, so Nova can tell which is most recent", () => {
    const notes = readStandingNotes(
      addStandingNote(addStandingNote("", "older", { on: "2026-09-01" }), "newer", { on: DAY }),
    );
    expect(notes.map((n) => n.on)).toEqual(["2026-09-01", DAY]);
    expect(notes[notes.length - 1].text).toBe("newer");
  });

  it("does not record the same thing twice", () => {
    const once = addStandingNote("", "Pricing is pay-per-use.", { on: DAY });
    const twice = addStandingNote(once, "pricing is PAY-PER-USE.", { on: DAY });
    expect(readStandingNotes(twice)).toHaveLength(1);
  });

  /*
   * Revising rather than piling on. A builder who has changed their mind
   * should not leave two notes contradicting each other, with Nova obeying
   * whichever it reads first.
   */
  it("drops the note it is replacing", () => {
    const before = addStandingNote("", "Pricing is a $20 monthly subscription.", { on: "2026-09-01" });
    const after = addStandingNote(before, "Pricing is pay-per-use, charged per outcome.", {
      on: DAY, replaces: "Pricing is a $20 monthly subscription",
    });
    expect(after).not.toContain("subscription");
    expect(after).toContain("pay-per-use");
  });

  it("keeps notes written before any of this existed", () => {
    const legacy = "The wedge is the three paths.";
    const after = addStandingNote(legacy, "Pricing is per-use.", { on: DAY });
    expect(after).toContain("three paths");
    expect(readStandingNotes(after)).toHaveLength(2);
  });

  it("ignores an empty note rather than storing a blank line", () => {
    expect(addStandingNote("something", "   ")).toBe("something");
  });

  /* Something has to give at the cap, and the oldest is likeliest overtaken. */
  it("drops the oldest when it runs out of room, never a half sentence", () => {
    let notes = "";
    for (let i = 0; i < 60; i++) {
      notes = addStandingNote(notes, `Direction number ${i} stated at some length to fill the field.`, {
        on: "2026-09-01",
      });
    }
    expect(notes.length).toBeLessThanOrEqual(STANDING_NOTES_MAX);
    expect(notes, "the newest must survive").toContain("Direction number 59");
    expect(notes, "no truncated sentence").toMatch(/\.$/);
  });

  it("round-trips through read and write", () => {
    const text = addStandingNote(addStandingNote("", "one", { on: "2026-09-01" }), "two", { on: DAY });
    expect(writeStandingNotes(readStandingNotes(text))).toBe(text);
  });
});
