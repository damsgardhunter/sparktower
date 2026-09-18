/**
 * The lobby's arithmetic and its wording, driven through the cases that would
 * show four people something different from each other.
 *
 * The clock is the one worth the most care: the room is live, everyone is
 * watching the same number, and a countdown that drifts or ticks backwards is
 * how a phase ends "early" on one phone and not on another.
 */
import { describe, it, expect } from "vitest";
import {
  clockIsUrgent, formatCount, formatCountdown, incumbentHold, loyaltyRead,
  phaseCopy, remainingSeconds, seatStatus, type SimSeat,
} from "./lobby";

const seat = (over: Partial<SimSeat> = {}): SimSeat => ({
  userId: "u1", name: "Dana", avatarUrl: null, role: null, assigned: false, isYou: false, ...over,
});

describe("the countdown between polls", () => {
  it("ticks down locally from the server's reading", () => {
    const anchor = { secondsLeft: 120, atMs: 1_000_000 };
    expect(remainingSeconds(anchor, 1_000_000)).toBe(120);
    expect(remainingSeconds(anchor, 1_003_000)).toBe(117);
  });

  it("re-anchors rather than accumulating drift", () => {
    // A poll two and a half seconds later says 100, not 117.5: the server's
    // answer replaces the local one outright, which is the whole point.
    const fresh = { secondsLeft: 100, atMs: 1_002_500 };
    expect(remainingSeconds(fresh, 1_002_500)).toBe(100);
  });

  it("never runs backwards, even if the device clock steps back", () => {
    const anchor = { secondsLeft: 60, atMs: 1_000_000 };
    expect(remainingSeconds(anchor, 990_000)).toBe(60);
  });

  it("stops at zero instead of going negative while a poll is in flight", () => {
    expect(remainingSeconds({ secondsLeft: 2, atMs: 0 }, 60_000)).toBe(0);
  });

  it("passes an unbounded phase through untouched", () => {
    // `secondsLeft` is Infinity for a phase with no deadline; formatting owns
    // that case rather than the arithmetic pretending it's a number.
    expect(remainingSeconds({ secondsLeft: Infinity, atMs: 0 }, 9e9)).toBe(Infinity);
    expect(formatCountdown(Infinity)).toBe("--:--");
  });
});

describe("formatting the clock", () => {
  it("pads the seconds so the number doesn't jump about", () => {
    expect(formatCountdown(125)).toBe("2:05");
    expect(formatCountdown(9)).toBe("0:09");
    expect(formatCountdown(0)).toBe("0:00");
  });

  it("floors rather than rounds, so it never shows a second that's already gone", () => {
    expect(formatCountdown(59.9)).toBe("0:59");
  });

  it("calls the last minute urgent", () => {
    expect(clockIsUrgent(61)).toBe(false);
    expect(clockIsUrgent(60)).toBe(true);
    expect(clockIsUrgent(Infinity)).toBe(false);
  });
});

describe("what the room says, to whom", () => {
  const base = { here: 3, lobbySize: 5, yourRoleTitle: null, isCeo: false, ceoName: null, companyName: null };

  it("counts down the people, not the seats, while filling", () => {
    expect(phaseCopy({ ...base, phase: "filling" }).title).toBe("Waiting for 2 more");
    expect(phaseCopy({ ...base, phase: "filling", here: 5 }).title).toBe("The room is full");
  });

  it("tells someone without a seat that one will be dealt to them", () => {
    const copy = phaseCopy({ ...base, phase: "claiming" });
    expect(copy.title).toBe("Pick a seat");
    expect(copy.body).toMatch(/dealt out/);
  });

  it("tells someone with a seat they can still swap", () => {
    const copy = phaseCopy({ ...base, phase: "claiming", yourRoleTitle: "Chief Financial Officer" });
    expect(copy.title).toBe("You're the Chief Financial Officer");
    expect(copy.body).toMatch(/release/i);
  });

  it("names whose turn it is during naming, for the four people waiting", () => {
    expect(phaseCopy({ ...base, phase: "naming", ceoName: "Dana" }).title).toBe("Dana is naming the company");
    expect(phaseCopy({ ...base, phase: "naming", isCeo: true }).title).toBe("Name the company");
  });

  it("falls back to the seat when the room has no name for the chief executive yet", () => {
    expect(phaseCopy({ ...base, phase: "naming" }).title).toMatch(/chief executive/i);
  });

  it("hands off to year one under the company's own name", () => {
    expect(phaseCopy({ ...base, phase: "running", companyName: "Kestrel Works" }).title).toBe("Kestrel Works is trading");
    expect(phaseCopy({ ...base, phase: "running" }).title).toBe("Year one has begun");
  });

  it("explains a retired room instead of leaving a dead end", () => {
    expect(phaseCopy({ ...base, phase: "retired" }).body).toMatch(/another/);
  });
});

describe("a seat in the list", () => {
  it("says a dealt seat was dealt", () => {
    const s = seatStatus(seat({ role: "coo", assigned: true }), "Chief Operating Officer");
    expect(s.label).toBe("Chief Operating Officer");
    expect(s.note).toMatch(/Dealt by the clock/);
  });

  it("says nothing extra about a seat somebody chose", () => {
    expect(seatStatus(seat({ role: "coo" }), "Chief Operating Officer").note).toBeNull();
  });

  it("marks the people who haven't decided, because they're who the clock is for", () => {
    const s = seatStatus(seat(), null);
    expect(s.settled).toBe(false);
    expect(s.label).toBe("Still choosing");
  });
});

describe("reading a market", () => {
  it("turns loyalty into the thing it decides", () => {
    expect(loyaltyRead(0.86).label).toBe("Locked in");
    expect(loyaltyRead(0.72).label).toBe("Sticky");
    expect(loyaltyRead(0.45).label).toBe("Persuadable");
    expect(loyaltyRead(0.18).label).toBe("On the rope");
  });

  it("adds the incumbents up to the ~90% a team has to take from", () => {
    expect(incumbentHold([{ name: "a", share: 0.34, posture: "fortress" }, { name: "b", share: 0.26, posture: "brawler" }])).toBe(60);
    expect(incumbentHold([])).toBe(0);
  });

  it("shortens customer counts so two segments can be compared at a glance", () => {
    expect(formatCount(420_000)).toBe("420k");
    expect(formatCount(22_000)).toBe("22k");
    expect(formatCount(1_250_000)).toBe("1.3m");
    expect(formatCount(2_000_000)).toBe("2m");
    expect(formatCount(840)).toBe("840");
  });
});
