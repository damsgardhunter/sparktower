#!/usr/bin/env node
/**
 * Writes one row of the release log in docs/release-checklist.md.
 *
 * The log is the evidence that the checklist is actually used, so the two ways
 * it usually rots are worth designing against:
 *
 *   - Rows written from memory, days later, with a rounded-off date and no way
 *     to check what CI said at the time. So the timestamp, the commit and the
 *     CI run URL are read from git and GitHub here, not typed.
 *   - A row that says the checklist was followed when the build was red. So
 *     this refuses to write a clean row unless the commit being deployed has a
 *     green CI run. Deploying anyway is allowed — that is sometimes the right
 *     call at 2am — but it is recorded as what it was, with `--force` and a
 *     reason that goes in the notes.
 *
 *   node scripts/release-log.mjs --notes "…"              # the usual case
 *   node scripts/release-log.mjs --notes "…" --dry-run    # print, write nothing
 *   node scripts/release-log.mjs --notes "…" --force      # red or unknown CI, deliberately
 *
 * It appends under the table header in docs/release-checklist.md, newest first.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const DOC = new URL("../docs/release-checklist.md", import.meta.url);
const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const has = (name) => argv.includes(`--${name}`);

const sh = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8" }).trim();

const commit = flag("commit") ?? sh("git", ["rev-parse", "HEAD"]);
const short = commit.slice(0, 8);
const notes = flag("notes");
if (!notes) {
  console.error('A note is required: --notes "what happened". "clean" is a fine note; silence is not.');
  process.exit(2);
}

/** Who is deploying, as git knows them. */
const deployer = (() => {
  try { return sh("git", ["config", "user.name"]) || "unknown"; } catch { return "unknown"; }
})();

/**
 * The CI run for this exact commit.
 *
 * By commit rather than "the latest run on main": the latest run may be for
 * something else entirely by the time a deploy happens, and a row that links
 * to a different commit's green build is worse than no link at all.
 */
function ciRun(sha) {
  try {
    const raw = sh("gh", [
      "api", `repos/{owner}/{repo}/actions/runs?head_sha=${sha}&per_page=20`,
      "--jq", '[.workflow_runs[] | select(.name == "ci") | {conclusion, status, url: .html_url, at: .created_at}] | first',
    ]);
    return raw && raw !== "null" ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

const run = ciRun(commit);
const green = run?.status === "completed" && run?.conclusion === "success";

if (!green && !has("force")) {
  const what = !run
    ? `no CI run found for ${short} (has it been pushed?)`
    : `CI for ${short} is ${run.status === "completed" ? run.conclusion : run.status}: ${run.url}`;
  console.error(`Refusing to write a release row: ${what}`);
  console.error("Deploying a commit CI hasn't passed is sometimes right. Record it as that, with --force and a note saying why.");
  process.exit(1);
}

// UTC, so rows from different machines sort against each other.
const when = new Date().toISOString().replace("T", " ").slice(0, 16) + "Z";
const ciCell = run ? `[${green ? "green" : (run.conclusion ?? run.status)}](${run.url})` : "—";
const followed = green && !has("force") ? "yes" : "**no — see notes**";
const row = `| ${when} | \`${short}\` | ${deployer} | ${ciCell} | ${followed} | ${notes.replace(/\|/g, "\\|")} |`;

if (has("dry-run")) {
  console.log(row);
  process.exit(0);
}

const doc = readFileSync(DOC, "utf8");
const header = "|---|---|---|---|---|---|";
if (!doc.includes(header)) {
  console.error("Couldn't find the release log table in docs/release-checklist.md — has its shape changed?");
  process.exit(2);
}
// Newest first, directly under the header. The placeholder row goes when the first real one arrives.
const placeholder = /\n\| — \| — \| — \| — \| — \|[^\n]*\n/;
let next = doc.replace(header, `${header}\n${row}`);
if (placeholder.test(next)) next = next.replace(placeholder, "\n");
writeFileSync(DOC, next);
console.log(`Recorded:\n${row}`);
