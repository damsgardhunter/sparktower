/**
 * One row per project, and which one it is.
 *
 * A company running Ship, Systemize and Run at once put three of itself on the
 * screen whose entire job is to answer "what do I do next" — and that question
 * has one answer per company. The other sections didn't go anywhere; they are
 * on the project's own page, which is where somebody goes to change which one
 * they are working on.
 *
 * Which one shows is worth pinning rather than leaving to the order a query
 * happened to return, because it decides what a person sees when they open the
 * app, and because "furthest along" is easy to say and has four edge cases.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("../../server/db", () => ({ db: {}, pool: {} }));

import { furthestAlong } from "../../server/path-return";
import type { NextStepItem } from "@shared/next-step";

const item = (over: Partial<NextStepItem> & { goal?: string; done?: number; total?: number }): NextStepItem => ({
  project: { id: "p1", title: "A company", logoUrl: null },
  track: { goal: (over.goal ?? "ship_mvp") as any, label: "Ship", short: "Ship", primary: false },
  phase: "Week 1",
  progress: { done: over.done ?? 0, total: over.total ?? 10 },
  next: { id: "SHIP.M1.1", title: "Product statement", actor: "user-decides", estimateMinutes: 5, step: null },
  daysSinceActivity: 0,
  projectedAt: null,
  lastDone: null,
  weekly: { due: false, steps: [] },
  ...over,
} as NextStepItem);

describe("the section a project shows", () => {
  it("is the one with the most steps finished", () => {
    const chosen = furthestAlong([
      item({ goal: "systemize_business", done: 1 }),
      item({ goal: "ship_mvp", done: 6 }),
      item({ goal: "run_company", done: 3 }),
    ]);
    expect(chosen?.track.goal).toBe("ship_mvp");
  });

  it("counts steps, not proportions, when the lines are different lengths", () => {
    /*
     * 2 of 4 is half a short line; 5 of 30 is a sixth of a long one. The
     * person with five finished steps has been at it longer, and a screen that
     * told them otherwise would be arguing with what they remember doing.
     */
    const chosen = furthestAlong([item({ goal: "run_company", done: 2, total: 4 }), item({ goal: "ship_mvp", done: 5, total: 30 })]);
    expect(chosen?.track.goal).toBe("ship_mvp");
  });

  it("falls back to the proportion when the counts are level", () => {
    const chosen = furthestAlong([item({ goal: "ship_mvp", done: 3, total: 30 }), item({ goal: "run_company", done: 3, total: 6 })]);
    expect(chosen?.track.goal).toBe("run_company");
  });

  it("then to whichever was worked on most recently", () => {
    const chosen = furthestAlong([
      item({ goal: "ship_mvp", done: 2, total: 10, daysSinceActivity: 9 }),
      item({ goal: "run_company", done: 2, total: 10, daysSinceActivity: 1 }),
    ]);
    expect(chosen?.track.goal).toBe("run_company");
  });

  it("and finally to the project's own section, so a fresh pair never flickers", () => {
    // Two sections started the same minute: nothing above tells them apart,
    // and the answer must not depend on the order rows came back in.
    const ship = item({ goal: "ship_mvp", track: { goal: "ship_mvp" as any, label: "Ship", short: "Ship", primary: true } });
    const run = item({ goal: "run_company", track: { goal: "run_company" as any, label: "Run", short: "Run", primary: false } });
    expect(furthestAlong([run, ship])?.track.goal).toBe("ship_mvp");
    expect(furthestAlong([ship, run])?.track.goal).toBe("ship_mvp");
  });

  it("prefers a section you can take a step on over one that needs setting up", () => {
    /*
     * A section waiting for adoption has no progress at all, so every rule
     * above would hand it the row the moment it existed — and "set this up"
     * is a worse answer than "take this step" when both are true.
     */
    const waiting = item({ goal: "run_company", next: null, needsPath: { kind: "adopt", existingTasks: 12, existingDone: 9 } });
    const working = item({ goal: "ship_mvp", done: 0, total: 12 });
    expect(furthestAlong([waiting, working])?.track.goal).toBe("ship_mvp");
    // Unless it is all there is, in which case the offer is the answer.
    expect(furthestAlong([waiting])?.needsPath?.kind).toBe("adopt");
  });

  it("says nothing about a project with nothing on it", () => {
    expect(furthestAlong([])).toBeNull();
  });
});
