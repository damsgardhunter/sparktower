/**
 * The pace model's promises, held to: optimistic on a thin sample, a date
 * that never regresses on effort, decay only on absence, fresh after
 * dormancy, and projection confidence that follows the verification tier.
 */
import { describe, it, expect } from "vitest";
import { computePace, paceState, admitInjections, INJECT_CAP_PER_PHASE } from "@shared/phase-trees";

const DAY = 86_400_000;
const now = new Date("2026-09-09T12:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * DAY);
const base = { now, createdAt: daysAgo(10), activityDates: [], remainingMinutes: 1200, totalMinutes: 2400, tier: "verified" as const };

describe("pace", () => {
  it("shows a date early: no completions yet means the authored month", () => {
    const r = computePace({ ...base, completions: [] });
    expect(r.mode).toBe("date");
    expect(r.multiplier).toBeNull();
    // 28 days from creation, 10 already gone.
    expect(Math.round((r.projectedAt!.getTime() - now.getTime()) / DAY)).toBe(18);
  });

  it("projects from the best recent days, not the average", () => {
    const strong = computePace({ ...base, completions: [{ at: daysAgo(1), estimateMinutes: 300 }, { at: daysAgo(2), estimateMinutes: 300 }, { at: daysAgo(3), estimateMinutes: 300 }] });
    const mixed = computePace({ ...base, completions: [{ at: daysAgo(1), estimateMinutes: 300 }, { at: daysAgo(2), estimateMinutes: 300 }, { at: daysAgo(3), estimateMinutes: 300 }, { at: daysAgo(12), estimateMinutes: 10 }] });
    expect(mixed.projectedAt!.getTime()).toBeLessThanOrEqual(strong.projectedAt!.getTime());
    expect(strong.multiplier).toBeGreaterThan(1);
  });

  it("never moves the date later while the builder is active", () => {
    const earlier = daysAgo(-5); // five days out
    const r = computePace({ ...base, completions: [{ at: daysAgo(1), estimateMinutes: 30 }], previous: { projectedAt: earlier, state: "active" } });
    expect(r.projectedAt!.getTime()).toBe(earlier.getTime());
  });

  it("decays only on absence, gently, and holds the date through the first week", () => {
    expect(paceState(3)).toBe("active");
    expect(paceState(7)).toBe("nudge");
    expect(paceState(10)).toBe("decaying");
    expect(paceState(15)).toBe("dormant");
    const prevDate = daysAgo(-3);
    const quiet = computePace({ ...base, createdAt: daysAgo(40), completions: [{ at: daysAgo(10), estimateMinutes: 60 }], previous: { projectedAt: prevDate, state: "active" } });
    expect(quiet.state).toBe("decaying");
    // three days past the first week of silence: three days of drift, no more.
    expect(quiet.projectedAt!.getTime()).toBeGreaterThan(prevDate.getTime());
    expect(Math.round((quiet.projectedAt!.getTime() - Math.max(prevDate.getTime(), quiet.projectedAt!.getTime() - 3 * DAY)) / DAY)).toBeLessThanOrEqual(3);
  });

  it("goes dormant after fifteen days and comes back fresh, with no carried penalty", () => {
    const dormant = computePace({ ...base, createdAt: daysAgo(40), completions: [{ at: daysAgo(20), estimateMinutes: 60 }], previous: { projectedAt: daysAgo(-1), state: "decaying" } });
    expect(dormant.state).toBe("dormant");
    expect(dormant.projectedAt).toBeNull();
    const back = computePace({ ...base, createdAt: daysAgo(40), completions: [{ at: daysAgo(20), estimateMinutes: 60 }, { at: now, estimateMinutes: 120 }], previous: { projectedAt: null, state: "dormant" } });
    expect(back.state).toBe("active");
    expect(back.projectedAt).not.toBeNull();
  });

  it("gives a hard date for verified work, a range for evidence, none for claimed, pipeline in market", () => {
    const c = [{ at: daysAgo(1), estimateMinutes: 120 }];
    expect(computePace({ ...base, completions: c, tier: "verified" }).mode).toBe("date");
    const ev = computePace({ ...base, completions: c, tier: "evidence" });
    expect(ev.mode).toBe("range");
    expect(ev.projectedLow!.getTime()).toBeLessThan(ev.projectedHigh!.getTime());
    expect(computePace({ ...base, completions: c, tier: "claimed" }).mode).toBe("none");
    expect(computePace({ ...base, completions: c, tier: "artifact", pipeline: true }).mode).toBe("pipeline");
  });

  it("an update post alone counts as activity", () => {
    const r = computePace({ ...base, createdAt: daysAgo(40), completions: [{ at: daysAgo(20), estimateMinutes: 60 }], activityDates: [daysAgo(2)] });
    expect(r.state).toBe("active");
  });
});

describe("injected tasks", () => {
  const artifacts = [{ label: "milestone:SHIP.M1.2", kind: "milestone" as const, text: "The loop" }, { label: "update:1", kind: "update" as const, text: "Shipped" }];

  it("admits only proposals that name a real artifact", () => {
    const { admitted, dropped } = admitInjections([
      { title: "Add rate limiting", description: "", artifact: "milestone:SHIP.M1.2", estimateHours: 2 },
      { title: "Something Nova made up", description: "", artifact: "" },
      { title: "Wrong label", description: "", artifact: "milestone:NOPE" },
    ], artifacts, 0);
    expect(admitted.map((a) => a.title)).toEqual(["Add rate limiting"]);
    expect(dropped.map((d) => d.reason)).toEqual(["no artifact named", "no artifact named"]);
  });

  it("caps a phase at three, counting what is already there", () => {
    const five = Array.from({ length: 5 }, (_, i) => ({ title: `T${i}`, description: "", artifact: "update:1" }));
    expect(admitInjections(five, artifacts, 0).admitted).toHaveLength(INJECT_CAP_PER_PHASE);
    expect(admitInjections(five, artifacts, 2).admitted).toHaveLength(1);
    expect(admitInjections(five, artifacts, 3).admitted).toHaveLength(0);
    expect(admitInjections(five, artifacts, 3).dropped.every((d) => d.reason === "phase is at its cap")).toBe(true);
  });

  it("keeps estimates whole and within a sitting", () => {
    const { admitted } = admitInjections([{ title: "Big", description: "", artifact: "update:1", estimateHours: 40 }, { title: "None", description: "", artifact: "update:1" }], artifacts, 0);
    expect(admitted.map((a) => a.estimateHours)).toEqual([8, 1]);
  });
});

/*
 * One note must not become the plan.
 *
 * The reported failure: a standing project note — "remove the weekly check-ins,
 * make the web path first" — turned up as the content of six different
 * milestones. It was in the MVP plan, the bottleneck ranking, the gap list, the
 * money roadmap, a contractor job post and "what is costing you most".
 *
 * Nothing was broken in the sense of throwing. Every one of those admissions was
 * legal: the note is a real artifact so the grounding rule passed, and each phase
 * was under its own cap of three. The cap was simply on the wrong axis — it could
 * only ever see one phase, and the repetition was across phases.
 */
describe("injected tasks, across the whole board", () => {
  const artifacts = [
    { label: "update:1", kind: "update" as const, text: "Drop the weekly check-ins, make the web path first" },
    { label: "milestone:SHIP.M1.2", kind: "milestone" as const, text: "The loop" },
  ];

  it("refuses work the project already has, wherever it was added", () => {
    const already = [{ title: "Remove the weekly check-ins", artifact: "update:1", phaseId: "week-1" }];
    const { admitted, dropped } = admitInjections(
      [{ title: "Remove the weekly check-ins", description: "", artifact: "update:1" }],
      artifacts, 0, already, "week-4",
    );
    expect(admitted).toHaveLength(0);
    expect(dropped[0].reason).toBe("already on the board");
  });

  it("sees through a rephrasing, which is how it got in six times", () => {
    /*
     * A model asked the same thing in six phases does not write it identically.
     * Matching on the exact string would have caught none of them.
     */
    const already = [{ title: "Remove the weekly check-ins and make the web path first", artifact: "update:1" }];
    for (const title of [
      "Remove weekly check-ins, make web path first",
      "Make the web path first and remove weekly check-ins".split(" and ").reverse().join(" and "),
      "remove the weekly check ins and make the web path first",
    ]) {
      const { admitted } = admitInjections([{ title, description: "", artifact: "update:1" }], artifacts, 0, already);
      expect(admitted, `"${title}" got in again`).toHaveLength(0);
    }
  });

  it("still admits a genuinely different task that shares a word", () => {
    /*
     * The other half, and the one that makes this worth testing: a rule loose
     * enough to stop a rephrasing can easily start refusing real work.
     */
    const already = [{ title: "Remove the weekly check-ins", artifact: "update:1" }];
    const { admitted } = admitInjections(
      [{ title: "Add a weekly digest email", description: "", artifact: "update:1" }],
      artifacts, 0, already,
    );
    expect(admitted.map((a) => a.title)).toEqual(["Add a weekly digest email"]);
  });

  it("stops one artifact following the project from phase to phase", () => {
    /*
     * The shape of the bug: the same note seeding section after section. Two
     * phases is a decision whose consequence landed later; by the third it has
     * become the plan.
     */
    const already = [
      { title: "Drop the check-ins", artifact: "update:1", phaseId: "week-1" },
      { title: "Reorder the web path", artifact: "update:1", phaseId: "week-2" },
    ];
    const { admitted, dropped } = admitInjections(
      [{ title: "Write the contractor post about the web path", description: "", artifact: "update:1" }],
      artifacts, 0, already, "week-3",
    );
    expect(admitted).toHaveLength(0);
    expect(dropped[0].reason).toBe("that artifact has already set work in enough phases");
  });

  it("still lets one artifact work a topic through inside its own phase", () => {
    /*
     * The half that must not break, and the documented behaviour: a rich update
     * describing three problems can set three tasks in the phase it belongs to.
     * That is one topic being worked through, not a note spreading — the first
     * version of this rule capped tasks instead of phases and broke it.
     */
    const already = [{ title: "Drop the check-ins", artifact: "update:1", phaseId: "week-1" }];
    const { admitted } = admitInjections([
      { title: "Reorder the web path", description: "", artifact: "update:1" },
      { title: "Retire the check-in email", description: "", artifact: "update:1" },
    ], artifacts, 1, already, "week-1");
    expect(admitted).toHaveLength(2);
  });

  it("lets a different artifact through while one has spread as far as it may", () => {
    const already = [
      { title: "Drop the check-ins", artifact: "update:1", phaseId: "week-1" },
      { title: "Reorder the web path", artifact: "update:1", phaseId: "week-2" },
    ];
    const { admitted } = admitInjections([
      { title: "Write the contractor post", description: "", artifact: "update:1" },
      { title: "Instrument the loop", description: "", artifact: "milestone:SHIP.M1.2" },
    ], artifacts, 0, already, "week-3");
    expect(admitted.map((a) => a.title)).toEqual(["Instrument the loop"]);
  });

  it("does not repeat itself inside one call", () => {
    /* Six proposals in one go is the same failure arriving faster. */
    const same = Array.from({ length: 6 }, () => ({
      title: "Remove the weekly check-ins", description: "", artifact: "update:1",
    }));
    expect(admitInjections(same, artifacts, 0).admitted).toHaveLength(1);
  });

  it("says a repeat is a repeat, even when the phase is also full", () => {
    /*
     * Order matters for the message. A repeat arriving at a full phase reported
     * as "phase is at its cap" would send somebody to raise the cap, which is
     * not the problem.
     */
    const already = [{ title: "Remove the weekly check-ins", artifact: "update:1" }];
    const { dropped } = admitInjections(
      [{ title: "Remove the weekly check-ins", description: "", artifact: "update:1" }],
      artifacts, INJECT_CAP_PER_PHASE, already,
    );
    expect(dropped[0].reason).toBe("already on the board");
  });

  it("behaves as it always did for a caller with no board to hand it", () => {
    /* The argument is optional, so every existing caller keeps its old answer. */
    const { admitted } = admitInjections(
      [{ title: "Add rate limiting", description: "", artifact: "milestone:SHIP.M1.2" }],
      artifacts, 0,
    );
    expect(admitted).toHaveLength(1);
  });
});
