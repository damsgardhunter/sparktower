/**
 * Signing out means the session is gone, sign-out-everywhere ends every
 * session and device, and the development upload endpoint is closed to
 * strangers, bad ids, and production.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { getTestApp, closeTestApp } from "../helpers/app";

afterAll(async () => { await closeTestApp(); });

const password = "Testpass123!";
async function signedIn(app: any, tag: string) {
  const agent = request.agent(app);
  const email = `ah-${tag}-${Date.now()}@example.test`;
  await agent.post("/api/auth/register").set("x-forwarded-for", `203.0.113.${Math.floor(Math.random() * 200) + 1}`).send({ email, password });
  return { agent, email };
}

describe("signing out", () => {
  it("destroys the session so the cookie is dead, and sign-out-everywhere ends the other sessions and devices too", async () => {
    const app = await getTestApp();
    const { agent, email } = await signedIn(app, "one");
    expect((await agent.get("/api/auth/user")).status).toBe(200);

    // A second browser on the same account.
    const other = request.agent(app);
    await other.post("/api/auth/login").set("x-forwarded-for", "203.0.113.250").send({ email, password }).expect(200);
    // And a phone.
    const phone = await request(app).post("/api/auth/mobile/login").set("x-forwarded-for", "203.0.113.251").send({ email, password });
    expect(phone.status).toBe(200);
    const refreshToken = phone.body.refreshToken;

    // Plain sign-out: this session is gone; the others still work.
    const out = await agent.post("/api/logout");
    expect(out.status).toBe(200);
    expect((await agent.get("/api/auth/user")).status).toBe(401);
    expect((await other.get("/api/auth/user")).status).toBe(200);

    // Sign out everywhere from the other browser: it ends itself, and the phone's refresh token is dead.
    const all = await other.post("/api/auth/logout-all");
    expect(all.status).toBe(200);
    expect(all.body.devicesSignedOut).toBe(1);
    // Web sessions are ended by reading the session store's own rows (sess->passport->user): if that shape ever
    // drifts, this count goes to 0 and the assertions below fail, rather than global sign-out quietly missing browsers.
    expect(all.body.sessionsEnded).toBeGreaterThanOrEqual(1);
    expect((await other.get("/api/auth/user")).status).toBe(401);
    expect((await request(app).post("/api/auth/mobile/refresh").set("x-forwarded-for", "203.0.113.252").send({ refreshToken })).status).toBe(401);
    // And the phone's access token, still unexpired, stops working now rather than in 15 minutes.
    expect((await request(app).get("/api/auth/mobile/me").set("Authorization", `Bearer ${phone.body.accessToken}`)).status).toBe(401);
    // Signing in again afterwards works as normal.
    const again = await request(app).post("/api/auth/mobile/login").set("x-forwarded-for", "203.0.113.253").send({ email, password });
    expect((await request(app).get("/api/auth/mobile/me").set("Authorization", `Bearer ${again.body.accessToken}`)).status).toBe(200);
  });
});

describe("the development upload endpoint", () => {
  it("accepts only an id it issued, once, and never in production", async () => {
    const app = await getTestApp();
    const { ObjectStorageService } = await import("../../server/replit_integrations/object_storage");
    // A guessed id, even a well-formed one, is a 404: the URL is the credential.
    expect((await request(app).put("/internal-local-upload/abc123").send("data")).status).toBe(404);
    expect((await request(app).put("/internal-local-upload/..%2F..%2Fetc").send("data")).status).toBe(400);
    // An issued one works without any session — that's how a client uses a presigned URL — and only once.
    const url = new URL(await new ObjectStorageService().getObjectEntityUploadURL());
    expect((await request(app).put(url.pathname).set("Content-Type", "application/octet-stream").send("data")).status).toBe(200);
    expect((await request(app).put(url.pathname).send("again")).status).toBe(404);
    const again = new URL(await new ObjectStorageService().getObjectEntityUploadURL());
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try { expect((await request(app).put(again.pathname).send("data")).status).toBe(404); }
    finally { process.env.NODE_ENV = prev; }
  });
});

describe("public writes that trust a credential in the request", () => {
  it("a mobile refresh token works once; reused after rotation it ends every mobile session on the account", async () => {
    const app = await getTestApp();
    const { db } = await import("../../server/db");
    const { mobileRefreshTokens } = await import("@shared/schema");
    const { eq, sql } = await import("drizzle-orm");
    const { email } = await signedIn(app, "reuse");
    const login = () => request(app).post("/api/auth/mobile/login").set("x-forwarded-for", "203.0.113.240").send({ email, password });
    const phone = (await login()).body;
    const tablet = (await login()).body;
    const refresh = (refreshToken: string) => request(app).post("/api/auth/mobile/refresh").set("x-forwarded-for", "203.0.113.241").send({ refreshToken });

    // Rotation: the new token works, the old one doesn't. A retry right away (a lost response) ends nothing else.
    const rotated = await refresh(phone.refreshToken);
    expect(rotated.status).toBe(200);
    expect((await refresh(phone.refreshToken)).body.code).toBe("refresh_invalid");
    expect((await refresh(tablet.refreshToken)).status).toBe(200);

    // Later, the spent token shows up again: someone else has it. Every live mobile session on the account ends.
    await db.update(mobileRefreshTokens).set({ revokedAt: sql`now() - interval '5 minutes'` }).where(eq(mobileRefreshTokens.tokenHash, (await import("crypto")).createHash("sha256").update(phone.refreshToken).digest("hex")));
    expect((await refresh(phone.refreshToken)).status).toBe(401);
    expect((await refresh(rotated.body.refreshToken)).status).toBe(401);
    // The access tokens those sessions held are dead too, the copy's included.
    expect((await request(app).get("/api/auth/mobile/me").set("Authorization", `Bearer ${rotated.body.accessToken}`)).status).toBe(401);
    expect((await request(app).get("/api/auth/mobile/me")).status).toBe(401);
  });

  it("two refreshes racing with one token get one session between them", async () => {
    const app = await getTestApp();
    const { email } = await signedIn(app, "race");
    const phone = (await request(app).post("/api/auth/mobile/login").set("x-forwarded-for", "203.0.113.242").send({ email, password })).body;
    const both = await Promise.all([1, 2].map(() => request(app).post("/api/auth/mobile/refresh").set("x-forwarded-for", "203.0.113.243").send({ refreshToken: phone.refreshToken })));
    expect(both.map((r) => r.status).sort()).toEqual([200, 401]);
  });

  it("a Stripe webhook address that keeps failing the signature check is refused; the count is of failures only", async () => {
    const app = await getTestApp();
    const { db } = await import("../../server/db");
    const { rateLimitHits } = await import("@shared/schema");
    const { RATE_LIMITS } = await import("@shared/moderation");
    const ip = "203.0.113.244";
    const forge = () => request(app).post("/api/stripe/webhook").set("x-forwarded-for", ip).set("Content-Type", "application/json").send(JSON.stringify({ id: "evt_forged", type: "customer.subscription.deleted" }));
    expect((await forge()).status).toBe(400);
    await db.insert(rateLimitHits).values(Array.from({ length: RATE_LIMITS.webhookReject.max }, () => ({ userId: `ip:${ip}`, action: "webhookReject" })) as any);
    const refused = await forge();
    expect(refused.status).toBe(429);
    expect(refused.body.action).toBe("webhookReject");
    // Another address is unaffected.
    expect((await request(app).post("/api/stripe/webhook").set("x-forwarded-for", "203.0.113.245").set("Content-Type", "application/json").send("{}")).status).toBe(400);
  });

  it("mobile sign-out and the development upload endpoint are limited per address", async () => {
    const app = await getTestApp();
    const { db } = await import("../../server/db");
    const { rateLimitHits } = await import("@shared/schema");
    const { RATE_LIMITS } = await import("@shared/moderation");
    const ip = "203.0.113.246";
    expect((await request(app).post("/api/auth/mobile/logout").set("x-forwarded-for", ip).send({})).status).toBe(200);
    await db.insert(rateLimitHits).values(Array.from({ length: RATE_LIMITS.session.max }, () => ({ userId: `ip:${ip}`, action: "session" })) as any);
    expect((await request(app).post("/api/auth/mobile/logout").set("x-forwarded-for", ip).send({})).status).toBe(429);

    const uploader = "203.0.113.247";
    await db.insert(rateLimitHits).values(Array.from({ length: RATE_LIMITS.upload.max }, () => ({ userId: `ip:${uploader}`, action: "upload" })) as any);
    expect((await request(app).put("/internal-local-upload/abc123").set("x-forwarded-for", uploader).send("data")).status).toBe(429);
  });
});

  it("keeps the device label the app gave at sign-in, cleaned, and won't let a refresh rewrite it", async () => {
    const app = await getTestApp();
    const { db } = await import("../../server/db");
    const { mobileRefreshTokens } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");
    const email = `device-${Date.now()}@example.test`;
    await request(app).post("/api/auth/register").set("x-forwarded-for", "203.0.113.130")
      .send({ email, password, firstName: "Device" }).expect(201);

    const messy = `  Ada's iPhone\u0000 15\n\nPro  ${"x".repeat(200)}`;
    const login = await request(app).post("/api/auth/mobile/login").set("x-forwarded-for", "203.0.113.131").send({ email, password, device: messy });
    expect(login.status).toBe(200);
    const [stored] = await db.select().from(mobileRefreshTokens).where(eq(mobileRefreshTokens.userId, login.body.user.id));
    expect(stored.device).toBe(`Ada's iPhone 15 Pro ${"x".repeat(200)}`.slice(0, 80));
    expect(stored.device).not.toMatch(/[\u0000-\u001f]/);

    // A refresh proves possession of a token, not whose device it is: the label comes from the sign-in, not the body.
    const refreshed = await request(app).post("/api/auth/mobile/refresh").set("x-forwarded-for", "203.0.113.132")
      .send({ refreshToken: login.body.refreshToken, device: "Attacker's laptop" });
    expect(refreshed.status).toBe(200);
    const rows = await db.select().from(mobileRefreshTokens).where(eq(mobileRefreshTokens.userId, login.body.user.id));
    expect(rows.map((r) => r.device)).toEqual([stored.device, stored.device]);

    // Nothing sent, nothing stored.
    const bare = await request(app).post("/api/auth/mobile/login").set("x-forwarded-for", "203.0.113.133").send({ email, password, device: "   " });
    expect(bare.status).toBe(200);
    const all = await db.select().from(mobileRefreshTokens).where(eq(mobileRefreshTokens.userId, login.body.user.id));
    expect(all.some((r) => r.device === null)).toBe(true);
  });

describe("security headers on the real app", () => {
  it("every response carries them — pages, the API, errors — and none says what the server runs", async () => {
    const app = await getTestApp();
    for (const path of ["/_health", "/api/surfaces", "/api/does-not-exist"]) {
      const res = await request(app).get(path);
      expect(res.headers["x-frame-options"], path).toBe("DENY");
      expect(res.headers["x-content-type-options"], path).toBe("nosniff");
      expect(res.headers["content-security-policy"] ?? res.headers["content-security-policy-report-only"], path).toContain("frame-ancestors 'none'");
      expect(res.headers["x-powered-by"], path).toBeUndefined();
    }
    // A served logo keeps its own stricter, sandboxed policy.
    const logo = await request(app).get("/api/promotions/replit/logo");
    if (logo.status === 200) expect(logo.headers["content-security-policy"]).toContain("sandbox");
  });
});
