/**
 * Kill-switch reads that finish out of order.
 *
 * The flags are re-read on a timer and again whenever one is toggled, so two
 * reads can be in flight at once. If the older one — which saw the switch
 * before it was flipped — finishes last, it must not win. This happened: the
 * kill-switch suite turned sign-up off and on, a timer read from the "off"
 * moment landed afterwards, and the next file's sign-ups were refused.
 *
 * The database is replaced with two answers whose timing the test controls,
 * so the race happens on demand rather than once in a long run.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { db } from "../../server/db";
import { loadSurfaceFlags, surfaceEnabled } from "../../server/surfaces";

afterEach(async () => {
  vi.restoreAllMocks();
  await loadSurfaceFlags();
});

describe("refreshing the kill switches", () => {
  it("never lets an older, slower read undo a newer one", async () => {
    let finishStale!: () => void;
    const staleRows = new Promise<any[]>((resolve) => { finishStale = () => resolve([{ surfaceId: "signup", enabled: false }]); });
    const freshRows = Promise.resolve([{ surfaceId: "signup", enabled: true }]);
    const select = vi.spyOn(db, "select")
      .mockReturnValueOnce({ from: () => staleRows } as any)
      .mockReturnValueOnce({ from: () => freshRows } as any);

    const older = loadSurfaceFlags();   // the timer's read: started first, finishes last
    await loadSurfaceFlags();           // the toggle's read: started second, finishes first
    expect(surfaceEnabled("signup")).toBe(true);

    finishStale();
    await older;
    expect(surfaceEnabled("signup")).toBe(true);
    expect(select).toHaveBeenCalledTimes(2);
  });
});
