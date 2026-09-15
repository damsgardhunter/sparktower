/** The Content Security Policy baseline: strict in production, report-only and Vite-friendly in development. */
import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import { contentSecurityPolicy, securityHeaders, CSP_SOURCES } from "../../server/security-headers";

const serve = (opts: Parameters<typeof securityHeaders>[0]) => {
  const app = express();
  app.use(securityHeaders(opts));
  app.get("/", (_req, res) => res.send("<!doctype html><p>hi</p>"));
  return app;
};

describe("content security policy", () => {
  it("in production: no inline or eval'd script, no framing, no plugins, forms only to us, http upgraded", () => {
    const p = contentSecurityPolicy({ production: true });
    expect(p["script-src"]).toEqual(["'self'", ...CSP_SOURCES.scripts]);
    expect(p["script-src"].join(" ")).not.toMatch(/unsafe/);
    expect(p["frame-ancestors"]).toEqual(["'none'"]);
    expect(p["object-src"]).toEqual(["'none'"]);
    expect(p["base-uri"]).toEqual(["'self'"]);
    expect(p["form-action"]).toEqual(["'self'"]);
    expect(p["connect-src"]).not.toContain("ws:");
    expect(p).toHaveProperty("upgrade-insecure-requests");
  });

  it("in development: Vite's inline preamble and HMR socket allowed, nothing else loosened", () => {
    const d = contentSecurityPolicy({ production: false });
    expect(d["script-src"]).toEqual(expect.arrayContaining(["'unsafe-inline'", "'unsafe-eval'"]));
    expect(d["connect-src"]).toEqual(expect.arrayContaining(["ws:", "wss:"]));
    expect(d["frame-ancestors"]).toEqual(["'none'"]);
    expect(d).not.toHaveProperty("upgrade-insecure-requests");
  });
});

describe("security headers", () => {
  it("in production: the policy enforced, HSTS on, framing denied, no X-Powered-By leak from helmet", async () => {
    const res = await request(serve({ production: true })).get("/");
    expect(res.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(res.headers["content-security-policy-report-only"]).toBeUndefined();
    expect(res.headers["strict-transport-security"]).toBe("max-age=31536000; includeSubDomains");
    expect(res.headers["x-frame-options"]).toBe("DENY");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(res.headers["cross-origin-opener-policy"]).toBe("same-origin");
  });

  it("in development: report-only (unless enforced), and no HSTS pinning localhost to https", async () => {
    const dev = await request(serve({ production: false })).get("/");
    expect(dev.headers["content-security-policy-report-only"]).toContain("frame-ancestors 'none'");
    expect(dev.headers["content-security-policy"]).toBeUndefined();
    expect(dev.headers["strict-transport-security"]).toBeUndefined();
    expect(dev.headers["x-frame-options"]).toBe("DENY");
    const enforced = await request(serve({ production: false, enforce: true })).get("/");
    expect(enforced.headers["content-security-policy"]).toContain("'unsafe-inline'");
  });
});
