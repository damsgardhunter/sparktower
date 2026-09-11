/**
 * Counting passes round the Explore loop. The subtle cases are the ones a
 * return creates: a page load back to Discover sends both "opened" and
 * "came back", and must close one cycle, not two; and acting without ever
 * coming back is zero cycles, however much acting there was.
 */
import { describe, it, expect } from "vitest";
import { countCycles, EXPLORE_EVENTS as E } from "@shared/explore-events";

const trail = (session: string, ...names: string[]) => names.map((name) => ({ session, name }));

describe("countCycles", () => {
  it("counts open → act → return as one pass, and the return as the start of the next", () => {
    const cycles = countCycles([
      ...trail("s1", E.openDiscover, E.viewMatchCard, E.follow, E.openDiscover, E.returnToDiscover, E.connectRequest, E.openDiscover, E.returnToDiscover),
    ]);
    expect(cycles.get("s1")).toBe(2);
  });

  it("doesn't count a return that followed no action, or an action with no return", () => {
    expect(countCycles(trail("s", E.openDiscover, E.returnToDiscover, E.returnToDiscover)).get("s")).toBe(0);
    expect(countCycles(trail("s", E.openDiscover, E.follow, E.messageSent)).get("s")).toBe(0);
  });

  it("ignores actions before Discover was ever opened, and leaves such sessions out", () => {
    const cycles = countCycles([...trail("a", E.follow, E.openDiscover), ...trail("b", E.follow, E.messageSent)]);
    expect(cycles.get("a")).toBe(0);
    expect(cycles.has("b")).toBe(false);
  });

  it("keeps sessions apart", () => {
    const cycles = countCycles([
      { session: "x", name: E.openDiscover }, { session: "y", name: E.openDiscover },
      { session: "x", name: E.follow }, { session: "y", name: E.openDiscover },
      { session: "x", name: E.returnToDiscover },
    ]);
    expect(Object.fromEntries(cycles)).toEqual({ x: 1, y: 0 });
  });
});
