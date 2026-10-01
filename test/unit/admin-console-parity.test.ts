/**
 * The admin consoles the phone has, and the shapes they expect back.
 *
 * Five of the web's admin screens had no phone counterpart — `ai-spend`,
 * `console`, `revenue`, `problems`, `security` — each confirmed by the phone
 * never calling the route behind it. They are being added one at a time, and
 * this file is what keeps each one honest as it lands.
 *
 * Two things are checked, and the second is the one that has already bitten.
 *
 * **Reachable.** A screen file nobody can navigate to is not a feature. The
 * phone's admin screens are reached from one place — the Admin group in
 * `(tabs)/more.tsx` — so a screen with no row there is dead code that
 * typechecks.
 *
 * **The response shape.** `mobile/app/security.tsx` once declared a
 * `recoveryCodesLeft` the server has never sent, and rendered the literal words
 * "undefined recovery codes left" to anybody with 2FA on. The phone cannot
 * import the server's types — Metro will not resolve `@shared` — so an
 * interface on the phone is a copy, and a copy drifts. Comparing the two is the
 * only thing that notices.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(import.meta.dirname, "../..", p), "utf8");

/** Top-level field names of a TypeScript interface, ignoring nested objects' own fields. */
function fieldsOf(source: string, name: string): string[] {
  const at = source.indexOf(`interface ${name} {`);
  expect(at, `interface ${name} is gone`).toBeGreaterThanOrEqual(0);
  let depth = 0;
  let end = -1;
  for (let i = source.indexOf("{", at); i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) { end = i; break; }
  }
  const body = source.slice(source.indexOf("{", at) + 1, end);
  /* Strip nested braces so only this interface's own keys remain. */
  let flat = body;
  let previous: string;
  do { previous = flat; flat = flat.replace(/\{[^{}]*\}/g, "OBJ"); } while (flat !== previous);
  return [...flat.matchAll(/(?:^|\n)\s*(\w+)\??\s*:/g)].map((m) => m[1]).sort();
}

const more = read("mobile/app/(tabs)/more.tsx");

describe("the admin consoles on the phone", () => {
  /*
   * One row per screen. Adding a screen without adding its row is the mistake
   * this catches, and it is an easy one: the screen works when you navigate to
   * it by hand during development.
   */
  const screens = ["safety", "reports", "backing", "surfaces", "analytics", "revenue", "ai-spend", "console"];

  for (const screen of screens) {
    it(`${screen} is reachable from the More tab`, () => {
      expect(more, `nothing in (tabs)/more.tsx navigates to /admin/${screen}`).toContain(`"/admin/${screen}"`);
    });
  }

  /*
   * Owner-only on the server means owner-only in the menu, or the row is a door
   * onto "not found". `/api/admin/revenue` is `requireOwner`.
   */
  /*
   * Owner-only on the server means owner-only in the menu, or the row is a door
   * onto "not found". Both of these routes are `requireOwner`.
   */
  it.each([["revenue"], ["ai-spend"]])("hides the owner-only %s row from a reviewer", (screen) => {
    const row = more.split("\n").find((l) => l.includes(`"/admin/${screen}"`));
    expect(row, `the ${screen} row is gone`).toBeTruthy();
    expect(row, `${screen} is owner-only on the server; the row has to be too`).toMatch(/access\?\.owner/);
  });
});

describe("what the phone expects back from the revenue route", () => {
  it("names the same fields the server sends, and no others", () => {
    const server = fieldsOf(read("server/platform-revenue.ts"), "PlatformRevenue");
    const phone = fieldsOf(read("mobile/app/admin/revenue.tsx"), "PlatformRevenue");
    expect(phone, "the phone's revenue shape has drifted from the server's").toEqual(server);
  });

  /*
   * The identity the screen is built on, and the reason the liabilities are as
   * prominent as the takings: held pledges are refundable and user balances are
   * credit somebody can spend tomorrow, so an owner reading only the top line is
   * planning around other people's money.
   */
  it("shows what is owed, not just what was taken", () => {
    const screen = read("mobile/app/admin/revenue.tsx");
    /*
     * The group totals get their testID from a template literal, so the rendered
     * `text-owed` is not in the source and matching it finds nothing — which an
     * earlier version of this test did, and reported as a missing section.
     * These are the props the source actually carries.
     */
    expect(screen, "the top line is there").toMatch(/testID="text-ours"/);
    expect(screen, "so is what is owed").toMatch(/testID="owed"/);
    expect(screen, "and the escrow that makes it refundable").toMatch(/testID: "escrow"/);
  });
});

/**
 * What the phone expects back from the AI spend routes.
 *
 * These responses are built inline in `res.json({...})` rather than declared as
 * interfaces, so the comparison reads the keys out of the route itself. `today`
 * is the one that matters most: it is the screen's headline and the brake, so a
 * renamed field there is a launch-day number silently reading `undefined`.
 */
describe("what the phone expects back from the AI spend routes", () => {
  const routes = read("server/ai-spend-routes.ts");
  const screen = read("mobile/app/admin/ai-spend.tsx");

  /** The top-level keys of the `res.json({...})` inside a named GET route. */
  function sentBy(path: string): string[] {
    const at = routes.indexOf(`app.get("${path}"`);
    expect(at, `${path} is no longer registered here`).toBeGreaterThanOrEqual(0);
    const jsonAt = routes.indexOf("res.json({", at);
    expect(jsonAt, `${path} no longer answers with a literal object`).toBeGreaterThan(at);
    let depth = 0;
    let end = -1;
    for (let i = routes.indexOf("{", jsonAt); i < routes.length; i++) {
      if (routes[i] === "{") depth++;
      else if (routes[i] === "}" && --depth === 0) { end = i; break; }
    }
    let body = routes.slice(routes.indexOf("{", jsonAt) + 1, end);
    let previous: string;
    do { previous = body; body = body.replace(/\{[^{}]*\}/g, "OBJ"); } while (body !== previous);
    /* Keys at this level, ignoring comments. */
    return [...body.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/(?:^|\n|,)\s*(\w+)\s*:/g)].map((m) => m[1]).sort();
  }

  function fieldsOfInterface(source: string, name: string): string[] {
    const at = source.indexOf(`interface ${name} {`);
    expect(at, `interface ${name} is gone from the phone's screen`).toBeGreaterThanOrEqual(0);
    const end = source.indexOf("}", at);
    return [...source.slice(source.indexOf("{", at) + 1, end).matchAll(/(\w+)\s*:/g)].map((m) => m[1]).sort();
  }

  it("reads the same fields the brake route sends", () => {
    expect(
      fieldsOfInterface(screen, "Today"),
      "the phone's Today has drifted from what /api/admin/ai-spend/today sends",
    ).toEqual(sentBy("/api/admin/ai-spend/today"));
  });

  /*
   * The four questions the server file says a launch day asks. The screen is
   * built on them in that order, and this is what stops it drifting back into
   * being a port of the web's charts.
   */
  it("answers the four questions the routes exist for", () => {
    expect(screen, "today, against the brake").toMatch(/against the brake/i);
    expect(screen, "which parts are dear").toMatch(/Dearest parts/);
    expect(screen, "who is spending it, and had they paid").toMatch(/Biggest spenders/);
    expect(screen, "whether the caching is working").toMatch(/cacheRate/);
  });

  it("says what it leaves on the web rather than being quietly short of it", () => {
    expect(screen, "changing the cap is a desk job; the screen should say so").toMatch(/web\s*\n?\s*\*?\s*console|web console/);
  });
});

/**
 * The support console's lookup half.
 *
 * The web console both looks people up and acts on them. Only the lookup is on
 * the phone, and that is a decision rather than an omission:
 * `/api/admin/console/actions` reports `maxGrantCents`,
 * `maxGrantPerDayCents` and `grantedTodayCents`, so acting includes putting
 * money on somebody's balance, capped per operator per day. A mis-tap on a
 * phone is a different kind of accident from a mis-click at a desk, and a grant
 * is recoverable only in the sense that money can be taken back off a balance
 * after somebody has seen it.
 *
 * The test is here so that stays a decision: if the actions arrive, the line
 * saying they are elsewhere has to go with them.
 */
describe("the support console on the phone", () => {
  const screen = read("mobile/app/admin/console.tsx");

  it("looks people up, which is the part a phone is for", () => {
    expect(screen).toMatch(/\/api\/admin\/console\/search/);
    expect(screen, "and opens one of them").toMatch(/\/api\/admin\/console\/users\//);
  });

  it("shows what has already been done to an account", () => {
    expect(screen, "the history is the half a phone is good for").toMatch(/history/);
  });

  /*
   * Either it does not act, or it stops claiming it does not. Both halves fail
   * together on purpose, so the screen and its explanation cannot disagree.
   */
  it("does not act, and says where acting happens", () => {
    /*
     * The boundary matters: `/api/admin/console/act` is a prefix of
     * `.../actions`, which the screen's own comment names when it explains why
     * acting is elsewhere — so without it this test matched the explanation and
     * reported that the screen acts.
     */
    const acts = /\/api\/admin\/console\/(act|undo)(?![A-Za-z])/.test(screen);
    const saysSo = /on the web console/.test(screen);
    expect(
      acts,
      acts && saysSo
        ? "the screen acts now — remove the line telling people acting is on the web"
        : "the screen should not grant credit or suspend accounts yet",
    ).toBe(false);
    expect(saysSo, "if it cannot act it has to say where to").toBe(true);
  });

  it("is open to a reviewer, because the route is requireAdmin rather than requireOwner", () => {
    const row = more.split("\n").find((l) => l.includes('"/admin/console"'));
    expect(row, "the console row is gone").toBeTruthy();
    expect(row, "gating it on owner would lock out the reviewers it is for").not.toMatch(/access\?\.owner/);
  });
});
