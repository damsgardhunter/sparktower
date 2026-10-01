/**
 * One instance does the scheduled work.
 *
 * Every `setInterval` in `server/` runs in every web process, which on a single
 * instance is indistinguishable from running once. That is why none of it
 * needed saying until the plan became several instances — and the costs are
 * not equal. `refreshDueNovaReads` asks the model with `forceAi: true`, so a
 * second instance pays OpenAI a second time for the same answers, and the work
 * *succeeds* both times: nothing in the logs reads as wrong, the bill is just
 * double.
 *
 * So the lock is the thing to hold to its claim, against a real Postgres,
 * because an advisory lock that silently fails open would be worse than no
 * lock — it would be a line of code everyone trusts.
 *
 * What it does not promise: that a job runs only once per hour across the
 * fleet. It prevents *concurrent* runs. Every job behind it is due-driven —
 * the rows carry when they were last done — so an instance that loses the race
 * has nothing left to do anyway.
 */
import { describe, it, expect, afterAll } from "vitest";
import { JOB, jobLockKey, withJobLock } from "../../server/job-lock";
import { pool } from "../../server/db";

afterAll(async () => {
  /* Nothing to close: the pool is the app's and other suites share it. */
});

/** Resolves once the caller says so, so two runs can be held open at once. */
function gate() {
  let open!: () => void;
  const waited = new Promise<void>((resolve) => { open = resolve; });
  return { waited, open };
}

describe("the lock around a scheduled job", () => {
  it("lets one caller in and turns the other away", async () => {
    const held = gate();
    const started: string[] = [];

    const first = withJobLock(JOB.promotions, async () => {
      started.push("first");
      await held.waited;
      return "did the work";
    });

    /* Wait for the first to be inside the lock before the second asks. */
    await new Promise((r) => setTimeout(r, 120));
    const second = await withJobLock(JOB.promotions, async () => {
      started.push("second");
      return "also did the work";
    });

    expect(second, "the second instance is turned away, not queued").toBeNull();
    expect(started, "and its work never ran").toEqual(["first"]);

    held.open();
    expect(await first).toBe("did the work");
  }, 60_000);

  it("gives the lock back afterwards, so the next tick runs", async () => {
    expect(await withJobLock(JOB.retention, async () => 1)).toBe(1);
    expect(await withJobLock(JOB.retention, async () => 2), "an hour later, the same instance or another").toBe(2);
  }, 60_000);

  /*
   * The failure that would wedge a job for everyone: a throw that leaves the
   * lock held. Advisory locks die with their connection, and the connection is
   * returned in a `finally`, so this holds even if the unlock itself fails.
   */
  it("gives the lock back when the job throws", async () => {
    await expect(withJobLock(JOB.rhythm, async () => { throw new Error("the job fell over"); }))
      .rejects.toThrow("the job fell over");
    expect(await withJobLock(JOB.rhythm, async () => "recovered"), "the next tick is not blocked by the last one's failure").toBe("recovered");
  }, 60_000);

  it("does not let one job block a different one", async () => {
    const held = gate();
    const first = withJobLock(JOB.reputation, async () => { await held.waited; return "reputation"; });
    await new Promise((r) => setTimeout(r, 120));
    expect(await withJobLock(JOB.promotions, async () => "promotions"), "a different job is not waiting on this one").toBe("promotions");
    held.open();
    expect(await first).toBe("reputation");
  }, 60_000);

  /*
   * Two jobs sharing a key would be the quietest possible bug: each would
   * sometimes skip a tick because the *other* was running, and the symptom
   * would be work that occasionally does not happen.
   */
  it("gives every job a key of its own", () => {
    const names = Object.values(JOB);
    const keys = names.map(jobLockKey);
    expect(new Set(keys).size, `two jobs share an advisory lock key: ${names.join(", ")}`).toBe(names.length);
    for (const k of keys) expect(Number.isInteger(k)).toBe(true);
  });

  it("does not leak a connection per tick", async () => {
    const before = pool.totalCount;
    for (let i = 0; i < 12; i++) await withJobLock(JOB.retention, async () => i);
    /*
     * The pool may grow to serve the burst; what must not happen is a client
     * held for ever by each tick, which on a 20-connection pool is an outage
     * by morning.
     */
    expect(pool.idleCount, "the clients came back").toBeGreaterThan(0);
    expect(pool.totalCount - before, "and the pool did not grow a client per tick").toBeLessThan(12);
  }, 60_000);
});
