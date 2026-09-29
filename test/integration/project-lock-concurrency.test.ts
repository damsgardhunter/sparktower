/**
 * The project lock under concurrency, which is where it used to deadlock.
 *
 * `withProjectLock` holds a transaction open while its body runs queries of
 * its own. When the lock and the body drew from the same connection pool,
 * enough simultaneous callers took every connection to hold their locks and
 * then waited forever for one to run their bodies on — a deadlock that no
 * amount of waiting cleared. A load test wedged a server with twelve
 * concurrent requests to `/api/projects/:id/path`, which a dashboard polls
 * every fifteen seconds; five were fine.
 *
 * So the number that matters here is "more at once than the main pool has
 * connections". node-postgres defaults to ten, and this runs comfortably past
 * it: if the lock ever shares that pool again, this test stops finishing
 * rather than failing an assertion, which is exactly what the bug did.
 */
import { describe, it, expect } from "vitest";
import { withProjectLock } from "../../server/project-lock";
import { db } from "../../server/db";
import { sql } from "drizzle-orm";

/* Comfortably above the main pool's ten. */
const CALLERS = 25;

describe("withProjectLock under concurrency", () => {
  it("lets every caller through when they all want the same project", async () => {
    let running = 0;
    let everRanTogether = false;

    const results = await Promise.all(
      Array.from({ length: CALLERS }, (_, i) =>
        withProjectLock("path-sync", "project-under-test", async () => {
          // Two at once here would mean the lock isn't serializing at all.
          running += 1;
          if (running > 1) everRanTogether = true;
          /*
           * A query of the body's own, on the main pool. This is the line the
           * deadlock turned on: under the old arrangement the connection it
           * needs is one of the ten being held by the locks.
           */
          const result: any = await db.execute(sql`select ${i}::int as n`);
          running -= 1;
          return Number(result.rows[0].n);
        }),
      ),
    );

    expect(results.sort((a, b) => a - b)).toEqual(Array.from({ length: CALLERS }, (_, i) => i));
    expect(everRanTogether, "two bodies held the same project's lock at once").toBe(false);
  }, 60_000);

  it("lets every caller through when they all want different projects", async () => {
    /*
     * The other shape, and the one that shows sizing was never the fix: with a
     * lock each, nobody waits on anybody's lock, and the old code still
     * deadlocked — because the connections were gone regardless of which key
     * each transaction held.
     */
    const results = await Promise.all(
      Array.from({ length: CALLERS }, (_, i) =>
        withProjectLock("path-sync", `project-${i}`, async () => {
          const result: any = await db.execute(sql`select ${i}::int as n`);
          return Number(result.rows[0].n);
        }),
      ),
    );
    expect(results.sort((a, b) => a - b)).toEqual(Array.from({ length: CALLERS }, (_, i) => i));
  }, 60_000);

  it("releases the lock when the body throws", async () => {
    await expect(
      withProjectLock("path-sync", "project-that-throws", async () => {
        throw new Error("the body failed");
      }),
    ).rejects.toThrow("the body failed");

    // If the rollback didn't happen, this waits for the lock until the timeout.
    const got = await withProjectLock("path-sync", "project-that-throws", async () => "through");
    expect(got).toBe("through");
  }, 60_000);
});
