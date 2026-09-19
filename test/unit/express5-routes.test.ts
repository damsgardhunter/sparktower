/**
 * Route paths Express 5 will actually accept.
 *
 * Express 5's router (path-to-regexp v8) dropped the old `:param?` suffix for
 * an optional segment and the `*` wildcard shorthand, and it throws on them —
 * at registration, not at request time. So a single route written the Express
 * 4 way stops the entire server from starting, while every typecheck and
 * every unit test stays green, because none of those register routes.
 *
 * That happened: `/api/sim/ventures/:id/reports/:year?` took the whole API
 * down until it was rewritten as `{/:year}`. This reads the route strings out
 * of the server's source so the next one fails here, in a second, rather than
 * as a server that won't boot.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROUTE = /\bapp\.(get|post|put|patch|delete|all|use)\(\s*["'`]([^"'`]+)["'`]/g;

describe("route paths", () => {
  /*
   * The directory, not `git ls-files`. Git lists files that have been deleted
   * but not committed, and — the case that matters — leaves out files that
   * are new and not yet added. The route that took the server down lived in a
   * file that was untracked when it was written, so a git-based scan would
   * have skipped precisely the code this exists to check.
   */
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : path.endsWith(".ts") ? [path] : [];
  });
  const files = walk("server");

  const routes = files.flatMap((file) => {
    const src = readFileSync(file, "utf8");
    return [...src.matchAll(ROUTE)].map((m) => ({ file, path: m[2] }));
  });

  it("finds the routes it is meant to be checking", () => {
    expect(routes.length, "the pattern stopped matching; this test would pass vacuously").toBeGreaterThan(100);
  });

  it("never uses the `:param?` optional syntax Express 5 throws on", () => {
    const bad = routes.filter((r) => /:[A-Za-z_]\w*\?/.test(r.path)).map((r) => `${r.file}: ${r.path}`);
    expect(bad, "write an optional segment as `{/:param}`").toEqual([]);
  });

  it("never uses a bare `*` wildcard, which Express 5 also rejects", () => {
    // Express 5 wants a named wildcard: `/*splat`, or `{*splat}` to allow empty.
    const bad = routes.filter((r) => /(^|\/)\*(\/|$)/.test(r.path)).map((r) => `${r.file}: ${r.path}`);
    expect(bad, "name the wildcard, e.g. `/*splat`").toEqual([]);
  });
});
