/**
 * Every privileged route, called by people who shouldn't reach it.
 *
 * An audit of this codebase listed 36 admin endpoints that no test named. The
 * useful answer isn't 36 smoke tests — a smoke test proves a route answers, and
 * what matters about an admin route is who it *refuses*. So this drives every
 * `/api/admin/` route the scanner finds, as three callers who must all be
 * turned away, and fails on a route that lets any of them in.
 *
 * It's built from the route scan rather than a list, so a new admin route is
 * covered the day it's written, and a route that quietly loses its guard fails
 * here rather than in production.
 *
 * Because it builds its URLs from the scan, it names no path — so it says what
 * it drives, for the audit's untested-route summary (server/audit-evidence.ts):
 */
// covers-routes: ^/api/admin/
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { eq } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { db } from "../../server/db";
import { users } from "@shared/schema";
import { buildRouteCoverage } from "../../server/route-coverage";

afterAll(async () => { await closeTestApp(); });

/** The admin surface, as the scanner sees it — the same scan the audit reads. */
function adminRoutes() {
  const root = join(__dirname, "..", "..");
  const skip = new Set(["node_modules", ".git", "dist", "test-results", ".cache", ".local", "local_objects", "playwright-report", "client", "mobile", "packages", "e2e", "test"]);
  const walk = (d: string, out: string[] = []): string[] => {
    for (const name of readdirSync(d)) {
      if (skip.has(name)) continue;
      const p = join(d, name);
      statSync(p).isDirectory() ? walk(p, out) : out.push(p);
    }
    return out;
  };
  const files = walk(root).filter((p) => /\.ts$/.test(p)).map((p) => ({ path: p.slice(root.length + 1), size: 0, content: readFileSync(p, "utf8") }));
  return buildRouteCoverage(files).rows.filter((r) => r.mounted && r.path.startsWith("/api/admin/"));
}

let n = 0;
const ip = () => `198.51.114.${20 + (n++ % 200)}`;

async function account(app: any, first: string) {
  n += 1;
  const agent = request.agent(app);
  const email = `guards-${first.toLowerCase()}-${Date.now()}-${n}@example.test`;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", ip()).send({ email, password: "Testpass123!", firstName: first });
  expect(res.status).toBe(201);
  return { agent, id: res.body.id as string };
}

/** Real ids where the path wants one, so a 404 means "not for you" and not "no such row". */
const fill = (path: string) => path
  .replace(/:projectId\b/g, "00000000-0000-4000-8000-000000000001")
  .replace(/:userId\b/g, "00000000-0000-4000-8000-000000000002")
  .replace(/:logId\b/g, "00000000-0000-4000-8000-000000000003")
  .replace(/:type\b/g, "comment")
  .replace(/:\w+/g, "00000000-0000-4000-8000-000000000004");

const REFUSALS = [401, 403, 404];

/**
 * Admin paths that answer any signed-in caller, on purpose, with the reason.
 *
 * One route, and it's the one that tells you about yourself: the client asks
 * it whether *this* account is the owner so it knows whether to show the
 * console at all. A boolean about the caller, with nothing behind it. Anything
 * else appearing here is a guard that went missing.
 */
const ANSWERS_ANY_SIGNED_IN_CALLER: Record<string, string> = {
  "GET /api/admin/analytics/access": "answers whether you are the owner, so the client knows whether to offer the console; a boolean about the caller",
};

describe("who can reach the admin routes", () => {
  it("refuses every one of them to a signed-out caller, an ordinary account, and a reviewer who hasn't passed 2FA", async () => {
    const app = await getTestApp();
    const routes = adminRoutes();
    // The scan found the admin surface at all — otherwise this test would pass by testing nothing.
    expect(routes.length).toBeGreaterThan(25);

    const ordinary = await account(app, "Ordinary");
    const reviewer = await account(app, "Reviewer");
    await db.update(users).set({ platformRole: "reviewer" }).where(eq(users.id, reviewer.id));

    const callers: { who: string; send: (method: string, url: string) => request.Test }[] = [
      { who: "signed out", send: (m, url) => (request(app) as any)[m](url).set("x-forwarded-for", ip()) },
      { who: "an ordinary account", send: (m, url) => (ordinary.agent as any)[m](url).set("x-forwarded-for", ip()) },
      // A reviewer whose session never passed a second factor: the role is right, the session isn't (server/mfa.ts).
      { who: "a reviewer without 2FA", send: (m, url) => (reviewer.agent as any)[m](url).set("x-forwarded-for", ip()) },
    ];

    const allowed: string[] = [];
    for (const route of routes) {
      const method = route.method.toLowerCase();
      const url = fill(route.path);
      for (const caller of callers) {
        const res = await caller.send(method, url).send({});
        const label = `${route.method} ${route.path}`;
        // Signed out is always refused, even by the one route below.
        if (label in ANSWERS_ANY_SIGNED_IN_CALLER && caller.who !== "signed out") continue;
        if (!REFUSALS.includes(res.status)) {
          allowed.push(`${caller.who}: ${route.method} ${route.path} → ${res.status} ${JSON.stringify(res.body).slice(0, 120)} [${route.file}]`);
        }
      }
    }
    expect(allowed, "admin routes that answered someone who shouldn't reach them — guard it, or write it down in ANSWERS_ANY_SIGNED_IN_CALLER with why").toEqual([]);

    // And the exception is real: a list that rots is a hole nobody notices.
    for (const [label, why] of Object.entries(ANSWERS_ANY_SIGNED_IN_CALLER)) {
      const [method, path] = label.split(" ");
      expect(routes.some((r) => `${r.method} ${r.path}` === label), `${label} is listed as open but isn't a route any more`).toBe(true);
      const res = await (ordinary.agent as any)[method.toLowerCase()](fill(path)).set("x-forwarded-for", ip()).send({});
      expect(res.status, `${label} is listed as open (${why}) but refused an ordinary account`).toBeLessThan(400);
    }
  }, 300_000);

  it("says the same thing to a reviewer as to a stranger on the owner's routes — the role isn't confirmed to someone probing", async () => {
    const app = await getTestApp();
    const reviewer = await account(app, "Prober");
    await db.update(users).set({ platformRole: "reviewer" }).where(eq(users.id, reviewer.id));
    // The owner's console: a reviewer is not the owner, and the answer doesn't say so.
    const res = await reviewer.agent.get("/api/admin/analytics/summary").set("x-forwarded-for", ip());
    expect(REFUSALS).toContain(res.status);
    expect(JSON.stringify(res.body)).not.toMatch(/owner|role|privilege/i);
  });
});
