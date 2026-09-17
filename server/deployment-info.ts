/**
 * Which build is running, at what address, and does it work — for the owner.
 *
 * Everything here is a fact the process can see about itself. That is a real
 * limit and the card that reads this says so: "the database answered me" is
 * not "the site is reachable from the internet", and nothing in this file can
 * tell the difference. It is not an uptime monitor and must not be read as one.
 *
 * The two questions it exists to answer quickly after a redeploy:
 *
 *   - Is this the build I just pushed? (the platform's commit, when it sets one)
 *   - Is PUBLIC_URL right? An unset or localhost PUBLIC_URL doesn't break
 *     anything visibly — it silently poisons every emailed link, every share
 *     URL and every OAuth callback until someone notices people can't get
 *     back in. So it is reported as a fault, not as a blank.
 *
 * On secrets: this route reports the *presence* of environment variables and
 * nothing else. No value, no prefix, no suffix, no length, no hash — an admin
 * page is still a screenshot waiting to happen, and a length is a clue. The
 * one value that is printed is the public base URL, which is the address the
 * site hands to strangers in emails.
 */
import type { Express } from "express";
import { pool } from "./db";
import { redact } from "./error-reporting";
import { isAuthenticated } from "./replit_integrations/auth/replitAuth";
import { requireOwner } from "./platform-roles";
import { publicBaseUrl } from "./public-url";

/**
 * What the deploy needs set, and what goes wrong when it isn't.
 *
 * `required` means the deployment is broken without it; the rest turn a
 * feature off rather than the site. Names only ever travel with a boolean.
 */
const ENV_CHECKS: { name: string; required: boolean; what: string }[] = [
  { name: "DATABASE_URL", required: true, what: "Every query. Without it nothing works at all." },
  { name: "SESSION_SECRET", required: true, what: "Signs session cookies. Changing or losing it signs everyone out." },
  { name: "MOBILE_TOKEN_SECRET", required: true, what: "Signs mobile refresh tokens." },
  { name: "PUBLIC_URL", required: true, what: "The address in every emailed link, share URL and OAuth callback." },
  { name: "RESEND_API_KEY", required: false, what: "Sending mail. Without it, verification and password resets never arrive." },
  { name: "EMAIL_FROM", required: false, what: "The address mail is sent as." },
  { name: "PRIVATE_OBJECT_DIR", required: false, what: "Where uploads are stored." },
  { name: "STRIPE_SECRET_KEY", required: false, what: "Payments. Without it checkout is off." },
  { name: "AI_INTEGRATIONS_OPENAI_API_KEY", required: false, what: "Nova and every AI feature." },
];

/** Set means set to something non-blank. A variable set to spaces is not set. */
const isSet = (name: string) => Boolean(process.env[name]?.trim());

export interface PublicUrlFact {
  /** The base URL the server would put in an email right now. */
  url: string;
  /** Which variable it came from, or "request" when nothing is configured. */
  source: "PUBLIC_URL" | "SERVER_BASE_URL" | "REPLIT_DOMAINS" | "request";
  absolute: boolean;
  https: boolean;
  localhost: boolean;
  /** Configured, absolute, https, not localhost. Anything else is a fault. */
  ok: boolean;
  /** One sentence naming what is wrong, or null. */
  problem: string | null;
}

/**
 * The address this deployment believes it has.
 *
 * The order of preference is `publicBaseUrl`'s and not a second copy of it —
 * that function is what actually builds the links, so anything else here would
 * be reporting on a different deployment than the one people receive mail from.
 * This adds only the judgement: is what it returned a real public address?
 */
export function publicUrlFact(req?: any): PublicUrlFact {
  const source: PublicUrlFact["source"] =
    process.env.PUBLIC_URL?.trim() ? "PUBLIC_URL"
    : process.env.SERVER_BASE_URL?.trim() ? "SERVER_BASE_URL"
    : process.env.REPLIT_DOMAINS?.trim() ? "REPLIT_DOMAINS"
    : "request";
  const url = publicBaseUrl(req);
  let host = "";
  let protocol = "";
  try {
    const parsed = new URL(url);
    host = parsed.hostname.toLowerCase();
    protocol = parsed.protocol;
  } catch { /* leaves host empty, which reads as not absolute below */ }

  const absolute = Boolean(host);
  const https = protocol === "https:";
  const localhost = /^(localhost|127\.|0\.0\.0\.0|\[::1\]|::1$)/.test(host);
  const configured = source !== "request";

  const problem =
    !configured ? "PUBLIC_URL is not set, so links are built from whatever host each request arrived on. Emailed links, share URLs and OAuth callbacks will point wherever the last caller came from."
    : !absolute ? "PUBLIC_URL isn't a URL this process can parse, so every link built from it is broken."
    : localhost ? `PUBLIC_URL points at ${host} — a link to it only works on the machine running the server. Every emailed link is dead for everyone else.`
    : !https ? `PUBLIC_URL is http, not https (${host}). Browsers will refuse the secure session cookie on it.`
    : null;

  return {
    url,
    source,
    absolute,
    https,
    localhost,
    // Outside production a missing PUBLIC_URL is ordinary, and the card says
    // so rather than shouting; it is still not ok, because the link it builds
    // is still wrong for anyone who isn't on this machine.
    ok: configured && absolute && https && !localhost,
    problem,
  };
}

/**
 * What the platform says it deployed, when there is a platform.
 *
 * Render sets these on every service; a laptop sets none of them, and that is
 * a legitimate answer rather than a failure — the card shows "not reported".
 */
export function buildIdentity() {
  const commit = process.env.RENDER_GIT_COMMIT || process.env.RELEASE_SHA || process.env.GITHUB_SHA || null;
  const platform =
    process.env.RENDER === "true" || process.env.RENDER_SERVICE_ID ? "render"
    : process.env.REPLIT_DOMAINS ? "replit"
    : null;
  return {
    platform,
    commit,
    commitShort: commit ? commit.slice(0, 7) : null,
    branch: process.env.RENDER_GIT_BRANCH || null,
    service: process.env.RENDER_SERVICE_NAME || null,
    /*
     * The platform's own address for this service. Kept apart from the public
     * URL on purpose: when the two disagree, the deployment is reachable at an
     * address it never tells anybody about, which is worth seeing.
     */
    externalUrl: process.env.RENDER_EXTERNAL_URL || null,
    instance: process.env.RENDER_INSTANCE_ID || null,
  };
}

/**
 * `/_ready`'s question, asked here rather than over HTTP.
 *
 * Deliberately not `fetch("/_ready")`: a single-worker instance answering this
 * request would have to answer its own second request first, which it cannot,
 * so the page would hang exactly when the server is busiest. Same pool, same
 * query, same redaction as server/app.ts.
 */
export async function readiness(): Promise<{ ready: boolean; database: "ok" | "unreachable"; ms: number; detail: string | null }> {
  const started = Date.now();
  try {
    await pool.query("SELECT 1");
    return { ready: true, database: "ok", ms: Date.now() - started, detail: null };
  } catch (err) {
    const message = String((err as Error)?.message ?? err);
    // Redacted, because the message is usually the connection string.
    return { ready: false, database: "unreachable", ms: Date.now() - started, detail: redact(message).slice(0, 200) };
  }
}

export function registerDeploymentRoutes(app: Express) {
  app.get("/api/admin/deployment", isAuthenticated, requireOwner, async (req: any, res) => {
    try {
      const ready = await readiness();
      const env = ENV_CHECKS.map(({ name, required, what }) => ({ name, required, what, set: isSet(name) }));
      const publicUrl = publicUrlFact(req);
      const uptimeSeconds = Math.floor(process.uptime());

      res.json({
        checkedAt: new Date().toISOString(),
        nodeEnv: process.env.NODE_ENV ?? "development",
        uptimeSeconds,
        startedAt: new Date(Date.now() - uptimeSeconds * 1000).toISOString(),
        publicUrl,
        build: buildIdentity(),
        /*
         * `/_health` asks whether this process is alive and answering. Asked
         * from inside that process the answer is yes by construction — the
         * value of saying so is that the card can show the same two states the
         * platform sees, and be honest that the shallow one proves very little.
         */
        health: { ok: true, note: "This process is running and answered. /_health asks nothing else." },
        ready,
        env,
        missingRequired: env.filter((e) => e.required && !e.set).map((e) => e.name),
        /*
         * Said in the payload as well as on the card, so it travels with a
         * copied response: everything above is what one process can see about
         * itself, from inside itself.
         */
        scope: "in-process: this reports what the running server can see about itself, not whether the site is reachable from outside",
      });
    } catch (error) {
      console.error("Deployment info error:", error);
      res.status(500).json({ message: "Couldn't read this deployment's state" });
    }
  });
}
