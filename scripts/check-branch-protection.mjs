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

/*
 * What the checks have actually been doing lately.
 *
 * The audit reads the workflow files and can't see a single run, so a `main`
 * that has been red for a week looks exactly like a green one. This asks.
 */
function recentRuns() {
  try {
    const raw = execFileSync("gh", [
      "api", "repos/{owner}/{repo}/actions/runs?branch=main&per_page=20",
      "--jq", "[.workflow_runs[] | select(.status == \"completed\") | {name: .name, conclusion: .conclusion, at: .created_at, url: .html_url}]",
    ], { encoding: "utf8" });
    return JSON.parse(raw);
  } catch {
    return null;
  }
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

const runs = recentRuns();
if (runs?.length) {
  const failed = runs.filter((r) => r.conclusion !== "success");
  const last = runs[0];
  console.log(`\nlast ${runs.length} completed runs on main: ${runs.length - failed.length} green, ${failed.length} not`);
  console.log(`most recent: ${last.name} — ${last.conclusion} (${last.at.slice(0, 10)})`);
  // Red on main is worth saying out loud, but it isn't a protection problem: it's a broken build.
  if (last.conclusion !== "success") console.error(`\nmain's most recent run did not pass: ${last.url}`);
  for (const r of failed.slice(0, 5)) console.warn(`- ${r.name} ${r.conclusion} ${r.at.slice(0, 10)} ${r.url}`);
} else if (runs) {
  console.log("\nno completed runs on main yet");
}

if (problems.length) {
  console.error(`\n${problems.length} problem${problems.length === 1 ? "" : "s"}:`);
  for (const p of problems) console.error(`- ${p}`);
  process.exit(1);
}
console.log(`\nBranch protection matches docs/ci-gate.md${launchMode ? " for launch" : ""}.`);
