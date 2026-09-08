/**
 * Authentication, both styles.
 *
 * The web uses a cookie session; mobile uses a short-lived access token plus a
 * rotating refresh token. They share `req.user`, so a change to one can quietly
 * break the other, and neither failure is obvious by hand: a session that
 * doesn't persist looks like "I got logged out", and a refresh token that isn't
 * rotated looks like nothing at all until someone replays an old one.
 *
 * The assertions worth having here are the negative and the invisible ones —
 * what must be refused, and what must not be readable in the database.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { db } from "../../server/db";
import { mobileRefreshTokens, users } from "@shared/schema";

afterAll(async () => {
  await closeTestApp();
});

const password = "Testpass123!";
const newEmail = () => `auth-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;

/** The server stores only a SHA-256 of a refresh token; this recomputes it. */
const sha256 = (v: string) => crypto.createHash("sha256").update(v).digest("hex");

// --- Web ------------------------------------------------------------------

describe("web: signing up and in", () => {
  it("returns the account, and never the password hash", async () => {
    const app = await getTestApp();
    const email = newEmail();

    const signup = await request(app)
      .post("/api/auth/register")
      .send({ email, password, firstName: "Web", lastName: "Tester" });

    expect(signup.status).toBe(201);
    expect(signup.body.email).toBe(email);
    expect(signup.body.id).toBeTruthy();
    expect(signup.body.passwordHash).toBeUndefined();

    // The row does hold a hash, and it is not the password.
    const [row] = await db.select().from(users).where(eq(users.email, email));
    expect(row.passwordHash).toBeTruthy();
    expect(row.passwordHash).not.toBe(password);
  });

  it("signs in with the right password and refuses the wrong one", async () => {
    const app = await getTestApp();
    const email = newEmail();
    await request(app).post("/api/auth/register").send({ email, password });

    const good = await request(app).post("/api/auth/login").send({ email, password });
    expect(good.status).toBe(200);
    expect(good.body.email).toBe(email);

    const bad = await request(app).post("/api/auth/login").send({ email, password: "wrong-entirely" });
    expect(bad.status).toBe(401);
    /*
     * The same message for both halves of the pair. Saying "no such account"
     * for one and "wrong password" for the other turns the login form into a
     * way to enumerate who has an account here.
     */
    const noSuchUser = await request(app)
      .post("/api/auth/login")
      .send({ email: "nobody-at-all@example.test", password });
    expect(noSuchUser.status).toBe(401);
    expect(noSuchUser.body.message).toBe(bad.body.message);
  });

  it("refuses to register the same email twice", async () => {
    const app = await getTestApp();
    const email = newEmail();
    await request(app).post("/api/auth/register").send({ email, password });

    const again = await request(app)
      .post("/api/auth/register")
      .send({ email, password, firstName: "Impostor" });
    expect(again.status).toBe(409);
  });
});

describe("web: session protection", () => {
  it("rejects a protected route with no credentials", async () => {
    const app = await getTestApp();
    await request(app).get("/api/auth/user").expect(401);
    await request(app).get("/api/profile").expect(401);
    await request(app).get("/api/user/projects").expect(401);
  });

  it("keeps the session across requests, and drops it on logout", async () => {
    const app = await getTestApp();
    const agent = request.agent(app);
    const email = newEmail();

    const signup = await agent.post("/api/auth/register").send({ email, password });
    expect(signup.status).toBe(201);

    // The cookie has to actually be set, or "persistence" is a coincidence.
    const cookies = signup.headers["set-cookie"] as unknown as string[];
    expect(cookies.some((c) => c.startsWith("connect.sid="))).toBe(true);
    /*
     * httpOnly matters more than it looks: without it any injected script on
     * the page can read the session cookie and walk off with the account.
     */
    expect(cookies.find((c) => c.startsWith("connect.sid="))).toMatch(/HttpOnly/i);

    // Three consecutive requests on the same jar, to catch a session that is
    // regenerated per request rather than actually stored.
    for (const _ of [1, 2, 3]) {
      const me = await agent.get("/api/auth/user");
      expect(me.status).toBe(200);
      expect(me.body.email).toBe(email);
    }
    await agent.get("/api/profile").expect(200);

    await agent.get("/api/logout").expect(302);
    const after = await agent.get("/api/auth/user");
    expect(after.status).toBe(401);
  });

  it("does not accept a forged session cookie", async () => {
    const app = await getTestApp();
    const forged = await request(app)
      .get("/api/auth/user")
      .set("Cookie", "connect.sid=s%3Anot-a-real-signed-session.deadbeef");
    expect(forged.status).toBe(401);
  });
});

// --- Mobile ---------------------------------------------------------------

describe("mobile: tokens", () => {
  it("issues an access token that authenticates, and a refresh token stored only as a hash", async () => {
    const app = await getTestApp();
    const email = newEmail();

    const session = await request(app)
      .post("/api/auth/mobile/register")
      .send({ email, password, firstName: "Mobile", lastName: "Tester", device: "iPhone 15" });

    expect(session.status).toBe(200);
    const { accessToken, refreshToken } = session.body;
    expect(accessToken).toBeTruthy();
    expect(refreshToken).toBeTruthy();
    expect(session.body.user.passwordHash).toBeUndefined();

    // The access token works as a Bearer credential on a normal route — the
    // point of attachBearerUser is that mobile needs no special endpoints.
    const me = await request(app)
      .get("/api/auth/user")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.email).toBe(email);

    /*
     * At rest the refresh token must be a hash. A database leak that hands out
     * working 60-day credentials is a different order of problem from one that
     * hands out hashes.
     */
    const rows = await db.select().from(mobileRefreshTokens);
    const stored = rows.find((r) => r.tokenHash === sha256(refreshToken));
    expect(stored).toBeTruthy();
    expect(rows.some((r) => r.tokenHash === refreshToken)).toBe(false);
    expect(stored!.device).toBe("iPhone 15");
    expect(stored!.revokedAt).toBeNull();
  });

  it("rejects a tampered access token", async () => {
    const app = await getTestApp();
    const session = await request(app)
      .post("/api/auth/mobile/register")
      .send({ email: newEmail(), password });

    const [header, payload] = session.body.accessToken.split(".");
    // Right shape, wrong signature.
    const forged = `${header}.${payload}.${"a".repeat(43)}`;

    const res = await request(app).get("/api/auth/user").set("Authorization", `Bearer ${forged}`);
    expect(res.status).toBe(401);
  });

  it("rotates the refresh token and invalidates the one it replaced", async () => {
    const app = await getTestApp();
    const session = await request(app)
      .post("/api/auth/mobile/register")
      .send({ email: newEmail(), password, device: "Pixel 8" });

    const first = session.body.refreshToken;

    const refreshed = await request(app).post("/api/auth/mobile/refresh").send({ refreshToken: first });
    expect(refreshed.status).toBe(200);
    const second = refreshed.body.refreshToken;

    // A new token, not the same one handed back.
    expect(second).toBeTruthy();
    expect(second).not.toBe(first);
    expect(refreshed.body.accessToken).toBeTruthy();

    // The old one is spent. This is the assertion that matters: without it, a
    // refresh token captured once would work forever.
    const replay = await request(app).post("/api/auth/mobile/refresh").send({ refreshToken: first });
    expect(replay.status).toBe(401);
    expect(replay.body.code).toBe("refresh_invalid");

    // Revoked rather than deleted, so the reuse is visible after the fact.
    const [oldRow] = await db.select().from(mobileRefreshTokens)
      .where(eq(mobileRefreshTokens.tokenHash, sha256(first)));
    expect(oldRow.revokedAt).not.toBeNull();

    // And the replacement still works, once.
    const third = await request(app).post("/api/auth/mobile/refresh").send({ refreshToken: second });
    expect(third.status).toBe(200);
    expect(third.body.refreshToken).not.toBe(second);
  });

  it("refuses an unknown or absent refresh token", async () => {
    const app = await getTestApp();
    await request(app).post("/api/auth/mobile/refresh").send({}).expect(400);

    const unknown = await request(app)
      .post("/api/auth/mobile/refresh")
      .send({ refreshToken: crypto.randomBytes(48).toString("base64url") });
    expect(unknown.status).toBe(401);
  });

  it("signs out one device without touching the others", async () => {
    const app = await getTestApp();
    const email = newEmail();

    const phone = await request(app)
      .post("/api/auth/mobile/register")
      .send({ email, password, device: "iPhone 15" });
    const tablet = await request(app)
      .post("/api/auth/mobile/login")
      .send({ email, password, device: "iPad" });
    expect(tablet.status).toBe(200);

    await request(app)
      .post("/api/auth/mobile/logout")
      .send({ refreshToken: phone.body.refreshToken })
      .expect(200);

    // The phone is out…
    const phoneAgain = await request(app)
      .post("/api/auth/mobile/refresh")
      .send({ refreshToken: phone.body.refreshToken });
    expect(phoneAgain.status).toBe(401);

    // …and the tablet is untouched. Signing out of one device logging you out
    // everywhere is a bug people notice immediately and report as flakiness.
    const tabletAgain = await request(app)
      .post("/api/auth/mobile/refresh")
      .send({ refreshToken: tablet.body.refreshToken });
    expect(tabletAgain.status).toBe(200);
  });
});
