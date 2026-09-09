/**
 * Typecheck as a ratchet: the error count may go down, never up.
 *
 * This repository carries a backlog of type errors that predate CI. Failing
 * the build on all of them would mean failing every pull request from day one,
 * so the job would be marked non-blocking within a week and stop being read.
 * Not checking at all lets the backlog grow. This is the middle: the count is
 * compared to a committed baseline, a PR that adds an error fails, and a PR
 * that removes some is told to lower the number so the gain is kept.
 *
 * The baseline lives in typecheck-baseline.json and is reviewed like any other
 * change — raising it is a visible decision in a diff, not something that
 * happens because someone was in a hurry.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const BASELINE_FILE = new URL("../typecheck-baseline.json", import.meta.url);
const baseline = JSON.parse(readFileSync(BASELINE_FILE, "utf8")).errors;

const run = spawnSync("npx", ["tsc", "--noEmit", "--pretty", "false"], { encoding: "utf8" });
const output = `${run.stdout}${run.stderr}`;
const errors = (output.match(/error TS\d+/g) ?? []).length;

const update = process.argv.includes("--update");

if (errors > baseline) {
  console.error(`typecheck: ${errors} errors, baseline is ${baseline} — ${errors - baseline} new.`);
  console.error("");
  // Show only the errors, not the whole transcript, so the new one is findable.
  console.error(output.split("\n").filter((l) => /error TS\d+/.test(l)).join("\n"));
  process.exit(1);
}

if (errors < baseline) {
  if (update) {
    writeFileSync(BASELINE_FILE, JSON.stringify({ errors }, null, 2) + "\n");
    console.log(`typecheck: ${errors} errors. Baseline lowered from ${baseline} — commit typecheck-baseline.json.`);
  } else {
    console.log(`typecheck: ${errors} errors, under the baseline of ${baseline}.`);
    console.log(`  Run \`npm run typecheck:ratchet -- --update\` to lock the improvement in.`);
  }
  process.exit(0);
}

console.log(`typecheck: ${errors} errors, at the baseline.`);
