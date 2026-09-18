/**
 * What the lobby tells five people at once.
 *
 * Both the web and the phone render the same room from these strings, so a
 * wrong one is wrong in two places, and the countdown is the kind of detail
 * nobody checks until it is on everybody's screen showing "1:60".
 */
import { describe, it, expect } from "vitest";
import { countdown, phaseCopy, urgency } from "@shared/simulation/lobby-copy";

describe("the countdown", () => {
  it("reads as minutes and seconds, and never as something impossible", () => {
    expect(countdown(125)).toBe("2:05");
    expect(countdown(60)).toBe("1:00");
    expect(countdown(59)).toBe("0:59");
    expect(countdown(9)).toBe("0:09");
    expect(countdown(0)).toBe("0:00");
    // A clock that has run out, or a browser tab that slept through the end.
    expect(countdown(-30)).toBe("0:00");
    expect(countdown(3.7)).toBe("0:03");
  });

  it("gets more urgent as it runs out", () => {
    expect(urgency(180)).toBe("calm");
    expect(urgency(45)).toBe("soon");
    expect(urgency(8)).toBe("now");
  });
});

describe("what each phase says", () => {
  const base = { seated: 3, lobbySize: 5, yourRole: null, isCeo: false, named: false } as const;

  it("counts the people still missing while filling", () => {
    const copy = phaseCopy({ ...base, phase: "filling" });
    expect(copy.title).toMatch(/2 more/);
    // And says what happens if they never arrive, because a deadline with no
    // stated consequence is just pressure.
    expect(copy.deadline).toMatch(/three/i);
  });

  it("tells someone without a seat to take one, and someone with one that they can still swap", () => {
    expect(phaseCopy({ ...base, phase: "claiming" }).title).toMatch(/take a seat/i);
    expect(phaseCopy({ ...base, phase: "claiming", yourRole: "cfo" }).title).toMatch(/you have a seat/i);
    expect(phaseCopy({ ...base, phase: "claiming", yourRole: "cfo" }).body).toMatch(/swap/i);
  });

  it("says whose turn it is during naming, differently to each side", () => {
    const ceo = phaseCopy({ ...base, phase: "naming", isCeo: true, yourRole: "ceo" });
    const rest = phaseCopy({ ...base, phase: "naming" });
    expect(ceo.title).toMatch(/name the company/i);
    expect(rest.title).toMatch(/chief executive is naming/i);
    // Both are told what the clock running out does, in their own terms.
    expect(ceo.deadline).toMatch(/placeholder/i);
    expect(rest.deadline).toMatch(/placeholder/i);
  });

  it("does not put a deadline on a phase that has none", () => {
    expect(phaseCopy({ ...base, phase: "running", named: true }).deadline).toBe("");
  });

  it("admits when a company started without a name", () => {
    expect(phaseCopy({ ...base, phase: "running", named: false }).title).toMatch(/unnamed/i);
    expect(phaseCopy({ ...base, phase: "running", named: true }).title).not.toMatch(/unnamed/i);
  });
});
