/**
 * What the server checks about itself before it agrees to serve anything.
 *
 * The failure this exists to prevent is not a crash — a crash is obvious. It
 * is the deploy that comes up, reports itself healthy, and is quietly the
 * wrong thing: a database on somebody's laptop, a PUBLIC_URL pointing at
 * localhost so every emailed link goes nowhere, a session secret short enough
 * to guess. Each of those has a shape identical to a working deploy from the
 * outside, and each is discovered days later by a person who couldn't sign in.
 *
 * So in production this refuses to start, loudly, naming the variable and what
 * it breaks. A deploy that fails to boot gets looked at within minutes; a
 * deploy that boots wrong gets looked at when a user complains.
 *
 * It is deliberately narrow about what counts as fatal. Missing Stripe keys,
 * no email provider, no object storage — those turn real features off and are
 * printed in full at every boot, but they do not stop the server. Refusing to
 * serve the whole site to protect a feature that isn't configured yet is a
 * worse outage than the one it prevents.
 */
import { checkEnvironment, type EnvReport } from "@shared/env-requirements";

const line = "─".repeat(72);

/** What the environment says, ready to print. Separated from the exit so tests can read it. */
export function preflight(env: Record<string, string | undefined> = process.env): EnvReport {
  return checkEnvironment(env);
}

export function formatPreflight(report: EnvReport): string {
  const out: string[] = [];

  if (report.blocking.length) {
    out.push(line);
    out.push(`REFUSING TO START: ${report.blocking.length} required setting${report.blocking.length === 1 ? " is" : "s are"} missing or unsafe.`);
    out.push("");
    for (const f of report.blocking) out.push(`  ✖ ${f.name}: ${f.detail}`);
    out.push("");
    out.push("  Set these where this deployment reads its environment, then deploy again.");
    out.push("  The one place that says where that is: docs/ops/deploy.md");
    out.push("  To check before deploying:  npm run check:env");
    out.push(line);
    return out.join("\n");
  }

  if (report.degraded.length) {
    out.push(`[preflight] ${report.degraded.length} feature${report.degraded.length === 1 ? "" : "s"} off for want of configuration:`);
    for (const f of report.degraded) out.push(`  • ${f.name}: ${f.detail}`);
    out.push("  Everything else is running. Details: docs/ops/deploy.md");
  } else {
    out.push(`[preflight] Every required and optional setting is present${report.production ? " (production)" : ""}.`);
  }
  return out.join("\n");
}

/**
 * Runs the check and, in production, ends the process when something fatal is
 * wrong.
 *
 * Outside production nothing is fatal: a laptop has no PUBLIC_URL and no
 * object storage, and a checker that shouts about it every morning is a
 * checker people learn to scroll past.
 */
export function assertEnvironmentAtBoot(env: Record<string, string | undefined> = process.env): void {
  const report = preflight(env);
  const message = formatPreflight(report);

  if (report.production && report.blocking.length) {
    console.error(message);
    // Not a thrown error: a stack trace here buries the only part anyone needs
    // to read, and the platform prints it above the message.
    process.exit(1);
  }

  console.log(message);
}
