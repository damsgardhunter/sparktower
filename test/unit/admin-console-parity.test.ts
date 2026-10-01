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
  const screens = ["safety", "reports", "backing", "surfaces", "analytics", "revenue"];

  for (const screen of screens) {
    it(`${screen} is reachable from the More tab`, () => {
      expect(more, `nothing in (tabs)/more.tsx navigates to /admin/${screen}`).toContain(`"/admin/${screen}"`);
    });
  }

  /*
   * Owner-only on the server means owner-only in the menu, or the row is a door
   * onto "not found". `/api/admin/revenue` is `requireOwner`.
   */
  it("hides the owner-only ones from a reviewer", () => {
    const row = more.split("\n").find((l) => l.includes('"/admin/revenue"'));
    expect(row, "the Revenue row is gone").toBeTruthy();
    expect(row, "Revenue is owner-only on the server; the row has to be too").toMatch(/access\?\.owner/);
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
