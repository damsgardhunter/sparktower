/**
 * Telling somebody their database is behind the build.
 *
 * `warnIfMigrationsPending` says it once at boot and says it well. What buries
 * it is everything that happens next: the auth lookup runs on every request,
 * so one missing column on `users` means a full Drizzle error — with its
 * forty-column SELECT — per request, and the one useful line has scrolled away
 * before anybody reads the failure.
 *
 * `server/migration-state.ts` records the same burial happening to the
 * simulation loop, and fixed it by holding the loop. Requests cannot be held,
 * so the error is made legible instead. This holds the detector that does it.
 */
import { describe, it, expect } from "vitest";
import { isSchemaBehind, isPoolTimeout } from "../../server/db";

/** A Drizzle failure, shaped the way one actually arrives. */
const drizzleWrapped = (code: string, message: string) => {
  const cause = Object.assign(new Error(message), { code });
  return Object.assign(
    new Error(`Failed query: select "id", "email", "push_enabled" from "users" where "users"."id" = $1`),
    { cause },
  );
};

describe("recognising a database behind the build", () => {
  it("finds an unknown column, however deeply wrapped", () => {
    /* Nothing hands these over bare — Drizzle wraps, and the caller may wrap again. */
    const inner = drizzleWrapped("42703", 'column "push_enabled" does not exist');
    const outer = Object.assign(new Error("Internal Server Error"), { cause: inner });
    expect(isSchemaBehind(inner)).toEqual({ column: "push_enabled" });
    expect(isSchemaBehind(outer)).toEqual({ column: "push_enabled" });
  });

  it("finds an unknown table too, which is the same cause", () => {
    expect(isSchemaBehind(drizzleWrapped("42P01", 'relation "push_tokens" does not exist')))
      .toEqual({ column: "push_tokens" });
  });

  it("still answers when the message cannot be parsed", () => {
    /*
     * The code is the signal; the name is a nicety. A detector that needed
     * both would go quiet exactly when Postgres changed its wording.
     */
    expect(isSchemaBehind(drizzleWrapped("42703", "something else entirely"))).toEqual({ column: null });
  });

  it("says nothing about any other database failure", () => {
    /* Narrow on purpose: every other error should keep saying what it is. */
    for (const code of ["23505", "23503", "42601", "57014", "08006"]) {
      expect(isSchemaBehind(drizzleWrapped(code, "whatever")), code).toBeNull();
    }
    expect(isSchemaBehind(new Error("a plain error"))).toBeNull();
    expect(isSchemaBehind(null)).toBeNull();
    expect(isSchemaBehind(undefined)).toBeNull();
  });

  it("does not confuse itself with a pool timeout", () => {
    /*
     * The two sit next to each other in the error handler and mean opposite
     * things — one is retryable and busy, the other is a deploy that needs a
     * command run.
     */
    const timeout = Object.assign(new Error("Failed query"), {
      cause: new Error("timeout exceeded when trying to connect"),
    });
    expect(isPoolTimeout(timeout)).toBe(true);
    expect(isSchemaBehind(timeout)).toBeNull();

    const behind = drizzleWrapped("42703", 'column "x" does not exist');
    expect(isSchemaBehind(behind)).toBeTruthy();
    expect(isPoolTimeout(behind)).toBe(false);
  });

  it("answers on a circular cause instead of hanging", () => {
    /*
     * Honest about what this proves: the `depth++` is what terminates, so
     * raising the cap does not break it and this test does not pretend to
     * catch that. What it does catch is a rewrite to `while (e.cause)`, which
     * would hang here — and a cause chain that points back at itself is not
     * hypothetical once errors are wrapped twice.
     */
    const a: any = new Error("a");
    const b: any = new Error("b");
    a.cause = b;
    b.cause = a;
    expect(isSchemaBehind(a)).toBeNull();
  });
});
