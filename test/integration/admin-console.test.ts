/**
 * The owner's and reviewers' own screens, actually called.
 *
 * `admin-guards.test.ts` proves nobody else reaches these. This proves they
 * work for the people they're for: an audit listed them as named by no test,
 * and a console nobody drives is a 500 waiting for the morning something goes
 * wrong — which is the morning you need it.
 *
 * Two are deliberately not driven here, because calling them reaches outward:
 * `POST /api/admin/promotions/refresh` starts a sync of the whole catalog, and
 * `POST /api/admin/promotions/:id/refresh` fetches one company's site. The
 * second is driven with an id that isn't in the catalog, which is refused
 * before any of that; both are covered as guarded by the guards test.
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { passMfa } from "../helpers/mfa";
import { verifyEmail } from "../helpers/verify-email";
import { db } from "../../server/db";
import { users } from "@shared/schema";

let ownerEmail = "";
const previousOwner = process.env.PLATFORM_OWNER_EMAIL;
beforeAll(() => { ownerEmail = `console-owner-${Date.now()}@example.test`; process.env.PLATFORM_OWNER_EMAIL = ownerEmail; });
afterAll(async () => {
  if (previousOwner === undefined) delete process.env.PLATFORM_OWNER_EMAIL;
  else process.env.PLATFORM_OWNER_EMAIL = previousOwner;
  await closeTestApp();
});

let n = 0;
const ip = () => `198.51.115.${20 + (n++ % 200)}`;

async function person(app: any, first: string, email?: string) {
  n += 1;
  const agent = request.agent(app);
  const address = email ?? `console-${first.toLowerCase()}-${Date.now()}-${n}@example.test`;
  expect((await agent.post("/api/auth/register").set("x-forwarded-for", ip()).send({ email: address, password: "Testpass123!", firstName: first })).status).toBe(201);
  await verifyEmail(app, address, ip());
  return { agent, email: address };
}

describe("the owner's analytics console", () => {
  it("answers on every screen it has — live, online, sessions, one session, the summary", async () => {
    const app = await getTestApp();
    const owner = await person(app, "Owner", ownerEmail);
    await passMfa(owner.agent);

    /*
     * The live screen is a stream, not a request: it opens an event-stream and
     * keeps it open. Awaiting it the way the rest of these are awaited hangs
     * until the test times out — which is probably why nothing had ever driven
     * it. What's worth asserting is that it opens as a stream and sends the
     * backfill the screen draws itself from; then we hang up, as a closed tab does.
     */
    await new Promise<void>((resolve, reject) => {
      const stream: any = owner.agent.get("/api/admin/analytics/live").buffer(false);
      const done = (err?: Error) => { try { stream.abort(); } catch { /* already gone */ } err ? reject(err) : resolve(); };
      const timer = setTimeout(() => done(new Error("the live stream sent no backfill within 15 seconds")), 15_000);
      let seen = "";
      stream.on("response", (res: any) => {
        /*
         * Hanging up mid-stream tears down the socket under the *response*, and
         * it emits its own 'aborted' and 'error' (ECONNRESET) — separately from
         * the request, whose error is handled below. With nothing listening on
         * this side, that landed outside any test as an unhandled exception:
         * vitest reported every test passing and still exited non-zero, which
         * made `server-web` red for a reason that had nothing to do with a
         * test. Closing a stream you opened on purpose is not a failure.
         */
        res.on("aborted", () => { /* expected: we hung up */ });
        res.on("error", (err: any) => {
          const expected = /abort|ECONNRESET|socket hang up/i.test(String(err?.code ?? err?.message ?? err));
          if (!expected) { clearTimeout(timer); done(err as Error); }
        });
        try {
          expect(res.status).toBe(200);
          expect(String(res.headers["content-type"])).toMatch(/text\/event-stream/);
        } catch (err) { clearTimeout(timer); return done(err as Error); }
        res.on("data", (chunk: Buffer) => {
          seen += chunk.toString();
          if (seen.includes("event: backfill")) { clearTimeout(timer); done(); }
        });
      });
      // Hanging up on a stream surfaces here as an abort; that's the test finishing, not a failure.
      stream.on("error", (err: any) => { if (!/abort/i.test(String(err?.message ?? err))) { clearTimeout(timer); done(err); } });
      stream.end();
    });

    const online = await owner.agent.get("/api/admin/analytics/online");
    expect(online.status, JSON.stringify(online.body)).toBe(200);

    const summary = await owner.agent.get("/api/admin/analytics/summary?days=1");
    expect(summary.status, JSON.stringify(summary.body)).toBe(200);

    // The list, then one of them by id — the pair the screen uses to drill in.
    const sessions = await owner.agent.get("/api/admin/analytics/sessions");
    expect(sessions.status, JSON.stringify(sessions.body)).toBe(200);
    const list = Array.isArray(sessions.body) ? sessions.body : sessions.body.sessions ?? [];
    const id = list[0]?.id ?? list[0]?.sessionId ?? "00000000-0000-4000-8000-000000000001";
    const one = await owner.agent.get(`/api/admin/analytics/sessions/${encodeURIComponent(String(id))}`);
    // Either the session, or an honest "no such session" — never a crash.
    expect([200, 404], JSON.stringify(one.body)).toContain(one.status);

    // Whether this account may see any of it: the boolean the client asks for before offering the console.
    expect((await owner.agent.get("/api/admin/analytics/access")).body).toEqual({ owner: true });
  }, 120_000);
});

describe("the reviewer's screens", () => {
  it("answers on the backing queue, a project's signals, the report count and the catalog", async () => {
    const app = await getTestApp();
    const reviewer = await person(app, "Reviewer");
    const [row] = await db.select({ id: users.id }).from(users).where(eq(users.email, reviewer.email));
    await db.update(users).set({ platformRole: "reviewer" }).where(eq(users.id, row.id));
    await passMfa(reviewer.agent);

    const queue = await reviewer.agent.get("/api/admin/backing/queue");
    expect(queue.status, JSON.stringify(queue.body)).toBe(200);
    expect(Array.isArray(queue.body) || Array.isArray(queue.body?.projects)).toBe(true);

    // A project nobody has backed still answers — the screen opens on projects with nothing to decide.
    const builder = await person(app, "Builder");
    const project = await builder.agent.post("/api/projects").send({ title: "Console", description: "A project the payout screen can be opened on.", category: "saas", goal: "ship_mvp", subcategory: "saas" });
    expect(project.status).toBeLessThan(300);
    const signals = await reviewer.agent.get(`/api/admin/backing/${project.body.id}/signals`);
    expect(signals.status, JSON.stringify(signals.body)).toBe(200);

    const count = await reviewer.agent.get("/api/admin/reports/count");
    expect(count.status).toBe(200);
    expect(typeof count.body.open).toBe("number");

    // No Printful key in a test run: it says so rather than failing or reaching out.
    const catalog = await reviewer.agent.get("/api/admin/printful/catalog");
    expect([200, 422]).toContain(catalog.status);
    if (catalog.status === 422) expect(catalog.body.message).toMatch(/PRINTFUL_API_KEY/);
  });
});

describe("the admin's switches", () => {
  it("turns a surface off and back on, and refuses a company that isn't in the catalog", async () => {
    const app = await getTestApp();
    const admin = await person(app, "Admin");
    const [row] = await db.select({ id: users.id }).from(users).where(eq(users.email, admin.email));
    await db.update(users).set({ platformRole: "admin" }).where(eq(users.id, row.id));
    await passMfa(admin.agent);

    const surfaces = await admin.agent.get("/api/admin/surfaces");
    expect(surfaces.status, JSON.stringify(surfaces.body)).toBe(200);
    const list: any[] = Array.isArray(surfaces.body) ? surfaces.body : surfaces.body.surfaces ?? [];
    expect(list.length).toBeGreaterThan(0);
    const surface = list.find((s) => (s.id ?? s.key) === "contests") ?? list[0];
    const key = surface.id ?? surface.key;
    const was = surface.enabled !== false;

    const off = await admin.agent.patch(`/api/admin/surfaces/${key}`).send({ enabled: false });
    expect(off.status, JSON.stringify(off.body)).toBe(200);
    const after = await admin.agent.get("/api/admin/surfaces");
    const now = (Array.isArray(after.body) ? after.body : after.body.surfaces ?? []).find((s: any) => (s.id ?? s.key) === key);
    expect(now.enabled).toBe(false);

    // Put it back the way it was: a test that leaves a feature switched off breaks the next one.
    expect((await admin.agent.patch(`/api/admin/surfaces/${key}`).send({ enabled: was })).status).toBe(200);

    // The refresh route checks the catalog before it fetches anything, so this never reaches the network.
    const unknown = await admin.agent.post("/api/admin/promotions/not-a-real-company/refresh").send({});
    expect(unknown.status).toBe(404);
  });
});
