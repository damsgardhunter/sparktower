#!/usr/bin/env node
/**
 * Which dependencies have known holes, in a form a person will read.
 *
 * CI already fails on a high or critical advisory (`.github/workflows/ci.yml`),
 * which is the gate. This is the other half: the gate tells you *that* the
 * build is red, and `npm audit`'s own output is a wall that ends in
 * "37 vulnerabilities (12 moderate, 25 high)" with no sense of what to do
 * first. The codebase audit can't see any of it — advisories live in a registry,
 * not in the repository — so this is where you look before shipping.
 *
 * What it adds over `npm audit`:
 *
 *  - Direct dependencies first. A hole in something you chose is yours to fix;
 *    one twelve levels down usually waits for the package above it.
 *  - Whether a fix exists, and whether it is a breaking one. "No fix available"
 *    is a different decision from "one patch release away".
 *  - The workspaces (mobile/) as well as the root, because CI audits both and
 *    an advisory in the app people install on their phone is not a lesser one.
 *
 * Usage:
 *   node scripts/audit-dependencies.mjs           # everything
 *   node scripts/audit-dependencies.mjs --high    # only what CI fails on
 *   node scripts/audit-dependencies.mjs --json    # the merged record
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const ORDER = ["critical", "high", "moderate", "low", "info"];
const FAILS_CI = new Set(["critical", "high"]);
const onlyHigh = args.has("--high");

/** `npm audit --json` exits non-zero when it finds anything, which is not an error here. */
function audit(cwd, extra = []) {
  try {
    return JSON.parse(execFileSync("npm", ["audit", "--json", ...extra], { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));
  } catch (err) {
    const out = err.stdout?.toString?.() ?? "";
    if (out.trim().startsWith("{")) return JSON.parse(out);
    console.error(`Could not audit ${cwd}: ${err.shortMessage ?? err.message}`);
    return null;
  }
}

/** npm's v2 audit report, flattened to one row per advisory-bearing package. */
function rows(report) {
  return Object.values(report?.vulnerabilities ?? {}).map((v) => {
    const advisories = (v.via ?? []).filter((x) => typeof x === "object");
    return {
      name: v.name,
      severity: v.severity,
      direct: Boolean(v.isDirect),
      // A string in `via` means "vulnerable because of that package", not an advisory of its own.
      through: (v.via ?? []).filter((x) => typeof x === "string"),
      titles: advisories.map((a) => a.title),
      urls: advisories.map((a) => a.url),
      range: v.range,
      fix: v.fixAvailable === false ? null
        : v.fixAvailable === true ? { note: "npm audit fix" }
        : { to: `${v.fixAvailable.name}@${v.fixAvailable.version}`, breaking: Boolean(v.fixAvailable.isSemVerMajor) },
    };
  });
}

const places = [["root", root], ["mobile", join(root, "mobile")]].filter(([, dir]) => existsSync(join(dir, "package.json")));
const found = [];
for (const [label, dir] of places) {
  const report = audit(dir);
  if (!report) continue;
  /*
   * CI audits with `--omit=dev`, and it is right to: a path traversal in the
   * test runner's dev server is not a hole in the deployed app, and treating it
   * as one is how a gate gets switched off. So the same distinction is made
   * here rather than calling everything blocking — but the dev ones are still
   * printed, because a compromised build tool is how a supply-chain attack
   * reaches production.
   */
  const shipped = new Set(Object.keys(audit(dir, ["--omit=dev"])?.vulnerabilities ?? {}));
  found.push({ label, rows: rows(report).map((r) => ({ ...r, shipped: shipped.has(r.name) })) });
}

if (args.has("--json")) {
  console.log(JSON.stringify(found, null, 2));
  process.exit(0);
}

const blocks = (r) => FAILS_CI.has(r.severity) && r.shipped;

let blocking = 0;
for (const { label, rows: all } of found) {
  const shown = (onlyHigh ? all.filter((r) => FAILS_CI.has(r.severity)) : all)
    .sort((a, b) => Number(blocks(b)) - Number(blocks(a)) || Number(b.shipped) - Number(a.shipped) || Number(b.direct) - Number(a.direct)
      || ORDER.indexOf(a.severity) - ORDER.indexOf(b.severity) || a.name.localeCompare(b.name));
  blocking += all.filter(blocks).length;

  console.log(`\n${label} — ${all.length ? `${all.length} package${all.length === 1 ? "" : "s"} with advisories` : "nothing known against any dependency"}`);
  for (const r of shown) {
    const where = [r.direct ? "direct" : r.through.length ? `through ${r.through.slice(0, 2).join(", ")}` : "transitive", r.shipped ? "ships" : "dev only"].join(", ");
    const fix = r.fix === null ? "no fix published"
      : r.fix.to ? `fix: ${r.fix.to}${r.fix.breaking ? " (breaking — read the changelog)" : ""}`
      : "fix: npm audit fix";
    console.log(`  ${blocks(r) ? "✗" : "·"} ${r.severity.padEnd(8)} ${r.name}@${r.range}  [${where}]  ${fix}`);
    if (r.titles.length) console.log(`      ${r.titles[0]}${r.titles.length > 1 ? ` (+${r.titles.length - 1} more)` : ""}`);
    if (r.urls[0]) console.log(`      ${r.urls[0]}`);
  }
}

const devHigh = found.flatMap((f) => f.rows).filter((r) => FAILS_CI.has(r.severity) && !r.shipped).length;
console.log(
  blocking
    ? `\n${blocking} high or critical advisory in a package that ships — this is what fails CI. Fix, or if there is no fix, record the decision in docs/security/ and move on deliberately.`
    : `\nNothing high or critical in a package that ships: CI's dependency gate passes.`,
);
if (devHigh) {
  console.log(`${devHigh} more are high or critical in build and test tooling only (marked "dev only"). They don't reach production and don't fail CI — but they run on your machine and in CI with your tokens, so fix them on the next dependency pass rather than never.`);
}
// Reporting is the job; exiting non-zero is CI's. This always exits 0 so it can be read on the way past.
