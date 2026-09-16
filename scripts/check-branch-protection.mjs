#!/usr/bin/env node
/**
 * Compares what GitHub enforces on `main` with what docs/ci-gate.md says.
 *
 * Reading branch protection needs admin on the repository, so this runs from an
 * owner's machine with `gh` signed in — CI's own token can't read it, which is
 * why the gate can't be proven from inside the repository.
 *
 *   node scripts/check-branch-protection.mjs            # what's true today
 *   node scripts/check-branch-protection.mjs --launch   # what must be true before real users
 *
 * The difference is deliberate: while one person ships, admins push straight to
 * `main` and CI reports afterwards. Before launch that stops being acceptable,
 * and --launch is the check that says so.
 */
import { execFileSync } from "node:child_process";

const REQUIRED = ["server-web", "e2e", "secrets", "mobile", "packages", "dependencies", "codeql"];
const launchMode = process.argv.includes("--launch");

let protection;
try {
  protection = JSON.parse(execFileSync("gh", ["api", "repos/{owner}/{repo}/branches/main/protection"], { encoding: "utf8" }));
} catch (err) {
  console.error("Could not read branch protection (is `gh` signed in as an admin?):", String(err.stderr || err.message).trim());
  process.exit(2);
}

const contexts = protection.required_status_checks?.contexts ?? [];
const strict = protection.required_status_checks?.strict ?? false;
const admins = protection.enforce_admins?.enabled ?? false;
const forcePushes = protection.allow_force_pushes?.enabled ?? false;
const deletions = protection.allow_deletions?.enabled ?? false;

console.log(`required checks: ${contexts.join(", ") || "(none)"}`);
console.log(`enforced for admins: ${admins}  ·  branch must be up to date: ${strict}  ·  force pushes: ${forcePushes}  ·  branch deletable: ${deletions}`);

const problems = [];
const missing = REQUIRED.filter((c) => !contexts.includes(c));
if (missing.length) problems.push(`required checks missing from GitHub: ${missing.join(", ")}`);
// Force-pushing or deleting main would erase history the gate is there to protect.
if (forcePushes) problems.push("force pushes to main are allowed");
if (deletions) problems.push("main can be deleted");
if (launchMode && !admins) problems.push("not enforced for admins: an owner can still push straight to main, and the checks never run before it lands");

const extra = contexts.filter((c) => !REQUIRED.includes(c));
if (extra.length) console.warn(`required on GitHub but not in docs/ci-gate.md: ${extra.join(", ")}`);
if (!launchMode && !admins) {
  console.warn("note: not enforced for admins — an owner's push to main lands without the checks. Deliberate for now; `--launch` treats it as a failure.");
}
if (!strict) console.log("note: a pull request may merge on checks that ran against a slightly older main (strict off, deliberate — see docs/ci-gate.md).");

if (problems.length) {
  console.error(`\n${problems.length} problem${problems.length === 1 ? "" : "s"}:`);
  for (const p of problems) console.error(`- ${p}`);
  process.exit(1);
}
console.log(`\nBranch protection matches docs/ci-gate.md${launchMode ? " for launch" : ""}.`);
