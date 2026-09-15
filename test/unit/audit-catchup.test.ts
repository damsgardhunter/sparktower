import { describe, it, expect } from "vitest";
import {
  fingerprint, fileIndexOf, diffFileIndex, summarizePaths, renderFileChanges, sectionOf, tidyCatchUp, summarizeCatchUp,
  sameWork, CATCHUP_CAPS, type CatchUpContext,
} from "@shared/audit-catchup";

const ctx = (over: Partial<CatchUpContext> = {}): CatchUpContext => ({
  project: { oneLiner: "Plan dinners from your fridge", techStack: ["React", "Express"] },
  tasks: [
    { id: "t1", title: "Build the post page with comments", status: "todo" },
    { id: "t2", title: "Rate limit reports", status: "done" },
  ],
  loops: [{ id: "l1", title: "Ship an MVP", description: "1. a 2. b", type: "product" }],
  pathDone: new Set(["SHIP.M1.1"]),
  declined: [],
  ...over,
});

describe("what changed since the last audit", () => {
  it("fingerprints files and diffs them", () => {
    expect(fingerprint("abc")).toBe(fingerprint("abc"));
    expect(fingerprint("abc")).not.toBe(fingerprint("abd"));
    const before = fileIndexOf([{ path: "a.ts", content: "1" }, { path: "b.ts", content: "2" }, { path: "c.ts", content: "3" }]);
    const after = fileIndexOf([{ path: "a.ts", content: "1" }, { path: "b.ts", content: "2!" }, { path: "d.ts", content: "4" }]);
    expect(diffFileIndex(before, after)).toEqual({ added: ["d.ts"], modified: ["b.ts"], removed: ["c.ts"] });
    expect(diffFileIndex(null, after)).toBeNull();
  });

  it("groups changed paths by folder instead of listing a hundred files", () => {
    const paths = [...Array.from({ length: 30 }, (_, i) => `client/src/pages/p${i}.tsx`), "server/routes.ts", "README.md"];
    const lines = summarizePaths(paths);
    expect(lines[0]).toMatch(/^client\/src\/pages \(30\): p0\.tsx, .*…$/);
    expect(lines).toHaveLength(3);
    expect(renderFileChanges({ added: [], modified: [], removed: [] }, "2026-09-10")).toMatch(/No file changed/);
    expect(renderFileChanges(null, null)).toMatch(/first audit/);
  });
});

describe("keeping the catch-up brief and true", () => {
  it("files each edit under a section, safe ones apart", () => {
    expect(sectionOf({ op: "create_task", title: "x", status: "done" })).toBe("shipped");
    expect(sectionOf({ op: "create_task", title: "x" })).toBe("tasks");
    expect(sectionOf({ op: "update_task", id: "t1", status: "done" })).toBe("closed");
    expect(sectionOf({ op: "update_task", id: "t1", status: "done", title: "renamed" })).toBe("tasks");
    expect(sectionOf({ op: "complete_path_milestone", backboneId: "SHIP.M1.5" })).toBe("path");
    expect(sectionOf({ op: "update_loop", id: "l1" })).toBe("loops");
    expect(sectionOf({ op: "update_scope" })).toBe("brief");
  });

  it("turns 'record shipped' for work already on the board into closing that card", () => {
    const { operations, dropped } = tidyCatchUp([
      { op: "create_task", title: "Post page with comments", status: "done", description: "client/src/pages/post-detail.tsx" },
      { op: "create_task", title: "Rate limiting on reports", status: "done" },
      { op: "create_task", title: "Comment threads with replies", status: "done" },
      { op: "create_task", title: "Comment threads and replies", status: "done" },
    ], ctx());
    expect(operations.map((o) => [o.op, o.id ?? o.title, o._section])).toEqual([
      ["update_task", "t1", "closed"],
      ["create_task", "Comment threads with replies", "shipped"],
    ]);
    expect(dropped).toEqual(expect.arrayContaining([{ reason: "already on the board", count: 1 }, { reason: "proposed twice", count: 1 }]));
  });

  it("drops edits that change nothing, what was declined, and what's past the caps", () => {
    const words = ["search", "billing", "onboarding", "exports", "invites", "dashboards", "webhooks", "themes", "uploads", "badges", "streaks", "digests", "reminders", "imports", "sharing"];
    const many = words.map((w) => ({ op: "create_task", title: `${w} flow`, status: "done" }));
    const { operations, dropped } = tidyCatchUp([
      { op: "update_project", fields: { oneLiner: "plan dinners from your fridge!", techStack: ["express", "react"], mission: "Waste less food" } },
      { op: "update_task", id: "t2", status: "done" },
      { op: "update_task", id: "nope", status: "done" },
      { op: "complete_path_milestone", backboneId: "SHIP.M1.1", evidence: "x" },
      { op: "update_loop", id: "l1", title: "Ship an MVP" },
      { op: "create_task", title: "Add Stripe checkout" },
      ...many,
    ], ctx({ declined: ["Add task: Add Stripe checkout"] }));
    const brief = operations.find((o) => o.op === "update_project");
    expect(brief.fields).toEqual({ mission: "Waste less food" });
    expect(operations.filter((o) => o._section === "shipped")).toHaveLength(CATCHUP_CAPS.shipped);
    expect(operations.some((o) => o.title === "Add Stripe checkout")).toBe(false);
    const reasons = Object.fromEntries(dropped.map((d) => [d.reason, d.count]));
    expect(reasons).toMatchObject({ "changes nothing": 2, "a task that isn't on the board": 1, "already done on the path": 1, "declined last time": 1, "over the shipped limit": words.length - CATCHUP_CAPS.shipped });
  });

  it("says it in one line", () => {
    expect(summarizeCatchUp([{ _section: "shipped" }, { _section: "shipped" }, { _section: "closed" }, { _section: "brief" }]))
      .toBe("2 pieces of shipped work to record, 1 task to close, brief updates");
    expect(summarizeCatchUp([])).toBe("Your project already matches the code.");
    expect(sameWork("Build comment threads", "Comment threads")).toBe(true);
    expect(sameWork("Stripe checkout", "Comment threads")).toBe(false);
  });

  it("keeps loop changes to what's new and never brings back a removed loop", () => {
    const withSteps = ctx({ loops: [{ id: "l1", title: "Ship an MVP", description: "1. a", type: "product", steps: [{ title: "Check-in composer" }] }], rejectedLoops: ["Leaderboard hunting"] });
    const { operations, dropped } = tidyCatchUp([
      { op: "add_loop_steps", loopId: "l1", steps: [{ title: "Check-in composer", done: true }, { title: "Comment threads", done: false }] },
      { op: "add_loop_steps", loopId: "l1", steps: [{ title: "Check-in composer", done: true }] },
      { op: "create_loop", type: "product", title: "Leaderboard hunting", steps: "1. x" },
      { op: "retire_loop", id: "gone", reason: "x" },
      { op: "retire_loop", id: "l1", reason: "x" },
    ], withSteps);
    expect(operations.map((o) => [o.op, o._section])).toEqual([["add_loop_steps", "loops"], ["retire_loop", "loops"]]);
    expect(operations[0].steps).toEqual([{ title: "Comment threads", done: false }]);
    expect(Object.fromEntries(dropped.map((d) => [d.reason, d.count]))).toMatchObject({ "steps already there": 1, "removed by you before": 1, "a loop that isn't on the project": 1 });
    expect(sectionOf({ op: "add_loop_steps", steps: [{ title: "a", done: true }] })).toBe("path");
  });
});
