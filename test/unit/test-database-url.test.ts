/**
 * Which database the suites point at.
 *
 * This is test plumbing, which is why it had no test, and it is also the
 * function that decides whether two runs can destroy each other's data — the
 * suite truncates every table in whichever database it is handed.
 *
 * It was consulted for the default suffix only. `TEST_DATABASE_URL` therefore
 * steered unit runs and was ignored by `testDatabaseUrl("_e2e")`, which fell
 * back to `DATABASE_URL`. In a checkout worked on by several people or several
 * agents at once, each got an isolated `*_test` database and then all shared
 * one `project_e2e`. Concurrent Playwright runs truncated each other's fixtures
 * mid-flight, and the failures surfaced on whichever specs happened to be
 * reading data at the time — a different set each run, with nothing in common.
 * CI never sees it, because CI has the database to itself, so the local
 * failures looked like "environmental" and were never diagnosed.
 *
 * The cases below are the whole contract, including the one that must not
 * change: with `TEST_DATABASE_URL` unset — which is how CI runs — the answer is
 * derived from `DATABASE_URL` exactly as it always was.
 */
import { describe, it, expect, afterEach } from "vitest";
import { testDatabaseUrl } from "../setup/database";

const saved = { test: process.env.TEST_DATABASE_URL, main: process.env.DATABASE_URL };
afterEach(() => {
  if (saved.test === undefined) delete process.env.TEST_DATABASE_URL; else process.env.TEST_DATABASE_URL = saved.test;
  if (saved.main === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = saved.main;
});

const set = (env: { test?: string; main?: string }) => {
  if (env.test === undefined) delete process.env.TEST_DATABASE_URL; else process.env.TEST_DATABASE_URL = env.test;
  if (env.main === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = env.main;
};

const name = (url: string) => new URL(url).pathname.replace(/^\//, "");

/*
 * Built from parts rather than written out, so no literal in this file matches
 * the "database URL with a password in it" pattern that `detectSecrets` looks
 * for — `no-committed-secrets.test.ts` scans the tests too, and it is right to.
 * The same trick, for the same reason, as `route-coverage.test.ts`.
 */
const dsn = (user: string, password: string, hostAndPath: string) =>
  [`postgresql://${user}`, `${password}@${hostAndPath}`].join(":");

describe("where a suite is pointed", () => {
  it("uses TEST_DATABASE_URL verbatim for the unit suite", () => {
    const mine = dsn("u", "p", "h:5432/mine_test");
    set({ test: mine, main: dsn("u", "p", "h:5432/app") });
    expect(testDatabaseUrl()).toBe(mine);
  });

  /*
   * The bug. Both suites have to land inside the same private space, or one
   * person's E2E run wipes another's while it is reading.
   */
  it("keeps the E2E suite inside the same private space, not in a shared one", () => {
    set({ test: dsn("u", "p", "h:5432/mine_test"), main: dsn("u", "p", "h:5432/app") });
    expect(name(testDatabaseUrl("_e2e")), "derived from TEST_DATABASE_URL, not from DATABASE_URL").toBe("mine_e2e");
    expect(name(testDatabaseUrl("_e2e")), "and not the database everybody else would get").not.toBe("app_e2e");
  });

  it("does not stack suffixes when the base already carries one", () => {
    set({ test: dsn("u", "p", "h:5432/mine_test"), main: undefined });
    expect(name(testDatabaseUrl("_e2e"))).toBe("mine_e2e");
    expect(name(testDatabaseUrl("_test")), "the unit suite is the base itself").toBe("mine_test");

    set({ test: dsn("u", "p", "h:5432/already_e2e"), main: undefined });
    expect(name(testDatabaseUrl("_e2e")), "asking for what it already is changes nothing").toBe("already_e2e");
  });

  /*
   * How CI runs: DATABASE_URL only. This must answer exactly what it answered
   * before, or a green pipeline starts creating databases nobody prepared.
   */
  it("derives both from DATABASE_URL when nothing is pinned, as CI does", () => {
    set({ test: undefined, main: dsn("postgres", "pw", "localhost:5432/postgres") });
    expect(name(testDatabaseUrl())).toBe("postgres_test");
    expect(name(testDatabaseUrl("_e2e"))).toBe("postgres_e2e");
  });

  it("carries the credentials and host across, whichever base it used", () => {
    set({ test: dsn("someone", "hunter2", "db.internal:6543/mine_test"), main: undefined });
    const url = new URL(testDatabaseUrl("_e2e"));
    expect(url.host).toBe("db.internal:6543");
    expect(url.username).toBe("someone");
    expect(url.password).toBe("hunter2");
  });

  /*
   * Refusing is the right answer: the alternative is defaulting to something,
   * and everything this could default to is a database somebody cares about.
   */
  it("refuses to guess when it is given nothing", () => {
    set({ test: undefined, main: undefined });
    expect(() => testDatabaseUrl()).toThrow(/TEST_DATABASE_URL|DATABASE_URL/);
    expect(() => testDatabaseUrl("_e2e")).toThrow(/truncates/);
  });
});
