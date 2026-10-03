#!/usr/bin/env node
/**
 * The dependency gate: fail on a high or critical advisory, except the ones we
 * have looked at and written down.
 *
 * This replaces a bare `npm audit --omit=dev --audit-level=high` in CI, which has
 * one failure mode and it is not false alarms: when an advisory lands that nobody
 * can fix, the only ways out are to lower the threshold for *everything* or to
 * merge past a red check. Both of those quietly stop the gate working, and nobody
 * notices until something that mattered goes through.
 *
 * So an advisory can be accepted, but only out loud:
 *
 *  - It is named, with the reason, in `ACCEPTED` below.
 *  - It carries a date. Past that date the build fails again, so an exception has
 *    to be renewed by a person rather than inherited for ever.
 *  - If it stops matching anything — upstream patched it, the dependency went —
 *    the build *also* fails, so a stale exception cannot sit here pretending to
 *    still be load-bearing. That is the rule that keeps this list honest.
 *
 * Anything not on the list fails as before. The threshold is unchanged.
 *
 *   node scripts/audit-gate.mjs            # the gate, as CI runs it
 *   node scripts/audit-gate.mjs --report   # everything it saw, accepted or not
 *
 * `scripts/audit-dependencies.mjs` is the companion: this one decides, that one
 * explains, and it is the better thing to read before shipping.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const report = process.argv.includes("--report");

/** Audited separately, because CI audits both and an app on somebody's phone is not a lesser one. */
const WORKSPACES = [
  { name: "server + web", dir: root },
  { name: "mobile", dir: join(root, "mobile") },
];

const FAILS = new Set(["critical", "high"]);

/**
 * Advisories we have read, cannot fix, and have decided to carry.
 *
 * Both of the current two arrive through `expo` → `@expo/cli`: the command-line
 * tool that builds the app, not the app. Nothing in either package is bundled
 * into what anybody installs — `node-forge` is in the code-signing helper and
 * `braces` is inside the Metro file watcher — and both advisories have an
 * affected range of `*`, meaning no patched version exists to move to. npm's only
 * offered remedy is `expo@44.0.6`, which is SDK 44: a resolver artifact rather
 * than a fix, and three years of the product backwards.
 */
const ACCEPTED = [
  {
    id: "GHSA-86w9-cpqp-85rv",
    package: "node-forge",
    workspace: "mobile",
    expires: "2026-11-15",
    why: "RSA PKCS#1 v1.5 signature verification accepts extra nested DigestAlgorithm elements. "
      + "Reached only through @expo/cli → @expo/code-signing-certificates, which signs development "
      + "builds on a build machine; it verifies no signature at runtime and is not in the app bundle. "
      + "Affected range is every published version, so there is nothing to upgrade to.",
  },
  {
    id: "GHSA-vfj7-8cjw-p6xm",
    package: "braces",
    workspace: "mobile",
    expires: "2026-11-15",
    why: "Stack-exhaustion denial of service on a deeply nested glob. Reached only through "
      + "@expo/cli → @expo/metro-file-map → micromatch, which globs this repository's own files "
      + "while bundling. The input is our source tree, not anybody's request. Affected range is "
      + "every published version.",
  },
];

/** `npm audit --json` exits non-zero whenever it finds anything, which is not an error here. */
function audit(dir) {
  try {
    const out = execFileSync("npm", ["audit", "--omit=dev", "--json"], {
      cwd: dir, encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
    });
    return JSON.parse(out);
  } catch (err) {
    const out = err.stdout?.toString?.() ?? "";
    if (out.trim().startsWith("{")) return JSON.parse(out);
    throw new Error(`could not audit ${dir}: ${err.shortMessage ?? err.message}`);
  }
}

/** One row per advisory at or above the threshold: its GHSA id and what it came through. */
function findings(dir) {
  const seen = new Map();
  for (const [name, v] of Object.entries(audit(dir)?.vulnerabilities ?? {})) {
    if (!FAILS.has(v.severity)) continue;
    for (const via of v.via ?? []) {
      /* A string in `via` means "vulnerable because of that package", not an advisory of its own. */
      if (typeof via !== "object" || !via.url) continue;
      const id = via.url.split("/").pop();
      const row = seen.get(id) ?? { id, severity: via.severity ?? v.severity, title: via.title, packages: new Set() };
      row.packages.add(name);
      seen.set(id, row);
    }
  }
  return [...seen.values()];
}

const today = new Date().toISOString().slice(0, 10);
const problems = [];
const matched = new Set();

for (const workspace of WORKSPACES) {
  if (!existsSync(join(workspace.dir, "package.json"))) continue;
  const found = findings(workspace.dir);
  if (report) {
    console.log(`\n${workspace.name}: ${found.length || "no"} high or critical advisor${found.length === 1 ? "y" : "ies"}`);
    for (const f of found) console.log(`  ${f.id}  ${[...f.packages].join(", ")}\n    ${f.title ?? ""}`);
  }

  for (const f of found) {
    const accepted = ACCEPTED.find((a) => a.id === f.id && a.workspace === workspace.name);
    if (!accepted) {
      problems.push(`${workspace.name}: ${f.id} (${[...f.packages].join(", ")}) is ${f.severity} and is not accepted.\n`
        + `    ${f.title ?? ""}\n`
        + `    Fix it, or add it to ACCEPTED in scripts/audit-gate.mjs with a reason and a date.`);
      continue;
    }
    matched.add(`${accepted.workspace}:${accepted.id}`);
    if (accepted.expires < today) {
      problems.push(`${workspace.name}: the exception for ${f.id} expired on ${accepted.expires}.\n`
        + `    Check whether it is fixable now; if it still is not, move the date on purpose.`);
    }
  }
}

/*
 * The rule that keeps the list from rotting. An entry matching nothing means the
 * advisory is gone — upstream patched it, or the dependency did — and leaving it
 * here would mean the next person reads an exception that is no longer carrying
 * anything, and trusts the list less for it.
 */
for (const a of ACCEPTED) {
  if (!matched.has(`${a.workspace}:${a.id}`)) {
    problems.push(`${a.workspace}: the exception for ${a.id} (${a.package}) matches nothing any more.\n`
      + `    It has been fixed or the dependency has gone. Delete it from scripts/audit-gate.mjs.`);
  }
}

if (!problems.length) {
  const carried = ACCEPTED.map((a) => `${a.id} until ${a.expires}`).join(", ");
  console.log(`Dependencies: no unaccepted high or critical advisories.${carried ? `\nCarrying, on purpose: ${carried}` : ""}`);
  process.exit(0);
}

console.error("Dependencies: the gate is red.\n");
for (const p of problems) console.error(`  ${p}\n`);
console.error("The reasoning for each accepted advisory is in scripts/audit-gate.mjs.");
process.exit(1);
