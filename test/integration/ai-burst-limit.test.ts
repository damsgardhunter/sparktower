/**
 * One burst budget across every kind of AI call.
 *
 * Paid AI goes through requireCredits, which refuses past the limit. Optional
 * AI — the extra a route can do without, like Nova's reasons on a match — goes
 * through reserveOptionalAi, which doesn't refuse the request: it just doesn't
 * run the model. Two different answers to being over the limit, and the risk is
 * that they end up counting against two different budgets, which would make the
 * limit meaningless. They don't, and this holds them to it.
 *
 * The free routes are here too: the interview verdict costs no credits (the
 * questions were paid for), so the burst limiter is the only thing standing
 * between it and a script.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { getTestApp, closeTestApp } from "../helpers/app";
import { reserveOptionalAi } from "../../server/entitlements";
import { enforceRateLimit, withinRateLimit } from "../../server/moderation";
import { buildRouteCoverage } from "../../server/route-coverage";
import { RATE_LIMITS } from "@shared/moderation";
import { readFileSync } from "fs";
import { execSync } from "child_process";
import { serverSourceFiles } from "../helpers/server-files";

afterAll(async () => { await closeTestApp(); });

let n = 0;
async function person(app: any) {
  n += 1;
  const agent = request.agent(app);
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", `198.51.106.${10 + n}`)
    .send({ email: `burst-${Date.now()}-${n}@example.test`, password: "Testpass123!", firstName: "Burst" });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

function fakeRes() {
  const res: any = { statusCode: 0, body: null, headers: {} as Record<string, string>, req: null };
  res.setHeader = (k: string, v: string) => { res.headers[k.toLowerCase()] = v; };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  return res;
}

describe("the AI burst limit", () => {
  it("counts optional AI against the same budget as paid AI, and refuses differently", async () => {
    const app = await getTestApp();
    const userId = await person(app);
    const max = RATE_LIMITS.ai.max;

    // Optional AI, up to the limit: allowed, and each use is counted.
    for (let i = 0; i < max; i++) {
      expect(await reserveOptionalAi(userId, 0), `optional AI call ${i + 1}`).toBe(true);
    }
    expect((await withinRateLimit(userId, "ai")).used).toBeGreaterThanOrEqual(max);

    // Past it, optional AI says no — without writing a response, because the route still works without it.
    expect(await reserveOptionalAi(userId, 0)).toBe(false);

    // And the same budget is what a paid route sees: it refuses outright, with the wait.
    const res = fakeRes();
    expect(await enforceRateLimit(res, userId, "ai")).toBe(false);
    expect(res.statusCode).toBe(429);
    expect(res.body).toMatchObject({ code: "rate_limited", action: "ai" });
    expect(Number(res.headers["retry-after"])).toBeGreaterThan(0);

    // Someone else's budget is their own.
    const other = await person(app);
    expect(await reserveOptionalAi(other, 0)).toBe(true);
  });

  it("holds the free AI routes to the burst limit, since credits aren't holding them", async () => {
    // What is on disk, not what git tracks — see test/helpers/server-files.ts.
    const coverage = buildRouteCoverage(serverSourceFiles().map((f) => ({ ...f, size: 1 })) as any);
    const free = coverage.rows.filter((r) => r.cost && !r.credits && r.mounted !== false);
    // Every AI route that isn't credit-metered carries its own limiter: nothing costly is left on the write floor alone.
    for (const route of free) {
      expect(route.rateLimited, `${route.method} ${route.path} [${route.file}] is AI-backed and free — it needs its own limiter`).toBe(true);
    }
    // The one the audit asks about, by name.
    const verdict = coverage.rows.find((r) => r.path === "/api/mock-interviews/:id/finish");
    expect(verdict).toMatchObject({ rateLimited: true, auth: true });
  });
});
