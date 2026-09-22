/**
 * The one part of a statement that cannot be a bound parameter.
 *
 * `select * from $1` is not a thing Postgres will do, so a script that works
 * across several tables has to put that name in as text — and that is the only
 * place in this repository where a value becomes SQL rather than being handed
 * to the driver. scripts/lib/sql-identifier.mjs is the gate, and these are the
 * things it must refuse.
 *
 * The allowlist is the lock being tested here, not the shape check. A name
 * that looks perfectly ordinary and is not one this script works on is exactly
 * as dangerous as a name with a quote in it: `users` instead of `feed_posts`
 * rewrites the wrong table, and every timestamp in it moves five hours.
 */
import { describe, it, expect } from "vitest";
// @ts-expect-error — a plain .mjs helper, deliberately outside the TypeScript build.
import { escapeIdentifier, escapeColumnOf, eachTarget, UnsafeIdentifierError } from "../../scripts/lib/sql-identifier.mjs";

const TARGETS = {
  feed_posts: ["created_at"],
  feed_comments: ["created_at"],
  users: ["created_at"],
};

describe("the names a maintenance script is allowed to put in a statement", () => {
  it("quotes a name that is on the list", () => {
    expect(escapeIdentifier("feed_posts", TARGETS)).toBe('"feed_posts"');
    expect(escapeIdentifier("created_at", ["created_at"])).toBe('"created_at"');
  });

  it("refuses a perfectly ordinary name that nobody declared", () => {
    // The dangerous case that no shape check catches: a real table, wrong one.
    expect(() => escapeIdentifier("users", { feed_posts: ["created_at"] })).toThrow(UnsafeIdentifierError);
    expect(() => escapeIdentifier("password_reset_tokens", TARGETS)).toThrow(/not one of the names/);
  });

  it("refuses anything that isn't a plain lower-case identifier", () => {
    const attempts = [
      'feed_posts"; drop table users; --',
      "feed_posts; delete from users",
      "feed_posts--",
      "feed_posts /* */",
      "feed posts",
      "feed_posts)",
      "public.feed_posts",
      "FEED_POSTS",     // upper case would match the allowlist by accident and a different table in Postgres
      "feed_posts\u0000",
      "feed_posts\n",
      "1_feed_posts",
      "",
    ];
    for (const attempt of attempts) {
      expect(() => escapeIdentifier(attempt, [...Object.keys(TARGETS), attempt]), attempt).toThrow(UnsafeIdentifierError);
    }
  });

  it("refuses anything that isn't a string, however plausible", () => {
    for (const attempt of [null, undefined, 7, {}, ["feed_posts"], Symbol("feed_posts")] as unknown[]) {
      expect(() => escapeIdentifier(attempt as string, TARGETS)).toThrow(UnsafeIdentifierError);
    }
  });

  it("refuses a name Postgres would truncate, because it is then a different name", () => {
    const long = "a".repeat(64);
    expect(() => escapeIdentifier(long, [long])).toThrow(/longer than Postgres will keep/);
    expect(escapeIdentifier("a".repeat(63), ["a".repeat(63)])).toBe(`"${"a".repeat(63)}"`);
  });

  it("refuses to work with no allowlist at all", () => {
    // Not "allow everything": an identifier is only safe because something expected it.
    expect(() => escapeIdentifier("feed_posts", [])).toThrow(/No allowlist/);
    expect(() => escapeIdentifier("feed_posts", undefined as never)).toThrow(/No allowlist/);
  });

  it("checks a column against its own table, not against every table", () => {
    const targets = { feed_posts: ["created_at"], recurring_jobs: ["next_due"] };
    expect(escapeColumnOf("feed_posts", "created_at", targets)).toEqual({ table: '"feed_posts"', column: '"created_at"' });
    // `next_due` is a real column on a declared table — just not on this one.
    expect(() => escapeColumnOf("feed_posts", "next_due", targets)).toThrow(UnsafeIdentifierError);
    expect(() => escapeColumnOf("password_reset_tokens", "created_at", targets)).toThrow(UnsafeIdentifierError);
  });

  it("hands back every declared pair, quoted, with the plain names for lookups", () => {
    const all = eachTarget({ feed_posts: ["created_at"], users: ["created_at"] });
    expect(all).toHaveLength(2);
    expect(all[0]).toEqual({ name: { table: "feed_posts", column: "created_at" }, table: '"feed_posts"', column: '"created_at"' });
    // The plain names go to information_schema as bound parameters; the quoted ones into the statement.
    expect(all.every((t: any) => t.table.startsWith('"') && !t.name.table.startsWith('"'))).toBe(true);
  });

  it("quotes a name that needs it rather than changing what the statement means", () => {
    // Nothing in this schema is called `order`, but the escaping is what makes
    // that survivable if one ever is, instead of a syntax error at 2am.
    expect(escapeIdentifier("order", ["order"])).toBe('"order"');
  });
});
