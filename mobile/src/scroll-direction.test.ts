/**
 * The bottom bar's disappearing act, driven through the cases that make it
 * feel wrong when they're missed.
 *
 * Each of these is a real complaint about naive hide-on-scroll: the bar that
 * flickers under a resting thumb, the one that vanishes when you bounce the
 * top of a list, and the one that makes you scroll half a screen to get it
 * back when you only wanted to reach it.
 */
import { describe, it, expect } from "vitest";
import { decideBar, SCROLL_THRESHOLD, TOP_ZONE } from "./scroll-direction";

/** A comfortable list: a tall page in a phone-sized window. */
const frame = (y: number, lastY: number) => ({ y, lastY, contentHeight: 4000, viewportHeight: 800 });

describe("scrolling down the page", () => {
  it("hides the bar, once past the top", () => {
    expect(decideBar(frame(400, 300)).hidden).toBe(true);
  });

  it("leaves it alone near the top, where people arrive", () => {
    // Reading the first few lines of a feed shouldn't take the controls away.
    expect(decideBar(frame(TOP_ZONE - 1, 0)).hidden).toBe(false);
    expect(decideBar(frame(20, 0)).hidden).toBe(false);
  });
});

describe("scrolling back up", () => {
  it("brings it back at the first real movement, not at the end of the gesture", () => {
    // Reaching back up IS the request for the controls, so it's answered
    // immediately rather than after some distance.
    expect(decideBar(frame(1000 - SCROLL_THRESHOLD, 1000)).hidden).toBe(false);
  });

  it("brings it back all the way to the top too", () => {
    expect(decideBar(frame(10, 600)).hidden).toBe(false);
  });
});

describe("movements that aren't decisions", () => {
  it("ignores a thumb resting on the screen", () => {
    // A few pixels either way is a hand, not an intention. Answering these is
    // what makes a bar flicker.
    for (const delta of [0, 1, -1, SCROLL_THRESHOLD - 1, -(SCROLL_THRESHOLD - 1)]) {
      const d = decideBar(frame(500 + delta, 500));
      expect(d.hidden, `delta ${delta}`).toBeNull();
      // And the reference point doesn't move, so a slow drag still accumulates
      // into a real decision rather than being ignored a pixel at a time.
      expect(d.lastY, `delta ${delta}`).toBe(500);
    }
  });

  it("ignores the rubber-band at the top", () => {
    // Pulling to refresh reports a downward movement. Hiding the bar there
    // reads as a glitch.
    expect(decideBar(frame(-60, 0)).hidden).toBeNull();
  });

  it("ignores the rubber-band at the end", () => {
    // Bouncing off the bottom of a list shouldn't decide anything either.
    const atEnd = { y: 3300, lastY: 3200, contentHeight: 4000, viewportHeight: 800 };
    expect(decideBar(atEnd).hidden).toBeNull();
    // Exactly at the end is not overscroll: that's a normal scroll to the last row.
    expect(decideBar({ ...atEnd, y: 3200, lastY: 3100 }).hidden).toBe(true);
  });
});

describe("a slow drag", () => {
  it("adds up to a decision rather than being lost pixel by pixel", () => {
    // Three 4px movements: each too small on its own, together past the line.
    let lastY = 500;
    let hidden: boolean | null = null;
    for (const y of [504, 508, 512]) {
      const d = decideBar({ y, lastY, contentHeight: 4000, viewportHeight: 800 });
      lastY = d.lastY;
      if (d.hidden !== null) hidden = d.hidden;
    }
    expect(hidden, "a slow but deliberate scroll should still hide it").toBe(true);
  });
});
