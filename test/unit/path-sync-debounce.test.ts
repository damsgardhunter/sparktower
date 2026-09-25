/**
 * When a path reconcile is allowed to be skipped.
 *
 * `syncPathTree` used to run on every read of `/api/projects/:id/path`, which
 * every open dashboard polls every fifteen seconds — a write-locked
 * read-modify-write that found nothing to do almost every time, and that
 * serialised everyone looking at the same project behind one lock. The rule
 * below is what lets a poll skip it, so it is worth being exact about.
 */
import { describe, it, expect } from "vitest";
import { pathSyncIsFresh, pathSyncKey, PATH_SYNC_DEBOUNCE_MS } from "../../server/phase-trees";

const at = (msAgo: number) => new Date(Date.now() - msAgo);
const key = pathSyncKey("ship_mvp" as any, "saas", null);

describe("pathSyncIsFresh", () => {
  it("is fresh just after a reconcile with the same inputs", () => {
    expect(pathSyncIsFresh({ syncedAt: at(1_000), syncedKey: key }, key)).toBe(true);
  });

  it("is stale once the window has passed", () => {
    expect(pathSyncIsFresh({ syncedAt: at(PATH_SYNC_DEBOUNCE_MS + 1), syncedKey: key }, key)).toBe(false);
  });

  it("is stale when nothing has been recorded yet", () => {
    expect(pathSyncIsFresh({ syncedAt: null, syncedKey: null }, key)).toBe(false);
    expect(pathSyncIsFresh(undefined, key)).toBe(false);
  });

  /*
   * The case that makes the debounce safe. A route answer rewrites which
   * phases the path shows, so it must reconcile immediately however recently
   * the last one ran — and it does, because the route is part of the key.
   */
  it("is stale the moment any input changes, however recent", () => {
    const recent = { syncedAt: at(10), syncedKey: key };
    expect(pathSyncIsFresh(recent, pathSyncKey("ship_mvp" as any, "saas", "loan"))).toBe(false);
    expect(pathSyncIsFresh(recent, pathSyncKey("ship_mvp" as any, "marketplace", null))).toBe(false);
    expect(pathSyncIsFresh(recent, pathSyncKey("raise" as any, "saas", null))).toBe(false);
  });

  it("treats a timestamp from the future as stale", () => {
    // A clock that went backwards should cost one reconcile, not stop them forever.
    expect(pathSyncIsFresh({ syncedAt: at(-60_000), syncedKey: key }, key)).toBe(false);
  });
});

describe("pathSyncKey", () => {
  it("separates a missing route from an empty one", () => {
    expect(pathSyncKey("ship_mvp" as any, "saas", null)).toBe(pathSyncKey("ship_mvp" as any, "saas", undefined));
    expect(pathSyncKey("ship_mvp" as any, "saas", null)).not.toBe(pathSyncKey("ship_mvp" as any, "saas", "loan"));
  });
});
