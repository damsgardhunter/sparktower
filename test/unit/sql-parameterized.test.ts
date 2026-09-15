/**
 * SQL is built from parameters, not strings.
 *
 * Time windows and identifiers used to be spliced into query text with
 * `sql.raw` — safe only while every value was a trusted constant. These tests
 * hold the line: the interval helper sends its length as a bound parameter and
 * refuses anything that isn't a number, and no server or shared file goes back
 * to string-built SQL (the same check the codebase audit runs).
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { PgDialect } from "drizzle-orm/pg-core";
import { interval, ago } from "../../server/sql-interval";
import { scanSecurity } from "@shared/security-checks";

const dialect = new PgDialect();

describe("interval()", () => {
  it("binds the length as a parameter", () => {
    const q = dialect.sqlToQuery(ago(15, "minutes"));
    expect(q.sql).toBe("(now() - make_interval(secs => $1::double precision))");
    expect(q.params).toEqual([900]);
    expect(dialect.sqlToQuery(interval(2, "days")).params).toEqual([172800]);
  });

  it("refuses anything that isn't a finite number", () => {
    for (const bad of ["1 day'; DROP TABLE users; --", NaN, Infinity, undefined, null]) {
      expect(() => interval(bad as any, "hours")).toThrow(TypeError);
    }
  });
});

describe("no string-built SQL", () => {
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(name) ? [p] : [];
  });
  const files = ["server", "shared"].flatMap(walk).map((path) => ({ path, content: readFileSync(path, "utf8") }));

  it("passes the audit's sql-injection check", () => {
    const check = scanSecurity(files).checks.find((c) => c.id === "sql-injection")!;
    expect(check.evidence).toEqual([]);
    expect(check.status).toBe("pass");
  });

  it("never reaches for sql.raw", () => {
    const offenders = files.filter((f) => !f.path.endsWith("security-checks.ts") && /sql\.raw\(/.test(f.content)).map((f) => f.path);
    expect(offenders).toEqual([]);
  });
});
