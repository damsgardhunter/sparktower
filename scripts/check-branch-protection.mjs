#!/usr/bin/env node
/**
 * Compares what GitHub enforces on `main` with what docs/ci-gate.md says it
 * should. Reading branch protection needs admin on the repository, so this
 * runs from an owner's machine with `gh` signed in — CI's token can't.
 *
 *   node scripts/check-branch-protection.mjs
 */
import { execFileSync } from "node:child_process";

const REQUIRED = ["server-web", "e2e", "secrets", "mobile", "packages", "dependencies", "codeql"];

let protection;
try {
  protection = JSON.parse(execFileSync("gh", ["api", "repos/{owner}/{repo}/branches/main/protection"], { encoding: "utf8" }));
} catch (err) {
  console.error("Could not read branch protection (is `gh` signed in as an admin?):", String(err.stderr || err.message).trim());
  process.exit(2);
}
const contexts = protection.required_status_checks?.contexts ?? [];
const missing = REQUIRED.filter((c) => !contexts.includes(c));
const extra = contexts.filter((c) => !REQUIRED.includes(c));
console.log(`required on GitHub: ${contexts.join(", ") || "(none)"}`);
console.log(`strict (branch up to date): ${protection.required_status_checks?.strict ?? false}; enforce for admins: ${protection.enforce_admins?.enabled ?? false}`);
if (missing.length) console.error(`MISSING required checks: ${missing.join(", ")}`);
if (extra.length) console.warn(`required on GitHub but not in docs/ci-gate.md: ${extra.join(", ")}`);
process.exit(missing.length ? 1 : 0);
