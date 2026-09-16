/**
 * What leaves the process when something breaks — and what must never.
 *
 * The risk in error reporting is the reporting: a drain that ships the request
 * body ships passwords, and a drain with no ceiling turns one bad minute into a
 * thousand alerts and a rate-limited webhook. So the tests are mostly about
 * restraint.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { FAKE_STRIPE_LIVE_KEY } from "../helpers/fake-secrets";
import { reportError, redact, resetErrorReporting } from "../../server/error-reporting";

const originalWebhook = process.env.ERROR_WEBHOOK_URL;
let sent: any[] = [];

beforeEach(() => {
  resetErrorReporting();
  sent = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: any) => {
    sent.push(JSON.parse(init.body));
    return { ok: true } as any;
  }));
  process.env.ERROR_WEBHOOK_URL = "https://hooks.example.test/drain";
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (originalWebhook === undefined) delete process.env.ERROR_WEBHOOK_URL;
  else process.env.ERROR_WEBHOOK_URL = originalWebhook;
});

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("what a report carries", () => {
  it("sends the route pattern, status and stack, and nothing anybody typed", async () => {
    const report = reportError(new TypeError("cannot read x of undefined"), {
      route: "/api/projects/:id/backings",
      method: "POST",
      userId: "user-7",
    });
    await flush();

    expect(report).toMatchObject({ kind: "TypeError", status: 500, route: "/api/projects/:id/backings", userId: "user-7" });
    expect(report!.stack).toContain("error-reporting.test");
    expect(sent).toHaveLength(1);
    expect(sent[0].route).toBe("/api/projects/:id/backings");
    // The drain's own summary line, for the chat apps that only read `text`.
    expect(sent[0].text).toContain("TypeError");
    // Nothing that could hold what somebody submitted.
    for (const key of ["body", "headers", "cookies", "query", "url", "ip"]) {
      expect(Object.keys(sent[0])).not.toContain(key);
    }
  });

  it("takes the credentials and addresses out of the message", () => {
    expect(redact("no user for casey@example.com")).toBe("no user for <email>");
    expect(redact(`Stripe refused ${FAKE_STRIPE_LIVE_KEY}`)).toBe("Stripe refused <key>");
    expect(redact("bad header Bearer eyJhbGciOi.payloadpayload.sig")).toMatch(/Bearer <token>|<jwt>/);
    expect(redact("connect postgresql://user:pw@host/db failed")).toBe("connect <connection-string> failed");
    // A long hex run is a session id, a token, or a hash — never something to ship.
    expect(redact("session 9f8e7d6c5b4a39281706f5e4d3c2b1a0 expired")).toBe("session <hex> expired");
  });

  it("says nothing about a 4xx: that's the caller's mistake, not a failure", async () => {
    const refused: any = new Error("Not found");
    refused.status = 404;
    expect(reportError(refused, { route: "/api/projects/:id" })).toBeNull();
    await flush();
    expect(sent).toHaveLength(0);
  });
});

describe("a storm", () => {
  it("folds identical errors into one report, whatever id was in the message", async () => {
    for (let i = 0; i < 25; i++) {
      reportError(new Error(`project 7f3a9c2b${i} not found on disk`), { route: "/api/projects/:id", method: "GET" });
    }
    await flush();
    expect(sent, "the same failure twenty-five times is one thing that is wrong, not twenty-five").toHaveLength(1);

    // A different failure on the same route is still its own report.
    reportError(new RangeError("offset out of range"), { route: "/api/projects/:id", method: "GET" });
    await flush();
    expect(sent).toHaveLength(2);
  });

  it("stops sending past the ceiling, and keeps logging", async () => {
    const logged = vi.spyOn(console, "error");
    for (let i = 0; i < 80; i++) {
      reportError(new Error(`distinct failure number ${String.fromCharCode(97 + (i % 26))}${i} here`), { route: `/api/thing-${i}` });
    }
    await flush();
    expect(sent.length).toBeLessThanOrEqual(60);
    expect(sent.length).toBeGreaterThan(50);
    expect(logged.mock.calls.some((c) => String(c[0]).includes("drain ceiling reached"))).toBe(true);
    // Everything is still on stderr for whatever is reading the logs.
    expect(logged.mock.calls.filter((c) => String(c[0]).startsWith("[error] {")).length).toBe(80);
  });
});

describe("when the drain itself is broken", () => {
  it("doesn't throw, and doesn't try to report the reporter", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("getaddrinfo ENOTFOUND hooks.example.test"); }));
    expect(() => reportError(new Error("something broke"), { route: "/api/x" })).not.toThrow();
    await flush();
    const complaints = (console.error as any).mock.calls.filter((c: any[]) => String(c[0]).includes("could not reach ERROR_WEBHOOK_URL"));
    expect(complaints).toHaveLength(1);
  });

  it("logs the record even with nowhere to send it", async () => {
    delete process.env.ERROR_WEBHOOK_URL;
    reportError(new Error("nowhere to send this"), { route: "/api/x" });
    await flush();
    expect(sent).toHaveLength(0);
    const line = (console.error as any).mock.calls.map((c: any[]) => String(c[0])).find((l: string) => l.startsWith("[error] {"));
    expect(JSON.parse(line.slice("[error] ".length)).message).toBe("nowhere to send this");
  });
});
