/**
 * Names built into SQL by hand.
 *
 * Values are parameters everywhere in this codebase. Identifiers cannot be —
 * Postgres has no `$1` for "which table" — so a maintenance script that walks
 * a list of tables builds that part of the string itself, and that is the one
 * remaining place injection could get in. The defence is not "the list is a
 * constant, nobody can reach it": that is true of today's code and stops being
 * true the moment somebody adds a flag.
 *
 * So the helper refuses anything that isn't a name, and this checks it refuses
 * the things an attacker would try — and that the script actually uses it,
 * which is the part a helper alone can't guarantee.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
// @ts-expect-error — a plain .mjs script helper, imported for what it does rather than its types.
import { quoteIdentifier, quoteKnownIdentifier, UnsafeIdentifierError, IDENTIFIER } from "../../scripts/lib/sql-identifier.mjs";

const script = readFileSync(join(__dirname, "..", "..", "scripts", "timestamp-skew.mjs"), "utf8");

describe("a name going into SQL", () => {
  it("takes the names this schema actually uses", () => {
    for (const name of ["feed_posts", "created_at", "users", "_private", "sim_pace_events2"]) {
      expect(quoteIdentifier(name)).toBe(`"${name}"`);
    }
  });

  it("quotes even a valid name, so a reserved word is unambiguous", () => {
    expect(quoteIdentifier("user")).toBe('"user"');
    expect(quoteIdentifier("order")).toBe('"order"');
  });

  it("refuses the things somebody would try", () => {
    const attempts = [
      'users"; drop table users; --',
      "users; delete from users",
      "users--",
      "users/*",
      "users'",
      'users"',
      "users users",
      "users\nusers",
      "users\u0000",
      "pg_catalog.pg_user",
      "public.users",
      "Users",          // upper case: nothing here is called that
      "1users",         // a name cannot start with a digit
      "",
      "   ",
      "\t",
    ];
    for (const attempt of attempts) {
      expect(() => quoteIdentifier(attempt), JSON.stringify(attempt)).toThrow(UnsafeIdentifierError);
    }
  });

  it("refuses anything that isn't a string at all", () => {
    for (const attempt of [null, undefined, 7, {}, [], { toString: () => "users" }]) {
      expect(() => quoteIdentifier(attempt as any)).toThrow(UnsafeIdentifierError);
    }
  });

  it("refuses a name longer than Postgres would keep", () => {
    expect(() => quoteIdentifier("a".repeat(64))).toThrow(UnsafeIdentifierError);
    expect(quoteIdentifier("a".repeat(63))).toBe(`"${"a".repeat(63)}"`);
  });

  it("refuses a well-formed name the caller never listed", () => {
    expect(quoteKnownIdentifier("feed_posts", ["feed_posts", "users"])).toBe('"feed_posts"');
    expect(() => quoteKnownIdentifier("secrets", ["feed_posts", "users"])).toThrow(UnsafeIdentifierError);
    // Trimmed before the check, so whitespace can't smuggle a name past the list.
    expect(quoteKnownIdentifier(" users ", ["users"])).toBe('"users"');
  });

  it("matches names the way the schema writes them", () => {
    expect(IDENTIFIER.test("project_task_completions")).toBe(true);
    expect(IDENTIFIER.test("project-task")).toBe(false);
  });
});

describe("the repair script", () => {
  it("checks every name it builds SQL with", () => {
    expect(script).toContain("quoteKnownIdentifier");
    /*
     * The loop's raw names are used only as *values* — the existence check's
     * $1/$2 and the console lines. If a raw name is ever interpolated into a
     * query again, this fails.
     */
    const queries = [...script.matchAll(/`([^`]*(?:select|update|insert|delete)[^`]*)`/gi)].map((m) => m[1]);
    expect(queries.length, "the script still builds SQL").toBeGreaterThan(0);
    for (const query of queries) {
      expect(query, `raw table name in: ${query.slice(0, 60)}`).not.toMatch(/\$\{rawTable\}/);
      expect(query, `raw column name in: ${query.slice(0, 60)}`).not.toMatch(/\$\{rawColumn\}/);
    }
  });

  it("still passes its own zone and cutoff as parameters, not as text", () => {
    expect(script, "the timezone is a parameter").toMatch(/at time zone \$\$\{params\.length \+ 1\}/);
    expect(script).not.toMatch(/at time zone '\$\{zone\}'/);
    expect(script, "the cutoff is a parameter").toMatch(/< \$1/);
  });
});
