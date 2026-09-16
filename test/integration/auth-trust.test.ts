/**
 * What the server actually trusts when it says "you're signed in".
 *
 * Three anchors, each deliberate and each easy to weaken by accident:
 *
 *  - A mobile access token is self-contained. Everything it claims is trusted
 *    once the signature checks out, so the signature has to cover the whole
 *    token (header included, which is why the header's `alg` is never read) and
 *    nothing may be believed without it.
 *  - A code at sign-in is trusted because of the session it arrives in: a
 *    correct password put `mfaPending` there, in that session, minutes ago.
 *  - A mobile sign-out is trusted because of the refresh token in the body. The
 *    token is the credential; holding it is the right to revoke it, and it must
 *    revoke nothing else.
 *
 * A device label is none of these. It's typed by the client and is only ever a
 * name in a list.
 *
 * These are the properties, written down. Anything here failing means a token
 * or a cookie is being believed for a reason it shouldn't be.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { passMfa, codeFor } from "../helpers/mfa";
import { db, pool } from "../../server/db";
import { mobileRefreshTokens, users } from "@shared/schema";
import { DEVICE_LABEL_MAX, tokenSecret } from "../../server/mobile-auth";
import { sessionSecret } from "../../server/secrets";

afterAll(async () => { await closeTestApp(); });

const password = "Testpass123!";
let n = 0;
const ip = () => `198.51.111.${20 + (n++ % 200)}`;

async function account(app: any, first: string) {
  n += 1;
  const agent = request.agent(app);
  const email = `trust-${first.toLowerCase()}-${Date.now()}-${n}@example.test`;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", ip()).send({ email, password, firstName: first });
  expect(res.status).toBe(201);
  return { agent, email, id: res.body.id as string };
}

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
/** A token built by hand: any header, any claims, signed with any key. */
function forge(header: Record<string, unknown>, claims: Record<string, unknown>, key = tokenSecret(), signature?: string) {
  const body = `${b64(header)}.${b64(claims)}`;
  return `${body}.${signature ?? crypto.createHmac("sha256", key).update(body).digest("base64url")}`;
}
const now = () => Math.floor(Date.now() / 1000);
const goodClaims = (sub: string, extra: Record<string, unknown> = {}) => ({ sub, iat: now(), iat_ms: Date.now(), exp: now() + 600, ...extra });

describe("what a mobile access token is believed for", () => {
  it("refuses every token it didn't sign, however the header is dressed up", async () => {
    const app = await getTestApp();
    const me = await account(app, "Bearer");
    const me2 = await request(app).get("/api/auth/mobile/me");
    expect(me2.status).toBe(401);

    const mine = (token: string) => request(app).get("/api/auth/mobile/me").set("Authorization", `Bearer ${token}`);
    // The real thing works, so a refusal below means the tampering was caught, not that the route is broken.
    const real = await request(app).post("/api/auth/mobile/login").set("x-forwarded-for", ip()).send({ email: me.email, password });
    expect((await mine(real.body.accessToken)).status).toBe(200);

    // "alg": "none", with no signature at all, and with the signature left off entirely.
    expect((await mine(forge({ alg: "none", typ: "JWT" }, goodClaims(me.id), undefined, ""))).status).toBe(401);
    expect((await mine(`${b64({ alg: "none" })}.${b64(goodClaims(me.id))}`)).status).toBe(401);
    // A header claiming another algorithm, signed with the right key: the signature covers the header, so it doesn't verify.
    const swapped = forge({ alg: "HS512", typ: "JWT" }, goodClaims(me.id));
    const [h, p] = swapped.split(".");
    expect((await mine(`${b64({ alg: "HS256", typ: "JWT" })}.${p}.${swapped.split(".")[2]}`)).status).toBe(401);
    expect(h).toBeTruthy();
    // Signed with the session secret, or the raw one the key is derived from: wrong key, refused.
    expect((await mine(forge({ alg: "HS256", typ: "JWT" }, goodClaims(me.id), sessionSecret()))).status).toBe(401);
    // A valid token with one byte of the payload changed.
    const parts = real.body.accessToken.split(".");
    expect((await mine(`${parts[0]}.${b64(goodClaims(me.id))}.${parts[2]}`)).status).toBe(401);
  });

  it("refuses a token that has run out, or never said when it would", async () => {
    const app = await getTestApp();
    const me = await account(app, "Clock");
    const mine = (claims: Record<string, unknown>) => request(app).get("/api/auth/mobile/me").set("Authorization", `Bearer ${forge({ alg: "HS256", typ: "JWT" }, claims)}`);

    expect((await mine(goodClaims(me.id))).status).toBe(200);
    expect((await mine({ ...goodClaims(me.id), exp: now() - 1 })).status).toBe(401);
    const { exp, ...noExp } = goodClaims(me.id);
    expect(exp).toBeTruthy();
    expect((await mine(noExp)).status).toBe(401);
    expect((await mine({ ...goodClaims(me.id), exp: `${now() + 600}` })).status).toBe(401);
    expect((await mine({ ...goodClaims(me.id), sub: 12345 })).status).toBe(401);
    // A token for an account that doesn't exist is nobody, however well signed.
    expect((await mine(goodClaims(crypto.randomUUID()))).status).toBe(401);
  });

  it("won't let a token award itself a second factor", async () => {
    const app = await getTestApp();
    const admin = await account(app, "Admin");
    await db.update(users).set({ platformRole: "admin" }).where(eq(users.id, admin.id));
    const reviewQueue = (token: string) => request(app).get("/api/admin/reports").set("Authorization", `Bearer ${token}`);

    // Signed by us, with mfa: true written in by hand — but 2FA was never set up, so the claim buys nothing: the account still has to enrol.
    const forged = await reviewQueue(forge({ alg: "HS256", typ: "JWT" }, goodClaims(admin.id, { mfa: true })));
    expect(forged.status, JSON.stringify(forged.body)).toBe(403);
    expect(forged.body.code).toBe("mfa_enrollment_required");

    // A real token from before 2FA was set up: it carries no mfa claim, and nothing it can say would add one.
    const before = await request(app).post("/api/auth/mobile/login").set("x-forwarded-for", ip()).send({ email: admin.email, password });
    expect(before.body.accessToken).toBeTruthy();
    expect((await reviewQueue(before.body.accessToken)).body.code).toBe("mfa_enrollment_required");

    // With 2FA on, that token is still refused — now for the other reason — and the password alone no longer even yields one.
    const { secret } = await passMfa(admin.agent);
    const stale = await reviewQueue(before.body.accessToken);
    expect(stale.status).toBe(403);
    expect(stale.body.code).toBe("mfa_required");
    const challenge = await request(app).post("/api/auth/mobile/login").set("x-forwarded-for", ip()).send({ email: admin.email, password });
    expect(challenge.body.mfaRequired).toBe(true);
    expect(challenge.body.accessToken).toBeUndefined();

    // The code is what earns it.
    const done = await request(app).post("/api/auth/mobile/mfa/verify").set("x-forwarded-for", ip())
      .send({ challengeToken: challenge.body.challengeToken, code: codeFor(secret, 1) });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect((await reviewQueue(done.body.accessToken)).status).toBe(200);
  });
});

describe("what a code at sign-in is believed for", () => {
  it("only finishes the sign-in that started in this session, not one started in another", async () => {
    const app = await getTestApp();
    const me = await account(app, "Pending");
    const { secret } = await passMfa(me.agent);

    // The password step, in one browser.
    const theirs = request.agent(app);
    expect((await theirs.post("/api/auth/login").set("x-forwarded-for", ip()).send({ email: me.email, password })).body).toEqual({ mfaRequired: true });

    // A different browser has no pending sign-in: the right code is worth nothing there.
    const attacker = request.agent(app);
    const stolen = await attacker.post("/api/auth/mfa/verify").set("x-forwarded-for", ip()).send({ code: codeFor(secret, 1) });
    expect(stolen.status).toBe(401);
    expect(stolen.body.code).toBe("mfa_challenge_expired");
    expect((await attacker.get("/api/auth/user")).status).toBe(401);

    // The browser that typed the password can finish, and its session id changes when it does.
    const before = await theirs.get("/api/auth/mfa/status");
    expect(before.status).toBe(401);
    const ok = await theirs.post("/api/auth/mfa/verify").set("x-forwarded-for", ip()).send({ code: codeFor(secret, 1) });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect((await theirs.get("/api/auth/user")).status).toBe(200);
  });

  it("forgets the pending sign-in once it's stale, even with the right code", async () => {
    const app = await getTestApp();
    const me = await account(app, "Stale");
    const { secret } = await passMfa(me.agent);

    const theirs = request.agent(app);
    expect((await theirs.post("/api/auth/login").set("x-forwarded-for", ip()).send({ email: me.email, password })).body.mfaRequired).toBe(true);

    // Age the pending sign-in past its five minutes, in the session store itself.
    const aged = await pool.query(
      `UPDATE sessions SET sess = jsonb_set(sess, '{mfaPending,at}', to_jsonb($1::bigint))
       WHERE sess -> 'mfaPending' ->> 'userId' = $2`,
      [Date.now() - 10 * 60_000, me.id],
    );
    expect(aged.rowCount).toBe(1);

    const late = await theirs.post("/api/auth/mfa/verify").set("x-forwarded-for", ip()).send({ code: codeFor(secret, 1) });
    expect(late.status).toBe(401);
    expect(late.body.code).toBe("mfa_challenge_expired");
    expect((await theirs.get("/api/auth/user")).status).toBe(401);
    // And it's gone, so the next attempt isn't "expired" once more but simply nothing.
    const gone = await pool.query("SELECT 1 FROM sessions WHERE sess -> 'mfaPending' ->> 'userId' = $1", [me.id]);
    expect(gone.rowCount).toBe(0);
  });
});

describe("what a mobile sign-out is believed for", () => {
  it("revokes the token it's handed and nothing else, with no session and no account check", async () => {
    const app = await getTestApp();
    const me = await account(app, "Devices");
    const phone = await request(app).post("/api/auth/mobile/login").set("x-forwarded-for", ip()).send({ email: me.email, password, device: "Pixel 8" });
    const tablet = await request(app).post("/api/auth/mobile/login").set("x-forwarded-for", ip()).send({ email: me.email, password, device: "iPad" });

    // No Authorization header at all: the refresh token in the body is the credential.
    const out = await request(app).post("/api/auth/mobile/logout").set("x-forwarded-for", ip()).send({ refreshToken: phone.body.refreshToken });
    expect(out.status).toBe(200);

    expect((await request(app).post("/api/auth/mobile/refresh").set("x-forwarded-for", ip()).send({ refreshToken: phone.body.refreshToken })).status).toBe(401);
    expect((await request(app).post("/api/auth/mobile/refresh").set("x-forwarded-for", ip()).send({ refreshToken: tablet.body.refreshToken })).status).toBe(200);
    // Someone else's guess revokes nothing.
    expect((await request(app).post("/api/auth/mobile/logout").set("x-forwarded-for", ip()).send({ refreshToken: "not-a-token" })).status).toBe(200);
  });
});

describe("what a device label is believed for", () => {
  it("is a name in a list: stored cleaned and capped, and never decides anything", async () => {
    const app = await getTestApp();
    const me = await account(app, "Label");
    const admin = await account(app, "Real");
    await db.update(users).set({ platformRole: "admin" }).where(eq(users.id, admin.id));

    // A label that reads like a claim about who you are, in every shape someone might try.
    const nasty = `admin  role=admin\n\n${"x".repeat(300)}`;
    const session = await request(app).post("/api/auth/mobile/login").set("x-forwarded-for", ip()).send({ email: me.email, password, device: nasty });
    expect(session.status).toBe(200);

    const [row] = await db.select().from(mobileRefreshTokens).where(eq(mobileRefreshTokens.userId, me.id));
    expect(row.device).not.toContain(" ");
    expect(row.device!.length).toBeLessThanOrEqual(DEVICE_LABEL_MAX);
    expect(row.device).not.toContain("\n");

    // It bought nothing: still an ordinary account, on the admin routes and everywhere else.
    expect((await request(app).get("/api/admin/reports").set("Authorization", `Bearer ${session.body.accessToken}`)).status).toBe(404);
    const me2 = await request(app).get("/api/auth/mobile/me").set("Authorization", `Bearer ${session.body.accessToken}`);
    expect(me2.body.user.platformRole).toBe("user");
    // And the label doesn't travel with the token: refreshing keeps the account's own rights.
    const refreshed = await request(app).post("/api/auth/mobile/refresh").set("x-forwarded-for", ip()).send({ refreshToken: session.body.refreshToken });
    expect((await request(app).get("/api/admin/reports").set("Authorization", `Bearer ${refreshed.body.accessToken}`)).status).toBe(404);
  });
});
