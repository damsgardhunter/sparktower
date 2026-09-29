/**
 * The main pool's waits are bounded.
 *
 * node-postgres defaults `connectionTimeoutMillis` to 0 — wait forever — and
 * that default is why a pool deadlock (server/project-lock.ts) presented as a
 * site that had simply stopped answering: no error, no log, no failing health
 * check, every request queued behind the last one for as long as anyone cared
 * to wait. The fix for the deadlock was elsewhere; this is the part that makes
 * the *next* exhaustion visible instead of silent.
 */
import { describe, it, expect, beforeAll } from "vitest";

let pool: any;
let isPoolTimeout: (err: unknown) => boolean;

beforeAll(async () => {
  // Constructing a Pool opens nothing, so this needs no database — only a URL
  // to satisfy the module's own check.
  process.env.DATABASE_URL ||= "postgresql://unit:unit@127.0.0.1:5432/unit_test";
  ({ pool, isPoolTimeout } = await import("../../server/db"));
});

describe("the main connection pool", () => {
  it("gives up waiting for a connection rather than queueing forever", () => {
    expect(pool.options.connectionTimeoutMillis).toBeGreaterThan(0);
  });

  it("states how many connections it has", () => {
    expect(pool.options.max).toBeGreaterThan(0);
  });
});

describe("isPoolTimeout", () => {
  it("recognises the pool's own timeout", () => {
    expect(isPoolTimeout(new Error("timeout exceeded when trying to connect"))).toBe(true);
  });

  /*
   * The shape it actually arrives in. Nothing hands this over bare: Drizzle
   * wraps it in a "Failed query", and the caller may wrap that again. Checking
   * only the top-level message — which is what the first version did — matches
   * none of these.
   */
  it("finds it under the wrappers", () => {
    const real = new Error("timeout exceeded when trying to connect");
    const drizzle = new Error('Failed query: select "id" from "projects"', { cause: real });
    expect(isPoolTimeout(drizzle)).toBe(true);
    expect(isPoolTimeout(new Error("Couldn't read the path", { cause: drizzle }))).toBe(true);
  });

  it("does not follow a cause chain forever", () => {
    const loop: any = new Error("a");
    loop.cause = loop;
    expect(isPoolTimeout(loop)).toBe(false);
  });

  /*
   * The narrowness is the point: this decides whether somebody is told the
   * site is busy and should retry, or that something broke. A query that
   * failed on its own merits must keep saying so.
   */
  it("leaves every other database error alone", () => {
    expect(isPoolTimeout(new Error('relation "projects" does not exist'))).toBe(false);
    expect(isPoolTimeout(new Error("canceling statement due to statement timeout"))).toBe(false);
    expect(isPoolTimeout(new Error("Connection terminated unexpectedly"))).toBe(false);
    expect(isPoolTimeout(null)).toBe(false);
    expect(isPoolTimeout("timeout exceeded when trying to connect")).toBe(false);
  });
});
