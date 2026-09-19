/**
 * Where a link in an email points, and whether the page it opens can do
 * anything when it gets there.
 *
 * Both failures are silent from the server's side. A link to the wrong host
 * still renders as a link; a page on a host the CSRF guard doesn't trust still
 * loads, and only refuses when the person presses the button. Nothing bounces,
 * nothing logs, and the symptom is that people stop arriving.
 *
 * The specific bug behind the shared builder: `invite-routes.ts` preferred
 * `SERVER_BASE_URL` while verification and reset never read it, so with both
 * set an invite pointed somewhere the confirmation link didn't — and the invite
 * version added no scheme, so a bare host produced a relative link that opens
 * nothing.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import {
  publicBaseUrl, domainOf, hostOf, senderAlignment, emailLinkHostIsTrusted,
} from "../../server/public-url";

const env = { ...process.env };
afterEach(() => { process.env = { ...env }; });

/** Only the variables under test, so a developer's own .env can't change the answer. */
const only = (vars: Record<string, string | undefined>) => {
  for (const key of ["PUBLIC_URL", "SERVER_BASE_URL", "REPLIT_DOMAINS", "CSRF_TRUSTED_ORIGINS", "EMAIL_FROM"]) delete process.env[key];
  for (const [k, v] of Object.entries(vars)) if (v !== undefined) process.env[k] = v;
};

describe("the address email links are built from", () => {
  it("prefers PUBLIC_URL, because that is the host the CSRF guard trusts", () => {
    only({ PUBLIC_URL: "https://sparktower.app", SERVER_BASE_URL: "https://internal.example" });
    expect(publicBaseUrl()).toBe("https://sparktower.app");
  });

  it("gives a bare host a scheme — without one the link is relative and opens nothing", () => {
    only({ PUBLIC_URL: "sparktower.app" });
    expect(publicBaseUrl()).toBe("https://sparktower.app");
  });

  it("drops a trailing slash, so the link isn't built with two", () => {
    only({ PUBLIC_URL: "https://sparktower.app/" });
    expect(`${publicBaseUrl()}/verify-email`).toBe("https://sparktower.app/verify-email");
  });

  it("falls back to SERVER_BASE_URL, then Replit's domain", () => {
    only({ SERVER_BASE_URL: "https://a.example" });
    expect(publicBaseUrl()).toBe("https://a.example");
    only({ REPLIT_DOMAINS: "b.example,c.example" });
    expect(publicBaseUrl()).toBe("https://b.example");
  });

  it("uses the request's own host only when nothing is configured", () => {
    only({});
    expect(publicBaseUrl({ headers: { host: "localhost:5001" } })).toBe("http://localhost:5001");
    expect(publicBaseUrl({ headers: { "x-forwarded-host": "live.example", "x-forwarded-proto": "https" } }))
      .toBe("https://live.example");
  });

  /*
   * The regression the shared builder exists to prevent. These three are built
   * in three different files; before this they were three different functions.
   */
  it("gives the same answer to verification, invites and password reset", () => {
    only({ PUBLIC_URL: "https://sparktower.app", SERVER_BASE_URL: "https://someone-elses.example" });
    const base = publicBaseUrl();
    const verify = `${base}/verify-email?token=abc`;
    const invite = `${base}/invite/abc`;
    const reset = `${base}/reset-password?token=abc`;
    for (const link of [verify, invite, reset]) {
      expect(new URL(link).host, `${link} must be on the same host as the others`).toBe("sparktower.app");
      expect(link.startsWith("https://"), `${link} must be absolute`).toBe(true);
    }
  });
});

describe("the From address and the domain that was authenticated", () => {
  it("accepts a plain address and a Name <addr> form on the site's own domain", () => {
    only({ PUBLIC_URL: "https://sparktower.app", EMAIL_FROM: "hello@sparktower.app" });
    expect(senderAlignment().ok).toBe(true);
    only({ PUBLIC_URL: "https://sparktower.app", EMAIL_FROM: "SparkTower <hello@sparktower.app>" });
    expect(senderAlignment().ok).toBe(true);
  });

  it("accepts a sending subdomain, which is the normal arrangement", () => {
    only({ PUBLIC_URL: "https://sparktower.app", EMAIL_FROM: "SparkTower <hello@mail.sparktower.app>" });
    expect(senderAlignment().ok).toBe(true);
  });

  /*
   * The one that costs you every message: DMARC passes only when the visible
   * From domain is the domain SPF or DKIM authenticated. Records published for
   * the site do nothing for mail sent as somebody else's domain.
   */
  it("refuses a From on a domain that isn't the site's", () => {
    only({ PUBLIC_URL: "https://sparktower.app", EMAIL_FROM: "SparkTower <sparktower@gmail.com>" });
    const result = senderAlignment();
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/gmail\.com/);
    expect(result.reason).toMatch(/sparktower\.app/);
  });

  it("says so when EMAIL_FROM is unset or has no domain", () => {
    only({ PUBLIC_URL: "https://sparktower.app" });
    expect(senderAlignment()).toMatchObject({ ok: false, reason: "EMAIL_FROM is not set" });
    only({ PUBLIC_URL: "https://sparktower.app", EMAIL_FROM: "not-an-address" });
    expect(senderAlignment().ok).toBe(false);
  });

  /*
   * An unset EMAIL_FROM is reported by warnIfEmailUnconfigured, which names the
   * consequence. This one firing too produced "mail sent as null" underneath it.
   */
  it("says nothing at boot when EMAIL_FROM is simply absent", async () => {
    only({ PUBLIC_URL: "https://sparktower.app" });
    process.env.NODE_ENV = "production";
    const { warnIfSenderMisaligned } = await import("../../server/public-url");
    const errors: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...a) => { errors.push(a.join(" ")); });
    warnIfSenderMisaligned();
    spy.mockRestore();
    expect(errors, "an unset EMAIL_FROM is somebody else's message").toEqual([]);
  });

  it("does warn at boot when EMAIL_FROM is set to the wrong domain", async () => {
    only({ PUBLIC_URL: "https://sparktower.app", EMAIL_FROM: "SparkTower <hi@gmail.com>" });
    process.env.NODE_ENV = "production";
    const { warnIfSenderMisaligned } = await import("../../server/public-url");
    const errors: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...a) => { errors.push(a.join(" ")); });
    warnIfSenderMisaligned();
    spy.mockRestore();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/gmail\.com/);
    expect(errors[0]).not.toMatch(/null/);
  });

  it("doesn't call an unconfigured site a misalignment", () => {
    only({ EMAIL_FROM: "hello@sparktower.app" });
    expect(senderAlignment().ok).toBe(true);
  });

  it("reads the domain out of either form, and nothing out of nonsense", () => {
    expect(domainOf("SparkTower <hello@Example.COM>")).toBe("example.com");
    expect(domainOf("hello@example.com")).toBe("example.com");
    expect(domainOf("hello@localhost")).toBeNull();
    expect(domainOf(undefined)).toBeNull();
    expect(hostOf("https://sparktower.app/x")).toBe("sparktower.app");
    expect(hostOf("sparktower.app")).toBe("sparktower.app");
  });
});

describe("the host an email link opens, against the CSRF guard's trusted set", () => {
  it("passes when links point at PUBLIC_URL", () => {
    only({ PUBLIC_URL: "https://sparktower.app" });
    expect(emailLinkHostIsTrusted().ok).toBe(true);
  });

  /*
   * server/csrf.ts trusts PUBLIC_URL, REPLIT_DOMAINS and CSRF_TRUSTED_ORIGINS —
   * it has never read SERVER_BASE_URL. A deployment setting only that one sends
   * links to a host the guard doesn't know, and every form on the far end of a
   * link (confirm, accept invite, set a new password) is refused as cross-site.
   */
  it("catches links pointing somewhere the guard has never heard of", () => {
    only({ SERVER_BASE_URL: "https://mail-links.example", PUBLIC_URL: "https://sparktower.app" });
    // PUBLIC_URL wins, so this is still fine…
    expect(emailLinkHostIsTrusted().ok).toBe(true);
    // …but with only SERVER_BASE_URL set, the link host is outside the trusted set.
    only({ SERVER_BASE_URL: "https://mail-links.example", CSRF_TRUSTED_ORIGINS: "sparktower.app" });
    const result = emailLinkHostIsTrusted();
    expect(result.ok).toBe(false);
    expect(result.linkHost).toBe("mail-links.example");
    expect(result.reason).toMatch(/cross-site/);
  });

  it("is satisfied by CSRF_TRUSTED_ORIGINS naming the link host", () => {
    only({ SERVER_BASE_URL: "https://mail-links.example", CSRF_TRUSTED_ORIGINS: "mail-links.example" });
    expect(emailLinkHostIsTrusted().ok).toBe(true);
  });

  it("doesn't complain when nothing is configured — every host is the request's own", () => {
    only({});
    expect(emailLinkHostIsTrusted().ok).toBe(true);
  });
});
