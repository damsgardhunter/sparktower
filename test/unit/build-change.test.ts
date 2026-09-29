/**
 * When a running build makes the screen re-read the path.
 *
 * The rule this covers is the one whose absence made a paid fourteen-minute
 * build look broken: everything waited for the run to *stop*, so while Nova
 * answered and closed a step every forty-five seconds the path on screen
 * stayed exactly as it was when the button was pressed.
 */
import { describe, expect, it } from "vitest";
import { buildChange, markOf, type BuildMark } from "../../client/src/lib/build-status";

const mark = (over: Partial<BuildMark> = {}): BuildMark =>
  ({ runningId: "run-1", lastId: null, finishedAt: null, through: 0, ...over });

describe("buildChange", () => {
  it("says a step went by while the run continues", () => {
    expect(buildChange(mark({ through: 3 }), mark({ through: 4 }))).toEqual({
      stopped: false, finished: false, advanced: true,
    });
  });

  it("says nothing happened when the count holds still", () => {
    // Polls every 3s, a step lands every ~45s: most readings are this one.
    expect(buildChange(mark({ through: 4 }), mark({ through: 4 }))).toEqual({
      stopped: false, finished: false, advanced: false,
    });
  });

  it("does not call a finish an advance", () => {
    // Otherwise the end of a run re-reads the light set and skips the full sweep.
    const before = mark({ through: 26 });
    const after = mark({ runningId: null, lastId: "run-1", finishedAt: "2026-09-24T10:00:00Z", through: 0 });
    expect(buildChange(before, after)).toEqual({ stopped: true, finished: true, advanced: false });
  });

  it("notices a run that stopped without writing an end", () => {
    const after = mark({ runningId: null, through: 0 });
    expect(buildChange(mark({ through: 9 }), after)).toMatchObject({ stopped: true, advanced: false });
  });

  it("notices a second run finishing after the first", () => {
    const before = mark({ runningId: null, lastId: "run-1", finishedAt: "2026-09-24T10:00:00Z" });
    const after = mark({ runningId: null, lastId: "run-2", finishedAt: "2026-09-24T11:00:00Z" });
    expect(buildChange(before, after)).toMatchObject({ finished: true, advanced: false });
  });
});

describe("markOf", () => {
  /* Steps handed back and steps that threw are progress too: a build whose
     next six steps are all the builder's own is still moving. */
  it("counts every step the build got through, however it ended", () => {
    const status: any = {
      running: { id: "run-1", stepsDone: 4, stepsForYou: 2, stepsFailed: 1 },
      last: null,
    };
    expect(markOf(status)).toMatchObject({ runningId: "run-1", through: 7 });
  });

  it("reads an idle project as nothing running", () => {
    const status: any = { running: null, last: { id: "run-1", finishedAt: "2026-09-24T10:00:00Z" } };
    expect(markOf(status)).toEqual({ runningId: null, lastId: "run-1", finishedAt: "2026-09-24T10:00:00Z", through: 0 });
  });
});
