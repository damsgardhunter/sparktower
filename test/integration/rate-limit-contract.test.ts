/**
 * Three kinds of risky request, one way of being told no.
 *
 * Sign-in attempts, a content write (comments), and a costly AI call are each
 * pushed past their limit through the real endpoint, and each refusal must be
 * the same thing: 429, the same body keys, `code: "rate_limited"`, and a
 * Retry-After equal to the body's wait. Around that: the count is rows in the
 * database, the wait is when room actually opens, a forged X-Forwarded-For
 * can't reset the sign-in limit, and the allowlist lets admins and listed
 * testers through while still recording what they did.
 */
import { describe, it, expect, afterAll, afterEach, vi } from "vitest";
import request from "supertest";
import { and, asc, eq, sql } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { db } from "../../server/db";
import { feedComments, feedPosts, rateLimitHits, users } from "@shared/schema";
import { RATE_LIMITS, RATE_LIMITED, type RateLimitAction } from "@shared/moderation";

afterAll(async () => { await closeTestApp(); });
afterEach(() => { vi.restoreAllMocks(); delete process.env.RATE_LIMIT_EXEMPT_EMAILS; });

let n = 0;
async function person(app: any) {
  const agent = request.agent(app);
  n += 1;
  const email = `rlc-${Date.now()}-${n}-${Math.random().toString(36).slice(2, 6)}@example.test`;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", `198.51.100.${120 + n}`).send({ email, password: "Testpass123!" });
  expect(res.status).toBe(201);
  return { agent, id: res.body.id as string, email };
}

/** Uses of a hit-counted action, as rows — `minutesAgo` back, in the database's clock. */
const seedHits = (key: string, action: RateLimitAction, count: number, minutesAgo = 0) =>
  db.insert(rateLimitHits).values(Array.from({ length: count }, () => ({
    userId: key, action, createdAt: sql`now() - interval '${sql.raw(String(minutesAgo))} minutes'`,
  })) as any);

/** Every rate-limit refusal, whichever endpoint it comes from, is exactly this. */
function expectRefusal(res: request.Response, action: RateLimitAction) {
  expect(res.status).toBe(429);
  expect(Object.keys(res.body).sort()).toEqual(["action", "code", "message", "retryAfterMinutes", "retryAfterSeconds"]);
  expect(res.body).toMatchObject({ code: RATE_LIMITED, action, message: RATE_LIMITS[action].message });
  const wait = res.body.retryAfterSeconds;
  expect(wait).toBeGreaterThan(0);
  expect(wait).toBeLessThanOrEqual(RATE_LIMITS[action].windowMinutes * 60);
  expect(res.headers["retry-after"]).toBe(String(wait));
  expect(res.body.retryAfterMinutes).toBe(Math.ceil(wait / 60));
}

describe("the three categories, past their limits", () => {
  it("auth: sign-in attempts from one address, counted as rows over time", async () => {
    const app = await getTestApp();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const ip = "198.51.100.201";
    let last: request.Response | undefined;
    for (let i = 0; i <= RATE_LIMITS.login.max; i++) {
      last = await request(app).post("/api/auth/login").set("x-forwarded-for", ip).send({ email: `nobody-${i}@example.test`, password: "wrong-password" });
    }
    expectRefusal(last!, "login");

    // The counter is the table: one row per attempt let through, each with its time.
    const hits = await db.select().from(rateLimitHits)
      .where(and(eq(rateLimitHits.userId, `ip:${ip}`), eq(rateLimitHits.action, "login")))
      .orderBy(asc(rateLimitHits.createdAt));
    expect(hits).toHaveLength(RATE_LIMITS.login.max);
    expect(hits.every((h) => h.createdAt instanceof Date)).toBe(true);
  });

  it("content: comments on a post", async () => {
    const app = await getTestApp();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { agent, id } = await person(app);
    const [post] = await db.insert(feedPosts).values({ authorId: id, postType: "project_update", content: "A post to comment on.", createdAt: sql.raw("now()") } as any).returning();

    for (let i = 0; i < RATE_LIMITS.comment.max; i++) {
      const ok = await agent.post(`/api/feed/${post.id}/comments`).send({ content: `Comment number ${i} on how the launch went` });
      expect(ok.status).toBeLessThan(300);
    }
    expectRefusal(await agent.post(`/api/feed/${post.id}/comments`).send({ content: "One more, past the limit" }), "comment");
    // Comments are counted from their own rows, so the rows are the counter.
    const written = await db.select().from(feedComments).where(eq(feedComments.authorId, id));
    expect(written).toHaveLength(RATE_LIMITS.comment.max);
  });

  it("AI: Nova chat, refused before any model is called", async () => {
    const app = await getTestApp();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { agent, id } = await person(app);
    await seedHits(id, "ai", RATE_LIMITS.ai.max);
    expectRefusal(await agent.post("/api/chat").send({ message: "hello" }), "ai");
  });
});

describe("around the contract", () => {
  it("says when room actually opens, not the window's whole length", async () => {
    const app = await getTestApp();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { agent, id } = await person(app);
    // All of the window's uses were nine minutes ago; the window is ten.
    await seedHits(id, "ai", RATE_LIMITS.ai.max, RATE_LIMITS.ai.windowMinutes - 1);
    const res = await agent.post("/api/chat").send({ message: "hello" });
    expectRefusal(res, "ai");
    expect(res.body.retryAfterSeconds).toBeLessThanOrEqual(61);
  });

  it("can't be reset by writing a new address into X-Forwarded-For", async () => {
    const app = await getTestApp();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    let last: request.Response | undefined;
    // The first entry is the client's to write; the last is what our proxy saw.
    for (let i = 0; i <= RATE_LIMITS.login.max; i++) {
      last = await request(app).post("/api/auth/register")
        .set("x-forwarded-for", `10.9.${i}.${i}, 198.51.100.202`)
        .send({ email: `spoof-${i}-${Date.now()}@example.test`, password: "Testpass123!" });
    }
    expectRefusal(last!, "login");
  });

  it("lets admins and listed testers through, and still records what they did", async () => {
    const app = await getTestApp();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const [admin, tester, someone] = [await person(app), await person(app), await person(app)];
    await db.update(users).set({ platformRole: "admin" }).where(eq(users.id, admin.id));
    process.env.RATE_LIMIT_EXEMPT_EMAILS = ` ${tester.email.toUpperCase()} , other@example.test`;
    const max = RATE_LIMITS.upload.max;
    for (const p of [admin, tester, someone]) await seedHits(p.id, "upload", max);

    const presign = (p: typeof admin) => p.agent.post("/api/uploads/request-url").send({ name: "shot.png" });
    expect((await presign(admin)).status).toBe(200);
    expect((await presign(tester)).status).toBe(200);
    expectRefusal(await presign(someone), "upload");

    const count = async (id: string) => (await db.select().from(rateLimitHits)
      .where(and(eq(rateLimitHits.userId, id), eq(rateLimitHits.action, "upload")))).length;
    expect(await count(admin.id)).toBe(max + 1);
    expect(await count(someone.id)).toBe(max);
  });
});
