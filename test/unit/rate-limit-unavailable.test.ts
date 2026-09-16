/**
 * What the limiter does when it can't count.
 *
 * A database that won't answer must not become an open door on the actions
 * where unmetered traffic does real damage — password guessing, model spend,
 * money, uploads — and must not become a wall in front of someone writing a
 * comment. Those are opposite answers, so both are pinned here, along with the
 * shape of the refusal: a 503 that says the check failed, never a 429 that
 * tells a person they did too much.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { FAIL_CLOSED_ACTIONS, failsClosed, LIMIT_UNAVAILABLE, RATE_LIMITS, type RateLimitAction } from "@shared/moderation";

const down = () => { throw new Error("connection terminated unexpectedly"); };
vi.mock("../../server/db", () => ({
  db: { select: down, insert: down, update: down, delete: down, execute: down, transaction: down },
  pool: { query: down },
}));

const { withinRateLimit, enforceRateLimit } = await import("../../server/moderation");

function fakeRes() {
  const res: any = { statusCode: 0, body: null, headers: {} as Record<string, string>, req: null };
  res.setHeader = (k: string, v: string) => { res.headers[k.toLowerCase()] = v; };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  return res;
}

beforeEach(() => { vi.spyOn(console, "error").mockImplementation(() => {}); });

describe("a limiter that can't reach the database", () => {
  it("refuses the actions that mustn't run unmetered", async () => {
    for (const action of FAIL_CLOSED_ACTIONS) {
      const check = await withinRateLimit("user-1", action);
      expect(check, action).toMatchObject({ ok: false, unavailable: true });
      expect(check.retryAfterSeconds, action).toBeGreaterThan(0);
    }
  });

  it("lets ordinary writes through", async () => {
    for (const action of ["comment", "feedPost", "react", "follow", "message", "webhookReject"] as RateLimitAction[]) {
      expect(await withinRateLimit("user-1", action), action).toMatchObject({ ok: true, used: 0 });
      expect(failsClosed(action), action).toBe(false);
    }
  });

  it("answers 503 with a wait, not a 429 blaming the person", async () => {
    const res = fakeRes();
    expect(await enforceRateLimit(res, "user-1", "login")).toBe(false);
    expect(res.statusCode).toBe(503);
    expect(res.body).toMatchObject({ code: LIMIT_UNAVAILABLE, action: "login" });
    expect(res.body.message).toMatch(/try again/i);
    expect(res.body.message).not.toMatch(/too many|slow down/i);
    expect(res.headers["retry-after"]).toBe(String(res.body.retryAfterSeconds));

    const fine = fakeRes();
    expect(await enforceRateLimit(fine, "user-1", "comment")).toBe(true);
    expect(fine.statusCode).toBe(0);
  });

  it("names only actions that exist", () => {
    for (const action of FAIL_CLOSED_ACTIONS) expect(RATE_LIMITS[action], action).toBeTruthy();
  });
});
