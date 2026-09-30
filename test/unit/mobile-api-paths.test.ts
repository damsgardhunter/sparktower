/**
 * Every endpoint the phone calls, checked against the endpoints the server has.
 *
 * The mobile app builds from its own tsconfig and cannot import the server's
 * route table, so the paths in it are strings. A string is not checked by
 * anything: the compiler is happy, the mobile suite is happy, and the screen
 * ships in a binary that answers 404 on a tap. That is strictly worse than the
 * same mistake on the web, where a wrong path is a deploy away from fixed —
 * here it waits for an App Store review.
 *
 * It had already happened. `mobile/app/security.tsx` offered a "New recovery
 * codes" button that POSTed to `/api/auth/mfa/recovery-codes`, a route that has
 * never existed in this repository. The product had dropped recovery codes —
 * the six digits from the authenticator are the only way in — and the web page
 * was rewritten to say so, while the phone kept a button for the old feature,
 * a `recoveryCodesLeft` counter the status route does not return, and a promise
 * of "recovery codes if you lose your phone" that could not be kept. Nothing
 * failed, because no test compares the two halves.
 *
 * So this is the same idea as `mobile-mirror.test.ts` and
 * `mobile-restatements.test.ts`, applied to routes rather than arithmetic or
 * constants: read both sides and fail when they disagree.
 *
 * What it does not check is the method — mobile's verb sits in an options
 * object rather than in the literal — so a GET against a POST-only route still
 * gets through. Paths are where the drift has actually happened.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { buildRouteCoverage } from "../../server/route-coverage";
import { serverSourceFiles } from "../helpers/server-files";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (path.includes("node_modules")) return [];
    if (statSync(path).isDirectory()) return walk(path);
    return /\.[jt]sx?$/.test(path) && !/\.test\./.test(path) ? [path] : [];
  });
}

/**
 * A path literal as a comparable route.
 *
 * Interpolations become `:param`, which is what they are. A nested template
 * (`` `/api/notifications${x ? `?before=${y}` : ""}` ``) can't be matched by a
 * regex that stops at the first backtick, so anything left unresolved after
 * the substitution truncates the path — the part before the first `$`, `{` or
 * backtick is still a real prefix, and the query string is not part of a route.
 */
function normalize(literal: string): string | null {
  let path = literal.replace(/^\$\{[^}]*\}(?=\/api\/)/, "");
  let previous: string;
  do { previous = path; path = path.replace(/\$\{[^${}]*\}/g, ":param"); } while (path !== previous);
  path = path.split(/[$`{]/)[0].split("?")[0].replace(/\/+$/, "");
  return path.startsWith("/api/") ? path : null;
}

/** Every `/api/...` literal handed to `api()` or `fetch()`, with the files that do it. */
function mobileCalls(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const file of [...walk("mobile/app"), ...walk("mobile/src")]) {
    const content = readFileSync(file, "utf8");
    const literals = [
      ...[...content.matchAll(/(?:api\s*(?:<[^>]*>)?|fetch)\s*\(\s*`([^`]*)`/g)].map((m) => m[1]),
      ...[...content.matchAll(/(?:api\s*(?:<[^>]*>)?|fetch)\s*\(\s*["']([^"']+)["']/g)].map((m) => m[1]),
    ];
    for (const literal of literals) {
      const path = normalize(literal);
      if (!path) continue;
      found.set(path, [...(found.get(path) ?? []), file]);
    }
  }
  return found;
}

const segments = (p: string) => p.split("/").filter(Boolean);
/** A route matches when it has the same shape and every segment agrees, a param matching anything. */
const matches = (call: string, route: string) => {
  const a = segments(call);
  const b = segments(route);
  return a.length === b.length && a.every((s, i) => s === b[i] || s.startsWith(":") || b[i].startsWith(":"));
};

describe("the endpoints the phone calls", () => {
  const calls = mobileCalls();
  const routes = buildRouteCoverage(serverSourceFiles() as any).rows.filter((r) => r.mounted).map((r) => r.path);

  /*
   * A test that reads source and finds nothing passes for the wrong reason
   * for ever. If either half comes back empty the extraction broke, not the
   * app — so that is the failure, said as itself.
   */
  it("are actually being read off both sides", () => {
    expect(calls.size, "no API calls found in mobile/ — the extraction broke, not the app").toBeGreaterThan(200);
    expect(routes.length, "no mounted routes found on the server — buildRouteCoverage changed shape").toBeGreaterThan(400);
  });

  it("all exist on the server", () => {
    const unresolved = [...calls.entries()]
      .filter(([call]) => !routes.some((route) => matches(call, route)))
      .map(([call, files]) => `${call}  — called from ${[...new Set(files)].join(", ")}`)
      .sort();
    expect(unresolved, "the phone calls endpoints the server does not have; a 404 the compiler cannot see").toEqual([]);
  });

  /*
   * The route this was written for, named on its own so a regression says what
   * came back rather than only that something did.
   */
  it("no longer include the recovery-code route the product does not have", () => {
    expect([...calls.keys()]).not.toContain("/api/auth/mfa/recovery-codes");
  });
});

/**
 * The phone's idea of a response, checked against what the route sends.
 *
 * The wrong path above was half the bug. The other half was a field: mobile
 * declared `recoveryCodesLeft: number` on the 2FA status, the route has never
 * sent it, and `undefined` went into a template — so anyone with 2FA on read
 * "undefined recovery codes left" on the screen reviewers and admins are
 * required to use. A shape is as much a contract as a path, and this one is
 * literal on both sides, so it can be compared.
 */
describe("what the phone expects back from the 2FA status route", () => {
  it("names only fields the route actually sends", () => {
    const server = readFileSync("server/mfa.ts", "utf8");
    const body = /app\.get\("\/api\/auth\/mfa\/status"[\s\S]*?res\.json\(\{([\s\S]*?)\}\)/.exec(server);
    expect(body, "the 2FA status route no longer looks like a single res.json({...})").toBeTruthy();
    const sent = [...body![1].matchAll(/(\w+)\s*:/g)].map((m) => m[1]).sort();

    const mobile = readFileSync("mobile/app/security.tsx", "utf8");
    const iface = /interface MfaStatus \{([^}]*)\}/.exec(mobile);
    expect(iface, "mobile/app/security.tsx no longer declares interface MfaStatus").toBeTruthy();
    const expected = [...iface![1].matchAll(/(\w+)\s*:/g)].map((m) => m[1]).sort();

    expect(sent.length, "no fields read off the status route").toBeGreaterThan(0);
    expect(expected, "mobile expects 2FA status fields the server does not send").toEqual(sent);
  });
});
