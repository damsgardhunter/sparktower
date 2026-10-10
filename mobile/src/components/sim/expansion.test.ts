/**
 * What the phone says about a region on the table.
 *
 * The phone could already cast this vote and could not see it: `expandVote` is a
 * `levels` lever and `LevelsField` draws it with the region and price in the
 * option's own help, but who had voted, which way, and whether it carried were
 * web-only. The data was in the desk payload the whole time.
 *
 * The trap these pin is `proposed`. A region is *announced* to everybody every
 * year; nothing is being decided until the operations seat puts it up. Reading an
 * unproposed region as "nobody voted for it" would tell four people their
 * colleagues had refused something none of them had been asked.
 */
import { describe, it, expect } from "vitest";
import {
  canNudge, expansionOutcome, notStartedReason, voteLabel, voteOf,
  type DeskExpansion, type DeskTableSeat,
} from "./desk";

const announced = (over: Partial<DeskExpansion> = {}): DeskExpansion => ({
  region: { id: "leeds", name: "Leeds", note: "A city that buys on price." },
  cost: 140_000,
  proposed: false,
  votes: {},
  carried: false,
  yes: 0,
  no: 0,
  ...over,
});

describe("where a region stands", () => {
  it("says a region nobody has put up is not up, rather than refused", () => {
    expect(expansionOutcome(announced())).toBe("Not put up");
  });

  it("distinguishes carried from put up and lost", () => {
    expect(expansionOutcome(announced({ proposed: true, carried: true }))).toBe("Carried");
    expect(expansionOutcome(announced({ proposed: true, carried: false }))).toBe("Not carried");
  });
});

describe("what one seat has said about it", () => {
  it("reads a vote once the region is actually up", () => {
    const up = announced({ proposed: true, votes: { coo: "yes", cfo: "no" }, yes: 1, no: 1 });
    expect(voteOf(up, "coo")).toBe("yes");
    expect(voteOf(up, "cfo")).toBe("no");
    expect(voteOf(up, "cmo"), "a seat that has not voted has no view").toBeNull();
  });

  it("shows no votes at all before the region is up, whatever was filed", () => {
    /*
     * The important one. A seat may have filed a vote in an earlier year, or the
     * server may carry one forward; until operations puts the region up it counts
     * for nothing, and showing it would be reporting a decision that has not been
     * taken.
     */
    const notUp = announced({ votes: { coo: "yes", cmo: "yes" }, yes: 2 });
    for (const role of ["coo", "cmo", "cfo", "cto", "ceo"]) {
      expect(voteOf(notUp, role), `${role} cannot have voted on a region nobody put up`).toBeNull();
    }
  });

  it("has no view for a seat that is not sitting anywhere", () => {
    expect(voteOf(announced({ proposed: true }), null)).toBeNull();
  });

  it("words a missing vote as not voted when there is something to vote on, and as nothing when there is not", () => {
    // "Against" is a thing somebody chose; "Not voted" and "—" are not the same thing either.
    expect(voteLabel(null, true)).toBe("Not voted");
    expect(voteLabel(null, false)).toBe("—");
    expect(voteLabel("yes", true)).toBe("For");
    expect(voteLabel("no", true)).toBe("Against");
  });
});

/**
 * Why year one has not started, which the phone used to get wrong.
 *
 * It said "The table is still filling" whatever was true. A season starts only
 * once *every* room in it has left the lobby, so the common case is a table that
 * has done everything asked of it waiting on other people's — and at two hundred
 * players that wait was measured at around six minutes. Six minutes of being told
 * you are the hold-up when you are not.
 */
describe("why year one has not started", () => {
  it("tells a solo founder nobody is coming, because nobody is", () => {
    const line = notStartedReason({ solo: true, roomsStillChoosing: 3 });
    expect(line).toContain("few seconds");
    expect(line, "a solo table has no other rooms to blame").not.toMatch(/room/i);
  });

  it("says it is a matter of the next tick when every room is in", () => {
    expect(notStartedReason({ roomsStillChoosing: 0 })).toContain("within the minute");
  });

  it("says how many rooms are still choosing, so the wait has a shape", () => {
    expect(notStartedReason({ roomsStillChoosing: 1 })).toContain("one room");
    expect(notStartedReason({ roomsStillChoosing: 1 })).toContain("has finished");
    expect(notStartedReason({ roomsStillChoosing: 4 })).toContain("4 rooms");
    expect(notStartedReason({ roomsStillChoosing: 4 })).toContain("have finished");
  });

  it("does not blame a table that is already ready", () => {
    /*
     * The one that matters. "Still filling" to five people who have claimed every
     * seat and named the company is the wrong reason, and it is the usual case.
     */
    const ready = notStartedReason({ roomsStillChoosing: 2, yourRoomReady: true });
    expect(ready).toContain("Your table is ready");
    const notReady = notStartedReason({ roomsStillChoosing: 2, yourRoomReady: false });
    expect(notReady).not.toContain("Your table is ready");
    expect(notReady, "and still says what it is waiting on").toContain("2 rooms");
  });

  it("says something sensible with nothing to go on", () => {
    // A payload missing the fields must not produce "undefined rooms".
    const line = notStartedReason({});
    expect(line).not.toMatch(/undefined|NaN/);
    expect(line.length).toBeGreaterThan(20);
  });
});

/**
 * Who the table can be reminded is holding it up.
 *
 * Nudging was web-only, which was the wrong way round: a phone player could
 * already *receive* one — `sim_nudge` has had an icon in the notifications tab
 * all along — and had no way to send one, on the client somebody actually has in
 * their pocket when a year is closing.
 *
 * The server refuses four cases with four different messages, so the button has
 * to agree with it: offering a nudge and then explaining why it could not be sent
 * is worse than not offering it.
 */
describe("who can be nudged", () => {
  const seat = (over: Partial<DeskTableSeat> = {}): DeskTableSeat => ({
    userId: "u1", name: "Dana", role: "cfo", title: "Chief Financial Officer",
    filed: false, isYou: false, ...over,
  });

  it("offers a reminder to somebody the table is waiting on", () => {
    expect(canNudge(seat())).toBe(true);
  });

  it("does not offer to remind you about yourself", () => {
    // The server's words for this are "You know already."
    expect(canNudge(seat({ isYou: true }))).toBe(false);
  });

  it("does not offer to remind somebody who has filed", () => {
    expect(canNudge(seat({ filed: true }))).toBe(false);
  });

  it("does not offer to remind a stand-in", () => {
    /*
     * A bot files every year without being asked, and the server says so rather
     * than silently succeeding — so the button must not appear at all.
     */
    expect(canNudge(seat({ isBot: true }))).toBe(false);
  });

  it("does not offer to remind an empty chair", () => {
    expect(canNudge(seat({ role: null }))).toBe(false);
  });

  it("needs every condition at once, not any of them", () => {
    // A filed bot that is also you is still not nudgeable, and nor is any pair.
    expect(canNudge(seat({ filed: true, isBot: true }))).toBe(false);
    expect(canNudge(seat({ isYou: true, filed: false }))).toBe(false);
  });
});
