/**
 * Does this environment have what the deployment needs?
 *
 * The same rules the server refuses to boot on (@shared/env-requirements),
 * asked from a terminal so the answer arrives before a deploy rather than
 * during one. Three places this is worth running:
 *
 *   npm run check:env                     — against .env, on a laptop
 *   npm run check:env -- --production     — the same file, judged by production's rules
 *   npm run check:env                     — in a shell on the production host, where
 *                                           the real environment is the one being read
 *
 * The second is the useful one before a release: a laptop is not production,
 * so by default the production-only rules are skipped, and `--production`
 * says "judge this as though it were the real thing".
 *
 * Values are never printed. Names, and whether they're set.
 */
import { readFileSync, existsSync } from "node:fs";
import { checkEnvironment, type EnvFinding } from "../shared/env-requirements";

const args = process.argv.slice(2);
const asProduction = args.includes("--production") || args.includes("--prod");
const quiet = args.includes("--quiet");

/**
 * Reads .env without a dependency, and without overriding anything already in
 * the environment — on the production host there is no .env file and
 * process.env is the whole truth.
 */
function loadDotEnv(path = ".env"): Record<string, string> {
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    out[key] = value;
  }
  return out;
}

const fileVars = loadDotEnv();
const env: Record<string, string | undefined> = { ...fileVars, ...process.env };
if (asProduction) env.NODE_ENV = "production";

const report = checkEnvironment(env);
const source = Object.keys(fileVars).length ? `.env (${Object.keys(fileVars).length} variables) plus the current shell` : "the current environment";

const mark = (f: EnvFinding) => (f.state === "ok" ? "✓" : f.severity === "fatal" ? "✖" : "•");
const width = Math.max(...report.findings.map((f) => f.name.length), 10);

if (!quiet) {
  console.log(`\nChecking ${source}, as ${report.production ? "PRODUCTION" : "development"}.\n`);
  for (const f of report.findings) {
    const via = f.satisfiedBy ? ` (via ${f.satisfiedBy})` : "";
    console.log(`  ${mark(f)} ${f.name.padEnd(width)}  ${f.state === "ok" ? `set${via}` : f.detail}`);
  }
  console.log("");
}

if (report.blocking.length) {
  console.error(`✖ ${report.blocking.length} required setting${report.blocking.length === 1 ? "" : "s"} missing or unsafe — a production boot would refuse to start.`);
  console.error(`  Where to set them: docs/ops/deploy.md\n`);
  process.exit(1);
}

if (report.degraded.length) {
  console.log(`${report.degraded.length} feature${report.degraded.length === 1 ? " is" : "s are"} off for want of configuration. Nothing blocks a deploy.`);
  console.log(`  What each one costs is listed above; the deploy path is in docs/ops/deploy.md\n`);
  // Not a failure: these are choices, and a release script shouldn't stop for them.
  process.exit(0);
}

console.log(`Everything this deployment needs is present.\n`);
