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


  /*
   * A negative control. The check above says "the scanner found nothing",
   * which is the same sentence a broken scanner produces — delete the regex
   * and the suite goes greener, not redder. So hand the scanner a file that
   * is definitely vulnerable and require it to say so, by name.
   *
   * The file is synthetic and in-memory: scanSecurity is pure (no filesystem,
   * no network — it takes {path, content} records), so nothing is written to
   * disk and no real path has to carry a fake vulnerability. The path matters
   * though: the check only looks at server code, so it can't be under
   * client/, can't be .tsx, and can't look like a test (`test/`, `.test.ts`)
   * or the scanner filters it out before looking.
   */
  const CONTROL = "server/negative-control-not-a-real-file.ts";
  const VULNERABLE = [
    // Template interpolation straight into the query text.
    "const byId = await db.execute(`SELECT * FROM users WHERE id = ${req.params.id}`);",
    // The same through a driver's query(), which is the shape most ORMs expose.
    "const rows = await pool.query(`DELETE FROM sessions WHERE token = '${token}'`);",
    // Drizzle's escape hatch, with a value spliced in.
    "await db.execute(sql.raw(`SET search_path = ${schema}`));",
    // Prisma's, which is named after exactly what it does.
    "const hits = await prisma.$queryRawUnsafe(`SELECT * FROM posts WHERE title LIKE '%${q}%'`);",
  ].join("\n");

  it("catches string-built SQL when there is some (the detector works)", () => {
    const check = scanSecurity([{ path: CONTROL, content: VULNERABLE }]).checks.find((c) => c.id === "sql-injection")!;
    expect(check.status).not.toBe("pass");
    expect(check.evidence).toContain(CONTROL);
  });

  it("catches each dangerous shape on its own, not just the four together", () => {
    /*
     * One regex alternative could rot without the combined file noticing, so
     * each shape is put in front of the scanner alone.
     */
    const missed = VULNERABLE.split("\n").filter((line) => {
      const check = scanSecurity([{ path: CONTROL, content: line }]).checks.find((c) => c.id === "sql-injection")!;
      return check.status === "pass";
    });
    expect(missed, "The sql-injection check no longer recognises these query shapes.").toEqual([]);
  });

  it("doesn't cry wolf over parameterised queries", () => {
    /*
     * The other half of a working detector: a check that flags everything is
     * as useless as one that flags nothing, and would make the repo-wide
     * assertion above impossible to keep green honestly.
     */
    const safe = [
      "const rows = await db.select().from(users).where(eq(users.id, id));",
      "const r = await db.execute(sql`SELECT * FROM users WHERE id = ${id}`);",
      "const p = await pool.query('SELECT * FROM users WHERE id = $1', [id]);",
    ].join("\n");
    const check = scanSecurity([{ path: CONTROL, content: safe }]).checks.find((c) => c.id === "sql-injection")!;
    expect(check.status).toBe("pass");
    expect(check.evidence).toEqual([]);
  });

  /*
   * Concatenation, which the check was blind to until the regex learned about
   * it: SQL glued with `+`, or assembled into a variable and executed on the
   * next line. Both are the shape the check's own "fix" text has always
   * described, and both used to come back clean.
   */
  it("catches SQL glued together with `+`, wherever the gluing happens", () => {
    const shapes: { why: string; code: string }[] = [
      { why: "concatenated straight into the call", code: 'await db.query("SELECT * FROM users WHERE email = \'" + email + "\'");' },
      { why: "concatenated without quotes around the value", code: 'await db.execute("SELECT * FROM users WHERE id = " + id);' },
      { why: "interpolated into a variable, executed a line later", code: 'const q = `DELETE FROM posts WHERE id = ${id}`;\nawait db.execute(q);' },
      { why: "concatenated into a variable, executed a line later", code: 'const q = "SELECT * FROM t WHERE a = " + a;\nawait db.execute(q);' },
      {
        why: "an escaped identifier followed by an unescaped value — the case a lookahead exemption hides",
        code: 'await db.query("SELECT * FROM " + client.escapeIdentifier(t) + " WHERE a = " + a);',
      },
    ];

    for (const { why, code } of shapes) {
      const check = scanSecurity([{ path: CONTROL, content: code }]).checks.find((c) => c.id === "sql-injection")!;
      expect(check.status, `should not have passed (${why}): ${code}`).not.toBe("pass");
      expect(check.evidence, `should have named the file (${why})`).toContain(CONTROL);
    }
  });

  /*
   * The one legitimate reason to build SQL from a string: an identifier can't
   * be a bound parameter, so pg quotes it for you instead. server/data-shape.ts
   * does exactly this, and a check that flags it is a check people learn to
   * ignore.
   */
  it("leaves an identifier the driver has quoted alone", () => {
    const code = 'await client.query("SELECT count(*) FROM " + client.escapeIdentifier(table));';
    const check = scanSecurity([{ path: CONTROL, content: code }]).checks.find((c) => c.id === "sql-injection")!;
    expect(check.status).toBe("pass");
    expect(check.evidence).toEqual([]);
  });

  it("never reaches for sql.raw", () => {
    const offenders = files.filter((f) => !f.path.endsWith("security-checks.ts") && /sql\.raw\(/.test(f.content)).map((f) => f.path);
    expect(offenders).toEqual([]);
  });
});
