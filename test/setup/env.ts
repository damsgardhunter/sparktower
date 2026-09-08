/**
 * Loading `.env` for the test run.
 *
 * `npm run dev` gets this from `tsx --env-file=.env`; Vitest has no equivalent,
 * and Node 20 predates `process.loadEnvFile`. Rather than add a dependency for
 * fifteen lines, this reads the file directly.
 *
 * Existing variables always win, so CI — which sets DATABASE_URL in the
 * environment and ships no `.env` — is unaffected, and so is anyone who runs
 * the suite with an explicit TEST_DATABASE_URL in front of the command.
 */
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

export function loadEnvFile(file = ".env"): void {
  const path = resolve(process.cwd(), file);
  if (!existsSync(path)) return;

  for (const raw of readFileSync(path, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;

    const eq = line.indexOf("=");
    if (eq < 1) continue;

    const key = line.slice(0, eq).trim();
    if (key in process.env) continue;

    let value = line.slice(eq + 1).trim();
    // Strip one layer of matching quotes, the way a shell would.
    if (value.length > 1 && /^(".*"|'.*')$/s.test(value)) value = value.slice(1, -1);
    process.env[key] = value;
  }
}
