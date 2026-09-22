/**
 * What this deployment needs in its environment, in one list.
 *
 * There were two copies of this knowledge and neither was authoritative: the
 * server read variables where it happened to need them, and a document listed
 * what someone remembered. A deploy could come up missing the thing that makes
 * emailed links work and look exactly like a deploy that hadn't.
 *
 * So the rules live here, as data, and two things read them: the boot
 * preflight (server/preflight.ts), which refuses to start production when
 * something fatal is missing, and `npm run check:env`, which answers the same
 * question from a terminal — including a shell on the production host.
 *
 * The distinction that matters is `fatal` versus `degraded`. Fatal means the
 * deployment is not the product: sessions can't be signed, the database is a
 * laptop, links point nowhere. Degraded means a real part of it is off and
 * everything else works — and that is deliberately NOT fatal, because a server
 * that refuses to boot over a missing Stripe key takes the whole site down to
 * protect a feature nobody was using yet.
 */

export type Severity = "fatal" | "degraded";

export interface EnvRule {
  /** The variable, or the first of a set where any one will do. */
  name: string;
  /** Others that satisfy the same need. The code's own fallback chains, written down. */
  alternatives?: string[];
  severity: Severity;
  /** What is broken without it — in terms of what a person would notice, not the variable's name. */
  breaks: string;
  /** Checked only when NODE_ENV is production; a laptop legitimately has none of these. */
  productionOnly?: boolean;
  /**
   * Returns a complaint when the value is present but wrong. Told which
   * environment it is judging, because the same value can be right in one and
   * catastrophic in the other — a database on localhost is correct on a
   * laptop and a broken deploy in production.
   */
  validate?: (value: string, ctx: { production: boolean }) => string | null;
}

const MIN_SECRET_LENGTH = 32;
/** Values published somewhere — this repository's own history included. */
const PUBLISHED = new Set(["dev-session-secret", "changeme", "change-me", "secret", "password", "your-secret-here"]);

const looksLocal = (host: string) =>
  host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "0.0.0.0" ||
  host.endsWith(".local") || host.endsWith(".localhost") || host.endsWith(".internal");

function checkSecret(value: string, ctx: { production: boolean }): string | null {
  if (PUBLISHED.has(value.trim().toLowerCase())) return "is a value published on the internet — anyone can forge sessions with it";
  // Length is a production rule: a short secret on a laptop signs a laptop's sessions.
  if (ctx.production && value.trim().length < MIN_SECRET_LENGTH) return `is shorter than ${MIN_SECRET_LENGTH} characters`;
  return null;
}

/**
 * A public URL that is actually public.
 *
 * This is the variable that breaks quietly. Everything a person receives from
 * this product is built from it — the confirm-your-email link, the reset link,
 * the share URL on a published artifact, the sitemap, the OAuth callback — so
 * a deploy carrying a development value doesn't fail, it sends people to a
 * machine that isn't on the internet, days after the deploy that did it.
 */
function checkPublicUrl(value: string): string | null {
  let url: URL;
  try { url = new URL(value.trim()); } catch { return `is not a URL ("${value.slice(0, 40)}") — it must be absolute, like https://sparktower.app`; }
  if (url.protocol !== "https:" && url.protocol !== "http:") return `is not an http(s) URL (${url.protocol}//…)`;
  if (looksLocal(url.hostname.toLowerCase().replace(/^\[|\]$/g, ""))) {
    return `points at ${url.hostname} — every emailed link, share URL and OAuth callback would send people to a machine that isn't on the internet`;
  }
  if (url.protocol === "http:") return "is http, so links sent to people would not be encrypted";
  return null;
}

/** A connection string for a database that isn't on this machine. */
function checkDatabaseUrl(value: string, ctx: { production: boolean }): string | null {
  let url: URL;
  try { url = new URL(value.trim()); } catch { return "is not a connection string this can parse"; }
  // On a laptop this is not only fine, it's the point.
  if (ctx.production && looksLocal(url.hostname.toLowerCase().replace(/^\[|\]$/g, ""))) {
    /*
     * This exact mistake has already happened once: the first deploy of this
     * app came up, announced itself live, answered /_health with a 200, and
     * failed every query — its DATABASE_URL still pointed at a database on
     * somebody's laptop. The server should not have started.
     */
    return `points at ${url.hostname}, which in production is a database that doesn't exist — this deploy would come up "healthy" and fail every query`;
  }
  return null;
}

export const ENV_RULES: EnvRule[] = [
  {
    name: "DATABASE_URL",
    severity: "fatal",
    breaks: "everything — there is no product without it",
    validate: checkDatabaseUrl,
  },
  {
    name: "SESSION_SECRET",
    severity: "fatal",
    breaks: "signing in; a weak or published value means anyone can forge a session for any account",
    validate: checkSecret,
  },
  {
    name: "PUBLIC_URL",
    /*
     * The fallback chain the code actually uses (server/public-url.ts).
     *
     * `RENDER_EXTERNAL_URL` used to be listed here and does not belong: nothing
     * that builds a link reads it — not publicBaseUrl, not the CSRF guard's
     * trusted origins, not the Stripe webhook registration at boot. Render sets
     * it on every service automatically, so listing it meant a production
     * deploy with no address configured at all passed this check, came up
     * healthy, and then built every link from whatever host each request
     * happened to arrive on. It is also the wrong address: it is the
     * onrender.com host, which is the exact mismatch render.yaml's PUBLIC_URL
     * comment records as having already happened once.
     */
    alternatives: ["SERVER_BASE_URL"],
    severity: "fatal",
    productionOnly: true,
    breaks: "every link this product sends anyone: confirm-your-email, password reset, invites, published artifact pages, the sitemap and OAuth callbacks",
    validate: checkPublicUrl,
  },
  {
    name: "MOBILE_TOKEN_SECRET",
    severity: "degraded",
    breaks: "nothing on its own — mobile access tokens fall back to a key derived from SESSION_SECRET — but rotating one then rotates the other",
    validate: checkSecret,
  },
  {
    name: "RESEND_API_KEY",
    severity: "degraded",
    productionOnly: true,
    breaks: "every email: nobody who signs up can confirm their address, and nobody who forgets a password can reset it",
  },
  {
    name: "EMAIL_FROM",
    severity: "degraded",
    productionOnly: true,
    breaks: "every email — the API key alone isn't enough to send one",
  },
  {
    name: "PRIVATE_OBJECT_DIR",
    severity: "degraded",
    productionOnly: true,
    breaks: "every image in the product, not just new uploads — avatars, covers, post media and anything Nova drew are all served through the object route, and without a bucket each one fails. On a phone a failed image is blank space with no error",
  },
  {
    name: "STRIPE_SECRET_KEY",
    severity: "degraded",
    productionOnly: true,
    breaks: "payments — subscriptions, backing and the webhook that records them",
  },
  {
    name: "AI_INTEGRATIONS_OPENAI_API_KEY",
    severity: "degraded",
    productionOnly: true,
    breaks: "Nova: the guide, plan generation, match reasons and every other AI feature",
  },
];

/**
 * The addresses in one deployment that have to agree with each other.
 *
 * Nothing here is missing or malformed — each value is individually fine — and
 * that is exactly why this check exists. The site can be served at one address
 * while Google sign-in sends people back to another, and every single-variable
 * check passes while sign-in is broken for everyone.
 *
 * This is not hypothetical: production served sparktower.onrender.com while
 * AUTH_HOST pointed the OAuth callback at sparktower.app, a domain that is
 * still a parked page. Google sent people back to nothing.
 */
function crossChecks(env: Record<string, string | undefined>, production: boolean): EnvFinding[] {
  if (!production) return [];
  const out: EnvFinding[] = [];

  const hostOf = (raw: string | undefined) => {
    if (!raw?.trim()) return null;
    try { return new URL(raw.trim().startsWith("http") ? raw.trim() : `https://${raw.trim()}`).host.toLowerCase(); } catch { return null; }
  };

  const siteVar = ["PUBLIC_URL", "SERVER_BASE_URL", "RENDER_EXTERNAL_URL"].find((n) => env[n]?.trim());
  const siteHost = hostOf(env[siteVar ?? ""]);
  const authHost = hostOf(env.AUTH_HOST);

  if (siteHost && authHost && siteHost !== authHost) {
    out.push({
      name: "AUTH_HOST",
      severity: "degraded",
      state: "invalid",
      detail: `is ${authHost} while the site is served at ${siteHost} (${siteVar}). Google sends people back to ${authHost}/api/auth/google/callback after they approve, so signing in with Google lands them on a host that isn't this app. Unset AUTH_HOST unless the callback genuinely belongs on another domain.`,
    });
  }
  return out;
}

export interface EnvFinding {
  name: string;
  /** The variable that actually supplied the value, when an alternative did. */
  satisfiedBy?: string;
  severity: Severity;
  state: "ok" | "missing" | "invalid";
  /** Present only when something is wrong: what a person should understand from it. */
  detail?: string;
}

export interface EnvReport {
  production: boolean;
  findings: EnvFinding[];
  /** Fatal problems. In production, the reason the server refuses to start. */
  blocking: EnvFinding[];
  /** Real features that are off. Loud, never fatal. */
  degraded: EnvFinding[];
}

/**
 * Reads an environment against the rules. Pure: takes the variables rather
 * than reaching for `process.env`, so a script, the server, and a test can all
 * ask the same question about different environments.
 */
export function checkEnvironment(env: Record<string, string | undefined>): EnvReport {
  const production = env.NODE_ENV === "production";
  const findings: EnvFinding[] = [];

  for (const rule of ENV_RULES) {
    if (rule.productionOnly && !production) continue;

    const candidates = [rule.name, ...(rule.alternatives ?? [])];
    const supplier = candidates.find((name) => (env[name] ?? "").trim() !== "");

    if (!supplier) {
      const also = rule.alternatives?.length ? ` (or ${rule.alternatives.join(", ")})` : "";
      findings.push({ name: rule.name, severity: rule.severity, state: "missing", detail: `not set${also}. Without it: ${rule.breaks}` });
      continue;
    }

    const complaint = rule.validate?.(env[supplier] as string, { production }) ?? null;
    findings.push(complaint
      ? {
        name: rule.name,
        satisfiedBy: supplier === rule.name ? undefined : supplier,
        severity: rule.severity,
        state: "invalid",
        detail: `${supplier} ${complaint}. What it affects: ${rule.breaks}`,
      }
      : { name: rule.name, satisfiedBy: supplier === rule.name ? undefined : supplier, severity: rule.severity, state: "ok" });
  }

  findings.push(...crossChecks(env, production));

  const bad = findings.filter((f) => f.state !== "ok");
  return {
    production,
    findings,
    blocking: bad.filter((f) => f.severity === "fatal"),
    degraded: bad.filter((f) => f.severity === "degraded"),
  };
}

/** The names a report covers, for anything that wants to show presence without values. */
export const ENV_NAMES = [...ENV_RULES.flatMap((r) => [r.name, ...(r.alternatives ?? [])]), "AUTH_HOST"];
