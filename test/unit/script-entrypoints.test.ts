/**
 * Importing a command-line script must not run it.
 *
 * `main()` at module scope means importing anything from one of these — a
 * helper, a type, a constant a test wants — connects to a database, does the
 * work, and calls `process.exit` in the middle of whatever imported it. Vitest
 * reports that as "process.exit unexpectedly called with 0" against an
 * unrelated test file: every test passes, the check is red, and nothing in the
 * output points at the cause.
 *
 * That happened once, to the catch-up script (1dcf2a0a), and cost an
 * afternoon. These are its siblings, and this is the check that keeps every one
 * of them importable.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";

const SCRIPTS = [
  "script/catch-up-migrations.ts",
  "script/reconcile-migrations.ts",
  "script/verify-migrations.ts",
  "script/baseline-migrations.ts",
  /*
   * The reputation pair, for the same reason and one more: both import the
   * fact-gatherers, and one of them writes. A missing guard there would not
   * merely connect to a database on import, it would seed one.
   */
  "script/reputation-gap.ts",
  "script/seed-max-reputation.ts",
];

describe("command-line scripts", () => {
  it("only run themselves when run directly", () => {
    for (const path of SCRIPTS) {
      const src = readFileSync(path, "utf8");
      /*
       * Read from the source rather than by importing: importing is the thing
       * being guarded against, and a test that proves it by doing it would
       * take the suite down with it on the day the guard is removed.
       */
      const bare = /^main\(\)/m.test(src);
      expect(bare, `${path} calls main() at module scope — importing it would run it`).toBe(false);
      expect(src, `${path} has no entrypoint guard`).toMatch(/import\.meta\.url === pathToFileURL/);
    }
  });

  /* The guard is only worth having if the command still runs. */
  it("still have a main to run", () => {
    for (const path of SCRIPTS) {
      expect(readFileSync(path, "utf8"), path).toMatch(/if \(runDirectly\) \{\s*\n\s*main\(\)/);
    }
  });
});
