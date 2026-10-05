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
import { assertEnvironmentAtBoot, formatPreflight, preflight } from "../../server/preflight";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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
  /* The video model behind generated adverts. An API key, which is one of the
   * two credential shapes Kling accounts come in and satisfies both rules. */
  KLINGAI_API_KEY: "kling-something",
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

describe("the two shapes a Kling account comes in", () => {
  /*
   * The rule used to report a missing secret key on every deployment that
   * uses an API key — which is most of them, and this product's own — because
   * the secret half was its own unconditional rule.
   */
  it("is satisfied by an API key alone", () => {
    const report = checkEnvironment({ ...HEALTHY, KLINGAI_API_KEY: "kling-something" });
    expect(report.degraded.map((f) => f.name)).not.toContain("KLING_SECRET_KEY");
    expect(report.degraded.map((f) => f.name)).not.toContain("KLINGAI_API_KEY");
  });

  it("is satisfied by an access key and its secret", () => {
    const report = checkEnvironment({ ...HEALTHY, KLINGAI_API_KEY: "", KLING_ACCESS_KEY: "ak", KLING_SECRET_KEY: "sk" });
    expect(report.degraded.map((f) => f.name)).toEqual([]);
  });

  it("still catches an access key with no secret beside it, which signs nothing", () => {
    const report = checkEnvironment({ ...HEALTHY, KLINGAI_API_KEY: "", KLING_ACCESS_KEY: "ak" });
    expect(report.degraded.map((f) => f.name)).toContain("KLING_SECRET_KEY");
    /* The access key on its own satisfies the first rule — it is the pair that is broken. */
    expect(report.degraded.map((f) => f.name)).not.toContain("KLINGAI_API_KEY");
  });
});

describe("features that aren't configured", () => {
  it("are reported, and never stop the server", () => {
    // Everything optional missing at once: email, uploads, payments, Nova.
    const stripped = { ...HEALTHY, RESEND_API_KEY: "", EMAIL_FROM: "", PRIVATE_OBJECT_DIR: "", STRIPE_SECRET_KEY: "", AI_INTEGRATIONS_OPENAI_API_KEY: "", MOBILE_TOKEN_SECRET: "", KLINGAI_API_KEY: "" };
    const report = checkEnvironment(stripped);

    expect(report.blocking).toEqual([]);
    expect(report.degraded.map((f) => f.name).sort()).toEqual(
      ["AI_INTEGRATIONS_OPENAI_API_KEY", "EMAIL_FROM", "KLINGAI_API_KEY", "KLING_SECRET_KEY", "MOBILE_TOKEN_SECRET", "PRIVATE_OBJECT_DIR", "RESEND_API_KEY", "STRIPE_SECRET_KEY"],
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

/*
 * The page people read before a deploy, held to the rules the server enforces.
 *
 * `docs/env-contract.md` had drifted from this module in two ways that both
 * mislead in the direction of a broken deploy. It listed
 * `AI_INTEGRATIONS_OPENAI_API_KEY` under "Required to boot" when the rule here
 * makes it `degraded` — so an operator reading it would believe an expired AI
 * key takes the site down, and might take the site down themselves getting a
 * fresh one in. And it recorded `PUBLIC_URL` in production as the onrender.com
 * host while the live value is the apex domain: the same stale-copy-of-an-
 * operational-fact that render.yaml's PUBLIC_URL comment exists to record,
 * repeated one file over.
 *
 * Nothing caught either, because a document cannot be wrong in a way a test
 * suite notices unless something compares it to the code. This does. It reads
 * the fatal table out of the prose and asserts it is exactly the set of fatal
 * rules — so adding a rule here, or changing one's severity, fails until the
 * page is updated with it.
 */
describe("the deploy page and the rules it describes", () => {
  const contract = readFileSync(resolve(import.meta.dirname, "../../docs/env-contract.md"), "utf8");

  /** The variables named in backticked cells of the "Required to boot" fatal table. */
  const documentedFatal = () => {
    const section = contract.split("## Required to boot")[1]?.split(/\n## /)[0] ?? "";
    const rows = section.split("\n").filter((l) => l.startsWith("| `"));
    return rows.map((l) => l.match(/^\| `([A-Z0-9_]+)`/)?.[1]).filter((n): n is string => Boolean(n));
  };

  it("names every variable that stops a boot, and nothing that only costs a feature", () => {
    const fatal = ENV_RULES.filter((r) => r.severity === "fatal").map((r) => r.name);
    expect([...documentedFatal()].sort(), "docs/env-contract.md's fatal table has drifted from ENV_RULES").toEqual([...fatal].sort());
  });

  it("does not file a degraded variable under a heading that says the boot needs it", () => {
    const degraded = ENV_RULES.filter((r) => r.severity === "degraded").map((r) => r.name);
    for (const name of documentedFatal()) {
      expect(degraded, `${name} is degraded, but the page lists it as required to boot`).not.toContain(name);
    }
  });

  /*
   * The address is the one value in here that is an operational fact rather
   * than a property of the repository, so it is the one that goes stale. Both
   * pages that state it have to agree with each other; which of them is right
   * is a question for whoever last moved DNS, and `npm run check:live` is how
   * they settle it against the running service.
   */
  it("states the same production address as the deploy runbook", () => {
    const deploy = readFileSync(resolve(import.meta.dirname, "../../docs/ops/deploy.md"), "utf8");
    const canonical = deploy.match(/\*\*Canonical\*\*\s*\|\s*`(https:\/\/[^`]+)`/)?.[1];
    expect(canonical, "docs/ops/deploy.md no longer marks a canonical URL").toBeTruthy();

    /*
     * The row under "The site's own address", not the one-line summary of it in
     * the fatal table above — two rows name this variable, and only one of them
     * is where the value is recorded.
     */
    const section = contract.split("## The site's own address")[1]?.split(/\n## /)[0] ?? "";
    const row = section.split("\n").find((l) => l.startsWith("| `PUBLIC_URL`"));
    expect(row, "docs/env-contract.md no longer has a PUBLIC_URL row").toBeTruthy();
    expect(row, `the runbook says production is ${canonical}`).toContain(`\`${canonical}\``);
  });
});

/*
 * A production boot that came up with features off has to say so somewhere
 * that outlives the boot.
 *
 * It was a single `console.log`. On a platform that is a line in a log nobody
 * is reading at the time, gone when retention rolls — and `RESEND_API_KEY`
 * missing is not cosmetic: every confirm-your-email link goes to the server
 * log instead of the person, so nobody who signs up can post, comment,
 * message or invite. The site is up and the front door is shut.
 *
 * The fatal path is not exercised here on purpose: it calls `process.exit`,
 * and a test that trips it takes the runner with it.
 */
describe("a production boot with features off", () => {
  const withoutEmail = () => {
    const env: Record<string, string | undefined> = { ...HEALTHY };
    delete env.RESEND_API_KEY;
    delete env.EMAIL_FROM;
    return env;
  };

  it("announces which features, down the channel that already exists for things nobody is watching", () => {
    const seen: { features: string[]; detail: string }[] = [];
    assertEnvironmentAtBoot(withoutEmail(), (features, detail) => seen.push({ features, detail }));

    expect(seen.length, "exactly one notice, at boot").toBe(1);
    expect(seen[0].features, "names the variable, so the fix is obvious").toContain("RESEND_API_KEY");
    expect(seen[0].detail, "and carries what it breaks, not just the name").toMatch(/email|confirm|sign|link/i);
  });

  it("says nothing when production has everything it needs", () => {
    const seen: string[][] = [];
    assertEnvironmentAtBoot({ ...HEALTHY }, (features) => seen.push(features));
    expect(seen, "a healthy boot is not worth waking anyone for").toEqual([]);
  });

  /*
   * A laptop has no email provider, no object storage and no Stripe keys, and
   * is meant to look exactly like this. A warning that fires every morning is
   * one people learn to scroll past, which is how the real one gets missed.
   */
  it("says nothing outside production, where looking like this is the point", () => {
    const seen: string[][] = [];
    const env = withoutEmail();
    env.NODE_ENV = "development";
    assertEnvironmentAtBoot(env, (features) => seen.push(features));
    expect(seen).toEqual([]);
  });
});
