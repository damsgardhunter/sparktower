/**
 * The two things the simulator is allowed to interrupt somebody for.
 *
 * A notification is a claim on attention, and the ones that get sent from a
 * scheduled sweep are the easiest in any product to get wrong: nothing stops
 * you posting "you haven't simulated anything lately" every morning, and
 * nothing except a test stops the next person adding one. What is guarded here
 * is the restraint rather than the delivery — that a projection which turned
 * out to be *right* is not a reason to ring a bell, and that neither of these
 * is sent twice for the same thing.
 */
import { describe, it, expect } from "vitest";
import { markProjection } from "../../shared/simulation/hindsight";
import { runMonths, emptyBaseline } from "../../shared/simulation/decision-sim";
import { WORTH_TESTING_AT } from "../../shared/simulation/marketing";
import { NOTIFICATION_KINDS } from "../../shared/schema";
import { notificationText, notificationHref } from "../../shared/notifications";

const run = runMonths({
  baseline: { ...emptyBaseline(), monthlyRevenue: 10_000, monthlyCosts: 6_000, grossMargin: 0.5 },
  levers: [], months: 6,
});

/** The bar the nudge uses: inside a fifth either way is a good projection. */
const WORTH_MENTIONING = 0.2;

describe("what is worth a notification", () => {
  it("says nothing about a projection that was close", () => {
    /*
     * The restraint that matters. Being told "your forecast was about right"
     * is the definition of a notification that teaches somebody to stop
     * reading notifications.
     */
    const marked = markProjection(run, [10_400, 9_700, 10_100, null, null, null]);
    expect(marked).toBeTruthy();
    expect(Math.abs(marked!.typicalOff)).toBeLessThan(WORTH_MENTIONING);
  });

  it("speaks up when a projection ran well high or well low", () => {
    const high = markProjection(run, [6_000, 6_200, 5_800, null, null, null]);
    expect(Math.abs(high!.typicalOff)).toBeGreaterThan(WORTH_MENTIONING);
    expect(high!.lean).toBe("over");

    const low = markProjection(run, [16_000, 15_000, 16_500, null, null, null]);
    expect(Math.abs(low!.typicalOff)).toBeGreaterThan(WORTH_MENTIONING);
    expect(low!.lean).toBe("under");
  });

  it("has nothing to say until some weeks have actually been filed", () => {
    expect(markProjection(run, [null, null, null])).toBeNull();
  });

  it("only counts a scheme worth testing", () => {
    expect(WORTH_TESTING_AT).toBeGreaterThan(0);
    expect(WORTH_TESTING_AT).toBeLessThan(100);
  });
});

describe("how the two read", () => {
  const base = { actorId: "u1", actorName: "You", postId: null, projectId: "p1", projectTitle: "Tallystick" };

  it("are both real kinds with copy and a destination", () => {
    for (const kind of ["projection_marked", "scheme_untested"] as const) {
      expect(NOTIFICATION_KINDS).toContain(kind);
      const text = notificationText({ ...base, kind });
      expect(text.length).toBeGreaterThan(10);
      expect(text).toContain("Tallystick");
      // Straight to the panel that holds the answer, not a list to hunt through.
      expect(notificationHref({ ...base, kind })).toContain("tab=simulations");
    }
  });

  it("says what it found rather than asking somebody to come and look", () => {
    /*
     * The line has to be worth the tap on its own. "Come back and see" is the
     * shape of a nudge that gets muted; a finding is the shape of one that
     * gets read.
     */
    for (const kind of ["projection_marked", "scheme_untested"] as const) {
      const text = notificationText({ ...base, kind }).toLowerCase();
      expect(text).not.toMatch(/come back|check in|don't forget|haven't/);
    }
  });

  it("still reads without a project name", () => {
    for (const kind of ["projection_marked", "scheme_untested"] as const) {
      const text = notificationText({ ...base, kind, projectTitle: null });
      expect(text).not.toContain("null");
      expect(text.length).toBeGreaterThan(10);
    }
  });
});
