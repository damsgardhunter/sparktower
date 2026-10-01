/**
 * How many instances the database will take.
 *
 * The whole 2,000-user plan turns on `max_connections`, and until now that
 * number lived only in a provider's dashboard. It matters more than most
 * capacity numbers because exceeding it does not degrade — Postgres refuses
 * new connections outright — so the cost of guessing is an outage, and it
 * arrives at the moment traffic is highest.
 *
 * Two ways this could be wrong and both are worse than a blank:
 *
 *   - inventing a default when the database will not answer, because somebody
 *     would then scale on a number nobody measured;
 *   - computing the budget to the last connection, which fails during a
 *     deploy — `preDeployCommand` runs migrations against the same database —
 *     i.e. exactly when nobody wants to be reading this.
 *
 * So: it asks the real database, it reports not-knowing as not-knowing, and it
 * holds a reservation back.
 */
import { describe, it, expect, afterAll } from "vitest";
import { connectionBudget, RESERVED_CONNECTIONS } from "../../server/connection-budget";

const saved = { main: process.env.DB_POOL_MAX, lock: process.env.PROJECT_LOCK_POOL_MAX };
afterAll(() => {
  if (saved.main === undefined) delete process.env.DB_POOL_MAX; else process.env.DB_POOL_MAX = saved.main;
  if (saved.lock === undefined) delete process.env.PROJECT_LOCK_POOL_MAX; else process.env.PROJECT_LOCK_POOL_MAX = saved.lock;
});

describe("the connection budget", () => {
  it("reads the real ceiling from the database it is connected to", async () => {
    const b = await connectionBudget();
    expect(b.maxConnections, "a local Postgres answers SHOW max_connections").toBeGreaterThan(0);
    expect(b.inUse, "and says how many are in use").toBeGreaterThan(0);
    expect(b.inUse!).toBeLessThanOrEqual(b.maxConnections!);
  }, 60_000);

  it("counts both pools an instance opens, not just the main one", async () => {
    process.env.DB_POOL_MAX = "20";
    process.env.PROJECT_LOCK_POOL_MAX = "12";
    const b = await connectionBudget();
    expect(b.mainPoolMax).toBe(20);
    expect(b.lockPoolMax).toBe(12);
    expect(b.perInstance, "an instance is both pools; counting one is how you end up at double").toBe(32);
  }, 60_000);

  /*
   * The arithmetic that decides the instance count, with the reservation
   * actually held back rather than described.
   */
  it("holds connections back for a deploy rather than spending them all", async () => {
    process.env.DB_POOL_MAX = "20";
    process.env.PROJECT_LOCK_POOL_MAX = "12";
    const b = await connectionBudget();
    const expected = Math.max(0, Math.floor((b.maxConnections! - RESERVED_CONNECTIONS) / 32));
    expect(b.safeInstances).toBe(expected);
    expect(b.safeInstances! * 32 + RESERVED_CONNECTIONS, "the fleet plus the reservation fits").toBeLessThanOrEqual(b.maxConnections!);
  }, 60_000);

  it("shrinks the instance count when the pools are made bigger", async () => {
    process.env.DB_POOL_MAX = "20";
    process.env.PROJECT_LOCK_POOL_MAX = "12";
    const modest = await connectionBudget();
    process.env.DB_POOL_MAX = "60";
    const greedy = await connectionBudget();
    expect(greedy.perInstance).toBe(72);
    expect(greedy.safeInstances!, "raising the pool to cope with load costs you instances").toBeLessThan(modest.safeInstances!);
  }, 60_000);

  it("says what it is holding back and why, so the number can be argued with", async () => {
    const b = await connectionBudget();
    expect(b.note).toMatch(/DB_POOL_MAX/);
    expect(b.note).toMatch(/held back|could not be read/);
  }, 60_000);
});
