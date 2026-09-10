/**
 * Rate limits are durable, or they aren't rate limits.
 *
 * An in-memory counter passes every test you can write against one process and
 * fails in exactly two places nobody tests: a restart, which forgets the count,
 * and autoscale, where each instance keeps its own — so the effective limit is
 * N times the configured one. The store here is Postgres, and the assertions
 * below are the two that distinguish it from a counter: the refusal survives a
 * fresh application instance, and the refusal is logged with the numbers.
 *
 * The upload presign is the action under test because it is hit-counted (it
 * writes nothing until a file lands) and costs nothing to call thirty times.
 * The AI limit is exercised through `enforceRateLimit` directly — the function
 * `requireCredits` calls — since driving a real AI route means a real model.
 */
import { describe, it, expect, afterAll, vi } from "vitest";
import request from "supertest";
import { getTestApp, closeTestApp } from "../helpers/app";
import { enforceRateLimit } from "../../server/moderation";
import { RATE_LIMITS } from "@shared/moderation";

afterAll(async () => {
  await closeTestApp();
});

const password = "Testpass123!";
const newEmail = () => `rl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;

async function signedIn(app: any) {
  const agent = request.agent(app);
  const res = await agent.post("/api/auth/register").send({ email: newEmail(), password });
  expect(res.status).toBe(201);
  return { agent, userId: res.body.id as string };
}

describe("hit-counted limits", () => {
  it("refuses the request past the limit, with a Retry-After and a clear body", async () => {
    const app = await getTestApp();
    const { agent } = await signedIn(app);
    const { max } = RATE_LIMITS.upload;

    for (let i = 0; i < max; i++) {
      await agent.post("/api/uploads/request-url").send({ name: `f${i}.png` }).expect(200);
    }

    const over = await agent.post("/api/uploads/request-url").send({ name: "one-too-many.png" });
    expect(over.status).toBe(429);
    expect(over.body.code).toBe("rate_limited");
    expect(over.body.action).toBe("upload");
    expect(over.body.message).toBe(RATE_LIMITS.upload.message);
    expect(Number(over.headers["retry-after"])).toBeGreaterThan(0);
    // Nothing was handed out with the refusal.
    expect(over.body.uploadURL).toBeUndefined();
  });

  it("survives a fresh application instance — the count is in the database", async () => {
    const app = await getTestApp();
    const { agent, userId } = await signedIn(app);
    const { max } = RATE_LIMITS.upload;

    for (let i = 0; i < max; i++) {
      await agent.post("/api/uploads/request-url").send({ name: `f${i}.png` }).expect(200);
    }
    await agent.post("/api/uploads/request-url").send({ name: "x.png" }).expect(429);

    /*
     * Tear the app down and build a new one: new middleware, new route
     * registrations, nothing in memory carried over. The session cookie still
     * identifies the same account, and the same account must still be refused.
     * An in-memory limiter passes the test above and fails this one.
     */
    await closeTestApp();
    const fresh = await getTestApp();
    const again = request.agent(fresh);
    const login = await again.post("/api/auth/login").send({
      email: (await agent.get("/api/auth/user")).body.email, password,
    });
    expect(login.status).toBe(200);
    expect(login.body.id).toBe(userId);

    const stillRefused = await again.post("/api/uploads/request-url").send({ name: "y.png" });
    expect(stillRefused.status).toBe(429);
  });

  it("logs every refusal with the numbers", async () => {
    const app = await getTestApp();
    const { agent, userId } = await signedIn(app);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      for (let i = 0; i <= RATE_LIMITS.upload.max; i++) {
        await agent.post("/api/uploads/request-url").send({ name: `f${i}.png` });
      }
      const lines = warn.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith("[rate-limit]"));
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain(userId);
      expect(lines[0]).toContain(`${RATE_LIMITS.upload.max}/${RATE_LIMITS.upload.max}`);
    } finally {
      warn.mockRestore();
    }
  });

  it("does not count one person's usage against another", async () => {
    const app = await getTestApp();
    const a = await signedIn(app);
    const b = await signedIn(app);

    for (let i = 0; i < RATE_LIMITS.upload.max; i++) {
      await a.agent.post("/api/uploads/request-url").send({ name: `f${i}.png` }).expect(200);
    }
    await a.agent.post("/api/uploads/request-url").send({ name: "x.png" }).expect(429);
    await b.agent.post("/api/uploads/request-url").send({ name: "x.png" }).expect(200);
  });
});

describe("the AI limit at the credit chokepoint", () => {
  /** A stand-in response that records what was written to it. */
  const fakeRes = () => {
    const out: any = { statusCode: 200, body: undefined as unknown, headers: {} as Record<string, string> };
    out.status = (n: number) => { out.statusCode = n; return out; };
    out.json = (b: unknown) => { out.body = b; return out; };
    out.setHeader = (k: string, v: string) => { out.headers[k] = v; };
    return out;
  };

  it("allows up to the limit, then refuses, durably", async () => {
    const app = await getTestApp();
    const { userId } = await signedIn(app);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      for (let i = 0; i < RATE_LIMITS.ai.max; i++) {
        expect(await enforceRateLimit(fakeRes(), userId, "ai")).toBe(true);
      }
      const res = fakeRes();
      expect(await enforceRateLimit(res, userId, "ai")).toBe(false);
      expect(res.statusCode).toBe(429);
      expect((res.body as any).action).toBe("ai");

      // Still refused after the app is rebuilt: the hits are rows, not memory.
      await closeTestApp();
      await getTestApp();
      const later = fakeRes();
      expect(await enforceRateLimit(later, userId, "ai")).toBe(false);
      expect(later.statusCode).toBe(429);
    } finally {
      warn.mockRestore();
    }
  });
});

describe("limits without a user", () => {
  it("counts registration and mobile sign-in attempts per address, like web sign-in", async () => {
    const app = await getTestApp();
    const ip = "198.51.100.77";
    const limit = RATE_LIMITS.login.max;
    let last: any;
    for (let i = 0; i <= limit; i++) {
      last = await request(app).post("/api/auth/register").set("x-forwarded-for", ip).send({ email: `r${i}-${Date.now()}@example.test`, password: "Testpass123!" });
    }
    expect(last.status).toBe(429);
    expect(last.body.code).toBe("rate_limited");
    expect(last.headers["retry-after"]).toBeTruthy();
    // The same budget covers mobile sign-in from that address; another address is unaffected.
    expect((await request(app).post("/api/auth/mobile/login").set("x-forwarded-for", ip).send({ email: "x@example.test", password: "nope" })).status).toBe(429);
    expect((await request(app).post("/api/auth/mobile/login").set("x-forwarded-for", "198.51.100.78").send({ email: "x@example.test", password: "nope" })).status).not.toBe(429);
  });

  it("limits analytics beacons per address", async () => {
    const app = await getTestApp();
    const ip = "198.51.100.90";
    let last: any;
    for (let i = 0; i <= RATE_LIMITS.track.max; i++) last = await request(app).post("/api/track").set("x-forwarded-for", ip).send({ events: [] });
    expect(last.status).toBe(429);
  }, 60_000);
});

describe("the floor under every write", () => {
  it("refuses a signed-in user past the write budget on any endpoint, and exempts the payment webhook", async () => {
    const app = await getTestApp();
    const { agent } = await signedIn(app);
    const project = await agent.post("/api/projects").send({ title: "Floor", description: "A project used to hit the write floor with many small edits.", category: "saas", goal: "ship_mvp", subcategory: "saas" });
    expect(project.status).toBe(200);
    let last: any;
    // Every write counts — including ones with no limiter of their own.
    for (let i = 0; i <= RATE_LIMITS.write.max; i++) last = await agent.patch(`/api/projects/${project.body.id}`).send({ description: `Edit ${i}: a small change to the description of the project.` });
    expect(last.status).toBe(429);
    expect(last.body).toMatchObject({ code: "rate_limited", action: "write" });
    // Reads are untouched.
    expect((await agent.get(`/api/projects/${project.body.id}`)).status).toBe(200);
    // The webhook is exempt: it is signature-verified and its caller is not a person.
    const hook = await request(app).post("/api/stripe/webhook").set("x-forwarded-for", "198.51.100.5").send({});
    expect(hook.status).not.toBe(429);
  }, 90_000);
});
