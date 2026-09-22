/**
 * What stops a deploy, and what merely costs it a feature.
 *
 * Both halves matter and they fail in opposite directions. Too lax and a
 * deploy comes up "healthy" pointing at a database on somebody's laptop —
 * which has happened here once already. Too strict and the whole site refuses
 * to serve anyone because a Stripe key isn't set yet, which is a self-inflicted
 * outage in the name of safety.
 *
 * So these tests pin the line between them, and the environment-sensitivity
 * that makes the line correct: a localhost database is the right answer on a
 * laptop and a catastrophe in production, and a checker that can't tell the
 * difference is one people turn off.
 */
import { describe, it, expect } from "vitest";
import { checkEnvironment, ENV_RULES } from "@shared/env-requirements";
import { formatPreflight, preflight } from "../../server/preflight";

/** A production environment with nothing wrong in it, to vary one thing at a time from. */
const HEALTHY = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://user:pw@db.internal-host.example.com:5432/app",
  SESSION_SECRET: "x".repeat(48),
  PUBLIC_URL: "https://sparktower.app",
  RESEND_API_KEY: "re_live_something",
  EMAIL_FROM: "hello@sparktower.app",
  PRIVATE_OBJECT_DIR: "/bucket/private",
  STRIPE_SECRET_KEY: "sk_live_something",
  AI_INTEGRATIONS_OPENAI_API_KEY: "sk-something",
  MOBILE_TOKEN_SECRET: "y".repeat(48),
};

const blockingNames = (env: Record<string, string | undefined>) => checkEnvironment(env).blocking.map((f) => f.name);

describe("a production environment", () => {
  it("passes when everything it needs is there", () => {
    const report = checkEnvironment(HEALTHY);
    expect(report.blocking).toEqual([]);
    expect(report.degraded).toEqual([]);
  });

  it("refuses a database on this machine, which is the failure that already happened", () => {
    for (const local of ["postgresql://u:p@localhost:5432/app", "postgresql://u:p@127.0.0.1:5432/app", "postgres://u:p@db.internal/app"]) {
      const names = blockingNames({ ...HEALTHY, DATABASE_URL: local });
      expect(names, local).toContain("DATABASE_URL");
    }
    // The message has to say what it would look like, because the symptom is
    // "everything is fine" right up until the first query.
    const [finding] = checkEnvironment({ ...HEALTHY, DATABASE_URL: "postgresql://u:p@localhost:5432/app" }).blocking;
    expect(finding.detail).toMatch(/healthy/i);
  });

  it("refuses a public URL that isn't public, and says what it would break", () => {
    for (const bad of ["http://localhost:5000", "https://127.0.0.1", "https://app.local", "not-a-url"]) {
      expect(blockingNames({ ...HEALTHY, PUBLIC_URL: bad }), bad).toContain("PUBLIC_URL");
    }
    const [finding] = checkEnvironment({ ...HEALTHY, PUBLIC_URL: "http://localhost:5000" }).blocking;
    expect(finding.detail).toMatch(/link|callback/i);
  });

  it("accepts the other variable the code actually falls back to", () => {
    // server/public-url.ts reads these in turn; the rule has to agree with the
    // code, or it refuses a deploy that works.
    const env = { ...HEALTHY, PUBLIC_URL: "", SERVER_BASE_URL: "https://sparktower.app" };
    const report = checkEnvironment(env);
    expect(report.blocking.map((f) => f.name)).not.toContain("PUBLIC_URL");
    expect(report.findings.find((f) => f.name === "PUBLIC_URL")?.satisfiedBy).toBe("SERVER_BASE_URL");
  });

  it("is not satisfied by the address Render sets by itself", () => {
    /*
     * RENDER_EXTERNAL_URL was listed as an alternative and is not one. Render
     * sets it on every service without anybody choosing it, so accepting it
     * meant a production deploy with no address configured at all passed this
     * check — and then built every link from whatever host each request
     * arrived on, because nothing that builds a link reads that variable:
     * not publicBaseUrl, not the CSRF guard, not the Stripe webhook
     * registration at boot. It is also the wrong address, the onrender.com
     * one, which is the mismatch render.yaml records as having happened.
     */
    const env = { ...HEALTHY, PUBLIC_URL: "", RENDER_EXTERNAL_URL: "https://sparktower.onrender.com" };
    expect(blockingNames(env), "a Render deploy that sets nothing must not boot").toContain("PUBLIC_URL");
  });

  it("refuses a session secret that is short or published", () => {
    expect(blockingNames({ ...HEALTHY, SESSION_SECRET: "short" })).toContain("SESSION_SECRET");
    expect(blockingNames({ ...HEALTHY, SESSION_SECRET: "dev-session-secret" })).toContain("SESSION_SECRET");
    expect(blockingNames({ ...HEALTHY, SESSION_SECRET: "" })).toContain("SESSION_SECRET");
  });
});

describe("features that aren't configured", () => {
  it("are reported, and never stop the server", () => {
    // Everything optional missing at once: email, uploads, payments, Nova.
    const stripped = { ...HEALTHY, RESEND_API_KEY: "", EMAIL_FROM: "", PRIVATE_OBJECT_DIR: "", STRIPE_SECRET_KEY: "", AI_INTEGRATIONS_OPENAI_API_KEY: "", MOBILE_TOKEN_SECRET: "" };
    const report = checkEnvironment(stripped);

    expect(report.blocking).toEqual([]);
    expect(report.degraded.map((f) => f.name).sort()).toEqual(
      ["AI_INTEGRATIONS_OPENAI_API_KEY", "EMAIL_FROM", "MOBILE_TOKEN_SECRET", "PRIVATE_OBJECT_DIR", "RESEND_API_KEY", "STRIPE_SECRET_KEY"],
    );
    // Each says what a person would notice, not what the variable is called.
    for (const f of report.degraded) expect(f.detail, f.name).toBeTruthy();
  });

  it("say what they cost in terms someone can act on", () => {
    const email = ENV_RULES.find((r) => r.name === "RESEND_API_KEY")!;
    expect(email.breaks).toMatch(/confirm|reset|email/i);
    const storage = ENV_RULES.find((r) => r.name === "PRIVATE_OBJECT_DIR")!;
    expect(storage.breaks).toMatch(/upload|avatar/i);
  });
});

describe("a laptop", () => {
  it("is not held to production's rules", () => {
    // What a developer actually has: a local database, a short secret, no
    // public URL, no email, no storage, no Stripe.
    const laptop = { NODE_ENV: "development", DATABASE_URL: "postgresql://localhost:5432/project", SESSION_SECRET: "short-but-fine-here" };
    const report = checkEnvironment(laptop);
    expect(report.production).toBe(false);
    expect(report.blocking).toEqual([]);
  });

  it("is still refused a session secret the whole internet knows", () => {
    // Published values are refused everywhere: the point isn't the environment,
    // it's that the value is in this repository's history.
    expect(blockingNames({ NODE_ENV: "development", DATABASE_URL: "postgresql://localhost/app", SESSION_SECRET: "changeme" })).toContain("SESSION_SECRET");
  });

  it("is never told about production-only settings it has no business having", () => {
    const report = checkEnvironment({ NODE_ENV: "development", DATABASE_URL: "postgresql://localhost/app", SESSION_SECRET: "x".repeat(40) });
    const named = report.findings.map((f) => f.name);
    expect(named).not.toContain("PRIVATE_OBJECT_DIR");
    expect(named).not.toContain("STRIPE_SECRET_KEY");
    expect(named).not.toContain("PUBLIC_URL");
  });
});

describe("what the boot prints", () => {
  it("names every blocking variable and where to fix it", () => {
    const report = preflight({ ...HEALTHY, PUBLIC_URL: "", SESSION_SECRET: "short" });
    const text = formatPreflight(report);

    expect(text).toContain("REFUSING TO START");
    expect(text).toContain("PUBLIC_URL");
    expect(text).toContain("SESSION_SECRET");
    // The two things a person reading a failed deploy needs next.
    expect(text).toContain("docs/ops/deploy.md");
    expect(text).toContain("npm run check:env");
  });

  it("never prints a value", () => {
    const secret = "super-secret-value-nobody-should-see-0000";
    const text = formatPreflight(preflight({ ...HEALTHY, SESSION_SECRET: secret, DATABASE_URL: "postgresql://someone:hunter2@localhost:5432/app" }));
    expect(text).not.toContain(secret);
    expect(text).not.toContain("hunter2");
  });

  it("is quiet and non-fatal when only features are missing", () => {
    const text = formatPreflight(preflight({ ...HEALTHY, STRIPE_SECRET_KEY: "" }));
    expect(text).not.toContain("REFUSING TO START");
    expect(text).toMatch(/STRIPE_SECRET_KEY/);
  });
});

describe("addresses that must agree with each other", () => {
  it("catches an OAuth callback pointing somewhere the site isn't", () => {
    // The real case: production served sparktower.onrender.com while AUTH_HOST
    // sent Google's callback to sparktower.app, a parked domain. Every
    // individual variable was valid, and signing in with Google was broken for
    // everyone — which is exactly the class of failure a per-variable check
    // cannot see.
    const report = checkEnvironment({ ...HEALTHY, PUBLIC_URL: "https://sparktower.onrender.com", AUTH_HOST: "sparktower.app" });
    const finding = report.degraded.find((f) => f.name === "AUTH_HOST");
    expect(finding, "a mismatched auth host should be reported").toBeTruthy();
    expect(finding!.detail).toMatch(/google/i);
    // Broken sign-in is not a reason to refuse to serve the site.
    expect(report.blocking).toEqual([]);
  });

  it("is quiet when they agree, or when there's nothing to disagree with", () => {
    expect(checkEnvironment({ ...HEALTHY, PUBLIC_URL: "https://sparktower.app", AUTH_HOST: "sparktower.app" }).degraded).toEqual([]);
    // The common case: AUTH_HOST unset, so the callback follows PUBLIC_URL.
    expect(checkEnvironment(HEALTHY).degraded).toEqual([]);
  });
});
