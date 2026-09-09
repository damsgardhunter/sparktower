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

  it("a check-in alone counts as activity", () => {
    const r = computePace({ ...base, createdAt: daysAgo(40), completions: [{ at: daysAgo(20), estimateMinutes: 60 }], activityDates: [daysAgo(2)] });
    expect(r.state).toBe("active");
  });
});

describe("injected tasks", () => {
  const artifacts = [{ label: "milestone:SHIP.M1.2", kind: "milestone" as const, text: "The loop" }, { label: "check-in:1", kind: "check-in" as const, text: "Shipped" }];

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
    const five = Array.from({ length: 5 }, (_, i) => ({ title: `T${i}`, description: "", artifact: "check-in:1" }));
    expect(admitInjections(five, artifacts, 0).admitted).toHaveLength(INJECT_CAP_PER_PHASE);
    expect(admitInjections(five, artifacts, 2).admitted).toHaveLength(1);
    expect(admitInjections(five, artifacts, 3).admitted).toHaveLength(0);
    expect(admitInjections(five, artifacts, 3).dropped.every((d) => d.reason === "phase is at its cap")).toBe(true);
  });

  it("keeps estimates whole and within a sitting", () => {
    const { admitted } = admitInjections([{ title: "Big", description: "", artifact: "check-in:1", estimateHours: 40 }, { title: "None", description: "", artifact: "check-in:1" }], artifacts, 0);
    expect(admitted.map((a) => a.estimateHours)).toEqual([8, 1]);
  });
});
