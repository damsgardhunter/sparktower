/**
 * The three things sign-in was missing.
 *
 *  - A password list tried from many addresses met no limit: the per-address
 *    limit never sees it. Failures now count against the account too.
 *  - Six characters was a password, and "password123" was a password.
 *  - There was no way to change one, so somebody whose password leaked could
 *    only ask us to change it for them — and nothing would have signed out the
 *    sessions it was protecting.
 */
import { describe, it, expect, afterAll, vi } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { db, pool } from "../../server/db";
import { users } from "@shared/schema";
import { RATE_LIMITS } from "@shared/moderation";
import { PASSWORD_MIN } from "@shared/passwords";

afterAll(async () => { await closeTestApp(); });

const password = "Testpass123!";
let n = 0;
const ip = () => `198.51.118.${20 + (n++ % 200)}`;

async function account(app: any, first: string) {
  n += 1;
  const agent = request.agent(app);
  const email = `signin-${first.toLowerCase()}-${Date.now()}-${n}@example.test`;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", ip()).send({ email, password, firstName: first });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return { agent, email, id: res.body.id as string };
}

describe("what a password has to be", () => {
  it("refuses the short, the common, and the one that's just your address", async () => {
    const app = await getTestApp();
    const email = `weak-${Date.now()}@example.test`;
    const tryIt = (pw: string, address = email) =>
      request(app).post("/api/auth/register").set("x-forwarded-for", ip()).send({ email: address, password: pw, firstName: "Weak" });

    const short = await tryIt("shortpw");
    expect(short.status).toBe(400);
    expect(short.body).toMatchObject({ field: "password" });
    expect(short.body.message).toContain(`${PASSWORD_MIN} characters`);

    // Long enough, and on every list.
    expect((await tryIt("password123")).status).toBe(400);
    expect((await tryIt("qwertyuiop")).status).toBe(400);
    expect((await tryIt("11111111")).status).toBe(400);
    // The address with a little on the end.
    const named = `casey-${Date.now()}@example.test`;
    expect((await tryIt(`casey-${named.split("@")[0].split("-")[1]}`, named)).status).toBe(400);

    // And something reasonable gets through.
    const fine = await tryIt("weeknight recipes for two");
    expect(fine.status, JSON.stringify(fine.body)).toBe(201);
  });

  it("holds mobile sign-up to the same rule", async () => {
    const app = await getTestApp();
    const weak = await request(app).post("/api/auth/mobile/register").set("x-forwarded-for", ip())
      .send({ email: `mobile-weak-${Date.now()}@example.test`, password: "letmein1", firstName: "Weak" });
    expect(weak.status).toBe(400);
    expect(weak.body.field).toBe("password");
  });
});

describe("guessing at one account", () => {
  it("stops after enough failures, however many addresses they come from — and a correct password never counts", async () => {
    const app = await getTestApp();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const victim = await account(app, "Victim");

    // Every attempt from a different address, so only the per-account limit can see this.
    let refusedAfter = 0;
    for (let i = 1; i <= RATE_LIMITS.loginAccount.max + 1; i++) {
      const res = await request(app).post("/api/auth/login").set("x-forwarded-for", ip())
        .send({ email: victim.email, password: `wrong-guess-${i}` });
      if (res.status === 429) { refusedAfter = i; break; }
      expect(res.status, `attempt ${i}: ${JSON.stringify(res.body)}`).toBe(401);
    }
    expect(refusedAfter, "the attack should be refused at the account's limit").toBe(RATE_LIMITS.loginAccount.max + 1);

    // Refused the same way everything else is refused.
    const refused = await request(app).post("/api/auth/login").set("x-forwarded-for", ip()).send({ email: victim.email, password });
    expect(refused.status).toBe(429);
    expect(refused.body).toMatchObject({ action: "loginAccount", code: "rate_limited" });

    // Another account is untouched: the limit is about this one, not the address or the server.
    const bystander = await account(app, "Bystander");
    const theirs = await request(app).post("/api/auth/login").set("x-forwarded-for", ip()).send({ email: bystander.email, password });
    expect(theirs.status).toBe(200);
  }, 120_000);

  it("says nothing about whether the account exists", async () => {
    const app = await getTestApp();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const real = await account(app, "Real");
    const unknown = `nobody-${Date.now()}@example.test`;

    const hit = (email: string) => request(app).post("/api/auth/login").set("x-forwarded-for", ip()).send({ email, password: "wrong-guess-here" });
    const [a, b] = [await hit(real.email), await hit(unknown)];
    expect(a.status).toBe(b.status);
    expect(a.body.message).toBe(b.body.message);

    // The limit counts the address that was typed, so an unknown one is limited too — the shape of the answer is the same either way.
    for (let i = 0; i < RATE_LIMITS.loginAccount.max; i++) await hit(unknown);
    expect((await hit(unknown)).status).toBe(429);
  }, 120_000);
});

describe("changing a password", () => {
  it("needs the current one, refuses a weak new one, and signs the other sessions out", async () => {
    const app = await getTestApp();
    const me = await account(app, "Changer");

    // A second browser and a phone, both signed in on the old password.
    const otherBrowser = request.agent(app);
    expect((await otherBrowser.post("/api/auth/login").set("x-forwarded-for", ip()).send({ email: me.email, password })).status).toBe(200);
    const phone = await request(app).post("/api/auth/mobile/login").set("x-forwarded-for", ip()).send({ email: me.email, password, device: "Phone" });
    expect(phone.body.accessToken).toBeTruthy();

    const wrong = await me.agent.post("/api/auth/change-password").send({ currentPassword: "not-my-password", newPassword: "a better passphrase" });
    expect(wrong.status).toBe(401);
    expect(wrong.body.code).toBe("bad_password");

    const weak = await me.agent.post("/api/auth/change-password").send({ currentPassword: password, newPassword: "password123" });
    expect(weak.status).toBe(400);
    expect(weak.body.field).toBe("newPassword");

    const same = await me.agent.post("/api/auth/change-password").send({ currentPassword: password, newPassword: password });
    expect(same.status).toBe(400);

    const changed = await me.agent.post("/api/auth/change-password").send({ currentPassword: password, newPassword: "a better passphrase" });
    expect(changed.status, JSON.stringify(changed.body)).toBe(200);
    expect(changed.body.sessionsEnded).toBeGreaterThanOrEqual(1);
    expect(changed.body.devicesSignedOut).toBeGreaterThanOrEqual(1);

    // This session stays; the other browser and the phone don't.
    expect((await me.agent.get("/api/auth/user")).status).toBe(200);
    expect((await otherBrowser.get("/api/auth/user")).status).toBe(401);
    expect((await request(app).get("/api/auth/mobile/me").set("Authorization", `Bearer ${phone.body.accessToken}`)).status).toBe(401);
    expect((await request(app).post("/api/auth/mobile/refresh").set("x-forwarded-for", ip()).send({ refreshToken: phone.body.refreshToken })).status).toBe(401);

    // The new password is the password now, and the old one isn't.
    expect((await request(app).post("/api/auth/login").set("x-forwarded-for", ip()).send({ email: me.email, password })).status).toBe(401);
    expect((await request(app).post("/api/auth/login").set("x-forwarded-for", ip()).send({ email: me.email, password: "a better passphrase" })).status).toBe(200);
    // Stored hashed, as before.
    const [row] = await db.select().from(users).where(eq(users.id, me.id));
    expect(row.passwordHash).not.toContain("passphrase");
    expect(row.accessTokensRevokedAt).toBeTruthy();
  }, 120_000);

  it("is refused for an account that signs in with Google, and for nobody at all", async () => {
    const app = await getTestApp();
    const me = await account(app, "Google");
    await db.update(users).set({ passwordHash: null }).where(eq(users.id, me.id));
    const res = await me.agent.post("/api/auth/change-password").send({ currentPassword: password, newPassword: "a better passphrase" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("no_password");

    expect((await request(app).post("/api/auth/change-password").send({ currentPassword: password, newPassword: "a better passphrase" })).status).toBe(401);
    // Nothing was written by the refusals.
    expect((await pool.query("SELECT password_hash FROM users WHERE id = $1", [me.id])).rows[0].password_hash).toBeNull();
  });
});
